/**
 * The Ladder session, server side.
 *
 * ─── The Commit Rule lives here ──────────────────────────────────────────────
 *
 * `releaseHint` loads the session, looks for a commit at the current rung, and throws
 * `CommitRuleViolation` if there is none. That throw is the rule. The disabled button
 * in the UI is a courtesy that explains the rule; it is not the rule, and there is no
 * code path in this module that releases a hint without the check running first.
 *
 * Consequences worth stating, because they are the product:
 *   - A wrong hypothesis unlocks the hint exactly as a right one does. The gate is
 *     falsifiability, not correctness.
 *   - Hints come out one level at a time. `nextHintLevel` is derived from the count
 *     already released, so a caller cannot ask for level 4 directly.
 *   - Level 6 requires a stated reason (rubrics.md), enforced here, not in the form.
 */

import {
  CommitRuleViolation,
  RUNG_PROMPTS,
  type HintLevel,
  type HintRelease,
  type LadderCommit,
  type LadderSessionState,
  type ProblemContent,
  type RungNumber,
} from '@/lib/types'
import { COACH_PROBLEM_ID, MOCK_LEARNER_ID, store, uiStore } from '@/lib/ui-store'
import { gradeCommit } from './grading'

/** Reaching level 4 on one rung means the problem is above the learner, not that they need level 5. */
const MISCALIBRATION_HINTS_PER_RUNG = 4
const MAX_HINT_LEVEL: HintLevel = 6

/**
 * The result shape crossing the action boundary. It lives here rather than in
 * `actions.ts` so a client component can import the type without importing a module
 * marked `'use server'`.
 */
export type CoachActionResult =
  | { ok: true; view: CoachView }
  | { ok: false; message: string; commitRuleViolation: boolean }

export interface CoachView {
  sessionId: string
  problemId: string
  title: string
  statement: string
  currentRung: RungNumber
  /** RUNG_PROMPTS, verbatim. Rung 3's phrasing is load-bearing. */
  prompt: string
  commits: LadderCommit[]
  hints: HintRelease[]
  /**
   * True iff a hypothesis is logged at the current rung. The UI disables the hint
   * button on this; the server throws on the same condition regardless.
   */
  hintUnlocked: boolean
  nextHintLevel: HintLevel
  /** Level 6 is full derivation and must be logged with a cause. */
  reasonRequired: boolean
  hintsExhausted: boolean
  difficultyMiscalibrated: boolean
  completed: boolean
}

async function loadProblem(problemId: string): Promise<ProblemContent> {
  const problem = await store.getProblem(problemId)
  if (!problem) throw new Error(`Missing problem ${problemId}`)
  return problem
}

function hasCommitAtRung(session: LadderSessionState, rung: RungNumber): boolean {
  return session.commits.some((c) => c.rung === rung)
}

function toView(session: LadderSessionState, problem: ProblemContent): CoachView {
  const nextLevel = Math.min(session.hints.length, MAX_HINT_LEVEL) as HintLevel
  return {
    sessionId: session.sessionId,
    problemId: session.problemId,
    title: problem.title,
    statement: problem.statement,
    currentRung: session.currentRung,
    prompt: RUNG_PROMPTS[session.currentRung],
    commits: session.commits,
    hints: session.hints,
    hintUnlocked: hasCommitAtRung(session, session.currentRung),
    nextHintLevel: nextLevel,
    reasonRequired: nextLevel === MAX_HINT_LEVEL,
    hintsExhausted: session.hints.length > MAX_HINT_LEVEL,
    difficultyMiscalibrated: session.difficultyMiscalibrated,
    completed: session.completedAt !== null,
  }
}

async function view(sessionId: string): Promise<CoachView> {
  const session = await store.getLadderSession(sessionId)
  if (!session) throw new Error('That ladder session has expired. Start a new one.')
  return toView(session, await loadProblem(session.problemId))
}

export async function startSession(
  learnerId: string = MOCK_LEARNER_ID,
  problemId: string = COACH_PROBLEM_ID,
): Promise<CoachView> {
  const session = await store.createLadderSession(learnerId, problemId)
  return toView(session, await loadProblem(problemId))
}

export async function getSession(sessionId: string): Promise<CoachView> {
  return view(sessionId)
}

/**
 * Logs a hypothesis at the current rung. Correct or not, it is logged — a wrong
 * commit is the more valuable record, because it is a labeled example of this
 * learner's misconception.
 */
export async function logHypothesis(sessionId: string, text: string): Promise<CoachView> {
  const session = await store.getLadderSession(sessionId)
  if (!session) throw new Error('That ladder session has expired. Start a new one.')
  if (text.trim() === '') throw new Error('A hypothesis has to say something falsifiable.')

  const problem = await loadProblem(session.problemId)
  const commit: LadderCommit = {
    rung: session.currentRung,
    text: text.trim(),
    correct: gradeCommit(session.currentRung, text, problem),
    hintsUsedAtCommit: session.hints.length,
    committedAt: new Date(),
  }
  await store.logCommit(sessionId, commit)
  if (commit.correct) await uiStore.advanceRung(sessionId)
  return view(sessionId)
}

/**
 * THE INVARIANT. Throws `CommitRuleViolation` when no hypothesis is logged at the
 * current rung. Nothing above this call can suppress it.
 */
export async function releaseHint(sessionId: string, reason: string | null): Promise<CoachView> {
  const session = await store.getLadderSession(sessionId)
  if (!session) throw new Error('That ladder session has expired. Start a new one.')

  if (!hasCommitAtRung(session, session.currentRung)) {
    throw new CommitRuleViolation(session.currentRung)
  }

  const level = Math.min(session.hints.length, MAX_HINT_LEVEL) as HintLevel
  if (level === MAX_HINT_LEVEL && (reason === null || reason.trim() === '')) {
    throw new Error(
      'Level 6 is the full derivation. It is a legitimate outcome, but it has to be logged with a cause so the planner can fix the difficulty calibration.',
    )
  }

  const problem = await loadProblem(session.problemId)
  const hint: HintRelease = {
    rung: session.currentRung,
    level,
    text: problem.hints[level] ?? problem.hints[problem.hints.length - 1],
    reason: reason?.trim() ? reason.trim() : null,
    releasedAt: new Date(),
  }
  await store.logHint(sessionId, hint)

  const atRung = session.hints.filter((h) => h.rung === session.currentRung).length + 1
  if (atRung >= MISCALIBRATION_HINTS_PER_RUNG) await uiStore.flagMiscalibrated(sessionId)

  return view(sessionId)
}
