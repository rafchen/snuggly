/**
 * PrismaDataStore — the real implementation of the DataStore seam in types.ts.
 *
 * Three things in here are invariants rather than conveniences:
 *
 *   1. SINGLE WRITER. `applyDeltas` throws SingleWriterViolation unless the caller
 *      identifies as MASTERY_WRITER ('curriculum-planner'). Every other agent calls
 *      `enqueueDelta`. This is enforced, not documented — a second writer would make
 *      mastery scores unattributable and the whole diagnostic worthless.
 *
 *   2. DECAY ON READ. getMastery/getAllMastery return values decayed from lastSeen to
 *      now. Nothing outside this file ever sees a stale score, so no caller can forget.
 *
 *   3. ARTICULATION IS NULL, NOT ZERO. It round-trips as null through every path here.
 *
 * All mastery math lives in ./mastery.ts and is Prisma-free, so it is testable without
 * a database. This file is the only place the two meet.
 */

import { PrismaClient, type Prisma } from '@prisma/client'

import {
  MASTERY_WRITER,
  type AgentName,
  type DataStore,
  type DisguiseLevel,
  type DrillAttempt,
  type FailureAnalysis,
  type FailureCode,
  type HintLevel,
  type HintRelease,
  type LadderCommit,
  type LadderSessionState,
  type MasteryDelta,
  type MasteryState,
  type ProblemContent,
  type RungNumber,
  type SkillDimension,
} from './types'
import type { Mechanism, PhaseNumber, Redundancy } from './taxonomy'
import { applyObservation, clamp01, decayState, emptyMastery } from './mastery'

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when an agent other than MASTERY_WRITER attempts to write Mastery.
 *
 * The named class is the point: a test can assert that a rogue writer is *impossible*,
 * not merely discouraged. Agents that want to influence mastery call enqueueDelta and
 * wait for curriculum-planner to fold their observation in.
 */
export class SingleWriterViolation extends Error {
  constructor(
    readonly source: AgentName | string,
    readonly learnerId?: string,
  ) {
    super(
      `Single-writer violation: "${source}" attempted to apply mastery deltas. ` +
        `Only "${MASTERY_WRITER}" may write Mastery; every other agent must call enqueueDelta().`,
    )
    this.name = 'SingleWriterViolation'
  }
}

/** Alias for callers that think of this as "the mastery writer check". Same class. */
export const MasteryWriterViolation = SingleWriterViolation
export type MasteryWriterViolation = SingleWriterViolation

