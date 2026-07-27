/**
 * The closed taxonomy. Per references/patterns.md: 24 mechanisms, 18 redundancies.
 * The finiteness is pedagogically load-bearing — content-forge rejects any problem
 * that does not map to this list, so these arrays are the authority, not a hint.
 */

export const MECHANISMS = [
  // Group A — Linear scanning
  'hashing',
  'two_pointers_opposite',
  'two_pointers_fast_slow',
  'sliding_window_fixed',
  'sliding_window_variable',
  'prefix_sums',
  // Group B — Ordered access
  'binary_search_array',
  'binary_search_answer',
  'sorting_preprocess',
  'heap',
  'monotonic_stack',
  'monotonic_deque',
  // Group C — Structures
  'linked_list',
  'tree_traversal',
  'trie',
  'union_find',
  'segment_tree',
  // Group D — Search
  'bfs',
  'dfs',
  'backtracking',
  'topological_sort',
  'dijkstra',
  // Group E — Optimization
  'greedy',
  'dynamic_programming',
] as const

export type Mechanism = (typeof MECHANISMS)[number]

/** The 18 rows of the Redundancy Table — rung 3 → 4 of the Ladder. */
export const REDUNDANCIES = [
  'reseeking_membership',
  'resumming_overlapping_range',
  'resumming_static_range',
  'relinear_search_sorted',
  'retesting_monotone_feasibility',
  'recomparing_sorted_pairs',
  'recomputing_subproblems',
  'refinding_extreme_of_changing_set',
  'refinding_next_greater',
  'retraversing_visited_regions',
  'remerging_overlapping_groups',
  'rewalking_shared_prefixes',
  'recomputing_range_under_updates',
  'reexploring_dead_branches',
  'reevaluating_safe_local_choice',
  'retracking_order_with_lookup',
  'reprocessing_dependencies',
  'reexpanding_equal_cost_frontier',
] as const

export type Redundancy = (typeof REDUNDANCIES)[number]

/** The canonical redundancy → mechanism mapping. Drives rung 4 and F4 grading. */
export const REDUNDANCY_TO_MECHANISM: Record<Redundancy, Mechanism[]> = {
  reseeking_membership: ['hashing'],
  resumming_overlapping_range: ['sliding_window_fixed', 'sliding_window_variable'],
  resumming_static_range: ['prefix_sums'],
  relinear_search_sorted: ['binary_search_array'],
  retesting_monotone_feasibility: ['binary_search_answer'],
  recomparing_sorted_pairs: ['two_pointers_opposite'],
  recomputing_subproblems: ['dynamic_programming'],
  refinding_extreme_of_changing_set: ['heap'],
  refinding_next_greater: ['monotonic_stack'],
  retraversing_visited_regions: ['bfs', 'dfs'],
  remerging_overlapping_groups: ['union_find'],
  rewalking_shared_prefixes: ['trie'],
  recomputing_range_under_updates: ['segment_tree'],
  reexploring_dead_branches: ['backtracking'],
  reevaluating_safe_local_choice: ['greedy'],
  retracking_order_with_lookup: ['monotonic_deque'],
  reprocessing_dependencies: ['topological_sort'],
  reexpanding_equal_cost_frontier: ['bfs', 'dijkstra'],
}

/**
 * Confusable pairs from patterns.md §5 — where F4 errors cluster.
 * recognition-drill weights toward these; failure-analyst names the pair.
 */
export const CONFUSABLE_PAIRS: ReadonlyArray<readonly [Mechanism, Mechanism]> = [
  ['sliding_window_variable', 'two_pointers_opposite'],
  ['heap', 'sorting_preprocess'],
  ['binary_search_array', 'binary_search_answer'],
  ['dynamic_programming', 'greedy'],
  ['bfs', 'dfs'],
  ['dfs', 'backtracking'],
  ['union_find', 'dfs'],
]

export type PhaseNumber = 0 | 1 | 2 | 3 | 4 | 5

/** A node in the skill DAG. `prereqs` gate unlocking. */
export interface SkillNodeDef {
  id: string
  phase: PhaseNumber
  prereqs: string[]
  mechanism: Mechanism | null // Phase 0 fluency nodes carry no mechanism
}

