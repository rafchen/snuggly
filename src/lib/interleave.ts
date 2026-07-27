/**
 * Drill selection / interleaving engine.
 *
 * The interleaving rule is enforced structurally: `selectDrillItems` cannot return
 * a sequence containing two consecutive items of the same mechanism. If the pool
 * makes that impossible, it throws `InterleavingViolation` rather than emitting
 * the blocked sequence — blocked practice inflates in-session accuracy and
 * destroys transfer, so silently degrading to it is worse than failing.
 */

import { CONFUSABLE_PAIRS, skillNode, type Mechanism } from './taxonomy'
import {
  InterleavingViolation,
  MASTERY_THRESHOLDS,
  type DataStore,
  type DisguiseLevel,
  type DrillItem,
  type MasteryState,
  type ProblemContent,
} from './types'

/** A pattern re-enters the warm-up pool once confidence decays below this. */
export const REVIEW_THRESHOLD = 0.7

/** Every Nth slot gets a planted misleading fingerprint, when one is available. */
export const DEFAULT_FINGERPRINT_EVERY = 4

export interface DrillSelectionInput {
  /** Candidate problems. Anything the learner has seen should already be excluded,
   *  or pass `seenProblemIds` and let the selector do it. */
  pool: ProblemContent[]
  count: number
  /** Patterns past decay threshold. Weighted up; they must make it into the set. */
  dueMechanisms?: Mechanism[]
  /** Defaults to the taxonomy's confusable pairs — where F4 errors cluster. */
  focusPairs?: ReadonlyArray<readonly [Mechanism, Mechanism]>
  seenProblemIds?: string[]
  /** Raise this as recognition rises. Disguise is the difficulty axis, not hardness. */
  disguiseFloor?: DisguiseLevel
  fingerprintEvery?: number
  /** Injectable for deterministic tests. Defaults to a seeded PRNG, not Math.random. */
  rng?: () => number
}

// ─────────────────────────────────────────────────────────────────────────────
// The invariant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The gate every returned sequence passes through. Exported so callers (and the
 * test suite) can assert the property on any sequence, not just ours.
 */
