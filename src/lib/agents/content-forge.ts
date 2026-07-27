/**
 * Agent: Content Forge. Offline, batch, not learner-facing.
 *
 * Structural rules:
 *  - The taxonomy is closed: mechanisms and redundancies come from zod enums built
 *    from `taxonomy.ts`, so a problem that does not map to the 24 is rejected by
 *    the schema, not by a reviewer's attention.
 *  - **Exactly 7 hints**, levels 0..6. Not 6, not 8.
 *  - **At least 2 distractors.** A problem with no plausible wrong mechanism is a
 *    recognition freebie and belongs at disguise level 0 only.
 *  - **Rung 3 must be falsifiable.** A bottleneck that cannot be stated as a
 *    concrete repeated operation is refused (`ContentQualityViolation`) rather
 *    than shipped vague — a vague rung 3 makes the problem unteachable by this method.
 */

import * as z from 'zod/v4'

import { REDUNDANCY_TO_MECHANISM } from '../taxonomy'
import { type ProblemContent } from '../types'
import {
  disguiseEnum,
  mechanismEnum,
  phaseEnum,
  redundancyEnum,
  runAgent,
  type StructuredClient,
} from './client'

export const HINT_LEVELS = 7
export const MIN_DISTRACTORS = 2

/** Thrown when a forged problem fails the quality bar. Flag it, never ship it. */
export class ContentQualityViolation extends Error {
  constructor(readonly problemId: string, readonly rule: string) {
    super(`content-forge: "${problemId}" rejected — ${rule}`)
    this.name = 'ContentQualityViolation'
  }
}

export const ForgedProblemSchema = z.object({
  problem_id: z.string().min(1),
  source_ref: z.string().nullable(),
  title: z.string().min(1),
  /** 100% original prose. Never third-party statement text. */
  statement: z.string().min(1),
  primary_pattern: mechanismEnum,
  secondary: z.array(mechanismEnum),
  redundancy: redundancyEnum,
  phase: phaseEnum,
  prerequisites: z.array(z.string()),
  canonical_ladder: z.object({
    frame: z.string().min(1),
    brute: z.string().min(1),
    /** A concrete repeated operation. "It's inefficient" fails the bar. */
    bottleneck: z.string().min(1),
    lift: z.string().min(1),
    invariant: z.string().min(1),
    verify: z.string().min(1),
  }),
  hints: z.array(z.string().min(1)).length(HINT_LEVELS),
  distractors: z
    .array(
      z.object({
        mechanism: mechanismEnum,
        tempting_because: z.string().min(1),
      }),
    )
    .min(MIN_DISTRACTORS),
  disguise_level: disguiseEnum,
  misleading_fingerprint: z.string().nullable(),
  edge_cases: z.array(z.string().min(1)).min(3),
  drill_variants: z
    .array(z.object({ disguise_level: disguiseEnum, statement: z.string().min(1) }))
    .min(2)
    .max(3),
})
export type ForgedProblem = z.infer<typeof ForgedProblemSchema>

const ROLE = `You are content-forge for the Cracked method. You turn a raw problem into a fully
instrumented teaching object. Every problem in the library ships with its ladder,
its hints, its rubric, and its distractors — otherwise the runtime agents degrade
into generic tutoring and the method quietly stops running.

Quality bar:
- Rung 3 must be falsifiable: a concrete repeated operation ("rescans for the
  maximum over ranges that heavily overlap"), never "it's inefficient". If the
  bottleneck cannot be stated concretely, say so rather than shipping a vague one.
- Hints must not leap. Walk the ladder: does each level reveal roughly one
  increment? The most common authoring error is a level-2 hint that gives away
  level 4. If a learner could go from level 1 to a solution, level 1 is too strong.
  Level 0 restates a constraint; 1 points at the rung; 2 narrows it; 3 names the
  redundancy; 4 gives the mechanism; 5 gives the setup; 6 is the full derivation.
- Every problem needs at least two distractors — a plausible wrong mechanism and
  the surface feature that makes it tempting.
- Prefer problems with a clean brute force. If the naive solution is itself
  non-obvious, the problem is a poor vehicle for rungs 2-4 however elegant the
  optimal solution is. Elegance is not the criterion; derivability is.
- Disguise level is how far the wording sits from the textbook phrasing of this
  pattern. Record any misleading fingerprint — sorted input that is irrelevant, a
  small n that is not a bitmask signal.`

