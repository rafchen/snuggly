/**
 * Mastery math. Pure, deterministic, and deliberately free of Prisma, I/O, and
 * ambient clock reads — every function that needs "now" takes it as an argument
 * (defaulting to new Date() at the call boundary only). Track C/D and the test
 * suite depend on that: nothing in this file may be mocked to be tested.
 *
 * The two rules that matter:
 *   1. EMA with alpha = 0.3 — new = 0.3*observed + 0.7*prior.
 *   2. Exponential decay from lastSeen, per-dimension half-lives from types.ts.
 *
 * And the one that matters most: articulation is `number | null`. Null means
 * "never measured". It decays to null, EMAs from null as a first observation,
 * and is excluded from the mastery check entirely — it gates Phase 5 exit only.
 */

import {
  EMA_ALPHA,
  HALF_LIFE_DAYS,
  MASTERY_THRESHOLDS,
  UNLOCK_THRESHOLD,
  type FailureCode,
  type MasteryState,
  type MasteryVector,
  type SkillDimension,
} from './types'
import { skillNode, type SkillNodeDef } from './taxonomy'

export const MS_PER_DAY = 86_400_000

/** The four dimensions, in the canonical order used by every report. */
export const SKILL_DIMENSIONS: readonly SkillDimension[] = [
  'recognition',
  'derivation',
  'implementation',
  'articulation',
] as const

/** The three dimensions the mastery gate actually checks. Articulation is absent by design. */
export const MASTERY_DIMENSIONS: readonly Exclude<SkillDimension, 'articulation'>[] = [
  'recognition',
  'derivation',
  'implementation',
] as const

/** Any collection shape a caller might already be holding. */
export type MasteryLookup =
  | readonly MasteryState[]
  | Readonly<Record<string, MasteryState>>
  | ReadonlyMap<string, MasteryState>

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Clamp into [0,1]. NaN collapses to 0 — a corrupt score must not poison a gate. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * The EMA update. alpha = EMA_ALPHA = 0.3, fixed by decision.
 *
 *   applyEma(prior, observed) => 0.3 * observed + 0.7 * prior
 *
 * A null prior means this is the first observation on this dimension, so the
 * observation is adopted whole rather than pulled 70% toward an imaginary zero.
 */
export function applyEma(prior: number | null | undefined, observed: number): number {
  const obs = clamp01(observed)
  if (prior === null || prior === undefined) return obs
  return clamp01(EMA_ALPHA * obs + (1 - EMA_ALPHA) * clamp01(prior))
}

/**
 * Exponential decay: value * 2^(-daysElapsed / halfLifeDays).
 *
 * Negative or zero elapsed time is a no-op (clock skew must never inflate a score),
 * and a non-positive half-life is treated as "does not decay" rather than a division
 * by zero.
 */
export function decay(value: number, halfLifeDays: number, daysElapsed: number): number {
  if (!Number.isFinite(value)) return 0
  if (daysElapsed <= 0 || !Number.isFinite(daysElapsed)) return clamp01(value)
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return clamp01(value)
  return clamp01(value * Math.pow(2, -daysElapsed / halfLifeDays))
}

/** Fractional days between two instants. Negative when `to` precedes `from`. */
export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY
}

/** The half-life for a dimension, straight from the contract. */
export function halfLifeFor(dimension: SkillDimension): number {
  return HALF_LIFE_DAYS[dimension]
}

// ─────────────────────────────────────────────────────────────────────────────
// Decay over the whole vector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decay all four scores by their own half-lives. Returns a new object; the input
 * is never mutated.
 *
 * A null articulation stays null. It is not decayed toward zero, because it was
 * never a number in the first place.
 */
export function decayVector(vector: MasteryVector, daysElapsed: number): MasteryVector {
  return {
    recognition: decay(vector.recognition, HALF_LIFE_DAYS.recognition, daysElapsed),
    derivation: decay(vector.derivation, HALF_LIFE_DAYS.derivation, daysElapsed),
    implementation: decay(vector.implementation, HALF_LIFE_DAYS.implementation, daysElapsed),
    articulation:
      vector.articulation === null || vector.articulation === undefined
        ? null
        : decay(vector.articulation, HALF_LIFE_DAYS.articulation, daysElapsed),
  }
}

/**
 * Decay a persisted state to `now`. This is what "decay is applied on read" means:
 * the store calls this on the way out, so no caller ever sees a stale score.
 *
 * `lastSeen` is preserved — this is a view of the state at `now`, not a write.
 */
export function decayState(state: MasteryState, now: Date = new Date()): MasteryState {
  const elapsed = daysBetween(state.lastSeen, now)
  if (elapsed <= 0) {
    return {
      ...state,
      recognition: clamp01(state.recognition),
      derivation: clamp01(state.derivation),
      implementation: clamp01(state.implementation),
      articulation: state.articulation === null ? null : clamp01(state.articulation),
      failureCodes: { ...state.failureCodes },
    }
  }
  return {
    ...state,
    ...decayVector(state, elapsed),
    failureCodes: { ...state.failureCodes },
  }
}

