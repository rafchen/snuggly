/**
 * Agent: Curriculum Planner. The only agent permitted to write mastery.
 *
 * Structural rules:
 *  - The block skeleton is built in code from the 60-minute template, so **at most
 *    one new pattern per session** is a property of the data structure, not an
 *    instruction: exactly one `core` block, targeting exactly one node.
 *  - Every block carries a non-empty `why`. Enforced by schema and re-asserted
 *    after generation.
 *  - Gates are enforced: `assertUnlocked` throws `GateViolation` for any node
 *    whose prerequisites are not at UNLOCK_THRESHOLD, whatever the learner asks for.
 *  - Review problems are drawn from unseen problems only, in code.
 *  - The circuit breaker (three consecutive F1/F2) overrides everything else.
 */

import * as z from 'zod/v4'

import { SKILL_DAG, skillNode, type Mechanism, type PhaseNumber } from '../taxonomy'
import { dueMechanismsFrom } from '../interleave'
import {
  MASTERY_THRESHOLDS,
  MASTERY_WRITER,
  UNLOCK_THRESHOLD,
  type BlockKind,
  type DataStore,
  type DisguiseLevel,
  type FailureAnalysis,
  type MasteryState,
  type ProblemContent,
  type ProblemRequest,
  type SessionBlock,
  type SessionPlan,
} from '../types'
import { runAgent, type StructuredClient } from './client'

/** Thrown when a node would be scheduled past an unmet gate. */
export class GateViolation extends Error {
  constructor(readonly node: string, readonly missingPrereqs: string[]) {
    super(
      `Gate: "${node}" is locked — unmet prerequisites: ${missingPrereqs.join(', ')}. Advancing past a gate is how learners end up feeling behind.`,
    )
    this.name = 'GateViolation'
  }
}

