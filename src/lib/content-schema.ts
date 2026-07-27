/**
 * Content schema + quality gate for the problem library (Track B).
 *
 * The Zod schema mirrors `ProblemContent` in ./types exactly — a compile-time
 * assertion below fails the build if the two ever drift.
 *
 * `validateProblem()` enforces the *quality bar* from agents/content-forge.md,
 * which is strictly stronger than the type. Shape validity is not the bar:
 * a vague rung-3 bottleneck, a level-2 hint that leaks level 4, or a problem
 * with fewer than two plausible wrong mechanisms all type-check fine and are
 * all rejected here.
 */

import { z } from 'zod'
import {
  MECHANISMS,
  REDUNDANCIES,
  REDUNDANCY_TO_MECHANISM,
  SKILL_NODE_IDS,
  type Mechanism,
} from './taxonomy'
import type { ProblemContent } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

export const mechanismSchema = z.enum(MECHANISMS)
export const redundancySchema = z.enum(REDUNDANCIES)

export const disguiseLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
])

export const phaseNumberSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])

export const canonicalLadderSchema = z.object({
  frame: z.string().min(1),
  brute: z.string().min(1),
  bottleneck: z.string().min(1),
  lift: z.string().min(1),
  invariant: z.string().min(1),
  verify: z.string().min(1),
})

export const distractorSchema = z.object({
  mechanism: mechanismSchema,
  temptingBecause: z.string().min(1),
})

export const problemContentSchema = z.object({
  problemId: z.string().min(1),
  sourceRef: z.string().nullable(),
  title: z.string().min(1),
  statement: z.string().min(1),
  primaryPattern: mechanismSchema,
  secondary: z.array(mechanismSchema),
  redundancy: redundancySchema,
  phase: phaseNumberSchema,
  prerequisites: z.array(z.string().min(1)),
  canonicalLadder: canonicalLadderSchema,
  hints: z.array(z.string().min(1)),
  distractors: z.array(distractorSchema),
  disguiseLevel: disguiseLevelSchema,
  misleadingFingerprint: z.string().nullable(),
  edgeCases: z.array(z.string().min(1)),
  drillVariants: z.array(
    z.object({
      disguiseLevel: disguiseLevelSchema,
      statement: z.string().min(1),
    })
  ),
})

/** Compile-time proof that the schema and the cross-track contract are the same shape. */
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SchemaMatchesContract = Assert<Eq<z.infer<typeof problemContentSchema>, ProblemContent>>

// ─────────────────────────────────────────────────────────────────────────────
// Quality bar
// ─────────────────────────────────────────────────────────────────────────────

export const HINT_LEVELS = 7
export const MIN_DISTRACTORS = 2
/** Levels 0–3 point at the rung and name the redundancy. Level 4 is where the tool arrives. */
export const MECHANISM_REVEAL_LEVEL = 4

/**
 * Rung 3 must be falsifiable. These are the phrasings that are not.
 * "It's slow" is a complexity observation, not a named repeated operation.
 */
const VAGUE_BOTTLENECK = [
  /\bit'?s (too )?slow\b/i,
  /\b(too|very|quite) slow\b/i,
  /\binefficien/i,
  /\bnot (fast|efficient) enough\b/i,
  /\btakes too long\b/i,
  /\bbad (time )?complexity\b/i,
  /\bwastes? time\b/i,
  /\bcould be faster\b/i,
  /\bdoes (a lot of|too much) (extra )?work\b/i,
]

/** A concrete bottleneck names a *repeated* operation. One of these markers must appear. */
const REPETITION_MARKER =
  /\b(re-?[a-z]{3,}|repeat(s|ed|edly)?|again|every|each|per\b|over and over|from scratch|all pairs|n times)\b/i

/**
 * Surface tokens that give away each mechanism. Banned in hints 0–3 (they would
 * collapse the diagnostic), required somewhere in hints 4–6 (the tool must land).
 */
