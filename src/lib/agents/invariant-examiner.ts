/**
 * Agent: Invariant Examiner. Grades the *why*.
 *
 * Structural rules:
 *  - Circularity is pushed on **exactly once**. The push counter lives in the
 *    exam state; a second circular answer closes the exam with F6 instead of
 *    grinding, and `pushOnCircularity` throws if called again.
 *  - Informal proofs are accepted: the grader has no "formality" field to score,
 *    and `answerQuality` is explicitly about the argument, not its dress.
 *  - Between 2 and 4 probes. More is grinding; fewer is not an examination.
 */

import * as z from 'zod/v4'

import type { Mechanism } from '../taxonomy'
import { type DataStore, type InvariantExamResult } from '../types'
import { runAgent, unitScore, type StructuredClient } from './client'

/** Thrown if the examiner tries to push on circularity a second time. */
export class CircularPushExhausted extends Error {
  constructor() {
    super(
      'invariant-examiner: circularity is pushed on exactly once. A second circular answer is F6 — score it and move on rather than grinding.',
    )
    this.name = 'CircularPushExhausted'
  }
}

/** The scripted push. Verbatim from references/rubrics.md. */
export const CIRCULARITY_PUSH =
  "That's a restatement of the goal. What's true at each *step* that makes the goal reachable?"

export const MIN_PROBES = 2
export const MAX_PROBES = 4

const answerQuality = z.enum(['full', 'partial', 'none'])

export const ProbeSetSchema = z.object({
  probes: z.array(z.string().min(1)).min(MIN_PROBES).max(MAX_PROBES),
})

export const ProbeGradeSchema = z.object({
  answer_quality: answerQuality,
  /** What they had and what they were missing. Specific, one or two clauses. */
  note: z.string(),
  /** True only for goal-restatement, or "because that's how the pattern works". */
  circular: z.boolean(),
  /** Did this answer state a property that holds at every step? */
  states_invariant: z.boolean(),
  invariant_correct: z.boolean(),
})
export type ProbeGrade = z.infer<typeof ProbeGradeSchema>

const ROLE = `You are the invariant-examiner of the Cracked method. You grade the *why*. A green
checkmark with no justification is an F6 failure and you treat it as one, because a
learner who can't say why their approach works cannot adapt it when an interviewer
changes one constraint.

Accept informal proofs. Plain-language correctness arguments get full credit.
Demanding formal induction teaches learners that the "why" rung is academic ritual
rather than the thing that lets them modify an approach under pressure.

Reject circular arguments. "It works because it finds the answer" is not an
invariant. Do not accept "because that's how the pattern works" — that is memory
presenting itself as understanding, and it is the specific failure you exist to catch.

One counterexample beats ten confirmations. If they defend a correct solution well,
try to break it. If they defend an incorrect one confidently, hand them the
counterexample immediately — confident wrongness is worth interrupting.

Probes are short, specific, and unforgiving of hand-waving.`

export interface ExaminerDeps {
  store: DataStore
  client?: StructuredClient
}

export interface ExamState {
  problemId: string
  mechanism: Mechanism
  probes: string[]
  graded: Array<{ q: string; answerQuality: 'full' | 'partial' | 'none'; note: string }>
  circularPushes: number
  invariantStated: boolean
  invariantCorrect: boolean
  closed: boolean
}