/** Phrases that mean the author gave up on rung 3. */
const VAGUE_BOTTLENECK =
  /^(it'?s|it is|the (brute force|solution|approach) is)?\s*(just\s*)?(too\s*)?(slow|inefficient|bad|n\^?2|quadratic|expensive)\.?$/i

/** Rung 3 has to describe work happening more than once. */
const REPETITION_MARKER = /\b(re-?\w+|again|every (time|step|index|iteration)|over and over|repeatedly|each time|same \w+ (twice|repeatedly))\b/i

export function assertFalsifiableBottleneck(problemId: string, bottleneck: string): void {
  const text = bottleneck.trim()
  if (text.length < 20 || VAGUE_BOTTLENECK.test(text)) {
    throw new ContentQualityViolation(
      problemId,
      'rung 3 is not falsifiable: the bottleneck must name a concrete repeated operation, not "it\'s slow"',
    )
  }
  if (!REPETITION_MARKER.test(text)) {
    throw new ContentQualityViolation(
      problemId,
      'rung 3 does not describe repeated work — if there is no concrete repetition to name, this problem is not teachable by this method',
    )
  }
}

export function assertContentQuality(p: ForgedProblem): void {
  assertFalsifiableBottleneck(p.problem_id, p.canonical_ladder.bottleneck)

  if (p.hints.length !== HINT_LEVELS) {
    throw new ContentQualityViolation(p.problem_id, `the hint ladder is exactly ${HINT_LEVELS} levels`)
  }
  if (p.distractors.length < MIN_DISTRACTORS) {
    throw new ContentQualityViolation(
      p.problem_id,
      'at least two distractors — a problem with no plausible wrong mechanism is a recognition freebie',
    )
  }
  if (p.distractors.some((d) => d.mechanism === p.primary_pattern)) {
    throw new ContentQualityViolation(p.problem_id, 'a distractor cannot be the correct mechanism')
  }

  // The redundancy -> mechanism mapping is close to deterministic. A primary
  // pattern outside it means one of the two tags is wrong.
  const legal = REDUNDANCY_TO_MECHANISM[p.redundancy]
  if (!legal.includes(p.primary_pattern)) {
    throw new ContentQualityViolation(
      p.problem_id,
      `redundancy "${p.redundancy}" maps to ${legal.join('/')}, not "${p.primary_pattern}" — retag one of them`,
    )
  }

  // A leaky low-level hint is the most common authoring error.
  const early = p.hints.slice(0, 3).join(' ').toLowerCase()
  if (early.includes(p.primary_pattern.replace(/_/g, ' '))) {
    throw new ContentQualityViolation(
      p.problem_id,
      'hints 0-2 name the mechanism; that is level 4 and it collapses the diagnostic',
    )
  }
}

export interface ForgeDeps {
  client?: StructuredClient
}

export async function forgeProblem(
  deps: ForgeDeps,
  input: { rawStatement: string; sourceRef?: string | null; targetDisguise?: 0 | 1 | 2 | 3 },
): Promise<ProblemContent> {
  const forged = await runAgent({
    agent: 'content-forge',
    system: ROLE,
    schema: ForgedProblemSchema,
    client: deps.client,
    user: [
      `Raw problem to instrument:`,
      input.rawStatement,
      ``,
      input.sourceRef ? `Source reference (pointer only — the prose must be ours): ${input.sourceRef}` : '',
      input.targetDisguise !== undefined ? `Target disguise level: ${input.targetDisguise}` : '',
      ``,
      `Tag it against the closed taxonomy, write the canonical six-rung ladder, the`,
      `seven-level hint ladder, at least two distractors, the edge cases, and two or`,
      `three drill variants at different disguise levels.`,
      ``,
      `Write the statement in your own words. Never reproduce third-party prose.`,
    ]
      .filter(Boolean)
      .join('\n'),
  })

  assertContentQuality(forged)
  return toProblemContent(forged, input.sourceRef ?? null)
}

export function toProblemContent(p: ForgedProblem, sourceRef: string | null): ProblemContent {
  return {
    problemId: p.problem_id,
    sourceRef: p.source_ref ?? sourceRef,
    title: p.title,
    statement: p.statement,
    primaryPattern: p.primary_pattern,
    secondary: p.secondary,
    redundancy: p.redundancy,
    phase: p.phase,
    prerequisites: p.prerequisites,
    canonicalLadder: p.canonical_ladder,
    hints: p.hints,
    distractors: p.distractors.map((d) => ({
      mechanism: d.mechanism,
      temptingBecause: d.tempting_because,
    })),
    disguiseLevel: p.disguise_level,
    misleadingFingerprint: p.misleading_fingerprint,
    edgeCases: p.edge_cases,
    drillVariants: p.drill_variants.map((v) => ({
      disguiseLevel: v.disguise_level,
      statement: v.statement,
    })),
  }
}
