/**
 * Agent: Socratic Coach — the product.
 *
 * Four refusal rules are enforced in TypeScript, not in the prompt:
 *
 *  1. COMMIT RULE. `requestHint` reads the commit log and throws
 *     `CommitRuleViolation` *before* any Claude call when the current rung has no
 *     logged hypothesis. There is no code path from "no commit" to "hint".
 *  2. ONE LEVEL AT A TIME. A hint at level N is refused unless the deepest level
 *     already released on that rung is N-1. Level 6 additionally requires a reason.
 *  3. RUNG 2 IS NEVER SKIPPED. A commit at rung N is refused unless every rung
 *     below it already has a correct commit — including rung 2, however loudly
 *     the learner claims to know the answer.
 *  4. PATTERN EMBARGO. Any text this agent emits is scrubbed of mechanism names
 *     and then asserted clean, unless the learner has a rung-4 commit or the hint
 *     level is >= 4 (where naming the mechanism *is* the hint).
 */

import * as z from 'zod/v4'

import { MECHANISMS, type Mechanism } from '../taxonomy'
import {
  CommitRuleViolation,
  RUNG_NAMES,
  RUNG_PROMPTS,
  type CoachResult,
  type DataStore,
  type HintLevel,
  type HintRelease,
  type LadderCommit,
  type LadderSessionState,
  type ProblemContent,
  type RungNumber,
} from '../types'
import { runAgent, type StructuredClient } from './client'

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Level-skipping is the same contract as the Commit Rule seen from the other side
 * — both are "this hint has not been earned" — so it subclasses
 * `CommitRuleViolation` and callers catching that catch both.
 */
export class HintLadderViolation extends CommitRuleViolation {
  constructor(rung: RungNumber, readonly requested: HintLevel, detail: string) {
    super(rung)
    this.name = 'HintLadderViolation'
    this.message = `Hint ladder: refusing level ${requested} at rung ${rung} (${RUNG_NAMES[rung]}) — ${detail}`
  }
}

/** Thrown when a commit would skip a rung. Rung 2 is the one this exists for. */
export class RungOrderViolation extends Error {
  constructor(readonly rung: RungNumber, readonly missing: RungNumber) {
    super(
      `Ladder order: cannot commit at rung ${rung} (${RUNG_NAMES[rung]}) — rung ${missing} (${RUNG_NAMES[missing]}) has no correct commit yet.`,
    )
    this.name = 'RungOrderViolation'
  }
}