const MECHANISM_TOKENS: Record<Mechanism, string[]> = {
  hashing: ['hash', 'frequency map', 'frequency counter', 'seen set'],
  two_pointers_opposite: ['two pointer', 'two-pointer', 'opposite ends'],
  two_pointers_fast_slow: ['fast pointer', 'slow pointer', 'fast/slow', 'tortoise'],
  sliding_window_fixed: ['sliding window', 'slide the window'],
  sliding_window_variable: ['sliding window', 'slide the window', 'shrink the window'],
  prefix_sums: ['prefix sum', 'prefix-sum', 'difference array', 'prefix array'],
  binary_search_array: ['binary search', 'binary-search'],
  binary_search_answer: ['binary search', 'binary-search'],
  sorting_preprocess: ['sort the', 'sorting first', 'presort'],
  heap: ['heap', 'priority queue'],
  monotonic_stack: ['stack', 'monotonic'],
  monotonic_deque: ['deque', 'monotonic'],
  linked_list: ['pointer surgery', 'relink'],
  tree_traversal: ['preorder', 'inorder', 'postorder', 'level order'],
  trie: ['trie', 'prefix tree'],
  union_find: ['union-find', 'union find', 'disjoint set', 'dsu'],
  segment_tree: ['segment tree', 'fenwick', 'binary indexed'],
  bfs: ['bfs', 'breadth-first', 'breadth first'],
  dfs: ['dfs', 'depth-first', 'depth first', 'flood fill'],
  backtracking: ['backtrack'],
  topological_sort: ['topological', 'kahn', 'indegree', 'in-degree'],
  dijkstra: ['dijkstra'],
  greedy: ['greedy', 'exchange argument'],
  dynamic_programming: ['dynamic programming', 'memoi', 'tabulat', 'dp table', 'cache the'],
}

export type IssueCode =
  | 'schema'
  | 'bottleneck_vague'
  | 'bottleneck_not_repeated'
  | 'hint_count'
  | 'hint_empty'
  | 'hint_leak'
  | 'hint_no_mechanism'
  | 'hint_level6_thin'
  | 'distractor_count'
  | 'distractor_self'
  | 'distractor_duplicate'
  | 'distractor_reason_thin'
  | 'redundancy_mismatch'
  | 'prerequisite_unknown'
  | 'prerequisite_empty'
  | 'secondary_self'
  | 'edge_cases_thin'
  | 'drill_variant_count'
  | 'drill_variant_levels'
  | 'drill_variant_length'
  | 'drill_variant_has_code'
  | 'statement_thin'
  | 'statement_no_constraint'
  | 'frame_no_magnitude'
  | 'source_ref_invalid'
  | 'problem_id_format'

export interface ValidationIssue {
  code: IssueCode
  path: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  problem: ProblemContent | null
  issues: ValidationIssue[]
}

function has(haystack: string, needles: string[]): string | null {
  const h = haystack.toLowerCase()
  return needles.find((n) => h.includes(n)) ?? null
}

/**
 * Validate one problem against the schema *and* the content-forge quality bar.
 * Returns every issue found rather than throwing on the first — authoring is a
 * batch activity and a single-issue error message makes it a slog.
 */