/** The skill DAG from references/curriculum.md. A node unlocks when every prereq is unlocked. */
export const SKILL_DAG: SkillNodeDef[] = [
  // Phase 0 — Fluency (the alphabet, not algorithms)
  { id: 'collections', phase: 0, prereqs: [], mechanism: null },
  { id: 'sorting_with_keys', phase: 0, prereqs: [], mechanism: null },
  { id: 'heapq', phase: 0, prereqs: [], mechanism: null },
  { id: 'string_ops', phase: 0, prereqs: [], mechanism: null },
  { id: 'defaultdict', phase: 0, prereqs: ['collections'], mechanism: null },
  { id: 'tuple_unpacking', phase: 0, prereqs: [], mechanism: null },

  // Phase 1 — Primitives
  { id: 'arrays_basics', phase: 1, prereqs: ['collections'], mechanism: null },
  { id: 'hashing', phase: 1, prereqs: ['defaultdict'], mechanism: 'hashing' },
  { id: 'two_pointers_opposite', phase: 1, prereqs: ['arrays_basics'], mechanism: 'two_pointers_opposite' },
  { id: 'two_pointers_fast_slow', phase: 1, prereqs: ['arrays_basics'], mechanism: 'two_pointers_fast_slow' },
  { id: 'sliding_window_fixed', phase: 1, prereqs: ['arrays_basics'], mechanism: 'sliding_window_fixed' },
  { id: 'sliding_window_variable', phase: 1, prereqs: ['sliding_window_fixed', 'hashing'], mechanism: 'sliding_window_variable' },
  { id: 'prefix_sums', phase: 1, prereqs: ['arrays_basics'], mechanism: 'prefix_sums' },
  { id: 'difference_arrays', phase: 1, prereqs: ['prefix_sums'], mechanism: 'prefix_sums' },
  { id: 'binary_search_array', phase: 1, prereqs: ['arrays_basics'], mechanism: 'binary_search_array' },
  { id: 'binary_search_answer', phase: 1, prereqs: ['binary_search_array'], mechanism: 'binary_search_answer' },
  { id: 'sorting_preprocess', phase: 1, prereqs: ['sorting_with_keys'], mechanism: 'sorting_preprocess' },
  { id: 'stack_basics', phase: 1, prereqs: ['arrays_basics'], mechanism: null },

  // Phase 2 — Structures
  { id: 'monotonic_stack', phase: 2, prereqs: ['stack_basics'], mechanism: 'monotonic_stack' },
  { id: 'monotonic_deque', phase: 2, prereqs: ['monotonic_stack', 'sliding_window_fixed'], mechanism: 'monotonic_deque' },
  { id: 'heap_topk', phase: 2, prereqs: ['heapq'], mechanism: 'heap' },
  { id: 'two_heaps', phase: 2, prereqs: ['heap_topk'], mechanism: 'heap' },
  { id: 'linked_list', phase: 2, prereqs: ['arrays_basics'], mechanism: 'linked_list' },
  { id: 'list_reversal', phase: 2, prereqs: ['linked_list'], mechanism: 'linked_list' },
  { id: 'cycle_detection', phase: 2, prereqs: ['linked_list', 'two_pointers_fast_slow'], mechanism: 'two_pointers_fast_slow' },
  { id: 'tree_basics', phase: 2, prereqs: ['arrays_basics'], mechanism: 'tree_traversal' },
  { id: 'dfs_traversal', phase: 2, prereqs: ['tree_basics'], mechanism: 'dfs' },
  { id: 'bfs_levels', phase: 2, prereqs: ['tree_basics'], mechanism: 'bfs' },
  { id: 'trie', phase: 2, prereqs: ['hashing'], mechanism: 'trie' },
  { id: 'union_find', phase: 2, prereqs: ['arrays_basics'], mechanism: 'union_find' },
  { id: 'segment_tree', phase: 2, prereqs: ['tree_basics', 'prefix_sums'], mechanism: 'segment_tree' },

  // Phase 3 — Search
  { id: 'flood_fill', phase: 3, prereqs: ['dfs_traversal'], mechanism: 'dfs' },
  { id: 'backtracking', phase: 3, prereqs: ['dfs_traversal'], mechanism: 'backtracking' },
  { id: 'pruning', phase: 3, prereqs: ['backtracking'], mechanism: 'backtracking' },
  { id: 'cycle_detection_graph', phase: 3, prereqs: ['dfs_traversal'], mechanism: 'dfs' },
  { id: 'shortest_path_unweighted', phase: 3, prereqs: ['bfs_levels'], mechanism: 'bfs' },
  { id: 'multi_source_bfs', phase: 3, prereqs: ['bfs_levels'], mechanism: 'bfs' },
  { id: 'topological_sort', phase: 3, prereqs: ['union_find', 'dfs_traversal'], mechanism: 'topological_sort' },
  { id: 'dijkstra', phase: 3, prereqs: ['topological_sort', 'heap_topk'], mechanism: 'dijkstra' },
  { id: 'greedy_exchange', phase: 3, prereqs: ['sorting_preprocess'], mechanism: 'greedy' },

  // Phase 4 — Dynamic programming (reached via backtracking + memoization, never via recurrences)
  { id: 'memoization', phase: 4, prereqs: ['backtracking'], mechanism: 'dynamic_programming' },
  { id: 'dp_1d', phase: 4, prereqs: ['memoization'], mechanism: 'dynamic_programming' },
  { id: 'dp_lis', phase: 4, prereqs: ['dp_1d'], mechanism: 'dynamic_programming' },
  { id: 'dp_2d_grid', phase: 4, prereqs: ['memoization'], mechanism: 'dynamic_programming' },
  { id: 'dp_edit_distance', phase: 4, prereqs: ['dp_2d_grid'], mechanism: 'dynamic_programming' },
  { id: 'dp_knapsack', phase: 4, prereqs: ['memoization'], mechanism: 'dynamic_programming' },
  { id: 'dp_subset_sum', phase: 4, prereqs: ['dp_knapsack'], mechanism: 'dynamic_programming' },
  { id: 'dp_interval', phase: 4, prereqs: ['memoization'], mechanism: 'dynamic_programming' },
  { id: 'dp_tree', phase: 4, prereqs: ['memoization', 'dfs_traversal'], mechanism: 'dynamic_programming' },
  { id: 'dp_bitmask', phase: 4, prereqs: ['memoization'], mechanism: 'dynamic_programming' },

  // Phase 5 — Synthesis
  { id: 'mixed_unlabeled', phase: 5, prereqs: ['dp_1d', 'dijkstra', 'monotonic_stack'], mechanism: null },
  { id: 'multi_pattern', phase: 5, prereqs: ['mixed_unlabeled'], mechanism: null },
  { id: 'interview_sim', phase: 5, prereqs: ['multi_pattern'], mechanism: null },
]

export const SKILL_NODE_IDS = SKILL_DAG.map((n) => n.id)

export function skillNode(id: string): SkillNodeDef | undefined {
  return SKILL_DAG.find((n) => n.id === id)
}
