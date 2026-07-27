/**
 * Agent: Failure Analyst.
 *
 * Structural rules:
 *  - Exactly one primary code, and it is computed from the commit log by
 *    `scoring.primaryFailure` — earliest rung wins. The model writes the prose;
 *    it does not get a vote on the classification.
 *  - No code without evidence. The returned `evidence` always opens with a
 *    log citation, and `assertEvidence` re-checks that the log supports the code
 *    before the analysis is returned.
 *  - A clean session returns `null` rather than a manufactured code. Guessing at
 *    the failure is exactly what this agent exists to prevent.
 *  - Three consecutive F1/F2 on a node sets `prerequisiteGap` — computed, not asked.
 */

import * as z from 'zod/v4'

import type { Mechanism } from '../taxonomy'
import {
  assertEvidence,
  candidateFailureCodes,
  hasPrerequisiteGap,
  primaryFailure,
  PRESCRIPTION_BY_CODE,
} from '../scoring'
import {
  RUNG_NAMES,
  type CodeCritiqueResult,
  type DataStore,
  type FailureAnalysis,
  type FailureCode,
  type InvariantExamResult,
  type LadderSessionState,
} from '../types'
import { failureCodeEnum, runAgent, type StructuredClient } from './client'

export const FailureAnalysisSchema = z.object({
  primary_code: failureCodeEnum,
  secondary_codes: z.array(failureCodeEnum),
  evidence: z.string(),
  node: z.string(),
  prerequisite_gap: z.boolean(),
  prescription: z.object({
    drill_type: z.string(),
    target: z.string(),
    reps: z.number().int().min(1).max(40),
    sessions: z.number().int().min(1).max(12),
  }),
  learner_message: z.string(),
})
export type FailureAnalysisPayload = z.infer<typeof FailureAnalysisSchema>

const ROLE = `You are the failure-analyst of the Cracked method. You classify where on the
Ladder a learner fell off and write the prescription. You are the agent that makes
this system a diagnostic instrument rather than a problem list.

F1 Frame — solved a different problem than the one posed.
F2 Brute — could not produce any correct approach. Back up a phase; the primitive
   is missing. Never treat this as needing a hint about the optimal approach.
F3 Bottleneck — had a brute force, could not name what it repeated.
F4 Lift — named the waste correctly, picked the wrong mechanism. Name the pair.
F5 Implementation — right approach, wrong code.
F6 Invariant — code passes, cannot say why.

F3 and F4 are the most common failures in the domain and the ones existing
resources serve worst, because "read the editorial" only ever addresses F5. When
you see F3 or F4, say so explicitly and say why it matters. Learners who have been
grinding without progress have usually been treating an F3 problem with F5
medicine for months; naming that correctly is often the highest-value sentence
this product delivers.

Praise clean derivation on wrong answers as a sentence, not a tone: "You climbed
every rung correctly and picked the wrong mechanism at the top. That's a much
better session than guessing right would have been."

A green checkmark is not a passing grade — solved-but-needed-four-hints is a real
gap and gets a code.`

export interface PostMortemInput {
  learnerId: string
  /** Skill DAG node this session exercised. */
  node: string
  session: LadderSessionState
  codeCritique?: CodeCritiqueResult | null
  invariantExam?: InvariantExamResult | null
  /** Prior codes on this node, oldest first, excluding this session. */
  recentCodesOnNode?: FailureCode[]
  /** From recognition-drill or code-critic, when the failure was F4. */
  confusedPair?: readonly [Mechanism, Mechanism] | null
  solved?: boolean
}

export interface FailureAnalystDeps {
  store: DataStore
  client?: StructuredClient
}

/**
 * Returns null when the log supports no code at all — a clean session with no
 * wrong commits and no hints. That is a real outcome, not a missing analysis.
 */
export async function analyzeFailure(
  deps: FailureAnalystDeps,
  input: PostMortemInput,
): Promise<FailureAnalysis | null> {
  const evidenceCtx = {
    session: input.session,
    codeCritique: input.codeCritique ?? null,
    invariantExam: input.invariantExam ?? null,
  }
  const candidates = candidateFailureCodes(evidenceCtx)
  const primary = primaryFailure(evidenceCtx)
  if (!primary) return null // no evidence, no code. Full stop.

  const secondary = candidates.filter((c) => c.code !== primary.code).map((c) => c.code)
  const prerequisiteGap = hasPrerequisiteGap([...(input.recentCodesOnNode ?? []), primary.code])
  const remedy = PRESCRIPTION_BY_CODE[primary.code]

  const payload = await runAgent({
    agent: 'failure-analyst',
    system: ROLE,
    schema: FailureAnalysisSchema,
    client: deps.client,
    user: [
      `Node: ${input.node}`,
      `Problem: ${input.session.problemId}`,
      `Solved: ${input.solved ? 'yes' : 'no'}`,
      ``,
      `Commit log:`,
      input.session.commits
        .map(
          (c) =>
            `  rung ${c.rung} (${RUNG_NAMES[c.rung]}) ${c.correct ? 'OK ' : 'BAD'} "${c.text}" [hints used at commit: ${c.hintsUsedAtCommit}]`,
        )
        .join('\n') || '  (empty)',
      ``,
      `Hint log:`,
      input.session.hints
        .map((h) => `  rung ${h.rung} level ${h.level}${h.reason ? ` (reason: ${h.reason})` : ''}`)
        .join('\n') || '  (none)',
      ``,
      input.codeCritique
        ? `code-critic: idea_correct=${input.codeCritique.ideaCorrect}, passes=${input.codeCritique.passes}, bugs=${input.codeCritique.bugs
            .map((b) => b.class)
            .join(', ')}, f5_subclass=${input.codeCritique.f5Subclass ?? 'none'}`
        : `code-critic: not run`,
      input.invariantExam
        ? `invariant-examiner: score=${input.invariantExam.score}, circular=${input.invariantExam.circularReasoning}, f6=${input.invariantExam.f6Flag}`
        : `invariant-examiner: not run`,
      input.confusedPair ? `Confused pair: ${input.confusedPair[0]} vs ${input.confusedPair[1]}` : ``,
      ``,
      `The classification is already fixed by the log and is not yours to change:`,
      `  primary_code = ${primary.code} (${primary.evidence})`,
      `  secondary_codes = [${secondary.join(', ')}]`,
      `  prerequisite_gap = ${prerequisiteGap}`,
      `  prescription.drill_type = ${remedy.drillType}`,
      `Echo those values back exactly. Your job is "evidence" (quote the log),`,
      `"target"/"reps"/"sessions" (tune the remedy to this learner), and`,
      `"learner_message" (2-4 sentences, direct, forward-pointing).`,
      prerequisiteGap
        ? `This is the circuit breaker: three consecutive F1/F2 on this node. Say plainly that this is not a discipline problem — the foundation genuinely isn't there yet, and grinding at this level will not build it.`
        : ``,
    ]
      .filter(Boolean)
      .join('\n'),
  })

  // The log citation always leads; the model's narrative is appended, never trusted alone.
  const evidence = `${primary.evidence}. ${payload.evidence.trim()}`.trim()
  assertEvidence(primary.code, evidence, evidenceCtx)

  return {
    primaryCode: primary.code,
    secondaryCodes: secondary,
    evidence,
    node: input.node,
    prerequisiteGap,
    prescription: {
      drillType: remedy.drillType,
      target: payload.prescription.target || remedy.target,
      reps: payload.prescription.reps,
      sessions: payload.prescription.sessions,
    },
    learnerMessage: payload.learner_message,
  }
}
