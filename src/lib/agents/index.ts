/**
 * Track C — the agent runtime.
 *
 * Everything here is constructed against the `DataStore` interface from
 * `types.ts` and takes it by injection. Nothing in this directory imports Prisma;
 * `mock-store.ts` is the in-memory implementation that lets the runtime run
 * standalone, and integration swaps it for Track A's.
 *
 * The invariants that are enforced in code rather than in prompts:
 *   socratic-coach   CommitRuleViolation / HintLadderViolation / RungOrderViolation
 *                    / PatternEmbargoViolation
 *   interleave       InterleavingViolation
 *   scoring          EvidenceRequired
 *   curriculum-planner GateViolation / PlanRuleViolation
 *   code-critic      idea judged before the code is read; BugFeedbackViolation
 *   invariant-examiner CircularPushExhausted (push exactly once)
 *   interview-simulator UnderspecificationRequired / WrongTurnExhausted
 *   content-forge    ContentQualityViolation
 *   recognition-drill IncompleteDrillAnswer
 */

export * from './client'
export * from './mock-store'

export * as placementDiagnostician from './placement-diagnostician'
export * as socraticCoach from './socratic-coach'
export * as recognitionDrill from './recognition-drill'
export * as invariantExaminer from './invariant-examiner'
export * as codeCritic from './code-critic'
export * as failureAnalyst from './failure-analyst'
export * as curriculumPlanner from './curriculum-planner'
export * as interviewSimulator from './interview-simulator'
export * as contentForge from './content-forge'

// Pure engines, re-exported for convenience so callers have one import site.
export * as scoring from '../scoring'
export * as interleave from '../interleave'
