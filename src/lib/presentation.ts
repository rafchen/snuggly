/**
 * Presentation helpers for the problem panel.
 *
 * Difficulty is derived from the skill DAG phase rather than stored, so it can
 * never drift from the curriculum: Phase 1 material is Easy, Phases 2-3 Medium,
 * Phase 4+ Hard. Constraints come from the forged edge cases, which is where the
 * bounds already live.
 */
import type { PhaseNumber, ProblemContent } from './types'

export type Difficulty = 'easy' | 'medium' | 'hard'

export function difficultyFor(phase: PhaseNumber): Difficulty {
  if (phase <= 1) return 'easy'
  if (phase <= 3) return 'medium'
  return 'hard'
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}

/** Edge cases, rendered the way a constraints block reads on a problem page. */
export function constraintsFor(problem: Pick<ProblemContent, 'edgeCases'>): string[] {
  return problem.edgeCases.map((c) => (/^[a-z]/.test(c) ? c : c))
}
