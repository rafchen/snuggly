# Patterns Reference

Contents:
1. The Redundancy Table — the core mapping
2. Pattern taxonomy — the finite set
3. Constraint fingerprints — reading n
4. Phrase fingerprints — reading the prompt
5. Confusable pairs — where learners actually go wrong

---

## 1. The Redundancy Table

Rung 3 → 4 of the Ladder. The learner names the wasted work; this table names the tool. **Teach this table before teaching any individual pattern.** It is the thing that generalizes.

| The waste | The mechanism |
|-----------|---------------|
| Re-scanning to ask "have I seen this / how many times" | Hash set, hash map, frequency counter |
| Re-summing a range that mostly overlaps the previous range | Sliding window (fixed or variable) |
| Re-summing arbitrary ranges of static data | Prefix sums |
| Re-searching a sorted or monotonic space linearly | Binary search |
| Re-testing every candidate answer when feasibility is monotonic | Binary search **on the answer** |
| Re-comparing pairs in sorted data | Two pointers |
| Recomputing subproblems already solved | Memoization → DP |
| Re-finding the min or max of a changing collection | Heap |
| Re-finding the next greater / smaller element | Monotonic stack |
| Re-traversing graph regions already visited | Visited set + BFS/DFS |
| Re-merging or re-querying overlapping groups | Union-Find |
| Re-walking shared string prefixes | Trie |
| Re-computing range aggregates *under updates* | Segment tree / Fenwick |
| Re-exploring branches that provably cannot win | Backtracking + pruning |
| Re-evaluating all orderings when a local choice is provably safe | Greedy + exchange argument |
| Re-tracking order of arrival while also needing lookup | Deque, or hash map + linked list |
| Re-processing dependencies in arbitrary order | Topological sort |
| Re-expanding equal-cost frontier nodes | BFS (unweighted) / Dijkstra (weighted) |

**Teaching note.** When a learner is stuck at rung 3, do not ask "what pattern is this?" Ask: *"What is your brute force doing over and over that it shouldn't have to?"* That question is answerable by reasoning. "What pattern is this?" is answerable only by memory, which is precisely the crutch being removed.

---

## 2. Pattern taxonomy

Twenty-two mechanisms. The finiteness is itself pedagogically important — tell learners the list is closed and short. Most of the felt hopelessness comes from believing the space is unbounded.

### Group A — Linear scanning
1. **Hashing / frequency counting** — membership and counts in O(1)
2. **Two pointers (opposite ends)** — sorted arrays, pair-finding, palindromes
3. **Two pointers (fast/slow)** — cycle detection, middle-finding, in-place partitioning
4. **Sliding window, fixed** — every window of size k
5. **Sliding window, variable** — longest/shortest window satisfying a predicate
6. **Prefix sums / difference arrays** — range aggregates on static data

### Group B — Ordered access
7. **Binary search on a sorted array** — index of a value
8. **Binary search on the answer** — smallest/largest feasible value under a monotone predicate
9. **Sorting as a preprocessing step** — intervals, greedy setups, dedup
10. **Heap / priority queue** — top-k, streaming min/max, merge-k
11. **Monotonic stack** — next greater/smaller, histogram problems
12. **Monotonic deque** — sliding-window max/min

### Group C — Structures
13. **Linked list manipulation** — reversal, merging, pointer surgery
14. **Tree traversal** — DFS (pre/in/post), BFS by level
15. **Trie** — prefix-shared string sets
16. **Union-Find** — dynamic connectivity, grouping
17. **Segment tree / Fenwick** — range queries with point updates

### Group D — Search
18. **BFS** — shortest path in unweighted graphs, level-order
19. **DFS** — connectivity, cycle detection, flood fill
20. **Backtracking** — enumerate combinations/permutations/subsets with pruning
21. **Topological sort** — ordering under dependency constraints
22. **Dijkstra / weighted shortest path** — non-negative weighted graphs

### Group E — Optimization
23. **Greedy + exchange argument** — locally safe choices, proven safe
24. **Dynamic programming** — subgroups below

DP subgroups, taught in this order:
- **1D linear** — house robber, climbing stairs, LIS
- **2D grid** — unique paths, edit distance, grid DP
- **Knapsack family** — 0/1, unbounded, subset-sum, partition
- **Interval DP** — burst balloons, matrix chain
- **Tree DP** — rob-on-tree, tree diameter
- **Bitmask DP** — n ≤ 20, TSP-like, assignment

