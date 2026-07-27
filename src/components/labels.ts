/**
 * Display strings for the closed taxonomy.
 *
 * The identifiers in `src/lib/taxonomy.ts` are the authority; this module only
 * decides how they read on screen. Every key comes from the imported unions, so a
 * taxonomy change is a type error here rather than a silent gap in a picker.
 */

import type { Mechanism, Redundancy } from '@/lib/types'
import type { BlockKind, FailureCode, SkillDimension } from '@/lib/types'

export const MECHANISM_LABEL: Record<Mechanism, string> = {
  hashing: 'Hashing',
  // No commas in these labels — they are interpolated mid-sentence in drill feedback.
  two_pointers_opposite: 'Two pointers from the ends',
  two_pointers_fast_slow: 'Fast and slow pointers',
  sliding_window_fixed: 'Fixed sliding window',
  sliding_window_variable: 'Variable sliding window',
  prefix_sums: 'Prefix sums',
  binary_search_array: 'Binary search on the array',
  binary_search_answer: 'Binary search on the answer',
  sorting_preprocess: 'Sorting as preprocessing',
  heap: 'Heap',
  monotonic_stack: 'Monotonic stack',
  monotonic_deque: 'Monotonic deque',
  linked_list: 'Linked list',
  tree_traversal: 'Tree traversal',
  trie: 'Trie',
  union_find: 'Union-find',
  segment_tree: 'Segment tree',
  bfs: 'BFS',
  dfs: 'DFS',
  backtracking: 'Backtracking',
  topological_sort: 'Topological sort',
  dijkstra: 'Dijkstra',
  greedy: 'Greedy',
  dynamic_programming: 'Dynamic programming',
}

/** Group headings mirror the comment structure of MECHANISMS in taxonomy.ts. */
export const MECHANISM_GROUPS: ReadonlyArray<{ label: string; members: readonly Mechanism[] }> = [
  {
    label: 'Linear scanning',
    members: [
      'hashing',
      'two_pointers_opposite',
      'two_pointers_fast_slow',
      'sliding_window_fixed',
      'sliding_window_variable',
      'prefix_sums',
    ],
  },
  {
    label: 'Ordered access',
    members: [
      'binary_search_array',
      'binary_search_answer',
      'sorting_preprocess',
      'heap',
      'monotonic_stack',
      'monotonic_deque',
    ],
  },
  {
    label: 'Structures',
    members: ['linked_list', 'tree_traversal', 'trie', 'union_find', 'segment_tree'],
  },
  {
    label: 'Search',
    members: ['bfs', 'dfs', 'backtracking', 'topological_sort', 'dijkstra'],
  },
  {
    label: 'Optimization',
    members: ['greedy', 'dynamic_programming'],
  },
]

export const REDUNDANCY_LABEL: Record<Redundancy, string> = {
  reseeking_membership: 're-seeking membership',
  resumming_overlapping_range: 're-summing an overlapping range',
  resumming_static_range: 're-summing a static range',
  relinear_search_sorted: 're-linear-searching sorted data',
  retesting_monotone_feasibility: 're-testing monotone feasibility',
  recomparing_sorted_pairs: 're-comparing sorted pairs',
  recomputing_subproblems: 'recomputing subproblems',
  refinding_extreme_of_changing_set: 're-finding the extreme of a changing set',
  refinding_next_greater: 're-finding the next greater element',
  retraversing_visited_regions: 're-traversing visited regions',
  remerging_overlapping_groups: 're-merging overlapping groups',
  rewalking_shared_prefixes: 're-walking shared prefixes',
  recomputing_range_under_updates: 'recomputing a range under updates',
  reexploring_dead_branches: 're-exploring dead branches',
  reevaluating_safe_local_choice: 're-evaluating a safe local choice',
  retracking_order_with_lookup: 're-tracking order with a lookup',
  reprocessing_dependencies: 'reprocessing dependencies',
  reexpanding_equal_cost_frontier: 're-expanding an equal-cost frontier',
}

export const FAILURE_LABEL: Record<FailureCode, string> = {
  F1: 'Frame — misread the problem or its constraints',
  F2: 'Brute — could not produce any working approach',
  F3: 'Bottleneck — had a brute force, could not name the waste',
  F4: 'Lift — named the waste, picked the wrong mechanism',
  F5: 'Implementation — right approach, wrong code',
  F6: 'Invariant — working code, cannot justify it',
}

export const BLOCK_LABEL: Record<BlockKind, string> = {
  warmup: 'Warm-up',
  review: 'Review',
  core: 'Core',
  postmortem: 'Post-mortem',
  plan: 'Plan',
}

export const DIMENSION_LABEL: Record<SkillDimension, string> = {
  recognition: 'Recognition',
  derivation: 'Derivation',
  implementation: 'Implementation',
  articulation: 'Articulation',
}