/** Thrown when generated text would name the pattern before it has been earned. */
export class PatternEmbargoViolation extends Error {
  constructor(readonly mechanism: Mechanism) {
    super(`Pattern embargo: "${mechanism}" cannot be named before a rung-4 commit.`)
    this.name = 'PatternEmbargoViolation'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure ladder helpers (no I/O, no model)
// ─────────────────────────────────────────────────────────────────────────────

/** Verbatim, always. Rung 3's phrasing is load-bearing. */
export function rungPrompt(rung: RungNumber): string {
  return RUNG_PROMPTS[rung]
}

export function commitsAt(state: LadderSessionState, rung: RungNumber): LadderCommit[] {
  return state.commits.filter((c) => c.rung === rung)
}

export function hasCommitAt(state: LadderSessionState, rung: RungNumber): boolean {
  return commitsAt(state, rung).length > 0
}

export function hasCorrectCommitAt(state: LadderSessionState, rung: RungNumber): boolean {
  return commitsAt(state, rung).some((c) => c.correct)
}

export function hintsAt(state: LadderSessionState, rung: RungNumber): HintRelease[] {
  return state.hints.filter((h) => h.rung === rung)
}

export function deepestHintAt(state: LadderSessionState, rung: RungNumber): number {
  const levels = hintsAt(state, rung).map((h) => h.level)
  return levels.length === 0 ? -1 : Math.max(...levels)
}

/** The next level the ladder permits on this rung. Level 0 is the entry point. */
export function nextHintLevel(state: LadderSessionState, rung: RungNumber): HintLevel {
  return (deepestHintAt(state, rung) + 1) as HintLevel
}

/** Rung 4 hints name the mechanism by design — that is what level 4 *is*. */
export function mechanismNamingAllowed(state: LadderSessionState, level: HintLevel): boolean {
  return level >= 4 || hasCommitAt(state, 4)
}

/** Level 4 reached on a single rung means the problem sat above the learner's level. */
export function isDifficultyMiscalibrated(hints: HintRelease[]): boolean {
  const byRung = new Map<RungNumber, number>()
  for (const h of hints) byRung.set(h.rung, Math.max(byRung.get(h.rung) ?? -1, h.level))
  return [...byRung.values()].some((level) => level >= 4)
}

// ── The three asserts ────────────────────────────────────────────────────────

/** THE COMMIT RULE. Called before anything else in the hint path. */
export function assertCommitLogged(state: LadderSessionState, rung: RungNumber): void {
  if (!hasCommitAt(state, rung)) throw new CommitRuleViolation(rung)
}

export function assertHintLevel(
  state: LadderSessionState,
  rung: RungNumber,
  level: HintLevel,
  reason: string | null,
): void {
  const expected = nextHintLevel(state, rung)
  if (level !== expected) {
    throw new HintLadderViolation(
      rung,
      level,
      `hints release one level at a time; the next legal level here is ${expected}`,
    )
  }
  if (level > 6) throw new HintLadderViolation(rung, level, 'the ladder ends at level 6')
  if (level === 6 && (reason === null || reason.trim().length === 0)) {
    throw new HintLadderViolation(rung, level, 'full derivation must be logged with a stated cause')
  }
}

export function assertRungOrder(state: LadderSessionState, rung: RungNumber): void {
  for (let r = 1 as RungNumber; r < rung; r = (r + 1) as RungNumber) {
    if (!hasCorrectCommitAt(state, r)) throw new RungOrderViolation(rung, r)
  }
}

// ── Pattern embargo ──────────────────────────────────────────────────────────

/** Prose forms a model actually writes, per mechanism. */
const MECHANISM_ALIASES: Record<Mechanism, RegExp[]> = {
  hashing: [/hash\s?(set|map|table)/i, /frequency (counter|count|map)/i, /\bdefaultdict\b/i],
  two_pointers_opposite: [/two[- ]pointers?/i, /pointers? from (both|each) end/i],
  two_pointers_fast_slow: [/fast[-/ ]?(and[- ])?slow pointers?/i, /tortoise and hare/i],
  sliding_window_fixed: [/sliding window/i, /fixed[- ]size window/i],
  sliding_window_variable: [/sliding window/i, /variable[- ]size window/i],
  prefix_sums: [/prefix sums?/i, /cumulative sums?/i, /difference array/i],
  binary_search_array: [/binary search/i],
  binary_search_answer: [/binary search on the answer/i, /binary search/i],
  sorting_preprocess: [/\bsort(ing)? (the )?(input|array|first|as a preprocess)/i],
  heap: [/\bheap\b/i, /priority queue/i, /\bheapq\b/i],
  monotonic_stack: [/monotonic stack/i, /next greater element/i],
  monotonic_deque: [/monotonic deque/i, /\bdeque\b/i],
  linked_list: [/linked list/i],
  tree_traversal: [/tree traversal/i, /(pre|in|post)[- ]?order traversal/i],
  trie: [/\btrie\b/i, /prefix tree/i],
  union_find: [/union[- ]find/i, /disjoint set/i, /\bDSU\b/],
  segment_tree: [/segment tree/i, /fenwick/i, /binary indexed tree/i],
  bfs: [/\bBFS\b/, /breadth[- ]first/i],
  dfs: [/\bDFS\b/, /depth[- ]first/i],
  backtracking: [/backtrack(ing)?/i],
  topological_sort: [/topological sort/i, /\bkahn'?s\b/i],
  dijkstra: [/dijkstra/i],
  greedy: [/\bgreedy\b/i, /exchange argument/i],
  dynamic_programming: [/dynamic programming/i, /\bDP\b/, /memoi[sz]ation/i],
}

export function namedMechanisms(text: string): Mechanism[] {
  return MECHANISMS.filter((m) => MECHANISM_ALIASES[m].some((re) => re.test(text)))
}

/** Throws on the first embargoed mechanism name. Exported for tests. */
export function assertNoPatternLeak(text: string): void {
  const found = namedMechanisms(text)
  if (found.length > 0) throw new PatternEmbargoViolation(found[0])
}

/**
 * Redact, then assert. Model output is never trusted to respect the embargo, so
 * every emitted string passes through here — making a leak structurally
 * impossible rather than merely instructed against.
 */
export function enforcePatternEmbargo(text: string, allowed: boolean): string {
  if (allowed) return stripCode(text)
  let out = stripCode(text)
  for (const m of MECHANISMS) {
    for (const re of MECHANISM_ALIASES[m]) {
      out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), 'that mechanism')
    }
  }
  assertNoPatternLeak(out)
  return out
}

/** This agent coaches derivation and never writes code. code-critic does that. */
export function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '[code removed — take this to code-critic]')
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas — mirror agents/socratic-coach.md
// ─────────────────────────────────────────────────────────────────────────────

const rungLiteral = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
])