**How DP must be taught.** Always as *memoized brute force*, arrived at by: write the recursive brute force → notice it recomputes → add a cache → optionally flip to bottom-up. Never as a recurrence to memorize. A learner who was handed `dp[i][j] = ...` has learned one problem. A learner who derived it has learned the method.

---

## 3. Constraint fingerprints

The value of n announces the intended complexity. Teach this as a lookup that runs at rung 1, before any thinking about approach — it eliminates whole branches of the search space for free.

| n | Intended complexity | Implies |
|---|---------------------|---------|
| ≤ 12 | O(n!) | Permutation enumeration |
| ≤ 20 | O(2ⁿ) | Subsets, bitmask DP |
| ≤ 100 | O(n³) | Floyd-Warshall, interval DP |
| ≤ 1,000 | O(n²) | Pairwise DP, nested loops fine |
| ≤ 10⁵ | O(n log n) | Sort, heap, binary search, segment tree |
| ≤ 10⁶ | O(n) or O(n log n) | Single pass, hashing, sliding window |
| ≥ 10⁸ | O(log n) or O(1) | Math, closed form, binary search on answer |

Corollaries worth drilling:
- Small n with a "count the ways / find the best arrangement" flavor → almost always DP or backtracking.
- Huge n with a numeric answer → the answer itself is probably the search space (binary search on answer).
- n ≤ 20 in a problem that otherwise looks intractable → bitmask, near-certainly.

---

## 4. Phrase fingerprints

Prompt language maps to mechanisms with high reliability. Drill these as recognition reps — but **always require the learner to state the redundancy too**, or you have taught keyword matching, which fails the instant a problem is worded unusually.

| Prompt says | Reach for |
|-------------|-----------|
| "contiguous subarray / substring" | Sliding window, prefix sums |
| "kth largest / smallest / top k" | Heap, or quickselect |
| "minimize the maximum" / "maximize the minimum" | Binary search on answer |
| "shortest path", unweighted | BFS |
| "shortest path", weighted non-negative | Dijkstra |
| "number of ways to..." | DP |
| "all possible / every combination" | Backtracking |
| "next greater / previous smaller" | Monotonic stack |
| "connected components / groups / islands" | Union-Find, DFS flood fill |
| "detect a cycle" | DFS with colors, or Union-Find, or fast/slow pointers |
| "in-place, O(1) extra space" | Two pointers, index encoding |
| "already sorted" (stated, not incidental) | Two pointers or binary search — the gift is deliberate |
| "prefix / starts with / autocomplete" | Trie |
| "intervals / meetings / ranges" | Sort by start or end, then sweep |
| "palindrome" | Expand-around-center, or DP |
| "before / prerequisite / dependency" | Topological sort |
| "median of a stream" | Two heaps |
| "at most k distinct / at most k changes" | Variable sliding window |

---

## 5. Confusable pairs

Where F4 errors (right redundancy, wrong mechanism) actually cluster. Each pair deserves dedicated drills that interleave the two.

**Sliding window vs. two pointers.** Window maintains a *contiguous range with a property*; two pointers converge from ends or move independently over sorted data. Discriminator: is contiguity required?

**Heap vs. sorting.** If you need all of it ordered, sort. If you need the top k, or the collection changes, heap. Discriminator: does the collection mutate, or do you need only a slice?

**Binary search on array vs. on answer.** On array: you're finding an existing element. On answer: you're finding a value that may not appear in the input, and you have a monotone feasibility check. Discriminator: is the search space the input, or the output?

**DP vs. greedy.** Greedy requires an exchange argument — a proof that a local choice is never regretted. If you can't produce one in 60 seconds, it's DP. Discriminator: can you prove the safety of the local choice?

**BFS vs. DFS.** Shortest path or level structure → BFS. Existence, connectivity, or exhaustive exploration → DFS. Discriminator: does distance matter?

**DFS vs. backtracking.** Backtracking is DFS that *undoes state on the way out* because it's enumerating candidate solutions rather than visiting nodes. Discriminator: are you building something you might have to unbuild?

**Memoized recursion vs. tabulation.** Same algorithm, different traversal order. Teach top-down first — it's derived from brute force and requires no ordering insight. Bottom-up is an optimization, introduced later.

**Union-Find vs. DFS for components.** Static graph, count once → DFS. Edges arriving over time, or repeated connectivity queries → Union-Find. Discriminator: is the graph changing?
