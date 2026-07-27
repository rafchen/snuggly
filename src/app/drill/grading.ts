/**
 * INTEGRATION SEAM — mock grader for the recognition drill.
 *
 * Track B/C own the real grader (the `recognition-drill` agent). At integration:
 *   `scoreDrill`          -> `drillScore` / `scoreDrillAttempt` in `src/lib/scoring.ts`
 *   `gradeRedundancyText` -> `gradeRedundancyOffline` in `src/lib/scoring.ts`
 * The signatures already line up; this file is deletable once the swap is made.
 *
 * Everything here is a stand-in so the UI has something honest to render, with one
 * exception
 * that is NOT a stand-in: `scoreDrill` implements the rubric table from
 * `references/rubrics.md` verbatim, including the deliberate 0.3 row, and it takes
 * `elapsedSec` as an argument so the caller has to have measured it. The caller in
 * this app is always the server.
 */

import type { DrillScore, Redundancy } from '@/lib/types'
import { DRILL_FAST_THRESHOLD_SEC, DRILL_TIME_CAP_SEC } from '@/lib/types'

/**
 * references/rubrics.md — recognition drill scoring.
 *
 * 1.0 both correct under 45s · 0.8 both correct under 90s · 0.5 mechanism only
 * 0.3 redundancy only · 0.0 both wrong or timeout.
 *
 * The 0.3 row is deliberate: naming the waste and reaching for the wrong tool is
 * closer to competence than keyword-matching the right one.
 */
export function scoreDrill(args: {
  mechanismCorrect: boolean
  redundancyCorrect: boolean
  elapsedSec: number
  timedOut: boolean
}): DrillScore {
  const { mechanismCorrect, redundancyCorrect, elapsedSec, timedOut } = args
  if (timedOut || elapsedSec > DRILL_TIME_CAP_SEC) return 0.0
  if (mechanismCorrect && redundancyCorrect) {
    return elapsedSec < DRILL_FAST_THRESHOLD_SEC ? 1.0 : 0.8
  }
  if (mechanismCorrect) return 0.5
  if (redundancyCorrect) return 0.3
  return 0.0
}

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'to',
  'is',
  'it',
  'and',
  'that',
  'over',
  'again',
  'same',
  'you',
  'are',
  'for',
  'on',
  'in',
  'be',
])

function stem(word: string): string {
  return word
    .replace(/^re-?/, '')
    .replace(/(ing|ed|es|s)$/, '')
    .replace(/[^a-z]/g, '')
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .map(stem)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/**
 * Accepted phrasings a learner is likely to use for each row of the redundancy
 * table. Stem-matching alone would reject "checking if I've seen it" for
 * `reseeking_membership`, which is a correct answer worded like a human.
 */
const ALIASES: Partial<Record<Redundancy, string[]>> = {
  reseeking_membership: ['seen', 'lookup', 'contain', 'present', 'exist', 'set', 'rescan'],
  resumming_overlapping_range: ['overlap', 'window', 'recompute', 'total', 'subarray', 'shared'],
  resumming_static_range: ['range', 'total', 'recompute', 'query'],
  relinear_search_sorted: ['sorted', 'scan', 'linear', 'order'],
  retesting_monotone_feasibility: ['feasible', 'threshold', 'candidate', 'capacity', 'monotone', 'predicate'],
  recomparing_sorted_pairs: ['pair', 'sorted', 'compare', 'order', 'reject'],
  recomputing_subproblems: ['subproblem', 'state', 'recompute', 'overlap', 'branch', 'recursion'],
  refinding_extreme_of_changing_set: ['sort', 'max', 'min', 'largest', 'smallest', 'extreme', 'resort'],
  refinding_next_greater: ['next', 'greater', 'taller', 'scan', 'suffix', 'forward'],
  retraversing_visited_regions: ['visited', 'revisit', 'rescan', 'cell', 'region'],
  remerging_overlapping_groups: ['group', 'merge', 'component', 'connect'],
  rewalking_shared_prefixes: ['prefix', 'shared', 'rewalk', 'character'],
  recomputing_range_under_updates: ['range', 'update', 'rebuild', 'recompute'],
  reexploring_dead_branches: ['branch', 'dead', 'prune', 'explore', 'invalid'],
  reevaluating_safe_local_choice: ['local', 'choice', 'safe', 'greedy'],
  retracking_order_with_lookup: ['order', 'lookup', 'window', 'expire', 'track'],
  reprocessing_dependencies: ['dependency', 'depend', 'prerequisite', 'order'],
  reexpanding_equal_cost_frontier: ['frontier', 'layer', 'level', 'rescan', 'grid', 'expand', 'hour'],
}

/**
 * MOCK. Free-text redundancy grading, keyword-stem overlap against the taxonomy id
 * plus the alias list above. The real grader is semantic; this one is generous on
 * phrasing and strict on emptiness, which is enough for the UI to exercise every
 * rubric row.
 */
export function gradeRedundancyText(text: string, target: Redundancy): boolean {
  const answer = new Set(tokens(text))
  if (answer.size === 0) return false
  const wanted = tokens(target.replace(/_/g, ' '))
  if (wanted.length === 0) return false
  const hits = wanted.filter((w) => answer.has(w)).length
  if (hits >= Math.max(2, Math.ceil(wanted.length / 2))) return true

  const aliasHits = (ALIASES[target] ?? []).map(stem).filter((w) => answer.has(w)).length
  return hits + aliasHits >= 2
}
