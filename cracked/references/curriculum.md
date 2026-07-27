# Curriculum Reference

## The mastery model

Each skill node carries four independent scores in [0, 1]:

```json
{
  "node": "sliding_window_variable",
  "recognition":    0.82,
  "derivation":     0.61,
  "implementation": 0.45,
  "articulation":   0.30,
  "last_seen":      "2026-07-19",
  "decay_rate":     0.04,
  "commit_log":     ["...", "..."],
  "failure_codes":  { "F3": 1, "F4": 3, "F5": 6 }
}
```

**Thresholds.** A node is *unlocked* at recognition ≥ 0.5 on its prerequisites. It is *mastered* at recognition ≥ 0.85, derivation ≥ 0.75, implementation ≥ 0.70. Articulation is gated separately and only enforced in Phase 5, because demanding it early adds load without payoff.

**Decay.** Scores decay exponentially from `last_seen`. Implementation decays fastest (syntax evaporates), recognition slowest (pattern intuition is sticky). Set base half-lives around 10 days for implementation, 21 for derivation, 45 for recognition.

**Why four scores and not one.** A single "mastery %" cannot distinguish a learner who can't start from one who can't finish, and those two need opposite interventions. The whole diagnostic value of the system lives in this separation.

---

## The skill DAG

A node is available only when all its prerequisites are unlocked. This is what makes the path feel like a path.

```
Phase 0 ── language_fluency ── collections, sorting_with_keys, heapq,
                               string_ops, defaultdict, tuple_unpacking

Phase 1 ── hashing ─────────┬── two_pointers_opposite
           arrays_basics ───┤   two_pointers_fast_slow
                            ├── sliding_window_fixed ── sliding_window_variable
                            ├── prefix_sums ────────── difference_arrays
                            ├── binary_search_array ── binary_search_answer
                            └── stack_basics

Phase 2 ── stack_basics ──── monotonic_stack ──── monotonic_deque
           heapq ─────────── heap_topk ────────── two_heaps
           linked_list ───── list_reversal, cycle_detection
           tree_basics ───── dfs_traversal, bfs_levels
           hashing ───────── trie
           arrays_basics ─── union_find

Phase 3 ── dfs_traversal ──┬── flood_fill
                           ├── backtracking ──── pruning
                           └── cycle_detection_graph
           bfs_levels ─────┬── shortest_path_unweighted
                           └── multi_source_bfs
           union_find ───── topological_sort ─── dijkstra

Phase 4 ── backtracking ─── memoization ──┬── dp_1d ─── dp_lis
                                          ├── dp_2d_grid ── dp_edit_distance
                                          ├── dp_knapsack ─ dp_subset_sum
                                          ├── dp_interval
                                          ├── dp_tree
                                          └── dp_bitmask

Phase 5 ── (all above) ──── mixed_unlabeled, multi_pattern, interview_sim
```

**Note the Phase 4 entry point.** DP hangs off `backtracking` and `memoization`, not off arrays. This encodes the pedagogy: DP is reached by caching a recursive brute force, never by memorizing recurrences. A learner routed into DP without solid backtracking will produce F2 and F3 failures endlessly and conclude they're bad at DP, when in fact they were admitted early.

---

## Phase exit criteria

Gates, not suggestions. Advancing early is the specific mechanism that produces the "falling further behind" feeling — the learner accumulates unmet prerequisites and experiences the resulting confusion as personal inadequacy.

**Phase 0 → 1.** Write from a blank page, no reference, under 3 minutes each: a min-heap of tuples with a custom key; a frequency count with sorted output; a 2D grid initialized and traversed; string reversal and palindrome check. All 4 clean, twice, on different days.

**Phase 1 → 2.** Recognition ≥ 0.85 across all Phase 1 nodes on interleaved unlabeled drills. Derivation ≥ 0.75. At least 3 problems solved where the learner named the bottleneck *before* any hint. F4 rate below 20% on the confusable pairs in `patterns.md §5`.

**Phase 2 → 3.** All Phase 2 nodes implemented from blank page. Can state the invariant for monotonic stack and union-find unprompted. Heap vs. sort discriminator applied correctly on 5 consecutive drills.

**Phase 3 → 4.** Can model an unfamiliar problem as a graph without being told it's a graph — the single highest-value skill in this phase. BFS/DFS chosen correctly by distance-relevance. Backtracking written with correct undo semantics from scratch.

**Phase 4 → 5.** Derived (not recalled) the DP state definition on 5 unseen problems. Can articulate the state, transition, and base case as three separate sentences before writing code. Top-down and bottom-up both fluent for 1D and 2D.

**Phase 5 exit.** 45-minute simulated interview, unfamiliar problem, thinking aloud, with a clarifying-questions phase, a stated brute force, an optimization with justification, clean implementation, and self-driven edge-case testing. Communication scored separately from correctness.

---

## Session scheduling

A default 60-minute session:

| Block | Minutes | Content |
|-------|---------|---------|
| Warm-up | 5 | `recognition-drill`, interleaved across all unlocked patterns |
| Review | 10 | One due pattern, served on an **unseen** problem |
| Core | 30 | New material, Ladder-driven with `socratic-coach` |
| Post-mortem | 10 | `failure-analyst` + `invariant-examiner` |
| Plan | 5 | `curriculum-planner` updates state, states the next session's target |

**Interleaving mandate.** Warm-up and review draw from *all* unlocked patterns, never just the current one. Blocked practice inflates in-session performance and destroys transfer, because when every problem is a sliding-window problem, the learner never has to perform the recognition step — which is the step being trained.

**Frustration circuit-breaker.** Three consecutive F1/F2 failures on the same node means the prerequisite is missing, not that the learner needs to try harder. Drop to the prerequisite node immediately and say plainly why. Grinding a node whose foundation is absent is the exact experience of "falling behind" and it must be interrupted by the system rather than endured by the learner.

**Ceiling on new material.** At most one new pattern per session. The bottleneck on learning here is consolidation, not exposure — and the market is already saturated with exposure.

---

## Problem selection

For each scheduled slot, `curriculum-planner` requests a problem with:

```json
{
  "target_pattern":   "monotonic_stack",
  "difficulty":       "just_above_current",
  "seen_before":      false,
  "disguise_level":   2,
  "distractor_signal": "contains sorted input that is irrelevant"
}
```

**`disguise_level`** (0–3) is the product's most underrated lever. Level 0 states the pattern in the tags. Level 3 is worded to actively suggest a different mechanism. Recognition scores mean nothing if measured only at level 0, and real interviews are level 2–3. Raise disguise level as recognition rises; that is the actual difficulty axis, more than problem "hardness."

**`distractor_signal`** deliberately plants a misleading fingerprint — sorted input where sorting is irrelevant, a small n where the intended solution isn't exponential. This inoculates against the keyword-matching failure mode that phrase fingerprints otherwise create.