export async function openExam(
  deps: ExaminerDeps,
  args: { problemId: string; mechanism: Mechanism; solutionSketch: string },
): Promise<ExamState> {
  const problem = await deps.store.getProblem(args.problemId)
  if (!problem) throw new Error(`invariant-examiner: unknown problem "${args.problemId}"`)

  const { probes } = await runAgent({
    agent: 'invariant-examiner',
    system: ROLE,
    schema: ProbeSetSchema,
    client: deps.client,
    user: [
      `Problem: ${problem.title}`,
      `Mechanism used: ${args.mechanism}`,
      `Canonical invariant: ${problem.canonicalLadder.invariant}`,
      ``,
      `Their working solution, in their words:`,
      args.solutionSketch,
      ``,
      `Write ${MIN_PROBES}-${MAX_PROBES} adversarial probes targeted at THIS mechanism.`,
      `Generic probing produces generic answers. Draw on the standard bank where it fits:`,
      `  - What's true after every iteration, regardless of input?`,
      `  - Why is it safe to discard the half you're discarding?`,
      `  - What breaks if you move the other pointer instead?`,
      `  - Convince me this terminates.`,
      `  - Give me an input where this fails.`,
      `  - Your greedy takes the locally best option — why is that never regretted later?`,
      `  - You cached on (i, j). Why is that enough state? What are you assuming doesn't matter?`,
    ].join('\n'),
  })

  return {
    problemId: args.problemId,
    mechanism: args.mechanism,
    probes,
    graded: [],
    circularPushes: 0,
    invariantStated: false,
    invariantCorrect: false,
    closed: false,
  }
}

/** The once-only push. Throws rather than allowing a second round of grinding. */
export function pushOnCircularity(state: ExamState): string {
  if (state.circularPushes >= 1) throw new CircularPushExhausted()
  state.circularPushes += 1
  return CIRCULARITY_PUSH
}

export async function answerProbe(
  deps: ExaminerDeps,
  state: ExamState,
  probeIndex: number,
  answer: string,
): Promise<{ state: ExamState; grade: ProbeGrade; followUp: string | null }> {
  const probe = state.probes[probeIndex]
  if (!probe) throw new Error(`invariant-examiner: no probe at index ${probeIndex}`)
  if (state.closed) throw new Error('invariant-examiner: this exam is closed')

  const problem = await deps.store.getProblem(state.problemId)

  const grade = await runAgent({
    agent: 'invariant-examiner',
    system: ROLE,
    schema: ProbeGradeSchema,
    client: deps.client,
    user: [
      `Mechanism: ${state.mechanism}`,
      problem ? `Canonical invariant: ${problem.canonicalLadder.invariant}` : '',
      ``,
      `Probe: ${probe}`,
      `Answer: "${answer}"`,
      state.circularPushes === 1
        ? `NOTE: this is their second attempt after you already pushed once on circularity.`
        : '',
      ``,
      `Grade the argument, not its formality. A correct plain-language argument is`,
      `"full". Mark circular only for goal-restatement or "that's how the pattern works".`,
    ]
      .filter(Boolean)
      .join('\n'),
  })

  state.graded.push({ q: probe, answerQuality: grade.answer_quality, note: grade.note })
  if (grade.states_invariant) state.invariantStated = true
  if (grade.invariant_correct) state.invariantCorrect = true

  let followUp: string | null = null
  if (grade.circular) {
    if (state.circularPushes === 0) {
      followUp = pushOnCircularity(state)
    } else {
      // Second circular answer. Score it F6 and stop rather than grinding.
      state.closed = true
    }
  }

  return { state, grade, followUp }
}

/** Output schema: agents/invariant-examiner.md */
export function finishExam(state: ExamState): InvariantExamResult {
  const weights = { full: 1, partial: 0.5, none: 0 }
  const score =
    state.graded.length === 0
      ? 0
      : Math.round(
          (state.graded.reduce((a, g) => a + weights[g.answerQuality], 0) / state.graded.length) * 100,
        ) / 100

  const circular = state.circularPushes > 0 && state.closed
  return {
    probes: state.graded,
    invariantStated: state.invariantStated,
    invariantCorrect: state.invariantCorrect && !circular,
    circularReasoning: state.circularPushes > 0,
    score,
    f6Flag: circular || !state.invariantCorrect || score < 0.5,
  }
}

/** Exported for the planner's articulation-free scoring paths. */
export const probeScoreSchema = unitScore
