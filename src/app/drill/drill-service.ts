/**
 * The drill run, server side. This module is never imported by a client component.
 *
 * ─── The timer is here, and only here ────────────────────────────────────────
 *
 * The 90-second cap is part of the scoring function (rubrics.md: 1.0 under 45s,
 * 0.8 under 90s, 0.0 on timeout), so the recorded elapsed time is server-authoritative
 * by construction, not by convention:
 *
 *   1. `issuedAtMs` is stamped with `Date.now()` on the server at the moment the item
 *      is handed out, and is stored in server state. It is never accepted as input.
 *   2. Nothing in the submit path takes a time argument. `submitAnswer(runId, token,
 *      answer)` has nowhere to put a client-supplied duration, so a tampered or merely
 *      skewed client clock cannot change the score. Elapsed is always
 *      `Date.now() - issued.issuedAtMs`, computed here.
 *   3. The payload carries `clock`, which exists purely so the browser can draw a
 *      countdown. The field is named `displayClock` at the component boundary and is
 *      not round-tripped.
 *   4. When the client's display clock reaches zero it calls `expireItem`, which is a
 *      request, not an assertion: the server re-derives elapsed and refuses to record a
 *      timeout if its own clock says time remains. A fast client cannot end an item early.
 *
 * State lives in a module-level Map, which is correct for a single-process dev server
 * and is exactly what Track A's store replaces at integration. The seam is the
 * `issuedAtMs` field: wherever it is persisted, the rule stays "the server wrote it".
 */

import type {
  DrillAnswer,
  DrillAttempt,
  DrillItem,
  DrillScore,
  DrillSessionResult,
  Mechanism,
  ProblemContent,
} from '@/lib/types'
import { DRILL_TIME_CAP_SEC } from '@/lib/types'
import { MOCK_LEARNER_ID, store } from '@/lib/ui-store'
import { prisma } from '@/lib/store'
import { constraintsFor, difficultyFor, type Difficulty } from '@/lib/presentation'
import { MECHANISM_LABEL, REDUNDANCY_LABEL } from '@/components/labels'
import { drillScore, gradeRedundancyOffline } from '@/lib/scoring'
import { selectDrillItems } from '@/lib/interleave'

// ─────────────────────────────────────────────────────────────────────────────
// Wire shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Display-only clock data. Read by the countdown, never sent back to the server. */
export interface DisplayClock {
  /** Server timestamp of issuance, in server ms. */
  issuedAtServerMs: number
  /** Server's `Date.now()` at the same instant, so the client can offset its own clock. */
  serverNowMs: number
  capSec: number
}

export interface DrillItemPayload {
  /** Derived from the curriculum phase, so it cannot drift from the DAG. */
  difficulty: Difficulty
  /** The forged edge cases, rendered as a constraints block. */
  constraints: string[]
  /** Opaque handle. The server's own record of this issuance hangs off it. */
  token: string
  /** 1-based position in the run. The learner sees a count, never a score-so-far. */
  index: number
  totalItems: number
  item: DrillItem
  displayClock: DisplayClock
}

/** One line, naming the discriminator. Never an explanation — that is the post-mortem. */
export interface DrillFeedback {
  line: string
  mechanismCorrect: boolean
  redundancyCorrect: boolean
  score: DrillScore
  /** Server-computed. The client never supplies this. */
  elapsedSec: number
  timedOut: boolean
}

export type SettleResult =
  | { kind: 'settled'; feedback: DrillFeedback; itemsRemaining: number }
  /** The server disagrees that time is up. The client resyncs its display clock. */
  | { kind: 'still-running'; payload: DrillItemPayload }

/**
 * Issuing the next item is a separate call, deliberately. If settling also issued,
 * the seconds the learner spends reading feedback would be charged to the next item's
 * 90. The next timestamp is stamped when the learner asks for the next item.
 */