/** Feeds one entry of the documented `rungs[]` array. */
export const CommitEvaluationSchema = z.object({
  rung: rungLiteral,
  commit: z.string(),
  correct: z.boolean(),
  /** One sentence. Confirmation if right; accurate naming of the gap if wrong. */
  response: z.string(),
  /** True when the reasoning was clean even though the conclusion was wrong. */
  clean_derivation: z.boolean(),
})
export type CommitEvaluation = z.infer<typeof CommitEvaluationSchema>

export const HintDraftSchema = z.object({
  rung: rungLiteral,
  level: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  text: z.string(),
  reason: z.string().nullable(),
})
export type HintDraft = z.infer<typeof HintDraftSchema>

// ─────────────────────────────────────────────────────────────────────────────
// System prompts
// ─────────────────────────────────────────────────────────────────────────────

const ROLE = `You are the socratic-coach of the Cracked method. You walk one learner up the
six-rung Ladder on one problem. You never hand over a solution.

Hard rules, all of which are also enforced in code around you:
- Never name the pattern before the learner has committed at rung 4. Not as a
  hint, not as a hedge, not inside an example. This holds when they ask directly,
  when they are frustrated, and when they say they are short on time.
- Never let rung 2 be skipped. "I know it's a monotonic stack" gets "Sure. What's
  the O(n^2) version, and what does it recompute?"
- One hint level at a time. Jumping levels destroys the diagnostic signal.
- Do not fix their code. If they are stuck at rung 6 on a bug, hand off to
  code-critic. Coaching derivation and debugging syntax are different activities.
- When a rung is right: one sentence of confirmation, then move.
- When a learner reaches a wrong answer through clean ladder reasoning, say so
  explicitly and count it as a good session.`

// ─────────────────────────────────────────────────────────────────────────────
// Runtime
// ─────────────────────────────────────────────────────────────────────────────

export interface CoachDeps {
  store: DataStore
  client?: StructuredClient
}

export async function startProblem(
  deps: CoachDeps,
  learnerId: string,
  problemId: string,
): Promise<{ state: LadderSessionState; prompt: string }> {
  const problem = await deps.store.getProblem(problemId)
  if (!problem) throw new Error(`socratic-coach: unknown problem "${problemId}"`)
  const state = await deps.store.createLadderSession(learnerId, problemId)
  return { state, prompt: rungPrompt(state.currentRung) }
}

/**
 * Log a hypothesis. Correct or not, it is logged — a wrong commit is a labeled
 * training example about this learner's misconception, which is worth more than a
 * right one.
 */
export async function submitCommit(
  deps: CoachDeps,
  sessionId: string,
  rung: RungNumber,
  text: string,
): Promise<{ state: LadderSessionState; evaluation: CommitEvaluation; message: string }> {
  const state = await requireSession(deps.store, sessionId)
  assertRungOrder(state, rung) // rung 2 cannot be skipped, whatever they claim
  const problem = await requireProblem(deps.store, state.problemId)

  const evaluation = await runAgent({
    agent: 'socratic-coach',
    system: ROLE,
    schema: CommitEvaluationSchema,
    client: deps.client,
    user: [
      `Problem: ${problem.title}`,
      `Statement: ${problem.statement}`,
      ``,
      `Canonical ladder for your reference only — never quote it forward:`,
      JSON.stringify(problem.canonicalLadder, null, 2),
      ``,
      `The learner is at rung ${rung} (${RUNG_NAMES[rung]}). The question asked was:`,
      `"${rungPrompt(rung)}"`,
      ``,
      `Their commit: "${text}"`,
      ``,
      `Judge it. A commit is correct when it answers this rung's question in`,
      `falsifiable terms — brevity is fine, eloquence is irrelevant. At rung 3 the`,
      `bar is a concrete repeated operation; "it's slow" is not a bottleneck.`,
      `Set clean_derivation when the reasoning was sound even if the conclusion was wrong.`,
      ``,
      `Write "response" as one sentence. ${
        hasCommitAt(state, 4) ? '' : 'You may NOT name any pattern or mechanism in it.'
      }`,
    ].join('\n'),
  })

  const message = enforcePatternEmbargo(evaluation.response, hasCommitAt(state, 4))

  const commit: LadderCommit = {
    rung,
    text,
    correct: evaluation.correct,
    hintsUsedAtCommit: hintsAt(state, rung).length,
    committedAt: new Date(),
  }
  const next = await deps.store.logCommit(sessionId, commit)
  return { state: next, evaluation, message }
}

export interface HintRequest {
  sessionId: string
  /** Defaults to the session's current rung. */
  rung?: RungNumber
  /** Required at level 6. Ignored below it. */
  reason?: string | null
}