export function validateProblem(input: unknown): ValidationResult {
  const parsed = problemContentSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      problem: null,
      issues: parsed.error.issues.map((i) => ({
        code: 'schema' as const,
        path: i.path.join('.') || '(root)',
        message: i.message,
      })),
    }
  }

  const p = parsed.data
  const issues: ValidationIssue[] = []
  const add = (code: IssueCode, path: string, message: string) =>
    issues.push({ code, path, message })

  // ── identity ───────────────────────────────────────────────────────────────
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.problemId)) {
    add('problem_id_format', 'problemId', `"${p.problemId}" is not kebab-case`)
  }
  if (p.sourceRef !== null && !/^https?:\/\/\S+$/.test(p.sourceRef)) {
    add('source_ref_invalid', 'sourceRef', 'must be null or an http(s) URL')
  }

  // ── statement ──────────────────────────────────────────────────────────────
  if (p.statement.trim().length < 150) {
    add('statement_thin', 'statement', 'statement is too short to frame a problem (<150 chars)')
  }
  if (!/\d/.test(p.statement)) {
    add(
      'statement_no_constraint',
      'statement',
      'no numeric constraint stated — rung 1 needs n to have a magnitude'
    )
  }

  // ── rung 3: the hinge ──────────────────────────────────────────────────────
  const bn = p.canonicalLadder.bottleneck
  const vague = VAGUE_BOTTLENECK.find((r) => r.test(bn))
  if (vague) {
    add(
      'bottleneck_vague',
      'canonicalLadder.bottleneck',
      `states a verdict, not a repeated operation (matched ${vague})`
    )
  }
  if (bn.trim().length < 40 || !REPETITION_MARKER.test(bn)) {
    add(
      'bottleneck_not_repeated',
      'canonicalLadder.bottleneck',
      'must name a concrete operation that is performed repeatedly'
    )
  }
  if (!/\d/.test(p.canonicalLadder.frame)) {
    add('frame_no_magnitude', 'canonicalLadder.frame', "frame must restate n's magnitude")
  }

  // ── hints ──────────────────────────────────────────────────────────────────
  if (p.hints.length !== HINT_LEVELS) {
    add('hint_count', 'hints', `expected exactly ${HINT_LEVELS} hints (levels 0..6)`)
  } else {
    p.hints.forEach((h, i) => {
      if (h.trim().length < 25) add('hint_empty', `hints.${i}`, `level ${i} hint is too thin`)
    })

    const tokens = MECHANISM_TOKENS[p.primaryPattern]
    const early = p.hints.slice(0, MECHANISM_REVEAL_LEVEL).join('   ')
    const leak = has(early, tokens)
    if (leak) {
      add(
        'hint_leak',
        'hints',
        `levels 0-3 name the mechanism ("${leak}") — that is level ${MECHANISM_REVEAL_LEVEL}'s job`
      )
    }
    const late = p.hints.slice(MECHANISM_REVEAL_LEVEL).join('   ')
    if (!has(late, tokens)) {
      add(
        'hint_no_mechanism',
        'hints',
        `levels ${MECHANISM_REVEAL_LEVEL}-6 never name the mechanism (${tokens[0]}…)`
      )
    }
    if (p.hints[HINT_LEVELS - 1].trim().length < 200) {
      add('hint_level6_thin', 'hints.6', 'level 6 is the full derivation, not another nudge')
    }
  }

  // ── distractors ────────────────────────────────────────────────────────────
  if (p.distractors.length < MIN_DISTRACTORS) {
    add('distractor_count', 'distractors', `need at least ${MIN_DISTRACTORS}`)
  }
  const seenMech = new Set<string>()
  p.distractors.forEach((d, i) => {
    if (d.mechanism === p.primaryPattern) {
      add('distractor_self', `distractors.${i}`, 'distractor repeats the primary pattern')
    }
    if (seenMech.has(d.mechanism)) {
      add('distractor_duplicate', `distractors.${i}`, `duplicate distractor "${d.mechanism}"`)
    }
    seenMech.add(d.mechanism)
    if (d.temptingBecause.trim().length < 25) {
      add(
        'distractor_reason_thin',
        `distractors.${i}.temptingBecause`,
        'must name the surface feature that makes this plausible'
      )
    }
  })

  // ── taxonomy coherence ─────────────────────────────────────────────────────
  const allowed = REDUNDANCY_TO_MECHANISM[p.redundancy]
  if (!allowed.includes(p.primaryPattern)) {
    add(
      'redundancy_mismatch',
      'redundancy',
      `"${p.redundancy}" maps to [${allowed.join(', ')}], not "${p.primaryPattern}"`
    )
  }
  if (p.secondary.includes(p.primaryPattern)) {
    add('secondary_self', 'secondary', 'secondary repeats the primary pattern')
  }
  if (p.prerequisites.length === 0) {
    add('prerequisite_empty', 'prerequisites', 'every problem sits on at least one skill node')
  }
  p.prerequisites.forEach((id, i) => {
    if (!SKILL_NODE_IDS.includes(id)) {
      add('prerequisite_unknown', `prerequisites.${i}`, `"${id}" is not a node in SKILL_DAG`)
    }
  })

  // ── edge cases ─────────────────────────────────────────────────────────────
  if (p.edgeCases.length < 3) {
    add('edge_cases_thin', 'edgeCases', 'need at least 3 (empty, single, all-identical, max n, …)')
  }

  // ── drill variants ─────────────────────────────────────────────────────────
  if (p.drillVariants.length < 2 || p.drillVariants.length > 3) {
    add('drill_variant_count', 'drillVariants', 'need 2-3 variants at different disguise levels')
  }
  const levels = new Set(p.drillVariants.map((v) => v.disguiseLevel))
  if (levels.size !== p.drillVariants.length) {
    add('drill_variant_levels', 'drillVariants', 'variants must sit at distinct disguise levels')
  }
  p.drillVariants.forEach((v, i) => {
    const len = v.statement.trim().length
    if (len < 150 || len > 1200) {
      add(
        'drill_variant_length',
        `drillVariants.${i}.statement`,
        'a 90-second drill item is one paragraph (150-1200 chars)'
      )
    }
    if (/```|\bdef \b|\breturn \w+\(|\bfor \(|=>/.test(v.statement)) {
      add('drill_variant_has_code', `drillVariants.${i}.statement`, 'drill variants are no-code')
    }
  })

  return { ok: issues.length === 0, problem: issues.length === 0 ? p : null, issues }
}

// ─────────────────────────────────────────────────────────────────────────────
// Library-level bar
// ─────────────────────────────────────────────────────────────────────────────

export interface LibraryReport {
  ok: boolean
  count: number
  byMechanism: Record<string, number>
  byDisguise: Record<string, number>
  byPhase: Record<string, number>
  byRedundancy: Record<string, number>
  misleadingFingerprints: number
  issues: string[]
}

/**
 * Corpus-level checks. A library where every problem sits at disguise level 1
 * trains keyword matching just as effectively as no disguise at all.
 */
export function validateLibrary(problems: ProblemContent[]): LibraryReport {
  const tally = (xs: string[]) =>
    xs.reduce<Record<string, number>>((acc, x) => ((acc[x] = (acc[x] ?? 0) + 1), acc), {})

  const byMechanism = tally(problems.map((p) => p.primaryPattern))
  const byDisguise = tally(problems.map((p) => String(p.disguiseLevel)))
  const byPhase = tally(problems.map((p) => String(p.phase)))
  const byRedundancy = tally(problems.map((p) => p.redundancy))
  const misleadingFingerprints = problems.filter((p) => p.misleadingFingerprint !== null).length

  const issues: string[] = []
  const ids = new Set<string>()
  for (const p of problems) {
    if (ids.has(p.problemId)) issues.push(`duplicate problemId "${p.problemId}"`)
    ids.add(p.problemId)
  }
  if (Object.keys(byMechanism).length < 8) {
    issues.push(`only ${Object.keys(byMechanism).length} distinct primary mechanisms (need >= 8)`)
  }
  for (const lvl of ['0', '1', '2', '3']) {
    if (!byDisguise[lvl]) issues.push(`no problems at disguise level ${lvl}`)
  }
  const maxShare = Math.max(...Object.values(byDisguise)) / Math.max(problems.length, 1)
  if (problems.length > 0 && maxShare > 0.6) {
    issues.push(`disguise levels are lopsided (one level holds ${Math.round(maxShare * 100)}%)`)
  }
  if (problems.length > 0) {
    const share = misleadingFingerprints / problems.length
    if (share < 0.1) issues.push('misleading fingerprints are set on too few problems (<10%)')
    if (share > 0.6) issues.push('misleading fingerprints are set on too many problems (>60%)')
  }

  return {
    ok: issues.length === 0,
    count: problems.length,
    byMechanism,
    byDisguise,
    byPhase,
    byRedundancy,
    misleadingFingerprints,
    issues,
  }
}
