/**
 * Agent: Code Critic.
 *
 * Structural rules:
 *  - **The idea question is answered before any line is read.** `judgeIdea` is a
 *    separate call whose prompt does not contain the code at all — it cannot be
 *    influenced by the implementation, and a wrong idea returns immediately with
 *    a handoff to socratic-coach at rung 4. Debugging a wrong idea is the most
 *    demoralizing activity in this domain, so there is no code path into it.
 *  - Bug feedback is graduated: `releaseBugFeedback` refuses to skip a level,
 *    same principle as the hint ladder.
 *  - Every bug names a CLASS. A bug without one is refused.
 */

import * as z from 'zod/v4'

import {
  type CodeCritiqueResult,
  type DataStore,
  type F5Subclass,
  type ProblemContent,
} from '../types'
import { runAgent, type StructuredClient } from './client'

/** Thrown when a bug report would ship without a category. */
export class BugClassRequired extends Error {
  constructor(readonly line: number) {
    super(
      `code-critic: the bug at line ${line} has no class. "Line 12 should be n-1" is a fact they use once; "off-by-one on a loop bound" is a category they meet a hundred times.`,
    )
    this.name = 'BugClassRequired'
  }
}

/** Thrown when bug feedback would jump levels. */
export class BugFeedbackViolation extends Error {
  constructor(readonly requested: number, readonly expected: number) {
    super(
      `code-critic: bug feedback releases one level at a time — level ${expected} is next, not ${requested}. Handing over the fix costs the information about whether they could have found it.`,
    )
    this.name = 'BugFeedbackViolation'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas — mirror agents/code-critic.md
// ─────────────────────────────────────────────────────────────────────────────

/** Phase one. Note there is no field here that could describe the code. */
export const IdeaVerdictSchema = z.object({
  idea_correct: z.boolean(),
  complexity_intended: z.string(),
  /** Said out loud, verbatim, to the learner. */
  verdict: z.string(),
  /** When the idea is wrong: which rung to return to (always 4 in practice). */
  return_to_rung: z.union([z.literal(3), z.literal(4), z.literal(5)]).nullable(),
})
export type IdeaVerdict = z.infer<typeof IdeaVerdictSchema>

const f5Subclass = z.enum([
  'off_by_one',
  'wrong_api',
  'mutation_during_iteration',
  'uninitialized_edge_case',
  'recursion_depth',
])

export const CodeCritiqueSchema = z.object({
  idea_correct: z.boolean(),
  passes: z.boolean(),
  complexity_actual: z.string(),
  complexity_intended: z.string(),
  bugs: z.array(
    z.object({
      line: z.number().int().min(0),
      /** The category, not the instance. Categories transfer. */
      class: z.string().min(1),
      hint_level_used: z.number().int().min(1).max(4),
    }),
  ),
  idiom_notes: z.array(z.string()),
  legibility_score: z.number().min(0).max(1),
  independence: z.boolean(),
  lookups: z.array(z.string()),
  f5_subclass: f5Subclass.nullable(),
})
export type CodeCritiquePayload = z.infer<typeof CodeCritiqueSchema>

const IDEA_ROLE = `You are the code-critic of the Cracked method, answering your first question:
IS THE IDEA RIGHT?

You are deliberately not being shown the code. You are shown the problem and the
approach the learner derived. Judge the approach alone. If it cannot produce a
correct answer within the problem's constraints, the idea is wrong and this stops
here — the learner goes back to socratic-coach at rung 4, not into a debugger.

Say which one it is out loud: "Your approach is correct — this is a syntax
problem" or "This is a bug in the plan, not the code. Back up."`

const REVIEW_ROLE = `You are the code-critic of the Cracked method. The approach has already been
confirmed correct, so everything you find now is an implementation problem.

Review for: correctness (edges, off-by-one, empty/single element, integer bounds),
complexity (does it actually hit the intended bound — any hidden O(n) inside a
loop?), idiom (natural constructs, no hand-rolled built-ins), legibility (would a
reader follow this without the author narrating?), and independence (did they look
up syntax while writing?).

Name the bug CLASS, not just the bug. "Off-by-one on a loop bound" is a category
they'll meet a hundred more times; "line 12 should be n-1" is a fact they use once.

Score independence honestly. A learner who looked up the heapq.heappush signature
has an implementation gap however clean the result, and it will surface under
interview conditions.

Flag clever one-liners and single-letter names even when correct. Code a reader
can't follow live is a real cost in an interview and an unambiguous cost on a team.`

// ─────────────────────────────────────────────────────────────────────────────
// Runtime
// ─────────────────────────────────────────────────────────────────────────────

export interface CriticDeps {
  store: DataStore
  client?: StructuredClient
}

export interface CritiqueInput {
  problemId: string
  /** The learner's stated approach — rungs 3-5, in their words. No code. */
  approach: string
  code: string
  language?: string
  /** Reported by the learner or the editor harness. */
  lookups?: string[]
  testResults?: string | null
}

/**
 * Phase one, in isolation. The code is not passed to this call — that is the
 * whole point, and it is why the separation is structural rather than a promise.
 */
export async function judgeIdea(
  deps: CriticDeps,
  input: { problem: ProblemContent; approach: string },
): Promise<IdeaVerdict> {
  return runAgent({
    agent: 'code-critic',
    system: IDEA_ROLE,
    schema: IdeaVerdictSchema,
    client: deps.client,
    user: [
      `Problem: ${input.problem.title}`,
      `Statement: ${input.problem.statement}`,
      `Constraints / edge cases: ${input.problem.edgeCases.join(', ')}`,
      `Canonical lift: ${input.problem.canonicalLadder.lift}`,
      `Canonical invariant: ${input.problem.canonicalLadder.invariant}`,
      ``,
      `The learner's stated approach:`,
      input.approach,
      ``,
      `Is this approach correct for the problem as posed, within its constraints?`,
      `You have not been shown their code and must not ask for it.`,
    ].join('\n'),
  })
}

export interface CritiqueOutcome {
  result: CodeCritiqueResult
  /** Populated only when the idea was wrong. */
  handoff: { agent: 'socratic-coach'; rung: 3 | 4 | 5; reason: string } | null
  message: string
}

export async function critique(deps: CriticDeps, input: CritiqueInput): Promise<CritiqueOutcome> {
  const problem = await deps.store.getProblem(input.problemId)
  if (!problem) throw new Error(`code-critic: unknown problem "${input.problemId}"`)

  // ── Phase one: the idea, with the code unseen ────────────────────────────
  const verdict = await judgeIdea(deps, { problem, approach: input.approach })

  if (!verdict.idea_correct) {
    // No line review. The failure happened three rungs earlier.
    const result: CodeCritiqueResult = {
      ideaCorrect: false,
      passes: false,
      complexityActual: 'not evaluated — the idea is wrong',
      complexityIntended: verdict.complexity_intended,
      bugs: [],
      idiomNotes: [],
      legibilityScore: 0,
      independence: (input.lookups ?? []).length === 0,
      lookups: input.lookups ?? [],
      f5Subclass: null,
    }
    return {
      result,
      handoff: {
        agent: 'socratic-coach',
        rung: verdict.return_to_rung ?? 4,
        reason: 'This is a bug in the plan, not the code. Back up.',
      },
      message: verdict.verdict,
    }
  }

  // ── Phase two: now, and only now, the lines ──────────────────────────────
  const payload = await runAgent({
    agent: 'code-critic',
    system: REVIEW_ROLE,
    schema: CodeCritiqueSchema,
    client: deps.client,
    user: [
      `Problem: ${problem.title}`,
      `Statement: ${problem.statement}`,
      `Intended complexity: ${verdict.complexity_intended}`,
      `Edge cases that must hold: ${problem.edgeCases.join(', ')}`,
      ``,
      `Approach (already confirmed correct):`,
      input.approach,
      ``,
      `Code (${input.language ?? 'python'}):`,
      '```',
      input.code,
      '```',
      input.testResults ? `\nTest results:\n${input.testResults}` : '',
      input.lookups?.length ? `\nLookups the learner made while writing: ${input.lookups.join(', ')}` : '\nNo lookups reported.',
      ``,
      `Set idea_correct true — it has already been established. Line numbers are`,
      `1-based against the code above. Every bug needs a class.`,
    ]
      .filter(Boolean)
      .join('\n'),
  })

  for (const bug of payload.bugs) {
    if (!bug.class.trim()) throw new BugClassRequired(bug.line)
  }

  const lookups = input.lookups ?? payload.lookups
  const result: CodeCritiqueResult = {
    ideaCorrect: true,
    passes: payload.passes,
    complexityActual: payload.complexity_actual,
    complexityIntended: payload.complexity_intended,
    bugs: payload.bugs.map((b) => ({ line: b.line, class: b.class, hintLevelUsed: b.hint_level_used })),
    idiomNotes: payload.idiom_notes,
    legibilityScore: payload.legibility_score,
    independence: lookups.length === 0,
    lookups,
    f5Subclass: (payload.f5_subclass ?? null) as F5Subclass | null,
  }

  return { result, handoff: null, message: verdict.verdict }
}

// ─────────────────────────────────────────────────────────────────────────────
// Graduated bug feedback — same principle as the hint ladder
// ─────────────────────────────────────────────────────────────────────────────

export type BugFeedbackLevel = 1 | 2 | 3 | 4

export const BUG_FEEDBACK_SHAPE: Record<BugFeedbackLevel, string> = {
  1: 'localize to a range of lines',
  2: 'name the construct and give a case to trace',
  3: 'name the bug class and where it bites',
  4: 'the fix',
}

/**
 * Release the next level of feedback on one bug. Refuses to skip — handing over
 * the fix costs the information about whether they could have found it.
 */
export function releaseBugFeedback(
  bug: { line: number; class: string },
  alreadyReleased: number,
  requested?: BugFeedbackLevel,
): { level: BugFeedbackLevel; text: string } {
  const expected = (alreadyReleased + 1) as BugFeedbackLevel
  if (requested !== undefined && requested !== expected) {
    throw new BugFeedbackViolation(requested, expected)
  }
  if (expected > 4) throw new BugFeedbackViolation(expected, 4)
  if (!bug.class.trim()) throw new BugClassRequired(bug.line)

  const lo = Math.max(1, bug.line - 3)
  const hi = bug.line + 3
  const text: Record<BugFeedbackLevel, string> = {
    1: `Something's wrong between lines ${lo} and ${hi}.`,
    2: `Look at line ${bug.line}. Trace it with n=1.`,
    3: `${humanize(bug.class)} — that's the class. It's at line ${bug.line}.`,
    4: `Line ${bug.line}: ${humanize(bug.class)}. Fix it there, then re-run your edge cases.`,
  }
  return { level: expected, text: text[expected] }
}

function humanize(bugClass: string): string {
  return bugClass.replace(/_/g, ' ')
}
