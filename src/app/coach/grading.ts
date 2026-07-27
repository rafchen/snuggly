/**
 * INTEGRATION SEAM — mock commit grader for the coach.
 *
 * The real judgement is the `socratic-coach` agent's. This stand-in exists so the
 * ladder advances and the commit log fills with a believable mix of correct and
 * incorrect entries. It is deliberately crude and deliberately honest about it:
 * nothing here decides anything the Commit Rule depends on. The gate does not care
 * whether a commit is correct — only that one exists.
 */

import type { Mechanism, ProblemContent, RungNumber } from '@/lib/types'
import { gradeRedundancyOffline } from '@/lib/scoring'

const COMPLEXITY = /(o\s*\(|n\^?2|n²|quadratic|exponential|factorial|linear|log\b|2\^n)/i
const FRAMING = /(input|output|return|constraint|\bn\b|size|up to|at most)/i
const TRACING = /(n\s*=\s*1|empty|identical|edge|trace|base case|duplicate)/i
const CIRCULAR = /(because it (works|is correct)|it finds the answer|it gives the right)/i

function namesMechanism(text: string, mechanism: Mechanism): boolean {
  const lower = text.toLowerCase()
  return mechanism
    .split('_')
    .filter((t) => t.length > 2)
    .every((t) => lower.includes(t))
}

/** MOCK. Returns whether the commit reads as a correct answer at that rung. */
export function gradeCommit(rung: RungNumber, text: string, problem: ProblemContent): boolean {
  const t = text.trim()
  if (t.length < 8) return false

  switch (rung) {
    case 1:
      return FRAMING.test(t) && t.length >= 30
    case 2:
      return COMPLEXITY.test(t)
    case 3:
      // The hinge. Graded against the canonical redundancy, not against vibes.
      return gradeRedundancyOffline(t, problem.redundancy)
    case 4:
      return namesMechanism(t, problem.primaryPattern)
    case 5:
      return t.length >= 30 && !CIRCULAR.test(t)
    case 6:
      return TRACING.test(t) && COMPLEXITY.test(t)
  }
}