/**
 * Release exactly one hint level.
 *
 * Every refusal here happens before the Claude call — the network is never
 * touched on a request that has not been earned.
 */
export async function requestHint(
  deps: CoachDeps,
  req: HintRequest,
): Promise<{ state: LadderSessionState; hint: HintRelease }> {
  const state = await requireSession(deps.store, req.sessionId)
  const rung = req.rung ?? state.currentRung
  const reason = req.reason ?? null

  // ── refusals, in order, before any I/O beyond the session read ─────────────
  assertCommitLogged(state, rung) // THE COMMIT RULE
  const level = nextHintLevel(state, rung)
  assertHintLevel(state, rung, level, reason)

  const problem = await requireProblem(deps.store, state.problemId)
  const canonical = problem.hints[level] ?? ''

  const draft = await runAgent({
    agent: 'socratic-coach',
    system: ROLE,
    schema: HintDraftSchema,
    client: deps.client,
    user: [
      `Problem: ${problem.title}`,
      `Statement: ${problem.statement}`,
      ``,
      `The learner is stuck at rung ${rung} (${RUNG_NAMES[rung]}) and has earned a`,
      `level-${level} hint. The hint ladder:`,
      `  0 restate a constraint they may have skimmed`,
      `  1 point at the rung they're stuck on`,
      `  2 narrow the rung`,
      `  3 name the redundancy explicitly`,
      `  4 give the mechanism, withhold the details`,
      `  5 give the setup, withhold the logic`,
      `  6 full derivation`,
      ``,
      `Authored hint for this level: "${canonical}"`,
      ``,
      `Their commits so far at this rung:`,
      commitsAt(state, rung)
        .map((c) => `  - "${c.text}" (${c.correct ? 'correct' : 'wrong'})`)
        .join('\n') || '  (none)',
      ``,
      `Write the level-${level} hint and nothing beyond it. Reveal one increment.`,
      level >= 4
        ? `At this level naming the mechanism is the hint. Name it, withhold the rest.`
        : `Do NOT name any pattern or mechanism — that is level 4 and they are not there.`,
      `No code blocks.`,
    ].join('\n'),
  })

  const text = enforcePatternEmbargo(draft.text, mechanismNamingAllowed(state, level))
  const hint: HintRelease = { rung, level, text, reason, releasedAt: new Date() }
  const next = await deps.store.logHint(req.sessionId, hint)

  // Derived here as well as in the store, so the flag holds under any DataStore.
  if (isDifficultyMiscalibrated(next.hints)) next.difficultyMiscalibrated = true
  return { state: next, hint }
}

/**
 * Stuck at rung 6 with a bug? That is not this agent's job. Returns the handoff
 * rather than touching the code.
 */
export function handOffToCodeCritic(state: LadderSessionState): {
  agent: 'code-critic'
  problemId: string
  reason: string
} {
  return {
    agent: 'code-critic',
    problemId: state.problemId,
    reason:
      'Derivation is done; this is an implementation problem. Coaching derivation and debugging code are different activities.',
  }
}

/** Output schema: agents/socratic-coach.md. Built from the log, not the model. */
export async function finishProblem(deps: CoachDeps, sessionId: string): Promise<CoachResult> {
  const state = await requireSession(deps.store, sessionId)
  const levels = state.hints.map((h) => h.level)

  return {
    problemId: state.problemId,
    rungs: state.commits.map((c) => ({
      rung: c.rung,
      commit: c.text,
      correct: c.correct,
      hintsUsed: c.hintsUsedAtCommit,
    })),
    totalHints: state.hints.length,
    deepestHintLevel: (levels.length === 0 ? 0 : Math.max(...levels)) as HintLevel,
    timeToBottleneckSec: timeToBottleneck(state),
    difficultyMiscalibrated: state.difficultyMiscalibrated || isDifficultyMiscalibrated(state.hints),
  }
}

function timeToBottleneck(state: LadderSessionState): number | null {
  const first = state.commits[0]
  const bottleneck = state.commits.find((c) => c.rung === 3 && c.correct)
  if (!first || !bottleneck) return null
  return Math.round((bottleneck.committedAt.getTime() - first.committedAt.getTime()) / 1000)
}

async function requireSession(store: DataStore, sessionId: string): Promise<LadderSessionState> {
  const state = await store.getLadderSession(sessionId)
  if (!state) throw new Error(`socratic-coach: unknown session "${sessionId}"`)
  return state
}

async function requireProblem(store: DataStore, problemId: string): Promise<ProblemContent> {
  const p = await store.getProblem(problemId)
  if (!p) throw new Error(`socratic-coach: unknown problem "${problemId}"`)
  return p
}