/** Thrown when a session id does not resolve. */
export class UnknownSessionError extends Error {
  constructor(readonly sessionId: string) {
    super(`Unknown ladder session: ${sessionId}`)
    this.name = 'UnknownSessionError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON column helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

// ─────────────────────────────────────────────────────────────────────────────
// Row → domain mappers
// ─────────────────────────────────────────────────────────────────────────────

type MasteryRow = {
  node: string
  recognition: number
  derivation: number
  implementation: number
  articulation: number | null
  lastSeen: Date
  decayRate: number
  failureCodes: string
}

/** Raw row → MasteryState, values as-of lastSeen. Decay is applied by the caller. */
function toMasteryState(row: MasteryRow): MasteryState {
  return {
    node: row.node,
    recognition: row.recognition,
    derivation: row.derivation,
    implementation: row.implementation,
    // Null survives the round trip. It is not coerced, defaulted, or zeroed.
    articulation: row.articulation === null ? null : row.articulation,
    lastSeen: row.lastSeen,
    decayRate: row.decayRate,
    failureCodes: parseJson<Partial<Record<FailureCode, number>>>(row.failureCodes, {}),
  }
}

type DeltaRow = {
  id: string
  node: string
  dimension: string
  observed: number
  source: string
  observedAt: Date
  appliedAt: Date | null
}

function toDelta(row: DeltaRow): MasteryDelta {
  return {
    id: row.id,
    node: row.node,
    dimension: row.dimension as SkillDimension,
    observed: row.observed,
    source: row.source as AgentName,
    observedAt: row.observedAt,
    appliedAt: row.appliedAt,
  }
}

type ProblemRow = {
  id: string
  sourceRef: string | null
  title: string
  statement: string
  primaryPattern: string
  secondary: string
  redundancy: string
  phase: number
  prerequisites: string
  canonicalLadder: string
  hints: string
  distractors: string
  disguiseLevel: number
  misleadingFingerprint: string | null
  edgeCases: string
  drillVariants: string
}

function toProblemContent(row: ProblemRow): ProblemContent {
  return {
    problemId: row.id,
    sourceRef: row.sourceRef,
    title: row.title,
    statement: row.statement,
    primaryPattern: row.primaryPattern as Mechanism,
    secondary: parseJson<Mechanism[]>(row.secondary, []),
    redundancy: row.redundancy as Redundancy,
    phase: row.phase as PhaseNumber,
    prerequisites: parseJson<string[]>(row.prerequisites, []),
    canonicalLadder: parseJson<ProblemContent['canonicalLadder']>(row.canonicalLadder, {
      frame: '',
      brute: '',
      bottleneck: '',
      lift: '',
      invariant: '',
      verify: '',
    }),
    hints: parseJson<string[]>(row.hints, []),
    distractors: parseJson<ProblemContent['distractors']>(row.distractors, []),
    disguiseLevel: row.disguiseLevel as DisguiseLevel,
    misleadingFingerprint: row.misleadingFingerprint,
    edgeCases: parseJson<string[]>(row.edgeCases, []),
    drillVariants: parseJson<ProblemContent['drillVariants']>(row.drillVariants, []),
  }
}

/** ProblemContent → the row shape, for seeding and for content-forge writes. */
export function toProblemRow(p: ProblemContent) {
  return {
    id: p.problemId,
    sourceRef: p.sourceRef ?? null,
    title: p.title,
    statement: p.statement,
    primaryPattern: p.primaryPattern,
    secondary: toJson(p.secondary ?? []),
    redundancy: p.redundancy,
    phase: p.phase,
    prerequisites: toJson(p.prerequisites ?? []),
    canonicalLadder: toJson(p.canonicalLadder ?? {}),
    hints: toJson(p.hints ?? []),
    distractors: toJson(p.distractors ?? []),
    disguiseLevel: p.disguiseLevel ?? 0,
    misleadingFingerprint: p.misleadingFingerprint ?? null,
    edgeCases: toJson(p.edgeCases ?? []),
    drillVariants: toJson(p.drillVariants ?? []),
  }
}

type LadderSessionRow = {
  id: string
  problemId: string
  currentRung: number
  difficultyMiscalibrated: boolean
  completedAt: Date | null
  commits: Array<{
    id: string
    rung: number
    text: string
    correct: boolean
    hintsUsedAtCommit: number
    committedAt: Date
  }>
  hints: Array<{
    rung: number
    level: number
    text: string
    reason: string | null
    releasedAt: Date
  }>
}

function toLadderSessionState(row: LadderSessionRow): LadderSessionState {
  return {
    sessionId: row.id,
    problemId: row.problemId,
    currentRung: row.currentRung as RungNumber,
    commits: row.commits.map((c) => ({
      id: c.id,
      rung: c.rung as RungNumber,
      text: c.text,
      correct: c.correct,
      hintsUsedAtCommit: c.hintsUsedAtCommit,
      committedAt: c.committedAt,
    })),
    hints: row.hints.map((h) => ({
      rung: h.rung as RungNumber,
      level: h.level as HintLevel,
      text: h.text,
      reason: h.reason,
      releasedAt: h.releasedAt,
    })),
    difficultyMiscalibrated: row.difficultyMiscalibrated,
    completedAt: row.completedAt,
  }
}

const LADDER_INCLUDE = {
  commits: { orderBy: [{ rung: 'asc' }, { committedAt: 'asc' }] },
  hints: { orderBy: [{ rung: 'asc' }, { level: 'asc' }] },
} satisfies Prisma.LadderSessionInclude

// ─────────────────────────────────────────────────────────────────────────────
// Client singleton
// ─────────────────────────────────────────────────────────────────────────────

const globalForPrisma = globalThis as unknown as { __crackedPrisma?: PrismaClient }

/** Shared client. Reused across Next.js hot reloads so we don't exhaust connections. */
export const prisma: PrismaClient =
  globalForPrisma.__crackedPrisma ?? new PrismaClient({ log: ['warn', 'error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.__crackedPrisma = prisma

// ─────────────────────────────────────────────────────────────────────────────
// The store
// ─────────────────────────────────────────────────────────────────────────────

export class PrismaDataStore implements DataStore {
  constructor(private readonly db: PrismaClient = prisma) {}

  // ── Mastery ────────────────────────────────────────────────────────────────

  /** Decayed to `now`. Null when the learner has never touched the node. */
  async getMastery(learnerId: string, node: string, now: Date = new Date()): Promise<MasteryState | null> {
    const row = await this.db.mastery.findUnique({ where: { learnerId_node: { learnerId, node } } })
    if (!row) return null
    return decayState(toMasteryState(row), now)
  }

  /** Every node the learner has state for, decayed to `now`. */
  async getAllMastery(learnerId: string, now: Date = new Date()): Promise<MasteryState[]> {
    const rows = await this.db.mastery.findMany({ where: { learnerId }, orderBy: { node: 'asc' } })
    return rows.map((row) => decayState(toMasteryState(row), now))
  }

  /**
   * Fold observations into Mastery. THE ONLY WRITE PATH FOR MASTERY.
   *
   * For each delta: decay the stored state to now, EMA the observed dimension
   * (0.3*observed + 0.7*prior), stamp lastSeen, persist. All four dimensions are
   * decayed before the write — advancing lastSeen without doing so would freeze
   * the three dimensions this delta doesn't touch.
   *
   * Deltas carrying an id are marked applied, which is what drains the queue.
   *
   * @throws SingleWriterViolation if `source` is not MASTERY_WRITER.
   */
  async applyDeltas(
    learnerId: string,
    deltas: MasteryDelta[],
    source: AgentName,
    now: Date = new Date(),
  ): Promise<MasteryState[]> {
    // Checked first, before any I/O: a rejected writer must not observe side effects.
    if (source !== MASTERY_WRITER) throw new SingleWriterViolation(source, learnerId)
    if (deltas.length === 0) return []

    const touched = new Map<string, MasteryState>()

    await this.db.$transaction(async (tx) => {
      for (const delta of deltas) {
        let state = touched.get(delta.node)
        if (!state) {
          const row = await tx.mastery.findUnique({
            where: { learnerId_node: { learnerId, node: delta.node } },
          })
          state = row ? toMasteryState(row) : emptyMastery(delta.node, now)
        }

        const next = applyObservation(state, delta.dimension, clamp01(delta.observed), now)
        touched.set(delta.node, next)

        await tx.mastery.upsert({
          where: { learnerId_node: { learnerId, node: delta.node } },
          create: {
            learnerId,
            node: next.node,
            recognition: next.recognition,
            derivation: next.derivation,
            implementation: next.implementation,
            articulation: next.articulation,
            decayRate: next.decayRate,
            lastSeen: next.lastSeen,
            failureCodes: toJson(next.failureCodes),
          },
          update: {
            recognition: next.recognition,
            derivation: next.derivation,
            implementation: next.implementation,
            articulation: next.articulation,
            lastSeen: next.lastSeen,
          },
        })
      }

      const ids = deltas.map((d) => d.id).filter((id): id is string => typeof id === 'string')
      if (ids.length > 0) {
        await tx.masteryDelta.updateMany({
          where: { id: { in: ids }, learnerId, appliedAt: null },
          data: { appliedAt: now },
        })
      }
    })

    return [...touched.values()].sort((a, b) => a.node.localeCompare(b.node))
  }

  /**
   * Append an observation to the queue. This is what every agent except
   * curriculum-planner calls — it never touches Mastery.
   */
  async enqueueDelta(learnerId: string, delta: MasteryDelta): Promise<void> {
    await this.db.masteryDelta.create({
      data: {
        learnerId,
        node: delta.node,
        dimension: delta.dimension,
        observed: clamp01(delta.observed),
        source: delta.source,
        observedAt: delta.observedAt ?? new Date(),
        appliedAt: delta.appliedAt ?? null,
      },
    })
  }

  /** Unapplied deltas, oldest first — the order curriculum-planner should fold them in. */
  async pendingDeltas(learnerId: string): Promise<MasteryDelta[]> {
    const rows = await this.db.masteryDelta.findMany({
      where: { learnerId, appliedAt: null },
      orderBy: { observedAt: 'asc' },
    })
    return rows.map(toDelta)
  }

  // ── Content ────────────────────────────────────────────────────────────────

  async getProblem(problemId: string): Promise<ProblemContent | null> {
    const row = await this.db.problem.findUnique({ where: { id: problemId } })
    return row ? toProblemContent(row) : null
  }

  async listProblems(filter?: { mechanism?: Mechanism; phase?: PhaseNumber }): Promise<ProblemContent[]> {
    const rows = await this.db.problem.findMany({
      where: {
        ...(filter?.mechanism ? { primaryPattern: filter.mechanism } : {}),
        ...(filter?.phase !== undefined ? { phase: filter.phase } : {}),
      },
      orderBy: [{ phase: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toProblemContent)
  }

  /**
   * Every problem the learner has encountered in any modality. Review must be served
   * on unseen problems — re-serving the original measures memory of that problem.
   */
  async seenProblemIds(learnerId: string): Promise<string[]> {
    const [drills, ladders] = await Promise.all([
      this.db.drillAttempt.findMany({ where: { learnerId }, select: { problemId: true }, distinct: ['problemId'] }),
      this.db.ladderSession.findMany({ where: { learnerId }, select: { problemId: true }, distinct: ['problemId'] }),
    ])
    const seen = new Set<string>()
    for (const d of drills) seen.add(d.problemId)
    for (const l of ladders) seen.add(l.problemId)
    return [...seen].sort()
  }

  /** Upsert a content-forge problem. Used by the seed and by content ingestion. */
  async upsertProblem(problem: ProblemContent): Promise<void> {
    const row = toProblemRow(problem)
    const { id: _id, ...rest } = row
    await this.db.problem.upsert({ where: { id: row.id }, create: row, update: rest })
  }

  // ── The Ladder ─────────────────────────────────────────────────────────────

  async createLadderSession(learnerId: string, problemId: string): Promise<LadderSessionState> {
    const row = await this.db.ladderSession.create({
      data: { learnerId, problemId, currentRung: 1 },
      include: LADDER_INCLUDE,
    })
    return toLadderSessionState(row)
  }

  async getLadderSession(sessionId: string): Promise<LadderSessionState | null> {
    const row = await this.db.ladderSession.findUnique({ where: { id: sessionId }, include: LADDER_INCLUDE })
    return row ? toLadderSessionState(row) : null
  }

  /**
   * Persist a hypothesis at a rung.
   *
   * `currentRung` tracks the furthest rung reached and never regresses. The store
   * does not auto-advance past the committed rung — deciding when a learner moves
   * on is the coach's judgement, not a storage side effect.
   */
  async logCommit(sessionId: string, commit: LadderCommit): Promise<LadderSessionState> {
    const session = await this.db.ladderSession.findUnique({ where: { id: sessionId } })
    if (!session) throw new UnknownSessionError(sessionId)

    await this.db.$transaction([
      this.db.ladderCommit.create({
        data: {
          sessionId,
          rung: commit.rung,
          text: commit.text,
          correct: commit.correct,
          hintsUsedAtCommit: commit.hintsUsedAtCommit ?? 0,
          committedAt: commit.committedAt ?? new Date(),
        },
      }),
      this.db.ladderSession.update({
        where: { id: sessionId },
        data: { currentRung: Math.max(session.currentRung, commit.rung) },
      }),
    ])

    const row = await this.db.ladderSession.findUniqueOrThrow({ where: { id: sessionId }, include: LADDER_INCLUDE })
    return toLadderSessionState(row)
  }

  /**
   * Persist a released hint.
   *
   * The Commit Rule (no hint without a commit at the current rung) is enforced in the
   * service layer via CommitRuleViolation, because it is a conversational rule about
   * *requesting* a hint. By the time a release reaches storage the decision is made,
   * and refusing to record it would only lose the audit trail.
   */
  async logHint(sessionId: string, hint: HintRelease): Promise<LadderSessionState> {
    const session = await this.db.ladderSession.findUnique({ where: { id: sessionId } })
    if (!session) throw new UnknownSessionError(sessionId)

    await this.db.hintRelease.create({
      data: {
        sessionId,
        rung: hint.rung,
        level: hint.level,
        text: hint.text,
        // Level 6 must carry a cause so the planner can correct difficulty calibration.
        reason: hint.reason ?? null,
        releasedAt: hint.releasedAt ?? new Date(),
      },
    })

    const row = await this.db.ladderSession.findUniqueOrThrow({ where: { id: sessionId }, include: LADDER_INCLUDE })
    return toLadderSessionState(row)
  }

  async completeLadderSession(sessionId: string, difficultyMiscalibrated = false): Promise<LadderSessionState> {
    const row = await this.db.ladderSession.update({
      where: { id: sessionId },
      data: { completedAt: new Date(), difficultyMiscalibrated },
      include: LADDER_INCLUDE,
    })
    return toLadderSessionState(row)
  }

  /**
   * Move to the next rung. Called only after a correct commit — the Ladder is
   * climbed in order, and rung 2 is never skipped even when the learner insists
   * they already know the fast solution.
   */
  async advanceRung(sessionId: string): Promise<LadderSessionState | null> {
    const session = await this.db.ladderSession.findUnique({ where: { id: sessionId } })
    if (!session) return null
    if (session.currentRung >= 6) return this.getLadderSession(sessionId)
    const row = await this.db.ladderSession.update({
      where: { id: sessionId },
      data: { currentRung: session.currentRung + 1 },
      include: LADDER_INCLUDE,
    })
    return toLadderSessionState(row)
  }

  /** Hint level 4 on a single rung means the problem sat above the learner's level. */
  async flagMiscalibrated(sessionId: string): Promise<void> {
    await this.db.ladderSession.update({
      where: { id: sessionId },
      data: { difficultyMiscalibrated: true },
    })
  }

  // ── Drills ─────────────────────────────────────────────────────────────────

  async recordDrillAttempt(learnerId: string, attempt: DrillAttempt, sessionId?: string): Promise<void> {
    await this.db.drillAttempt.create({
      data: {
        learnerId,
        sessionId: sessionId ?? null,
        problemId: attempt.problemId,
        answerMechanism: attempt.answer?.mechanism ?? null,
        answerRedundancy: attempt.answer?.redundancy ?? '',
        mechanismCorrect: attempt.mechanismCorrect,
        redundancyCorrect: attempt.redundancyCorrect,
        score: attempt.score,
        elapsedSec: Math.round(attempt.elapsedSec),
        timedOut: attempt.timedOut,
      },
    })
  }

  async createDrillSession(learnerId: string): Promise<string> {
    const row = await this.db.drillSession.create({ data: { learnerId } })
    return row.id
  }

  async completeDrillSession(sessionId: string, result: unknown): Promise<void> {
    await this.db.drillSession.update({
      where: { id: sessionId },
      data: { completedAt: new Date(), result: toJson(result) },
    })
  }

  // ── Failures ───────────────────────────────────────────────────────────────

  /** Persist a failure-analyst verdict. Feeds the frustration circuit-breaker. */
  async recordFailure(
    learnerId: string,
    analysis: FailureAnalysis,
    context?: { sessionId?: string; problemId?: string; f5Subclass?: string | null },
  ): Promise<void> {
    await this.db.failureRecord.create({
      data: {
        learnerId,
        node: analysis.node,
        sessionId: context?.sessionId ?? null,
        problemId: context?.problemId ?? null,
        primaryCode: analysis.primaryCode,
        secondaryCodes: toJson(analysis.secondaryCodes ?? []),
        evidence: analysis.evidence,
        prerequisiteGap: analysis.prerequisiteGap,
        prescription: toJson(analysis.prescription ?? {}),
        learnerMessage: analysis.learnerMessage ?? '',
        f5Subclass: context?.f5Subclass ?? null,
      },
    })
  }

  /** Most recent failures on a node, newest first. `limit` defaults to the breaker window. */
  async recentFailures(learnerId: string, node: string, limit = 3) {
    return this.db.failureRecord.findMany({
      where: { learnerId, node },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  /**
   * The frustration circuit-breaker: three consecutive F1/F2 on one node means the
   * prerequisite is missing, not that the learner needs to try harder.
   */
  async circuitBreakerTripped(learnerId: string, node: string, window = 3): Promise<boolean> {
    const recent = await this.recentFailures(learnerId, node, window)
    if (recent.length < window) return false
    return recent.every((f) => f.primaryCode === 'F1' || f.primaryCode === 'F2')
  }

  // ── Learners ───────────────────────────────────────────────────────────────

  async getLearner(learnerId: string) {
    return this.db.learner.findUnique({ where: { id: learnerId } })
  }

  async setPhase(learnerId: string, phase: PhaseNumber): Promise<void> {
    await this.db.learner.update({ where: { id: learnerId }, data: { phase } })
  }
}

/** Convenience factory; pass a client to point the store at a test database. */
export function createDataStore(client: PrismaClient = prisma): PrismaDataStore {
  return new PrismaDataStore(client)
}

/** The process-wide store. Tracks C/D import this. */
export const store: PrismaDataStore = createDataStore()

export default store
