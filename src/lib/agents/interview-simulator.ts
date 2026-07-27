/**
 * Agent: Interview Simulator. 45 minutes, timed, uninterrupted.
 *
 * Structural rules:
 *  - The problem is **deliberately underspecified**: the generated statement must
 *    carry at least two genuine ambiguities, or it is refused. A candidate who
 *    starts coding without asking has failed a real dimension of the interview,
 *    and this is the only place they find that out before it costs them.
 *  - **Exactly one wrong turn**, injected around the 20-minute mark.
 *    `injectWrongTurn` throws if called twice. The recovery is the point.
 *  - Correctness and communication are scored in **separate calls** and reported
 *    separately — a candidate who solves it silently must score poorly.
 *  - Phase 5 only, unless the learner explicitly acknowledges it is above level.
 */

import * as z from 'zod/v4'

import {
  type DataStore,
  type DisguiseLevel,
  type InterviewResult,
  type PhaseNumber,
  type ProblemContent,
} from '../types'
import { disguiseEnum, runAgent, unitScore, type StructuredClient } from './client'

export const INTERVIEW_SECONDS = 45 * 60
export const WRONG_TURN_AT_SEC = 20 * 60
export const WRONG_TURN_WINDOW_SEC = 3 * 60
export const MIN_AMBIGUITIES = 2

/** Thrown when the simulator is run below Phase 5 without an explicit acknowledgement. */
export class AboveLevelWarning extends Error {
  constructor(readonly phase: PhaseNumber) {
    super(
      `interview-simulator: this is a Phase 5 instrument and the learner is at Phase ${phase}. Run it only with an explicit acknowledgement that it is above level.`,
    )
    this.name = 'AboveLevelWarning'
  }
}

/** Thrown when the generated problem is not actually underspecified. */
export class UnderspecificationRequired extends Error {
  constructor(readonly count: number) {
    super(
      `interview-simulator: the problem must carry at least ${MIN_AMBIGUITIES} genuine ambiguities; got ${count}. A fully specified problem cannot test clarifying questions.`,
    )
    this.name = 'UnderspecificationRequired'
  }
}