/** Thrown when a plan would violate a scheduling rule. */
export class PlanRuleViolation extends Error {
  constructor(rule: string) {
    super(`curriculum-planner: ${rule}`)
    this.name = 'PlanRuleViolation'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mastery reading (pure)
// ─────────────────────────────────────────────────────────────────────────────

export function isMastered(s: MasteryState | undefined): boolean {
  if (!s) return false
  return (
    s.recognition >= MASTERY_THRESHOLDS.recognition &&
    s.derivation >= MASTERY_THRESHOLDS.derivation &&
    s.implementation >= MASTERY_THRESHOLDS.implementation
  )
}

export function isUnlocked(node: string, byNode: Map<string, MasteryState>): boolean {
  return missingPrereqs(node, byNode).length === 0
}

export function missingPrereqs(node: string, byNode: Map<string, MasteryState>): string[] {
  const def = skillNode(node)
  if (!def) return []
  return def.prereqs.filter((p) => (byNode.get(p)?.recognition ?? 0) < UNLOCK_THRESHOLD)
}

export function assertUnlocked(node: string, byNode: Map<string, MasteryState>): void {
  const missing = missingPrereqs(node, byNode)
  if (missing.length > 0) throw new GateViolation(node, missing)
}

/**
 * Phase-exit status. Criteria are the phase's nodes at mastery, plus (Phase 5
 * only) a non-null articulation — articulation never blocks a Phase 0-4 transition.
 */
export function gateStatus(mastery: MasteryState[]): SessionPlan['gateStatus'] {
  const byNode = new Map(mastery.map((m) => [m.node, m]))
  const phase = currentPhase(byNode)
  const nodes = SKILL_DAG.filter((n) => n.phase === phase)

  const missing = nodes.filter((n) => !isMastered(byNode.get(n.id))).map((n) => n.id)
  let total = nodes.length
  let met = nodes.length - missing.length

  if (phase === 5) {
    total += 1
    const articulated = mastery.some((m) => m.articulation !== null && m.articulation >= 0.7)
    if (articulated) met += 1
    else missing.push('articulation_interview_sim')
  }

  return { phase, criteriaMet: met, criteriaTotal: total, missing }
}

/** The lowest phase that still has unmastered nodes. Gates are not suggestions. */
export function currentPhase(byNode: Map<string, MasteryState>): PhaseNumber {
  for (const phase of [0, 1, 2, 3, 4, 5] as PhaseNumber[]) {
    const nodes = SKILL_DAG.filter((n) => n.phase === phase)
    if (nodes.some((n) => !isMastered(byNode.get(n.id)))) return phase
  }
  return 5
}

/** Next node to teach: unlocked, unmastered, lowest phase, prerequisites honoured. */
export function nextNode(byNode: Map<string, MasteryState>): string | null {
  const phase = currentPhase(byNode)
  const candidates = SKILL_DAG.filter(
    (n) => n.phase <= phase && !isMastered(byNode.get(n.id)) && isUnlocked(n.id, byNode),
  )
  return candidates[0]?.id ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema — mirrors agents/curriculum-planner.md
// ─────────────────────────────────────────────────────────────────────────────

const blockKind = z.enum(['warmup', 'review', 'core', 'postmortem', 'plan'])

export const SessionPlanSchema = z.object({
  session_plan: z.array(
    z.object({
      block: blockKind,
      content: z.string().min(1),
      /** One sentence the learner actually sees. Never empty. */
      why: z.string().min(1),
    }),
  ),
  learner_message: z.string().min(1),
})
export type SessionPlanPayload = z.infer<typeof SessionPlanSchema>

const ROLE = `You are the curriculum-planner of the Cracked method. You decide what happens
next and you say why. You replace the unmotivated problem list — the thing that
makes learners feel like they're drawing from a deck rather than following a path.

Rules you are writing inside of (all already enforced in code):
- At most one new pattern per session. The bottleneck on learning is
  consolidation, not exposure, and exposure is what this market already has.
- Review is served on problems the learner has never seen. Re-serving the
  original measures memory of that problem and nothing else.
- The warm-up interleaves across all unlocked patterns, never just the current node.
- Difficulty targets ~70% success. Calibrate with disguise level before reaching
  for harder problems — disguise is the axis that tracks interview conditions.
- Honor the failure-analyst's prescription. A diagnosis that doesn't change the
  plan is decoration.

When holding someone back, be specific and bounded: "You're 2 nodes from the
Phase 3 gate — union-find implementation and the heap/sort discriminator.
Probably four sessions. Then graphs open up." A named, finite distance is
tolerable in a way that vague "not ready yet" is not.

Every block gets a one-sentence justification grounded in mastery state.`

// ─────────────────────────────────────────────────────────────────────────────
// Runtime
// ─────────────────────────────────────────────────────────────────────────────

export interface PlannerDeps {
  store: DataStore
  client?: StructuredClient
}

export interface PlanOptions {
  analysis?: FailureAnalysis | null
  /** Minutes available. Defaults to the 60-minute template. */
  minutes?: number
}

interface Skeleton {
  block: BlockKind
  agent: SessionBlock['agent']
  minutes: number
  /** Deterministic content, generated here so the model cannot add a second new node. */
  content: string
  fallbackWhy: string
}

export async function planSession(
  deps: PlannerDeps,
  learnerId: string,
  opts: PlanOptions = {},
): Promise<SessionPlan> {
  const mastery = await deps.store.getAllMastery(learnerId)
  const byNode = new Map(mastery.map((m) => [m.node, m]))
  const status = gateStatus(mastery)
  const analysis = opts.analysis ?? null

  // Circuit breaker overrides everything, including a learner who wants to push on.
  let target = analysis?.prerequisiteGap
    ? (skillNode(analysis.node)?.prereqs[0] ?? nextNode(byNode))
    : nextNode(byNode)
  if (target) assertUnlocked(target, byNode)

  const due = dueMechanismsFrom(mastery)
  const reviewProblem = await pickReviewProblem(deps.store, learnerId, due)
  const disguise = disguiseFloorFor(mastery)

  const skeleton: Skeleton[] = [
    {
      block: 'warmup',
      agent: 'recognition-drill',
      minutes: analysis?.primaryCode === 'F4' ? 15 : 5,
      content: warmupContent(analysis, due),
      fallbackWhy: analysis
        ? `${analysis.primaryCode} last session — these reps target it directly.`
        : 'Interleaved across every unlocked pattern; recognition is the step being trained.',
    },
    {
      block: 'review',
      agent: 'socratic-coach',
      minutes: 10,
      content: reviewProblem
        ? `${reviewProblem.primaryPattern} on unseen problem "${reviewProblem.problemId}", disguise ${disguise}`
        : 'no pattern is due; extend the warm-up',
      fallbackWhy: due.length
        ? `${due[0]} has decayed past threshold and is due.`
        : 'Nothing due — the slot goes back to recognition reps.',
    },
    {
      block: 'core',
      agent: 'socratic-coach',
      minutes: 30,
      content: target ? `${target}, disguise level ${disguise}` : 'consolidation — no new node is unlocked',
      fallbackWhy: analysis?.prerequisiteGap
        ? `Dropping to ${target} — three consecutive F1/F2 on ${analysis.node} means the foundation is missing, not the effort.`
        : `Prerequisites for ${target ?? 'this node'} are met; it is the next node on the path.`,
    },
    {
      block: 'postmortem',
      agent: 'failure-analyst',
      minutes: 10,
      content: 'classify where the ladder broke, then the invariant probe',
      fallbackWhy: 'The classification is the data the whole system runs on.',
    },
    {
      block: 'plan',
      agent: 'curriculum-planner',
      minutes: 5,
      content: 'apply deltas, state the next target',
      fallbackWhy: 'You should leave knowing exactly what the next session is for.',
    },
  ]

  // Exactly one core block, one target node. This is the "one new pattern" rule
  // as a property of the structure rather than a request to the model.
  const coreBlocks = skeleton.filter((s) => s.block === 'core')
  if (coreBlocks.length !== 1) throw new PlanRuleViolation('a session has exactly one core block')

  const payload = await runAgent({
    agent: 'curriculum-planner',
    system: ROLE,
    schema: SessionPlanSchema,
    client: deps.client,
    user: [
      `Mastery state (post-decay):`,
      mastery
        .map(
          (m) =>
            `  ${m.node}: rec ${m.recognition}, der ${m.derivation}, impl ${m.implementation}, art ${m.articulation ?? 'null'}, codes ${JSON.stringify(m.failureCodes)}`,
        )
        .join('\n') || '  (empty — new learner)',
      ``,
      `Gate: phase ${status.phase}, ${status.criteriaMet}/${status.criteriaTotal} criteria met.`,
      `Missing: ${status.missing.join(', ') || 'none'}`,
      `Due patterns: ${due.join(', ') || 'none'}`,
      analysis
        ? `Last post-mortem: ${analysis.primaryCode} on ${analysis.node} — "${analysis.evidence}". Prescription: ${analysis.prescription.reps} reps of ${analysis.prescription.drillType} across ${analysis.prescription.sessions} sessions.${analysis.prerequisiteGap ? ' PREREQUISITE GAP FLAGGED.' : ''}`
        : `No post-mortem from last session.`,
      ``,
      `The blocks and their content are fixed. Write the "why" for each — one`,
      `sentence, grounded in the state above, that the learner will read — and the`,
      `learner_message (2-3 sentences naming the bounded distance to the gate).`,
      ``,
      skeleton.map((s) => `  ${s.block} (${s.minutes}m): ${s.content}`).join('\n'),
    ].join('\n'),
  })

  const whyByBlock = new Map(payload.session_plan.map((b) => [b.block, b.why.trim()]))
  const sessionPlan: SessionBlock[] = skeleton.map((s) => ({
    block: s.block,
    agent: s.agent,
    minutes: s.minutes,
    content: s.content,
    why: whyByBlock.get(s.block) || s.fallbackWhy,
  }))

  // No block ships without a reason. Diagnose before prescribing.
  for (const b of sessionPlan) {
    if (!b.why || b.why.trim().length === 0) {
      throw new PlanRuleViolation(`block "${b.block}" has no stated reason`)
    }
  }

  return {
    sessionPlan,
    gateStatus: status,
    estimatedSessionsToGate: Math.max(1, status.missing.length * 2),
    learnerMessage: payload.learner_message,
  }
}

/** Problem selection contract. `seenBefore` is a literal `false` — reviews are unseen. */
export function requestProblem(args: {
  targetPattern: Mechanism
  difficulty: ProblemRequest['difficulty']
  disguiseLevel: DisguiseLevel
  distractorSignal?: string | null
}): ProblemRequest {
  return {
    targetPattern: args.targetPattern,
    difficulty: args.difficulty,
    seenBefore: false,
    disguiseLevel: args.disguiseLevel,
    distractorSignal: args.distractorSignal ?? null,
  }
}

/** The single-writer path. Every other agent enqueues; only this one applies. */
export async function applyPendingDeltas(
  deps: PlannerDeps,
  learnerId: string,
): Promise<MasteryState[]> {
  const pending = await deps.store.pendingDeltas(learnerId)
  if (pending.length === 0) return deps.store.getAllMastery(learnerId)
  return deps.store.applyDeltas(learnerId, pending, MASTERY_WRITER)
}

async function pickReviewProblem(
  store: DataStore,
  learnerId: string,
  due: Mechanism[],
): Promise<ProblemContent | null> {
  if (due.length === 0) return null
  const [problems, seen] = await Promise.all([store.listProblems(), store.seenProblemIds(learnerId)])
  const seenSet = new Set(seen)
  // Unseen only. Re-serving the original measures memory of that problem, nothing else.
  return problems.find((p) => due.includes(p.primaryPattern) && !seenSet.has(p.problemId)) ?? null
}

function warmupContent(analysis: FailureAnalysis | null, due: Mechanism[]): string {
  if (analysis?.primaryCode === 'F4') {
    return `15 interleaved, weighted to the confused pair (${analysis.prescription.target})`
  }
  if (analysis) return `10 interleaved, plus ${analysis.prescription.drillType} reps`
  return `10 interleaved across all unlocked patterns${due.length ? `, weighted to ${due.slice(0, 2).join('/')}` : ''}`
}

/** Raise disguise as recognition rises — that, not hardness, is the difficulty axis. */
function disguiseFloorFor(mastery: MasteryState[]): DisguiseLevel {
  if (mastery.length === 0) return 0
  const mean = mastery.reduce((a, m) => a + m.recognition, 0) / mastery.length
  if (mean >= 0.85) return 3
  if (mean >= 0.7) return 2
  if (mean >= 0.5) return 1
  return 0
}