export type AdvanceResult =
  | { kind: 'next'; payload: DrillItemPayload }
  | { kind: 'done'; summary: DrillSessionResult }

// ─────────────────────────────────────────────────────────────────────────────
// Server-held run state
// ─────────────────────────────────────────────────────────────────────────────

interface IssuedItem {
  token: string
  problemId: string
  /** Written by the server, at issuance. Never read from a request. */
  issuedAtMs: number
  settled: boolean
}

interface DrillRun {
  runId: string
  learnerId: string
  problemIds: string[]
  cursor: number
  issued: Map<string, IssuedItem>
  attempts: DrillAttempt[]
  confusions: Array<[Mechanism, Mechanism]>
}

/** A warm-up is ~10 interleaved items (curriculum.md: 5-minute warm-up block). */
const DRILL_SET_SIZE = 10

/**
 * Run state is persisted, not held in memory.
 *
 * A module-level Map does not survive the module re-evaluation that happens
 * between rendering the page and executing a server action, so the run was gone
 * by the time the learner pressed Submit and every answer reported an expired
 * run. `issuedAtMs` still originates on the server and is still never accepted
 * as input — persisting it changes where the server keeps its own timestamp,
 * not who writes it.
 */
type PersistedRun = Omit<DrillRun, 'issued'> & { issued: IssuedItem[] }

async function loadRun(runId: string): Promise<DrillRun | null> {
  const row = await prisma.drillSession.findUnique({ where: { id: runId } })
  if (!row?.runState) return null
  const parsed = JSON.parse(row.runState) as PersistedRun
  return { ...parsed, issued: new Map(parsed.issued.map((i) => [i.token, i])) }
}

async function saveRun(run: DrillRun): Promise<void> {
  const persisted: PersistedRun = { ...run, issued: [...run.issued.values()] }
  await prisma.drillSession.update({
    where: { id: run.runId },
    data: { runState: JSON.stringify(persisted) },
  })
}

let counter = 0