/** Decay a whole set of states to the same instant. Convenience for getAllMastery. */
export function decayAll(states: readonly MasteryState[], now: Date = new Date()): MasteryState[] {
  return states.map((s) => decayState(s, now))
}

/**
 * Fold one observation into a state: decay every dimension to `at`, EMA the observed
 * dimension, and stamp lastSeen.
 *
 * All four dimensions are decayed — not just the one being written — because the
 * contract carries a single `lastSeen`. Advancing it without first decaying the
 * other three would silently freeze them at their old values.
 */
export function applyObservation(
  state: MasteryState,
  dimension: SkillDimension,
  observed: number,
  at: Date = new Date(),
): MasteryState {
  const decayed = decayState(state, at)
  const prior = decayed[dimension]
  return {
    ...decayed,
    [dimension]: applyEma(prior, observed),
    lastSeen: at,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────────────

function toLookup(all: MasteryLookup): Map<string, MasteryState> {
  if (all instanceof Map) return all as Map<string, MasteryState>
  const map = new Map<string, MasteryState>()
  if (Array.isArray(all)) {
    for (const state of all as readonly MasteryState[]) map.set(state.node, state)
  } else {
    for (const [node, state] of Object.entries(all as Record<string, MasteryState>)) {
      map.set(state?.node ?? node, state)
    }
  }
  return map
}

/**
 * A node is unlocked when EVERY prerequisite has recognition >= UNLOCK_THRESHOLD (0.5).
 * A node with no prerequisites is unlocked unconditionally — that is the DAG's entry set.
 *
 * Accepts a SkillNodeDef or a node id; the id form resolves through the taxonomy and
 * returns false for an unknown node rather than silently unlocking it.
 *
 * Note this reads recognition on the *prerequisite*, not the node itself, and reads it
 * from whatever states you pass — pass decayed states if you want the current answer.
 */
export function isUnlocked(node: SkillNodeDef | string, allMastery: MasteryLookup): boolean {
  const def = typeof node === 'string' ? skillNode(node) : node
  if (!def) return false
  if (def.prereqs.length === 0) return true

  const lookup = toLookup(allMastery)
  return def.prereqs.every((prereqId) => {
    const state = lookup.get(prereqId)
    if (!state) return false
    return clamp01(state.recognition) >= UNLOCK_THRESHOLD
  })
}

/**
 * Mastered when recognition >= 0.85, derivation >= 0.75, implementation >= 0.70.
 *
 * Articulation is deliberately NOT part of this check. It gates Phase 5 exit only —
 * demanding it earlier adds load without payoff, and a null there would otherwise
 * make every node permanently unmastered.
 */
export function isMastered(state: MasteryVector | null | undefined): boolean {
  if (!state) return false
  return (
    clamp01(state.recognition) >= MASTERY_THRESHOLDS.recognition &&
    clamp01(state.derivation) >= MASTERY_THRESHOLDS.derivation &&
    clamp01(state.implementation) >= MASTERY_THRESHOLDS.implementation
  )
}

/** Which of the three mastery criteria are still unmet. Empty array == mastered. */
export function missingForMastery(state: MasteryVector | null | undefined): SkillDimension[] {
  if (!state) return [...MASTERY_DIMENSIONS]
  return MASTERY_DIMENSIONS.filter((d) => clamp01(state[d]) < MASTERY_THRESHOLDS[d])
}

/**
 * The Phase 5 exit gate, and the only place articulation is consulted.
 * A null articulation fails the gate — but as "not yet measured", never as a zero.
 */
export function meetsArticulationGate(
  state: MasteryVector | null | undefined,
  threshold = MASTERY_THRESHOLDS.derivation,
): boolean {
  if (!state || state.articulation === null || state.articulation === undefined) return false
  return clamp01(state.articulation) >= threshold
}

/** The set of node ids currently unlocked, given a mastery snapshot. */
export function unlockedNodes(nodes: readonly SkillNodeDef[], allMastery: MasteryLookup): string[] {
  const lookup = toLookup(allMastery)
  return nodes.filter((n) => isUnlocked(n, lookup)).map((n) => n.id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Construction helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A zeroed state for a node the learner has never touched. Articulation is null,
 * not 0 — placement never initializes it and neither does this.
 */
export function emptyMastery(node: string, at: Date = new Date()): MasteryState {
  return {
    node,
    recognition: 0,
    derivation: 0,
    implementation: 0,
    articulation: null,
    lastSeen: at,
    decayRate: 1,
    failureCodes: {},
  }
}

/** Increment a failure code tally without mutating the input. */
export function tallyFailure(
  failureCodes: Partial<Record<FailureCode, number>>,
  code: FailureCode,
): Partial<Record<FailureCode, number>> {
  return { ...failureCodes, [code]: (failureCodes[code] ?? 0) + 1 }
}
