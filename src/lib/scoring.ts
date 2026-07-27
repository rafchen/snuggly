/**
 * Pure scoring and classification. No I/O, no Claude, no store — every function
 * here is deterministic so the rubric tables in `cracked/references/rubrics.md`
 * can be asserted directly in tests instead of trusted to a prompt.
 */

import {
  CONFUSABLE_PAIRS,
  REDUNDANCY_TO_MECHANISM,
  type Mechanism,
  type Redundancy,
} from './taxonomy'
import {
  DRILL_FAST_THRESHOLD_SEC,
  DRILL_TIME_CAP_SEC,
  FAILURE_CODES,
  FAILURE_RUNG,
  RUNG_NAMES,
  type CodeCritiqueResult,
  type DrillAnswer,
  type DrillAttempt,
  type DrillItem,
  type DrillScore,
  type DrillSessionResult,
  type FailureCode,
  type InvariantExamResult,
  type LadderSessionState,
  type RungNumber,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Recognition drill scoring — rubrics.md "Recognition drill scoring"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The scoring table, verbatim:
 *
 *   1.0  correct pattern + correct redundancy, under 45s
 *   0.8  correct pattern + correct redundancy, under 90s
 *   0.5  correct pattern, redundancy vague or absent
 *   0.3  wrong pattern, redundancy correctly named
 *   0.0  both wrong, or timeout
 *
 * The 0.3 row is load-bearing: naming the waste and reaching for the wrong tool
 * beats guessing the right tool off surface keywords. There is deliberately no
 * path to 1.0 that does not require the redundancy.
 */
export function drillScore(args: {
  mechanismCorrect: boolean
  redundancyCorrect: boolean
  elapsedSec: number
}): DrillScore {
  const { mechanismCorrect, redundancyCorrect, elapsedSec } = args
  if (elapsedSec > DRILL_TIME_CAP_SEC) return 0.0
  if (mechanismCorrect && redundancyCorrect) {
    return elapsedSec < DRILL_FAST_THRESHOLD_SEC ? 1.0 : 0.8
  }
  if (mechanismCorrect) return 0.5
  if (redundancyCorrect) return 0.3
  return 0.0
}

export function isTimedOut(elapsedSec: number): boolean {
  return elapsedSec > DRILL_TIME_CAP_SEC
}

/**
 * Build the attempt record. `redundancyCorrect` is supplied by the grader
 * (`recognition-drill` uses Claude; `gradeRedundancyOffline` is the no-API
 * fallback) because free text cannot be compared with `===`.
 *
 * An answer with no mechanism is a wrong mechanism, not a missing field — the
 * drill requires both parts and a blank half is scored as a miss on that half.
 */
export function scoreDrillAttempt(args: {
  item: DrillItem
  answer: DrillAnswer
  elapsedSec: number
  redundancyCorrect: boolean
}): DrillAttempt {
  const { item, answer, elapsedSec, redundancyCorrect } = args
  const timedOut = isTimedOut(elapsedSec)
  const mechanismCorrect = answer.mechanism === item.targetMechanism
  const redundancyGraded = redundancyCorrect && answer.redundancy.trim().length > 0
  return {
    problemId: item.problemId,
    answer,
    mechanismCorrect: mechanismCorrect && !timedOut,
    redundancyCorrect: redundancyGraded && !timedOut,
    score: drillScore({ mechanismCorrect, redundancyCorrect: redundancyGraded, elapsedSec }),
    elapsedSec,
    timedOut,
  }
}

/**
 * Offline redundancy grader. Deliberately conservative: it can say "clearly
 * right", and everything else is treated as vague, which lands the learner on
 * the 0.5 row rather than inflating to 0.8. Used when no API call is wanted.
 */
const REDUNDANCY_CUES: Record<Redundancy, string[]> = {
  reseeking_membership: ['seen', 'membership', 'contains', 'lookup', 'count', 'frequency'],
  resumming_overlapping_range: ['overlap', 'window', 'shift', 'recompute the sum', 'resum', 're-sum'],
  resumming_static_range: ['range sum', 'same range', 'static', 'prefix', 'recompute the sum'],
  relinear_search_sorted: ['sorted', 'linear scan', 'scan', 'search'],
  retesting_monotone_feasibility: ['feasib', 'monoton', 'every candidate', 'try every value'],
  recomparing_sorted_pairs: ['pair', 'sorted', 'compare', 'both ends'],
  recomputing_subproblems: ['subproblem', 'recompute', 'same call', 'overlapping', 'recursion repeats'],
  refinding_extreme_of_changing_set: ['min', 'max', 'smallest', 'largest', 'changing', 'rescan'],
  refinding_next_greater: ['next greater', 'next smaller', 'previous smaller', 'rescan to the right'],
  retraversing_visited_regions: ['visited', 'revisit', 'already explored', 'same cell', 'same node'],
  remerging_overlapping_groups: ['group', 'component', 'merge', 'connect', 'union'],
  rewalking_shared_prefixes: ['prefix', 'shared', 'same start', 'character by character'],
  recomputing_range_under_updates: ['update', 'rebuild', 'range', 'after every change'],
  reexploring_dead_branches: ['branch', 'dead', 'prune', 'cannot win', 'partial'],
  reevaluating_safe_local_choice: ['local', 'greedy', 'every ordering', 'all orders'],
  retracking_order_with_lookup: ['order', 'arrival', 'both ends', 'oldest', 'lookup'],
  reprocessing_dependencies: ['depend', 'prerequisite', 'order', 'before'],
  reexpanding_equal_cost_frontier: ['frontier', 'same distance', 'equal cost', 'expand', 'shortest'],
}

export function gradeRedundancyOffline(text: string, target: Redundancy): boolean {
  const t = text.toLowerCase()
  if (t.trim().length === 0) return false
  // A bare "it's slow / too slow / inefficient" is the canonical vague answer.
  if (/^(it'?s |it is )?(just )?(too )?(slow|inefficient|n\^?2|quadratic)\.?$/.test(t.trim())) return false
  const cues = REDUNDANCY_CUES[target]
  const hits = cues.filter((c) => t.includes(c)).length
  const namesRepetition = /\b(re-?|again|every time|over and over|repeated|redundan|each time)/.test(t)
  return hits >= 2 || (hits >= 1 && namesRepetition)
}

/** Which mechanisms are defensible for a redundancy — drives F4 vs "just wrong". */
export function mechanismsFor(redundancy: Redundancy): Mechanism[] {
  return REDUNDANCY_TO_MECHANISM[redundancy]
}

export function isConfusablePair(a: Mechanism, b: Mechanism): boolean {
  return CONFUSABLE_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}

// ─────────────────────────────────────────────────────────────────────────────
// Drill session roll-up — output schema: agents/recognition-drill.md
// ─────────────────────────────────────────────────────────────────────────────

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

/**
 * Per-mechanism recognition movement. Centred on 0.7 — the planner's target
 * success rate — so a session at the target moves nothing, which is correct:
 * hitting your calibrated difficulty is evidence of the level you are already at.
 */
export function recognitionDelta(scores: number[]): number {
  if (scores.length === 0) return 0
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const raw = (mean - 0.7) * 0.2 * Math.min(scores.length, 4)
  const clamped = Math.max(-0.15, Math.min(0.15, raw))
  return Math.round(clamped * 1000) / 1000
}

export function summarizeDrillSession(
  items: DrillItem[],
  attempts: DrillAttempt[],
): DrillSessionResult {
  const byId = new Map(items.map((i) => [i.problemId, i]))
  let correctBoth = 0
  let correctPatternOnly = 0
  let correctRedundancyOnly = 0
  let missed = 0
  const confusions: Array<[Mechanism, Mechanism]> = []
  const perMechanism = new Map<Mechanism, number[]>()

  for (const a of attempts) {
    if (a.mechanismCorrect && a.redundancyCorrect) correctBoth++
    else if (a.mechanismCorrect) correctPatternOnly++
    else if (a.redundancyCorrect) correctRedundancyOnly++
    else missed++

    const item = byId.get(a.problemId)
    if (!item) continue
    const bucket = perMechanism.get(item.targetMechanism) ?? []
    bucket.push(a.score)
    perMechanism.set(item.targetMechanism, bucket)

    if (!a.mechanismCorrect && a.answer.mechanism) {
      confusions.push([item.targetMechanism, a.answer.mechanism])
    }
  }

  const delta: Record<string, number> = {}
  for (const [mech, scores] of perMechanism) {
    const d = recognitionDelta(scores)
    if (d !== 0) delta[mech] = d
  }

  return {
    items: attempts.length,
    correctBoth,
    correctPatternOnly,
    correctRedundancyOnly,
    missed,
    medianTimeSec: Math.round(median(attempts.map((a) => a.elapsedSec))),
    confusions,
    recognitionDelta: delta,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivation rubric — rung 3 weighted double
// ─────────────────────────────────────────────────────────────────────────────

export function scoreDerivation(rungScores: Partial<Record<1 | 2 | 3 | 4 | 5, number>>): number {
  const weights: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 1, 2: 1, 3: 2, 4: 1, 5: 1 }
  let total = 0
  let weight = 0
  for (const key of [1, 2, 3, 4, 5] as const) {
    const s = rungScores[key]
    if (s === undefined) continue
    total += s * weights[key]
    weight += weights[key]
  }
  return weight === 0 ? 0 : Math.round((total / weight) * 1000) / 1000
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure classification — rubrics.md "Failure classification heuristics"
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when a failure code would be assigned without commit-log evidence. */
export class EvidenceRequired extends Error {
  constructor(readonly code: FailureCode | null, detail: string) {
    super(`failure-analyst: refusing to assign ${code ?? 'a code'} — ${detail}`)
    this.name = 'EvidenceRequired'
  }
}

export interface FailureCandidate {
  code: FailureCode
  /** The ladder rung this code belongs to, per FAILURE_RUNG in types.ts. */
  rung: RungNumber
  /** A quotation from the commit/hint log. Never synthesised. */
  evidence: string
}

export interface LadderEvidence {
  session: LadderSessionState
  codeCritique?: CodeCritiqueResult | null
  invariantExam?: InvariantExamResult | null
}

const RUNG_TO_CODE: Record<RungNumber, FailureCode> = { 1: 'F1', 2: 'F2', 3: 'F3', 4: 'F4', 5: 'F6', 6: 'F5' }

/**
 * Everything the log actually supports, earliest rung first. A rung produces a
 * candidate when a commit there was wrong or a hint was released there —
 * "solved but needed four hints" is a real gap and gets a code.
 */
export function candidateFailureCodes(ev: LadderEvidence): FailureCandidate[] {
  const { session, codeCritique, invariantExam } = ev
  const out: FailureCandidate[] = []

  for (const rung of [1, 2, 3, 4, 5, 6] as RungNumber[]) {
    const commits = session.commits.filter((c) => c.rung === rung)
    const hints = session.hints.filter((h) => h.rung === rung)
    const wrong = commits.filter((c) => !c.correct)
    if (wrong.length === 0 && hints.length === 0) continue
    const bits: string[] = []
    if (wrong.length > 0) {
      bits.push(`${wrong.length} incorrect commit(s), first was "${truncate(wrong[0].text, 80)}"`)
    }
    if (hints.length > 0) {
      const deepest = Math.max(...hints.map((h) => h.level))
      bits.push(`${hints.length} hint(s) released, deepest level ${deepest}`)
    }
    out.push({
      code: RUNG_TO_CODE[rung],
      rung,
      evidence: `rung ${rung} (${RUNG_NAMES[rung]}): ${bits.join('; ')}`,
    })
  }

  // A wrong idea is a rung-4 failure, not an implementation failure. code-critic
  // answers this before it reads a line, precisely so this stays separable.
  if (codeCritique && !codeCritique.ideaCorrect && !out.some((c) => c.code === 'F4')) {
    out.push({
      code: 'F4',
      rung: 4,
      evidence: `code-critic: idea_correct=false (intended ${codeCritique.complexityIntended}, actual ${codeCritique.complexityActual})`,
    })
  }
  if (codeCritique && codeCritique.ideaCorrect && (!codeCritique.passes || codeCritique.bugs.length > 0)) {
    if (!out.some((c) => c.code === 'F5')) {
      const classes = codeCritique.bugs.map((b) => `${b.class}@L${b.line}`).join(', ')
      out.push({
        code: 'F5',
        rung: 6,
        evidence: `code-critic: right approach, failing code${classes ? ` — ${classes}` : ''}`,
      })
    }
  }
  if (invariantExam && (invariantExam.f6Flag || !invariantExam.invariantCorrect) && !out.some((c) => c.code === 'F6')) {
    out.push({
      code: 'F6',
      rung: 5,
      evidence: `invariant-examiner: stated=${invariantExam.invariantStated}, correct=${invariantExam.invariantCorrect}, circular=${invariantExam.circularReasoning}, score ${invariantExam.score}`,
    })
  }

  return out.sort(
    (a, b) => FAILURE_RUNG[a.code] - FAILURE_RUNG[b.code] || FAILURE_CODES.indexOf(a.code) - FAILURE_CODES.indexOf(b.code),
  )
}

/**
 * The earliest rung wins. A learner with F3 and F5 needs the F3 work first —
 * fixing syntax while they cannot locate bottlenecks treats the symptom they
 * noticed rather than the one limiting them.
 *
 * Returns null on a clean session. That is not an oversight: assigning a code
 * with nothing in the log to cite is exactly what this agent must never do.
 */
export function primaryFailure(ev: LadderEvidence): FailureCandidate | null {
  return candidateFailureCodes(ev)[0] ?? null
}

/** Circuit breaker: three consecutive F1/F2 on the same node is a missing prerequisite. */
export function hasPrerequisiteGap(recentCodesOnNode: FailureCode[]): boolean {
  if (recentCodesOnNode.length < 3) return false
  const last3 = recentCodesOnNode.slice(-3)
  return last3.every((c) => c === 'F1' || c === 'F2')
}

/**
 * Structural guard behind `failure-analyst`. Evidence must quote the log, and the
 * code must be one the log actually supports.
 */
export function assertEvidence(code: FailureCode, evidence: string, ev: LadderEvidence): void {
  const text = evidence.trim()
  if (text.length < 12) throw new EvidenceRequired(code, 'evidence string is empty or trivial')
  if (!/\b(rung|commit|hint|log)\b/i.test(text)) {
    throw new EvidenceRequired(code, 'evidence does not cite the commit log')
  }
  const supported = candidateFailureCodes(ev).some((c) => c.code === code)
  if (!supported) {
    throw new EvidenceRequired(code, 'nothing in the commit log supports this code')
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

// ─────────────────────────────────────────────────────────────────────────────
// Prescriptions — the remedy column of the taxonomy, as data
// ─────────────────────────────────────────────────────────────────────────────

export const PRESCRIPTION_BY_CODE: Record<
  FailureCode,
  { drillType: string; target: string; reps: number; sessions: number }
> = {
  F1: { drillType: 'constraint_reading', target: 'restate I/O and n before solving', reps: 10, sessions: 2 },
  F2: { drillType: 'prerequisite_backup', target: 'drop to the prerequisite node; the primitive is missing', reps: 6, sessions: 4 },
  F3: { drillType: 'redundancy_naming', target: 'already-solved problems, name the waste only', reps: 8, sessions: 3 },
  F4: { drillType: 'confusable_pair_recognition', target: 'interleaved drills on the confused pair', reps: 12, sessions: 3 },
  F5: { drillType: 'blank_page_reimplementation', target: 'rewrite from scratch, no lookups', reps: 4, sessions: 2 },
  F6: { drillType: 'proof_sketch', target: 'state the loop invariant aloud before coding', reps: 6, sessions: 2 },
}
