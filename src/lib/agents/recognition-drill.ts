/**
 * Agent: Recognition Drill.
 *
 * Structural rules:
 *  - Both answer fields are required. A submission missing a field is refused
 *    (`IncompleteDrillAnswer`); a *blank* field is a miss on that half, which is
 *    a different thing and is scored, not refused.
 *  - The 90-second cap is applied before grading — a timed-out item scores 0.0
 *    and never reaches the model.
 *  - Scoring is `scoring.drillScore`, the rubric table verbatim. The model is
 *    only ever asked whether the free-text redundancy is right; it never picks
 *    the score.
 *  - Feedback is truncated to one line. A three-minute explanation turns a
 *    5-minute drill into a lecture and drops the rep count from 10 to 2.
 */

import * as z from 'zod/v4'

import { REDUNDANCY_TO_MECHANISM, type Mechanism } from '../taxonomy'
import { buildDrillSet, type BuildDrillSetOptions } from '../interleave'
import { isConfusablePair, scoreDrillAttempt, summarizeDrillSession } from '../scoring'
import {
  DRILL_TIME_CAP_SEC,
  type DataStore,
  type DrillAnswer,
  type DrillAttempt,
  type DrillItem,
  type DrillSessionResult,
  type MasteryDelta,
} from '../types'
import { runAgent, type StructuredClient } from './client'

/** Thrown when a submission omits a field rather than leaving it blank. */
export class IncompleteDrillAnswer extends Error {
  constructor(readonly field: 'mechanism' | 'redundancy') {
    super(
      `recognition-drill: both fields are required — "${field}" was not submitted. Mechanism alone is keyword matching.`,
    )
    this.name = 'IncompleteDrillAnswer'
  }
}

const FEEDBACK_MAX = 220

export const DrillGradeSchema = z.object({
  /** Does the free text name the canonical waste, in any wording? */
  redundancy_correct: z.boolean(),
  /** One line. On a miss, the discriminator — never the answer. */
  feedback: z.string(),
})
export type DrillGrade = z.infer<typeof DrillGradeSchema>

const ROLE = `You are the recognition-drill grader of the Cracked method. Rapid-fire pattern
identification, no coding, 90 seconds an item.

You grade one thing: whether the learner's free-text answer names the same wasted
work as the canonical redundancy. Wording does not matter; the identified waste
does. "It keeps re-adding the same numbers as the window slides" is the same
answer as resumming_overlapping_range. "It's slow" is not.

Feedback is ONE line, delivered immediately. On a miss, name the discriminator,
not the answer: "Two pointers, not sliding window — the window here doesn't need
to stay contiguous, that's the discriminator." Never explain at length; long
explanations are banked for the post-mortem.`

export interface DrillDeps {
  store: DataStore
  client?: StructuredClient
}

/** Interleaved warm-up set: due reviews, confusable pairs, planted fingerprints. */
export async function startDrillSession(
  deps: DrillDeps,
  learnerId: string,
  opts: BuildDrillSetOptions = {},
): Promise<DrillItem[]> {
  return buildDrillSet(deps.store, learnerId, opts)
}

export function assertAnswerComplete(answer: DrillAnswer): void {
  if (!('mechanism' in answer) || answer.mechanism === undefined) {
    throw new IncompleteDrillAnswer('mechanism')
  }
  if (typeof answer.redundancy !== 'string') throw new IncompleteDrillAnswer('redundancy')
}

/**
 * Grade one item. Records the attempt on the store so the drill log survives the
 * session even if the learner walks away mid-set.
 */
export async function submitDrillAnswer(
  deps: DrillDeps,
  learnerId: string,
  item: DrillItem,
  answer: DrillAnswer,
  elapsedSec: number,
): Promise<{ attempt: DrillAttempt; feedback: string }> {
  assertAnswerComplete(answer)

  // The cap is structural: past 90s the item is a miss and we do not spend a
  // model call grading prose the learner no longer gets credit for.
  if (elapsedSec > DRILL_TIME_CAP_SEC) {
    const attempt = scoreDrillAttempt({ item, answer, elapsedSec, redundancyCorrect: false })
    await deps.store.recordDrillAttempt(learnerId, attempt)
    return { attempt, feedback: `Time. ${DRILL_TIME_CAP_SEC}s is the cap — next.` }
  }

  const mechanismCorrect = answer.mechanism === item.targetMechanism
  const grade = await runAgent({
    agent: 'recognition-drill',
    system: ROLE,
    schema: DrillGradeSchema,
    client: deps.client,
    user: [
      `Statement (disguise level ${item.disguiseLevel}):`,
      item.statement,
      ``,
      `Canonical mechanism: ${item.targetMechanism}`,
      `Canonical redundancy: ${item.targetRedundancy}`,
      `Mechanisms that legitimately kill that redundancy: ${REDUNDANCY_TO_MECHANISM[
        item.targetRedundancy
      ].join(', ')}`,
      item.hasMisleadingFingerprint
        ? `NOTE: this item carries a deliberately misleading surface signal.`
        : ``,
      ``,
      `Learner answered mechanism: ${answer.mechanism ?? '(blank)'} — ${
        mechanismCorrect ? 'correct' : 'wrong'
      }`,
      `Learner answered redundancy: "${answer.redundancy}"`,
      ``,
      `Set redundancy_correct only if that free text names the canonical waste.`,
      `Vague ("it's slow", "too many loops") is false.`,
      mechanismCorrect
        ? `Feedback: one line of confirmation, no praise inflation.`
        : `Feedback: one line naming the discriminator between what they said and the answer.`,
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const attempt = scoreDrillAttempt({
    item,
    answer,
    elapsedSec,
    redundancyCorrect: grade.redundancy_correct,
  })
  await deps.store.recordDrillAttempt(learnerId, attempt)
  return { attempt, feedback: oneLine(grade.feedback) }
}

/**
 * Roll up the set. Emits mastery deltas for the planner — this agent observes,
 * it never writes mastery.
 */
export async function finishDrillSession(
  deps: DrillDeps,
  learnerId: string,
  items: DrillItem[],
  attempts: DrillAttempt[],
): Promise<DrillSessionResult> {
  const result = summarizeDrillSession(items, attempts)

  const byNode = new Map<string, number[]>()
  const byId = new Map(items.map((i) => [i.problemId, i]))
  for (const a of attempts) {
    const node = byId.get(a.problemId)?.targetMechanism
    if (!node) continue
    byNode.set(node, [...(byNode.get(node) ?? []), a.score])
  }
  const now = new Date()
  for (const [node, scores] of byNode) {
    const delta: MasteryDelta = {
      node,
      dimension: 'recognition',
      observed: scores.reduce((a, b) => a + b, 0) / scores.length,
      source: 'recognition-drill',
      observedAt: now,
      appliedAt: null,
    }
    await deps.store.enqueueDelta(learnerId, delta)
  }

  return result
}

/**
 * Confusions worth escalating: a miss inside a known confusable pair is an F4
 * signal and should extend the next warm-up from 5 minutes to 15.
 */
export function confusablePairMisses(
  result: DrillSessionResult,
): Array<[Mechanism, Mechanism]> {
  return result.confusions.filter(([target, given]) => isConfusablePair(target, given))
}

function oneLine(text: string): string {
  const flat = text.replace(/\s*\n+\s*/g, ' ').trim()
  return flat.length <= FEEDBACK_MAX ? flat : `${flat.slice(0, FEEDBACK_MAX - 1)}…`
}
