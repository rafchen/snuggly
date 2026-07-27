/**
 * THE CROSS-TRACK CONTRACT.
 *
 * Every track imports from here. No track redefines these shapes locally.
 * Track A owns the persistence that backs them; Tracks B/C/D consume them.
 *
 * Where a type mirrors an agent's documented output schema, the source file is
 * named in the doc comment — those schemas are contracts, not suggestions.
 */

import type { Mechanism, PhaseNumber, Redundancy } from './taxonomy'

export type { Mechanism, PhaseNumber, Redundancy } from './taxonomy'

// ─────────────────────────────────────────────────────────────────────────────
// Mastery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Four separable skills (SKILL.md). Articulation is nullable and Phase-5 gated:
 * null is NOT zero and must never be averaged as one.
 */
export interface MasteryVector {
  recognition: number
  derivation: number
  implementation: number
  articulation: number | null
}

export interface MasteryState extends MasteryVector {
  node: string
  lastSeen: Date
  decayRate: number
  failureCodes: Partial<Record<FailureCode, number>>
}

/** Thresholds from references/curriculum.md. Articulation gates Phase 5 exit only. */
export const UNLOCK_THRESHOLD = 0.5
export const MASTERY_THRESHOLDS = {
  recognition: 0.85,
  derivation: 0.75,
  implementation: 0.7,
} as const

/** EMA smoothing factor. A single number, fixed by decision: new = 0.3*obs + 0.7*prior. */
export const EMA_ALPHA = 0.3

/** Decay half-lives in days. Implementation evaporates fastest; recognition is stickiest. */
export const HALF_LIFE_DAYS = {
  recognition: 45,
  derivation: 21,
  implementation: 10,
  articulation: 21,
} as const

export type SkillDimension = keyof typeof HALF_LIFE_DAYS

