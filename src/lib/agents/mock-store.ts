/**
 * In-memory `DataStore`. Track A owns the Prisma implementation; this exists so
 * the agent runtime runs, and is testable, standalone. No Prisma import anywhere
 * in this track — every agent takes a `DataStore` and never reaches past it.
 */

import {
  EMA_ALPHA,
  HALF_LIFE_DAYS,
  MASTERY_WRITER,
  type AgentName,
  type DataStore,
  type DrillAttempt,
  type HintRelease,
  type LadderCommit,
  type LadderSessionState,
  type MasteryDelta,
  type MasteryState,
  type Mechanism,
  type PhaseNumber,
  type ProblemContent,
  type SkillDimension,
} from '../types'

/** Thrown when an agent other than curriculum-planner tries to write mastery. */
export class SingleWriterViolation extends Error {
  constructor(readonly source: AgentName) {
    super(`Mastery is single-writer: ${MASTERY_WRITER} only, got "${source}".`)
    this.name = 'SingleWriterViolation'
  }
}

const MS_PER_DAY = 86_400_000

export function decayValue(value: number, days: number, halfLifeDays: number): number {
  if (days <= 0) return value
  return value * Math.pow(0.5, days / halfLifeDays)
}

/** Articulation stays null if it was null — null is not zero and never decays into one. */
export function applyDecay(state: MasteryState, now: Date): MasteryState {
  const days = Math.max(0, (now.getTime() - state.lastSeen.getTime()) / MS_PER_DAY)
  return {
    ...state,
    recognition: round(decayValue(state.recognition, days, HALF_LIFE_DAYS.recognition)),
    derivation: round(decayValue(state.derivation, days, HALF_LIFE_DAYS.derivation)),
    implementation: round(decayValue(state.implementation, days, HALF_LIFE_DAYS.implementation)),
    articulation:
      state.articulation === null
        ? null
        : round(decayValue(state.articulation, days, HALF_LIFE_DAYS.articulation)),
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

export class MockDataStore implements DataStore {
  private mastery = new Map<string, Map<string, MasteryState>>()
  private pending = new Map<string, MasteryDelta[]>()
  private problems = new Map<string, ProblemContent>()
  private seen = new Map<string, Set<string>>()
  private sessions = new Map<string, LadderSessionState>()
  private attempts = new Map<string, DrillAttempt[]>()
  private sessionSeq = 0

  constructor(private now: () => Date = () => new Date()) {}

  // ── seeding (test/dev only; not part of DataStore) ─────────────────────────

  seedProblems(problems: ProblemContent[]): this {
    for (const p of problems) this.problems.set(p.problemId, p)
    return this
  }

  seedMastery(learnerId: string, states: MasteryState[]): this {
    const byNode = this.mastery.get(learnerId) ?? new Map<string, MasteryState>()
    for (const s of states) byNode.set(s.node, s)
    this.mastery.set(learnerId, byNode)
    return this
  }

  markSeen(learnerId: string, problemIds: string[]): this {
    const set = this.seen.get(learnerId) ?? new Set<string>()
    for (const id of problemIds) set.add(id)
    this.seen.set(learnerId, set)
    return this
  }

  drillAttempts(learnerId: string): DrillAttempt[] {
    return [...(this.attempts.get(learnerId) ?? [])]
  }

  // ── DataStore ──────────────────────────────────────────────────────────────

  async getMastery(learnerId: string, node: string): Promise<MasteryState | null> {
    const s = this.mastery.get(learnerId)?.get(node)
    return s ? applyDecay(s, this.now()) : null
  }

  async getAllMastery(learnerId: string): Promise<MasteryState[]> {
    const now = this.now()
    return [...(this.mastery.get(learnerId)?.values() ?? [])].map((s) => applyDecay(s, now))
  }

  async applyDeltas(
    learnerId: string,
    deltas: MasteryDelta[],
    source: AgentName,
  ): Promise<MasteryState[]> {
    if (source !== MASTERY_WRITER) throw new SingleWriterViolation(source)
    const now = this.now()
    const byNode = this.mastery.get(learnerId) ?? new Map<string, MasteryState>()

    for (const d of deltas) {
      const prior = byNode.get(d.node)
      const current = prior ? applyDecay(prior, now) : blankState(d.node, now)
      const dim: SkillDimension = d.dimension
      const base = current[dim] ?? 0 // articulation starts null; first observation seeds it
      const next = round(EMA_ALPHA * d.observed + (1 - EMA_ALPHA) * base)
      const updated: MasteryState = { ...current, lastSeen: now }
      if (dim === 'recognition') updated.recognition = next
      else if (dim === 'derivation') updated.derivation = next
      else if (dim === 'implementation') updated.implementation = next
      else updated.articulation = next
      byNode.set(d.node, updated)
      d.appliedAt = now
    }

    this.mastery.set(learnerId, byNode)
    const applied = new Set(deltas.map((d) => d.id).filter(Boolean))
    this.pending.set(
      learnerId,
      (this.pending.get(learnerId) ?? []).filter((d) => !applied.has(d.id) && !deltas.includes(d)),
    )
    return this.getAllMastery(learnerId)
  }

  async enqueueDelta(learnerId: string, delta: MasteryDelta): Promise<void> {
    const q = this.pending.get(learnerId) ?? []
    q.push(delta)
    this.pending.set(learnerId, q)
  }

  async pendingDeltas(learnerId: string): Promise<MasteryDelta[]> {
    return [...(this.pending.get(learnerId) ?? [])]
  }

  async getProblem(problemId: string): Promise<ProblemContent | null> {
    return this.problems.get(problemId) ?? null
  }

  async listProblems(filter?: { mechanism?: Mechanism; phase?: PhaseNumber }): Promise<ProblemContent[]> {
    return [...this.problems.values()].filter((p) => {
      if (filter?.mechanism && p.primaryPattern !== filter.mechanism) return false
      if (filter?.phase !== undefined && p.phase !== filter.phase) return false
      return true
    })
  }

  async seenProblemIds(learnerId: string): Promise<string[]> {
    return [...(this.seen.get(learnerId) ?? [])]
  }

  async createLadderSession(learnerId: string, problemId: string): Promise<LadderSessionState> {
    const session: LadderSessionState = {
      sessionId: `sess_${++this.sessionSeq}`,
      problemId,
      currentRung: 1,
      commits: [],
      hints: [],
      difficultyMiscalibrated: false,
      completedAt: null,
    }
    this.sessions.set(session.sessionId, session)
    this.markSeen(learnerId, [problemId])
    return clone(session)
  }

  async getLadderSession(sessionId: string): Promise<LadderSessionState | null> {
    const s = this.sessions.get(sessionId)
    return s ? clone(s) : null
  }

  async logCommit(sessionId: string, commit: LadderCommit): Promise<LadderSessionState> {
    const s = this.require(sessionId)
    s.commits.push({ ...commit, id: commit.id ?? `c_${s.commits.length + 1}` })
    // Advance only on a correct commit; a wrong one stays on the rung by design.
    if (commit.correct && commit.rung === s.currentRung && s.currentRung < 6) {
      s.currentRung = (s.currentRung + 1) as LadderSessionState['currentRung']
    }
    return clone(s)
  }

  async logHint(sessionId: string, hint: HintRelease): Promise<LadderSessionState> {
    const s = this.require(sessionId)
    s.hints.push(hint)
    // Level 4 on a single rung means the problem was above level. Recorded here as
    // well as derived by socratic-coach, so the flag survives either code path.
    if (hint.level >= 4) s.difficultyMiscalibrated = true
    return clone(s)
  }

  async recordDrillAttempt(learnerId: string, attempt: DrillAttempt): Promise<void> {
    const list = this.attempts.get(learnerId) ?? []
    list.push(attempt)
    this.attempts.set(learnerId, list)
    this.markSeen(learnerId, [attempt.problemId])
  }

  private require(sessionId: string): LadderSessionState {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`MockDataStore: unknown session "${sessionId}"`)
    return s
  }
}

function blankState(node: string, now: Date): MasteryState {
  return {
    node,
    recognition: 0,
    derivation: 0,
    implementation: 0,
    articulation: null,
    lastSeen: now,
    decayRate: 0.04,
    failureCodes: {},
  }
}

function clone(s: LadderSessionState): LadderSessionState {
  return { ...s, commits: s.commits.map((c) => ({ ...c })), hints: s.hints.map((h) => ({ ...h })) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal well-formed ProblemContent. Overrides win; hints default to 7 levels. */
export function makeProblem(overrides: Partial<ProblemContent> & { problemId: string }): ProblemContent {
  const mech: Mechanism = overrides.primaryPattern ?? 'hashing'
  return {
    sourceRef: null,
    title: overrides.problemId,
    statement: `Statement for ${overrides.problemId}.`,
    primaryPattern: mech,
    secondary: [],
    redundancy: 'reseeking_membership',
    phase: 1,
    prerequisites: [],
    canonicalLadder: {
      frame: 'array in, integer out, n <= 1e5',
      brute: 'check every pair, O(n^2)',
      bottleneck: 'rescans the prefix on every index to ask whether a value was seen',
      lift: 'hash set — membership in O(1)',
      invariant: 'the set holds exactly the values at indices < i',
      verify: 'n=1, empty, all-identical; O(n) time, O(n) space',
    },
    hints: [
      'How large can n get?',
      'You have a brute force. What is it recomputing?',
      'For each element you rescan everything before it.',
      'You are re-answering "have I seen this value" from scratch each time.',
      'Store what you have seen so lookups are constant time.',
      'One pass, a set of seen values, check before you insert. Why is one pass enough?',
      'Full derivation of all six rungs.',
    ],
    distractors: [
      { mechanism: 'sorting_preprocess', temptingBecause: 'pairs feel like they need order' },
      { mechanism: 'two_pointers_opposite', temptingBecause: 'two indices are involved' },
    ],
    disguiseLevel: 1,
    misleadingFingerprint: null,
    edgeCases: ['[]', '[1]', '[2,2,2]'],
    drillVariants: [
      { disguiseLevel: 1, statement: `Drill variant (1) for ${overrides.problemId}.` },
      { disguiseLevel: 2, statement: `Drill variant (2) for ${overrides.problemId}.` },
    ],
    ...overrides,
  }
}

/** Minimal well-formed MasteryState. */
export function makeMastery(
  node: string,
  overrides: Partial<MasteryState> = {},
): MasteryState {
  return {
    node,
    recognition: 0.6,
    derivation: 0.5,
    implementation: 0.4,
    articulation: null,
    lastSeen: new Date(),
    decayRate: 0.04,
    failureCodes: {},
    ...overrides,
  }
}