export function assertInterleaved(items: DrillItem[]): void {
  for (let i = 1; i < items.length; i++) {
    if (items[i].targetMechanism === items[i - 1].targetMechanism) {
      throw new InterleavingViolation(items[i].targetMechanism, i)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────────────

export function selectDrillItems(input: DrillSelectionInput): DrillItem[] {
  const {
    pool,
    count,
    dueMechanisms = [],
    focusPairs = CONFUSABLE_PAIRS,
    seenProblemIds = [],
    disguiseFloor = 0,
    fingerprintEvery = DEFAULT_FINGERPRINT_EVERY,
    rng = mulberry32(0x5eed),
  } = input

  const seen = new Set(seenProblemIds)
  const due = new Set(dueMechanisms)
  const candidates = pool.filter((p) => !seen.has(p.problemId))

  const remaining = new Map(candidates.map((p) => [p.problemId, p]))
  const out: DrillItem[] = []
  let previous: Mechanism | null = null

  for (let i = 0; i < count; i++) {
    if (remaining.size === 0) break // pool genuinely exhausted — a short set is honest

    const legal = [...remaining.values()].filter((p) => p.primaryPattern !== previous)
    if (legal.length === 0) {
      // Candidates exist but every one of them would block. Refuse.
      throw new InterleavingViolation(previous as Mechanism, i)
    }

    const wantFingerprint = fingerprintEvery > 0 && (i + 1) % fingerprintEvery === 0
    const pick = weightedPick(
      legal,
      (p) => score(p, { due, focusPairs, previous, disguiseFloor, wantFingerprint }),
      rng,
    )

    remaining.delete(pick.problemId)
    out.push(toDrillItem(pick, { isDueReview: due.has(pick.primaryPattern), disguiseFloor }))
    previous = pick.primaryPattern
  }

  // Belt and braces: the loop cannot produce a violation, and this proves it.
  assertInterleaved(out)
  return out
}

function score(
  p: ProblemContent,
  ctx: {
    due: Set<Mechanism>
    focusPairs: ReadonlyArray<readonly [Mechanism, Mechanism]>
    previous: Mechanism | null
    disguiseFloor: DisguiseLevel
    wantFingerprint: boolean
  },
): number {
  let w = 1

  // Due reviews are the point of the warm-up pool.
  if (ctx.due.has(p.primaryPattern)) w *= 3

  // Confusable pairs generally...
  if (ctx.focusPairs.some(([a, b]) => a === p.primaryPattern || b === p.primaryPattern)) w *= 2

  // ...and the partner of the item we just served specifically. Serving the other
  // half of a confusable pair back-to-back is what forces the discriminator to run.
  if (ctx.previous && partnersOf(ctx.previous, ctx.focusPairs).includes(p.primaryPattern)) w *= 2.5

  // Escalate disguise, not hardness.
  if (p.disguiseLevel >= ctx.disguiseFloor) w *= 1.5

  // Periodic inoculation against keyword matching.
  if (ctx.wantFingerprint && p.misleadingFingerprint !== null) w *= 6

  return w
}

function partnersOf(
  m: Mechanism,
  pairs: ReadonlyArray<readonly [Mechanism, Mechanism]>,
): Mechanism[] {
  const out: Mechanism[] = []
  for (const [a, b] of pairs) {
    if (a === m) out.push(b)
    else if (b === m) out.push(a)
  }
  return out
}

function toDrillItem(
  p: ProblemContent,
  opts: { isDueReview: boolean; disguiseFloor: DisguiseLevel },
): DrillItem {
  const variant = pickVariant(p, opts.disguiseFloor)
  return {
    problemId: p.problemId,
    statement: variant.statement,
    disguiseLevel: variant.disguiseLevel,
    targetMechanism: p.primaryPattern,
    targetRedundancy: p.redundancy,
    isDueReview: opts.isDueReview,
    hasMisleadingFingerprint: p.misleadingFingerprint !== null,
  }
}

/** Lowest variant at or above the floor; otherwise the most disguised one we have. */
function pickVariant(
  p: ProblemContent,
  floor: DisguiseLevel,
): { statement: string; disguiseLevel: DisguiseLevel } {
  const variants = [...p.drillVariants].sort((a, b) => a.disguiseLevel - b.disguiseLevel)
  const atOrAbove = variants.find((v) => v.disguiseLevel >= floor)
  const chosen = atOrAbove ?? variants[variants.length - 1]
  if (!chosen) return { statement: p.statement, disguiseLevel: p.disguiseLevel }
  return { statement: chosen.statement, disguiseLevel: chosen.disguiseLevel }
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: () => number): T {
  const weights = items.map(weight)
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return items[0]
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

/** Small deterministic PRNG so drill sets are reproducible in tests and replays. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Store-backed convenience
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mechanisms whose recognition or implementation has decayed past threshold.
 * `getAllMastery` is contracted to apply decay before returning, so this reads
 * current values, not last-session values.
 */
export function dueMechanismsFrom(states: MasteryState[]): Mechanism[] {
  const out = new Set<Mechanism>()
  for (const s of states) {
    const mech = skillNode(s.node)?.mechanism
    if (!mech) continue
    const decayed = s.recognition < REVIEW_THRESHOLD || s.implementation < REVIEW_THRESHOLD
    const everUnlocked = s.recognition > 0
    if (decayed && everUnlocked) out.add(mech)
  }
  return [...out]
}

/** Mechanisms the learner has demonstrably mastered — the interleaving pool floor. */
export function masteredMechanismsFrom(states: MasteryState[]): Mechanism[] {
  const out = new Set<Mechanism>()
  for (const s of states) {
    const mech = skillNode(s.node)?.mechanism
    if (!mech) continue
    if (s.recognition >= MASTERY_THRESHOLDS.recognition) out.add(mech)
  }
  return [...out]
}

export interface BuildDrillSetOptions {
  count?: number
  disguiseFloor?: DisguiseLevel
  focusPairs?: ReadonlyArray<readonly [Mechanism, Mechanism]>
  fingerprintEvery?: number
  rng?: () => number
  /** Restrict the pool (e.g. to unlocked patterns). Empty means "everything". */
  allowedMechanisms?: Mechanism[]
}

/**
 * The warm-up builder the planner actually calls: interleaved across *all* unlocked
 * patterns, weighted to due reviews and confusable pairs, on unseen problems only.
 */
export async function buildDrillSet(
  store: DataStore,
  learnerId: string,
  opts: BuildDrillSetOptions = {},
): Promise<DrillItem[]> {
  const [problems, seenProblemIds, mastery] = await Promise.all([
    store.listProblems(),
    store.seenProblemIds(learnerId),
    store.getAllMastery(learnerId),
  ])

  const allowed = new Set(opts.allowedMechanisms ?? [])
  const pool = allowed.size === 0 ? problems : problems.filter((p) => allowed.has(p.primaryPattern))

  return selectDrillItems({
    pool,
    count: opts.count ?? 10,
    dueMechanisms: dueMechanismsFrom(mastery),
    focusPairs: opts.focusPairs,
    seenProblemIds,
    disguiseFloor: opts.disguiseFloor,
    fingerprintEvery: opts.fingerprintEvery,
    rng: opts.rng,
  })
}