/** A delta emitted by any agent. Only curriculum-planner may apply these to Mastery. */
export interface MasteryDelta {
  id?: string
  node: string
  dimension: SkillDimension
  observed: number // the raw score in [0,1] this observation produced
  source: AgentName
  observedAt: Date
  appliedAt: Date | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Content (content-forge output schema)
// ─────────────────────────────────────────────────────────────────────────────

/** 0 = pattern stated in the tags. 3 = worded to suggest a different mechanism. */
export type DisguiseLevel = 0 | 1 | 2 | 3

export interface CanonicalLadder {
  frame: string
  brute: string
  /** Must name a concrete repeated operation. "It's inefficient" fails the quality bar. */
  bottleneck: string
  lift: string
  invariant: string
  verify: string
}

export interface Distractor {
  mechanism: Mechanism
  temptingBecause: string
}

/**
 * The instrumented teaching object. Every problem in the library ships with all of it,
 * or the runtime agents degrade into generic tutoring. Source: agents/content-forge.md.
 */
export interface ProblemContent {
  problemId: string
  /** Reference pointer to the canonical published problem. Statement prose is ours. */
  sourceRef: string | null
  title: string
  /** 100% original prose. Never store third-party statement text. */
  statement: string
  primaryPattern: Mechanism
  secondary: Mechanism[]
  redundancy: Redundancy
  phase: PhaseNumber
  prerequisites: string[]
  canonicalLadder: CanonicalLadder
  /** Exactly 7 entries, levels 0..6. Each reveals ~one increment. */
  hints: string[]
  /** At least 2. A problem with no plausible wrong mechanism is a recognition freebie. */
  distractors: Distractor[]
  disguiseLevel: DisguiseLevel
  misleadingFingerprint: string | null
  edgeCases: string[]
  /** One-paragraph restatements for 90s no-code drills, keyed by disguise level. */
  drillVariants: { disguiseLevel: DisguiseLevel; statement: string }[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Recognition drill
// ─────────────────────────────────────────────────────────────────────────────

export const DRILL_TIME_CAP_SEC = 90
export const DRILL_FAST_THRESHOLD_SEC = 45

/** Both fields required. Mechanism alone is keyword matching. */
export interface DrillAnswer {
  mechanism: Mechanism | null
  redundancy: string // free text, graded against the canonical redundancy
}

/**
 * Scores from references/rubrics.md. The 0.3 row is deliberate: naming the waste
 * and picking the wrong tool beats guessing the right tool from surface keywords.
 */
export type DrillScore = 1.0 | 0.8 | 0.5 | 0.3 | 0.0

export interface DrillItem {
  problemId: string
  statement: string
  disguiseLevel: DisguiseLevel
  targetMechanism: Mechanism
  targetRedundancy: Redundancy
  isDueReview: boolean
  hasMisleadingFingerprint: boolean
}

export interface DrillAttempt {
  problemId: string
  answer: DrillAnswer
  mechanismCorrect: boolean
  redundancyCorrect: boolean
  score: DrillScore
  elapsedSec: number
  timedOut: boolean
}

/** Output schema: agents/recognition-drill.md */
export interface DrillSessionResult {
  items: number
  correctBoth: number
  correctPatternOnly: number
  correctRedundancyOnly: number
  missed: number
  medianTimeSec: number
  confusions: Array<[Mechanism, Mechanism]>
  recognitionDelta: Partial<Record<string, number>>
}

// ─────────────────────────────────────────────────────────────────────────────
// The Ladder & the Commit Rule
// ─────────────────────────────────────────────────────────────────────────────

export type RungNumber = 1 | 2 | 3 | 4 | 5 | 6

export const RUNG_NAMES: Record<RungNumber, string> = {
  1: 'Frame',
  2: 'Brute',
  3: 'Bottleneck',
  4: 'Lift',
  5: 'Invariant',
  6: 'Verify',
}

/** Rung 3's phrasing is load-bearing — never substitute "what pattern is this?". */
export const RUNG_PROMPTS: Record<RungNumber, string> = {
  1: 'Restate this in your own words. What is the input, the output, and how big can n get?',
  2: "What's the dumbest thing that works? Complexity?",
  3: "What is your brute force doing over and over that it shouldn't have to?",
  4: 'What kills that specific waste?',
  5: "What's true after every step, no matter the input?",
  6: 'Trace n=1, empty input, and all-identical. Final complexity?',
}

/** A falsifiable hypothesis logged at a rung. The product's memory and research asset. */
export interface LadderCommit {
  id?: string
  rung: RungNumber
  text: string
  correct: boolean
  hintsUsedAtCommit: number
  committedAt: Date
}

export type HintLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Reaching level 6 is legitimate but must be logged with a cause. */
export interface HintRelease {
  rung: RungNumber
  level: HintLevel
  text: string
  reason: string | null
  releasedAt: Date
}

export interface LadderSessionState {
  sessionId: string
  problemId: string
  currentRung: RungNumber
  commits: LadderCommit[]
  hints: HintRelease[]
  difficultyMiscalibrated: boolean
  completedAt: Date | null
}

/** Output schema: agents/socratic-coach.md */
export interface CoachResult {
  problemId: string
  rungs: Array<{ rung: RungNumber; commit: string; correct: boolean; hintsUsed: number }>
  totalHints: number
  deepestHintLevel: HintLevel
  timeToBottleneckSec: number | null
  difficultyMiscalibrated: boolean
}

/**
 * Thrown by the service layer when a hint is requested with no commit logged at the
 * current rung. This is the Commit Rule as an invariant, not an instruction — it is
 * what makes "a hint cannot be obtained without a commit" testable as *impossible*.
 */
export class CommitRuleViolation extends Error {
  constructor(readonly rung: RungNumber) {
    super(`Commit Rule: no hypothesis logged at rung ${rung} (${RUNG_NAMES[rung]}); hint withheld.`)
    this.name = 'CommitRuleViolation'
  }
}

/** Thrown when a drill sequence would place two consecutive items of the same pattern. */
export class InterleavingViolation extends Error {
  constructor(readonly mechanism: Mechanism, readonly index: number) {
    super(`Interleaving: item ${index} repeats mechanism "${mechanism}" from the previous item.`)
    this.name = 'InterleavingViolation'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure taxonomy
// ─────────────────────────────────────────────────────────────────────────────

export const FAILURE_CODES = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] as const
export type FailureCode = (typeof FAILURE_CODES)[number]

export const FAILURE_RUNG: Record<FailureCode, RungNumber> = {
  F1: 1,
  F2: 2,
  F3: 3,
  F4: 4,
  F5: 6,
  F6: 5,
}

export type F5Subclass =
  | 'off_by_one'
  | 'wrong_api'
  | 'mutation_during_iteration'
  | 'uninitialized_edge_case'
  | 'recursion_depth'

/** Output schema: agents/failure-analyst.md */
export interface FailureAnalysis {
  primaryCode: FailureCode
  secondaryCodes: FailureCode[]
  /** Must cite the commit log. Never assign a code without it. */
  evidence: string
  node: string
  prerequisiteGap: boolean
  prescription: {
    drillType: string
    target: string
    reps: number
    sessions: number
  }
  learnerMessage: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning
// ─────────────────────────────────────────────────────────────────────────────

export type BlockKind = 'warmup' | 'review' | 'core' | 'postmortem' | 'plan'

export interface SessionBlock {
  block: BlockKind
  agent: AgentName
  minutes: number
  content: string
  /** Every block gets a one-sentence justification the learner actually sees. */
  why: string
}

/** Output schema: agents/curriculum-planner.md */
export interface SessionPlan {
  sessionPlan: SessionBlock[]
  gateStatus: {
    phase: PhaseNumber
    criteriaMet: number
    criteriaTotal: number
    missing: string[]
  }
  estimatedSessionsToGate: number
  learnerMessage: string
}

export interface ProblemRequest {
  targetPattern: Mechanism
  difficulty: 'below_current' | 'at_current' | 'just_above_current'
  seenBefore: false
  disguiseLevel: DisguiseLevel
  distractorSignal: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Placement, examination, review, interview
// ─────────────────────────────────────────────────────────────────────────────

/** Output schema: agents/placement-diagnostician.md */
export interface PlacementResult {
  placementPhase: PhaseNumber
  frontierNodes: string[]
  /** Articulation is absent here by design — placement never initializes it. */
  masteryInit: Record<string, Omit<MasteryVector, 'articulation'>>
  profile: string
  confidence: number
  notes: string
  firstSessionPlan: string
}

/** Output schema: agents/invariant-examiner.md */
export interface InvariantExamResult {
  probes: Array<{ q: string; answerQuality: 'full' | 'partial' | 'none'; note: string }>
  invariantStated: boolean
  invariantCorrect: boolean
  circularReasoning: boolean
  score: number
  f6Flag: boolean
}

/** Output schema: agents/code-critic.md */
export interface CodeCritiqueResult {
  /** Answered before any line is read. Debugging a wrong idea is the demoralizing path. */
  ideaCorrect: boolean
  passes: boolean
  complexityActual: string
  complexityIntended: string
  bugs: Array<{ line: number; class: string; hintLevelUsed: number }>
  idiomNotes: string[]
  legibilityScore: number
  independence: boolean
  lookups: string[]
  f5Subclass: F5Subclass | null
}

/** Output schema: agents/interview-simulator.md */
export interface InterviewResult {
  problemId: string
  disguiseLevel: DisguiseLevel
  solved: boolean
  timeToWorkingSec: number
  correctnessScore: number
  communication: {
    clarifyingQuestions: number
    bruteForceStated: number
    optimizationJustified: number
    thinkingAudible: number
    selfTesting: number
    composure: number
  }
  wrongTurnRecoverySec: number | null
  highestCostBehavior: string
  verdict: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Agents
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_NAMES = [
  'placement-diagnostician',
  'socratic-coach',
  'recognition-drill',
  'invariant-examiner',
  'code-critic',
  'failure-analyst',
  'curriculum-planner',
  'interview-simulator',
  'content-forge',
] as const

export type AgentName = (typeof AGENT_NAMES)[number]

/** The only agent permitted to write Mastery. Everything else emits deltas. */
export const MASTERY_WRITER: AgentName = 'curriculum-planner'

// ─────────────────────────────────────────────────────────────────────────────
// Data access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The seam between Track A (real Prisma impl) and Tracks C/D (mocks).
 * Both sides code against this; integration swaps the implementation.
 */
export interface DataStore {
  getMastery(learnerId: string, node: string): Promise<MasteryState | null>
  /** MUST apply decay from lastSeen before returning. Callers receive current values. */
  getAllMastery(learnerId: string): Promise<MasteryState[]>
  /** Enforced single-writer: rejects any source other than MASTERY_WRITER. */
  applyDeltas(learnerId: string, deltas: MasteryDelta[], source: AgentName): Promise<MasteryState[]>
  enqueueDelta(learnerId: string, delta: MasteryDelta): Promise<void>
  pendingDeltas(learnerId: string): Promise<MasteryDelta[]>

  getProblem(problemId: string): Promise<ProblemContent | null>
  listProblems(filter?: { mechanism?: Mechanism; phase?: PhaseNumber }): Promise<ProblemContent[]>
  seenProblemIds(learnerId: string): Promise<string[]>

  createLadderSession(learnerId: string, problemId: string): Promise<LadderSessionState>
  getLadderSession(sessionId: string): Promise<LadderSessionState | null>
  logCommit(sessionId: string, commit: LadderCommit): Promise<LadderSessionState>
  logHint(sessionId: string, hint: HintRelease): Promise<LadderSessionState>

  recordDrillAttempt(learnerId: string, attempt: DrillAttempt): Promise<void>
}