const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++counter).toString(36)}`

// ─────────────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Selection is delegated to the real engine, which additionally weights
 * confusable pairs and due reviews and plants misleading fingerprints. It throws
 * InterleavingViolation rather than degrading into a blocked run.
 */
function selectItems(problems: ProblemContent[], count: number): DrillItem[] {
  return selectDrillItems({ pool: problems, count: Math.min(count, problems.length) })
}

function toDrillItem(p: ProblemContent): DrillItem {
  const variant = p.drillVariants.find((v) => v.disguiseLevel === p.disguiseLevel) ?? p.drillVariants[0]
  return {
    problemId: p.problemId,
    statement: variant?.statement ?? p.statement,
    disguiseLevel: p.disguiseLevel,
    targetMechanism: p.primaryPattern,
    targetRedundancy: p.redundancy,
    isDueReview: false,
    hasMisleadingFingerprint: p.misleadingFingerprint !== null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Issuance — the only place a timestamp is created
// ─────────────────────────────────────────────────────────────────────────────

async function issue(run: DrillRun): Promise<DrillItemPayload | null> {
  const problemId = run.problemIds[run.cursor]
  if (problemId === undefined) return null
  const problem = await store.getProblem(problemId)
  if (!problem) return null

  const now = Date.now() // server clock, the only clock that counts
  const record: IssuedItem = { token: nextId('item'), problemId, issuedAtMs: now, settled: false }
  run.issued.set(record.token, record)

  return {
    token: record.token,
    index: run.cursor + 1,
    totalItems: run.problemIds.length,
    item: toDrillItem(problem),
    difficulty: difficultyFor(problem.phase),
    constraints: constraintsFor(problem),
    displayClock: { issuedAtServerMs: record.issuedAtMs, serverNowMs: now, capSec: DRILL_TIME_CAP_SEC },
  }
}

export async function startRun(learnerId: string = MOCK_LEARNER_ID): Promise<{
  runId: string
  payload: DrillItemPayload
}> {
  const all = await store.listProblems()
  const selected = selectItems(all, DRILL_SET_SIZE)
  const row = await prisma.drillSession.create({ data: { learnerId } })
  const run: DrillRun = {
    runId: row.id,
    learnerId,
    problemIds: selected.map((i) => i.problemId),
    cursor: 0,
    issued: new Map(),
    attempts: [],
    confusions: [],
  }
  const payload = await issue(run)
  if (!payload) throw new Error('Drill run has no items.')
  await saveRun(run)
  return { runId: run.runId, payload }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback — one line, the discriminator, never the explanation
// ─────────────────────────────────────────────────────────────────────────────

function feedbackLine(args: {
  problem: ProblemContent
  chosen: Mechanism | null
  mechanismCorrect: boolean
  redundancyCorrect: boolean
  timedOut: boolean
  elapsedSec: number
}): string {
  const { problem, chosen, mechanismCorrect, redundancyCorrect, timedOut, elapsedSec } = args
  const target = MECHANISM_LABEL[problem.primaryPattern]
  const waste = REDUNDANCY_LABEL[problem.redundancy]

  if (timedOut) {
    return `Time. ${target}, because the waste is ${waste}. The clock is part of recognition, so this scores zero.`
  }

  if (!mechanismCorrect) {
    const discriminator = chosen
      ? problem.distractors.find((d) => d.mechanism === chosen)?.temptingBecause
      : undefined
    const tail =
      discriminator ?? `The waste is ${waste}, and that is what selects the tool — not the wording.`
    const lead = redundancyCorrect
      ? `You named the waste and reached for the wrong tool. ${target}, not ${chosen ? MECHANISM_LABEL[chosen] : 'that'}.`
      : `${target}, not ${chosen ? MECHANISM_LABEL[chosen] : 'that'}.`
    return `${lead} ${tail}`
  }

  if (!redundancyCorrect) {
    return `Mechanism right, waste not named. It is ${waste} — name that and the mechanism follows instead of being recalled.`
  }

  return elapsedSec < 45
    ? `${waste} to ${target}, in ${elapsedSec}s. That is the derivation running, not the keyword.`
    : `${waste} to ${target}. Both parts, and the second one is the one that transfers.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement
// ─────────────────────────────────────────────────────────────────────────────

async function settle(
  run: DrillRun,
  issued: IssuedItem,
  answer: DrillAnswer,
  forcedTimeout: boolean,
): Promise<DrillFeedback> {
  // Elapsed is derived here, from the timestamp the server itself wrote.
  const elapsedSec = Math.round((Date.now() - issued.issuedAtMs) / 1000)
  const timedOut = forcedTimeout || elapsedSec > DRILL_TIME_CAP_SEC

  const problem = await store.getProblem(issued.problemId)
  if (!problem) throw new Error(`Missing problem ${issued.problemId}`)

  const mechanismCorrect = !timedOut && answer.mechanism === problem.primaryPattern
  const redundancyCorrect =
    !timedOut && gradeRedundancyOffline(answer.redundancy, problem.redundancy)
  const score = drillScore({ mechanismCorrect, redundancyCorrect, elapsedSec })

  const attempt: DrillAttempt = {
    problemId: problem.problemId,
    answer,
    mechanismCorrect,
    redundancyCorrect,
    score,
    elapsedSec,
    timedOut,
  }
  run.attempts.push(attempt)
  if (!mechanismCorrect && answer.mechanism) {
    run.confusions.push([problem.primaryPattern, answer.mechanism])
  }
  await store.recordDrillAttempt(run.learnerId, attempt)

  issued.settled = true
  run.cursor += 1

  return {
    line: feedbackLine({
      problem,
      chosen: answer.mechanism,
      mechanismCorrect,
      redundancyCorrect,
      timedOut,
      elapsedSec,
    }),
    mechanismCorrect,
    redundancyCorrect,
    score,
    elapsedSec,
    timedOut,
  }
}