/** Thrown on a second wrong turn. One setback, then recovery — that is the design. */
export class WrongTurnExhausted extends Error {
  constructor() {
    super('interview-simulator: exactly one wrong turn is induced per interview.')
    this.name = 'WrongTurnExhausted'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const InterviewProblemSchema = z.object({
  /** Three or four sentences. No more. */
  statement: z.string().min(1),
  disguise_level: disguiseEnum,
  /** Unstated bounds, undefined empty behaviour, ambiguous tie-breaking, ... */
  ambiguities: z.array(z.string().min(1)).min(MIN_AMBIGUITIES),
  /** Held back. Delivered only if the candidate asks the right question. */
  clarifications: z.array(z.object({ question: z.string(), answer: z.string() })),
})
export type InterviewProblem = z.infer<typeof InterviewProblemSchema>

export const WrongTurnSchema = z.object({
  /** "What if the array can't be modified?" / "Now it's streaming." */
  prompt: z.string().min(1),
  invalidates: z.string().min(1),
})

/** Correctness only. This call is never shown the communication transcript. */
export const CorrectnessSchema = z.object({
  solved: z.boolean(),
  correctness_score: unitScore,
  complexity_actual: z.string(),
  notes: z.string(),
})

/** Communication only. Scored separately, reported separately. */
export const CommunicationSchema = z.object({
  clarifying_questions: unitScore,
  brute_force_stated: unitScore,
  optimization_justified: unitScore,
  thinking_audible: unitScore,
  self_testing: unitScore,
  composure: unitScore,
  /** One thing, not a list. Lists don't get acted on. */
  highest_cost_behavior: z.string().min(1),
  /** Replay of the wrong turn, with the line they should have said instead. */
  wrong_turn_replay: z.string(),
  verdict: z.string().min(1),
})

const INTERVIEWER_ROLE = `You are running a 45-minute technical interview. Play a real interviewer: slightly
impatient, interrupts, asks "why that?" at inconvenient moments, and occasionally
pushes a *worse* idea to see whether the candidate defends their reasoning or
folds. Folding under a confident wrong suggestion is extremely common and almost
never practiced against.

State the problem in three or four sentences with at least two genuine
ambiguities — unstated input bounds, undefined behaviour on empty input,
ambiguous tie-breaking. Do not volunteer clarification. Answer clarifying
questions accurately when asked, and only when asked.`

const GRADER_ROLE = `You are grading a 45-minute mock interview for the Cracked method. Correctness and
communication are scored separately and reported separately.

A candidate who solves it silently scores poorly and needs to hear that plainly.
Silent correct solving is a failure mode that looks like success on every other
practice platform, and it loses real offers.

Composure is about the induced wrong turn: did they recover, or spiral? The most
common failure among technically-ready candidates is the spiral after the first
setback.`

// ─────────────────────────────────────────────────────────────────────────────
// Runtime
// ─────────────────────────────────────────────────────────────────────────────

export interface InterviewDeps {
  store: DataStore
  client?: StructuredClient
}

export interface InterviewState {
  problemId: string
  problem: InterviewProblem
  startedAt: Date
  wrongTurnInjectedAtSec: number | null
  wrongTurnRecoveredAtSec: number | null
}

export async function startInterview(
  deps: InterviewDeps,
  args: {
    problemId: string
    phase: PhaseNumber
    /** Required below Phase 5. The warning is the point; suppressing it is not. */
    acknowledgedAboveLevel?: boolean
    disguiseLevel?: DisguiseLevel
    now?: Date
  },
): Promise<InterviewState> {
  if (args.phase < 5 && !args.acknowledgedAboveLevel) throw new AboveLevelWarning(args.phase)

  const problem = await deps.store.getProblem(args.problemId)
  if (!problem) throw new Error(`interview-simulator: unknown problem "${args.problemId}"`)

  const generated = await runAgent({
    agent: 'interview-simulator',
    system: INTERVIEWER_ROLE,
    schema: InterviewProblemSchema,
    client: deps.client,
    user: [
      `Source problem: ${problem.title}`,
      `Full statement (yours, not the candidate's): ${problem.statement}`,
      `Target mechanism: ${problem.primaryPattern}`,
      `Edge cases: ${problem.edgeCases.join(', ')}`,
      `Target disguise level: ${args.disguiseLevel ?? 3}`,
      ``,
      `Restate this as an interview prompt: three or four sentences, deliberately`,
      `underspecified, at least ${MIN_AMBIGUITIES} genuine ambiguities. List the`,
      `ambiguities and the clarifications you will give if — and only if — asked.`,
    ].join('\n'),
  })

  if (generated.ambiguities.length < MIN_AMBIGUITIES) {
    throw new UnderspecificationRequired(generated.ambiguities.length)
  }

  return {
    problemId: args.problemId,
    problem: generated,
    startedAt: args.now ?? new Date(),
    wrongTurnInjectedAtSec: null,
    wrongTurnRecoveredAtSec: null,
  }
}

export function shouldInjectWrongTurn(state: InterviewState, elapsedSec: number): boolean {
  if (state.wrongTurnInjectedAtSec !== null) return false
  return elapsedSec >= WRONG_TURN_AT_SEC - WRONG_TURN_WINDOW_SEC
}

/**
 * Around the 20-minute mark, ask a follow-up that invalidates part of their
 * approach. Once. The recovery is the point.
 */
export async function injectWrongTurn(
  deps: InterviewDeps,
  state: InterviewState,
  args: { elapsedSec: number; currentApproach: string },
): Promise<{ state: InterviewState; prompt: string; invalidates: string }> {
  if (state.wrongTurnInjectedAtSec !== null) throw new WrongTurnExhausted()

  const problem = await deps.store.getProblem(state.problemId)
  const turn = await runAgent({
    agent: 'interview-simulator',
    system: INTERVIEWER_ROLE,
    schema: WrongTurnSchema,
    client: deps.client,
    user: [
      `Candidate's approach so far: ${args.currentApproach}`,
      problem ? `Canonical solution: ${problem.canonicalLadder.lift}` : '',
      ``,
      `We are ${Math.round(args.elapsedSec / 60)} minutes in. Ask the one follow-up`,
      `that invalidates part of their approach — "what if the array can't be`,
      `modified?", "now it's streaming", "what if it has to be online?". One line.`,
    ]
      .filter(Boolean)
      .join('\n'),
  })

  state.wrongTurnInjectedAtSec = args.elapsedSec
  return { state, prompt: turn.prompt, invalidates: turn.invalidates }
}

export function markWrongTurnRecovered(state: InterviewState, elapsedSec: number): InterviewState {
  if (state.wrongTurnInjectedAtSec === null) return state
  if (state.wrongTurnRecoveredAtSec === null) state.wrongTurnRecoveredAtSec = elapsedSec
  return state
}

export interface DebriefInput {
  state: InterviewState
  /** Code and final approach. Correctness only — no transcript. */
  submission: { code: string; approach: string; timeToWorkingSec: number }
  /** Turn-by-turn transcript. Communication only — no grading of the answer. */
  transcript: string
}

/**
 * Two calls, deliberately. The correctness grader never sees the transcript and
 * the communication grader never sees the code, so neither score can quietly
 * absorb the other.
 */
export async function debrief(
  deps: InterviewDeps,
  input: DebriefInput,
): Promise<{ result: InterviewResult; debriefScript: string[] }> {
  const problem = await deps.store.getProblem(input.state.problemId)

  const [correctness, communication] = await Promise.all([
    runAgent({
      agent: 'interview-simulator',
      system: GRADER_ROLE,
      schema: CorrectnessSchema,
      client: deps.client,
      user: [
        `Problem: ${input.state.problem.statement}`,
        problem ? `Edge cases that must hold: ${problem.edgeCases.join(', ')}` : '',
        ``,
        `Final approach: ${input.submission.approach}`,
        `Code:`,
        '```',
        input.submission.code,
        '```',
        ``,
        `Score correctness only. You have not been shown how they communicated.`,
      ]
        .filter(Boolean)
        .join('\n'),
    }),
    runAgent({
      agent: 'interview-simulator',
      system: GRADER_ROLE,
      schema: CommunicationSchema,
      client: deps.client,
      user: [
        `Ambiguities planted: ${input.state.problem.ambiguities.join(' | ')}`,
        `Wrong turn injected at: ${
          input.state.wrongTurnInjectedAtSec !== null
            ? `${Math.round(input.state.wrongTurnInjectedAtSec / 60)} min`
            : 'not injected'
        }`,
        ``,
        `Transcript:`,
        input.transcript,
        ``,
        `Score communication only, on the articulation rubric: clarifying questions`,
        `(did they surface a real ambiguity before coding), brute force stated aloud`,
        `with complexity, optimization justified by naming the bottleneck before the`,
        `mechanism, thinking audible (no unnarrated silence beyond ~20s), self-testing`,
        `unprompted, composure through the wrong turn.`,
        ``,
        `Name ONE highest-cost behavior, not a list. Replay the wrong turn with the`,
        `line they should have said instead — narrating uncertainty reads as`,
        `competence; silence reads as being stuck.`,
      ].join('\n'),
    }),
  ])

  const recovery =
    input.state.wrongTurnInjectedAtSec !== null && input.state.wrongTurnRecoveredAtSec !== null
      ? input.state.wrongTurnRecoveredAtSec - input.state.wrongTurnInjectedAtSec
      : null

  const result: InterviewResult = {
    problemId: input.state.problemId,
    disguiseLevel: input.state.problem.disguise_level,
    solved: correctness.solved,
    timeToWorkingSec: input.submission.timeToWorkingSec,
    correctnessScore: correctness.correctness_score,
    communication: {
      clarifyingQuestions: communication.clarifying_questions,
      bruteForceStated: communication.brute_force_stated,
      optimizationJustified: communication.optimization_justified,
      thinkingAudible: communication.thinking_audible,
      selfTesting: communication.self_testing,
      composure: communication.composure,
    },
    wrongTurnRecoverySec: recovery,
    highestCostBehavior: communication.highest_cost_behavior,
    verdict: communication.verdict,
  }

  // Debrief order is fixed: what they'd have passed on, the one behavior, the
  // wrong-turn replay, correctness LAST — it is usually the part they're least
  // deficient in, and leading with it lets them skip the part that needs work.
  const debriefScript = [
    passedOnLine(result),
    `Highest-cost behavior: ${communication.highest_cost_behavior}`,
    communication.wrong_turn_replay,
    `Correctness: ${correctness.correctness_score} — ${correctness.notes}`,
  ]

  return { result, debriefScript }
}

function passedOnLine(r: InterviewResult): string {
  const strong = Object.entries(r.communication)
    .filter(([, v]) => v >= 0.8)
    .map(([k]) => k)
  return strong.length
    ? `You'd have passed on: ${strong.join(', ')}.`
    : `Nothing here clears the bar yet on communication — that is the whole finding.`
}