function summarize(run: DrillRun): DrillSessionResult {
  const times = run.attempts.map((a) => a.elapsedSec).sort((a, b) => a - b)
  const mid = times.length === 0 ? 0 : times[Math.floor((times.length - 1) / 2)]
  const recognitionDelta: Record<string, number> = {}
  for (const a of run.attempts) recognitionDelta[a.problemId] = a.score

  return {
    items: run.attempts.length,
    correctBoth: run.attempts.filter((a) => a.mechanismCorrect && a.redundancyCorrect).length,
    correctPatternOnly: run.attempts.filter((a) => a.mechanismCorrect && !a.redundancyCorrect).length,
    correctRedundancyOnly: run.attempts.filter((a) => !a.mechanismCorrect && a.redundancyCorrect).length,
    missed: run.attempts.filter((a) => !a.mechanismCorrect && !a.redundancyCorrect).length,
    medianTimeSec: mid,
    confusions: run.confusions,
    recognitionDelta,
  }
}

async function locate(runId: string, token: string): Promise<{ run: DrillRun; issued: IssuedItem }> {
  const run = await loadRun(runId)
  if (!run) throw new Error('That drill run has expired. Start a new one.')
  const issued = run.issued.get(token)
  if (!issued) throw new Error('Unknown drill item.')
  if (issued.settled) throw new Error('That item is already settled.')
  return { run, issued }
}

const remainingIn = (run: DrillRun) => run.problemIds.length - run.cursor

/**
 * Both fields are required. The UI blocks an incomplete submit, and so does this —
 * the UI is never the only thing enforcing a rule.
 */
export async function submitAnswer(
  runId: string,
  token: string,
  answer: DrillAnswer,
): Promise<SettleResult> {
  const { run, issued } = await locate(runId, token)
  if (answer.mechanism === null || answer.redundancy.trim() === '') {
    throw new Error('Both the mechanism and the redundancy are required.')
  }
  const feedback = await settle(run, issued, answer, false)
  await saveRun(run) // settle mutated the run; persist before the action returns
  return { kind: 'settled', feedback, itemsRemaining: remainingIn(run) }
}

/**
 * A request to expire, not an assertion that time is up. The server re-derives elapsed
 * from its own timestamp and hands the item back if it disagrees.
 */
export async function expireItem(
  runId: string,
  token: string,
  partial: DrillAnswer,
): Promise<SettleResult> {
  const { run, issued } = await locate(runId, token)
  const elapsedSec = (Date.now() - issued.issuedAtMs) / 1000
  if (elapsedSec < DRILL_TIME_CAP_SEC) {
    const problem = await store.getProblem(issued.problemId)
    if (!problem) throw new Error(`Missing problem ${issued.problemId}`)
    return {
      kind: 'still-running',
      payload: {
        token: issued.token,
        index: run.cursor + 1,
        totalItems: run.problemIds.length,
        item: toDrillItem(problem),
        difficulty: difficultyFor(problem.phase),
        constraints: constraintsFor(problem),
        displayClock: {
          issuedAtServerMs: issued.issuedAtMs,
          // Deliberately re-read: the resync must reflect the server's clock now,
          // not the client's belief about it.
          serverNowMs: Date.now(),
          capSec: DRILL_TIME_CAP_SEC,
        },
      },
    }
  }
  const feedback = await settle(run, issued, partial, true)
  await saveRun(run)
  return { kind: 'settled', feedback, itemsRemaining: remainingIn(run) }
}

/** Issues the next item, stamping its server timestamp at this instant. */
export async function advanceRun(runId: string): Promise<AdvanceResult> {
  const run = await loadRun(runId)
  if (!run) throw new Error('That drill run has expired. Start a new one.')
  const payload = await issue(run)
  await saveRun(run)
  return payload ? { kind: 'next', payload } : { kind: 'done', summary: summarize(run) }
}
