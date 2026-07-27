/**
 * A mock DataStore so Track D (UI) runs standalone.
 *
 * This file implements the `DataStore` interface from `./types` and nothing else.
 * At integration, `uiStore` is swapped for Track A's Prisma-backed implementation and
 * every screen keeps working, because no component imports this module directly —
 * they go through the per-route loaders under `src/app`.
 *
 * All problem prose here is original. Nothing is copied from a published problem set.
 */

import type {
  AgentName,
  DataStore,
  DrillAttempt,
  FailureAnalysis,
  HintRelease,
  LadderCommit,
  LadderSessionState,
  MasteryDelta,
  MasteryState,
  Mechanism,
  PhaseNumber,
  ProblemContent,
  SessionPlan,
} from './types'
import { MASTERY_WRITER } from './types'
import { store as prismaStore } from './store'

// ─────────────────────────────────────────────────────────────────────────────
// Problem library
// ─────────────────────────────────────────────────────────────────────────────

const PROBLEMS: ProblemContent[] = [
  {
    problemId: 'pair-sums-to-target',
    sourceRef: null,
    title: 'Two Readings That Sum To A Target',
    statement:
      'A sensor logs one integer per minute. Given the log and a target, report whether any two distinct minutes have readings summing to the target. The log is unsorted and may hold up to 200,000 entries.',
    primaryPattern: 'hashing',
    secondary: [],
    redundancy: 'reseeking_membership',
    phase: 1,
    prerequisites: ['defaultdict'],
    canonicalLadder: {
      frame: 'Input: unsorted int array, int target. Output: boolean. n up to 2e5, so O(n^2) is out.',
      brute: 'Every pair, check the sum. O(n^2) time, O(1) space.',
      bottleneck:
        'For each element the inner loop rescans the whole array to answer one question: is target - x present?',
      lift: 'A hash set answers "have I seen this" in O(1), so the rescan disappears.',
      invariant: 'After processing index i, the set holds exactly the readings at indices 0..i.',
      verify: 'n=0 and n=1 return false. Duplicates work because the check precedes the insert. O(n) time, O(n) space.',
    },
    hints: [
      'How large can the log get, and what does that rule out?',
      'You have the O(n^2) version. What is the inner loop doing on every single outer step?',
      'The inner loop exists to answer one yes/no question, and it re-answers it from scratch n times.',
      'You are re-seeking membership: "is this value present" asked repeatedly over a set that only grows.',
      'Stop scanning for membership. Store what you have already seen in something that answers that in constant time.',
      'Walk once. Before inserting x, ask whether target - x is already stored. Why must the check come before the insert?',
      'One pass. Keep a set of readings seen so far. For each x, if target - x is in the set, return true, else add x. Correct because every pair (i, j) with i < j is tested exactly once, at j.',
    ],
    distractors: [
      {
        mechanism: 'two_pointers_opposite',
        temptingBecause:
          'Two pointers needs sorted input, and sorting here costs more than the scan it saves.',
      },
      {
        mechanism: 'sorting_preprocess',
        temptingBecause: 'Sorting buys ordering you never use — the question is membership, not order.',
      },
    ],
    disguiseLevel: 1,
    misleadingFingerprint: null,
    edgeCases: ['empty log', 'single reading', 'target equal to twice one reading', 'duplicate readings'],
    drillVariants: [
      {
        disguiseLevel: 1,
        statement:
          'A sensor logs one integer per minute. Given the log and a target, report whether any two distinct minutes have readings summing to the target. Unsorted, up to 200,000 entries.',
      },
    ],
  },
  {
    problemId: 'longest-clean-run',
    sourceRef: null,
    title: 'Longest Run Under A Noise Budget',
    statement:
      'An audio stream is a list of per-frame noise values. Find the length of the longest contiguous stretch whose total noise stays at or under a budget B. Values are non-negative and there can be 300,000 frames.',
    primaryPattern: 'sliding_window_variable',
    secondary: ['prefix_sums'],
    redundancy: 'resumming_overlapping_range',
    phase: 1,
    prerequisites: ['sliding_window_fixed', 'hashing'],
    canonicalLadder: {
      frame: 'Input: non-negative int array, budget B. Output: max length of a contiguous stretch with sum <= B. n up to 3e5.',
      brute: 'Every start, extend to every end, sum as you go. O(n^2).',
      bottleneck:
        'Consecutive candidate ranges overlap almost entirely, and each one is summed again from its first element.',
      lift: 'A variable window adds the entering frame and subtracts the leaving one, so the overlap is never re-summed.',
      invariant: 'The window [lo, hi] always has sum <= B after the shrink step.',
      verify: 'Empty stream returns 0. A single frame above budget returns 0. O(n) time, each index enters and leaves once.',
    },
    hints: [
      'Are the values allowed to be negative? Check before you commit to an approach.',
      'You have the O(n^2) scan. What does the range starting at i+1 share with the range starting at i?',
      'Ranges that differ by one element are being summed from scratch, element by element.',
      'You are re-summing an overlapping range: consecutive candidates share all but one or two frames.',
      'Carry the sum between candidates instead of rebuilding it. Add on the right, remove on the left.',
      'Two indices, both only moving forward, with a running sum. Why can the left index never need to move back?',
      'Advance hi, add value. While sum > B, subtract value at lo and advance lo. Record hi - lo + 1. Non-negativity is what makes the left pointer monotone.',
    ],
    distractors: [
      {
        mechanism: 'two_pointers_opposite',
        temptingBecause:
          'Opposite pointers converge from the ends; this window has to stay contiguous and both ends move forward.',
      },
      {
        mechanism: 'prefix_sums',
        temptingBecause:
          'Prefix sums answer static range queries; here the range itself is what you are searching for.',
      },
    ],
    disguiseLevel: 2,
    misleadingFingerprint: null,
    edgeCases: ['empty stream', 'all values above budget', 'budget of zero', 'all zeros'],
    drillVariants: [
      {
        disguiseLevel: 2,
        statement:
          'An audio stream is a list of per-frame noise values. Find the length of the longest contiguous stretch whose total noise stays at or under a budget B. Non-negative values, up to 300,000 frames.',
      },
    ],
  },
  {
    problemId: 'rail-pair-closest',
    sourceRef: null,
    title: 'Closest Pair On A Sorted Rail',
    statement:
      'Positions of markers along a rail arrive already sorted ascending. Given a distance D, return the pair of markers whose separation is closest to D without exceeding it. Up to 500,000 markers.',
    primaryPattern: 'two_pointers_opposite',
    secondary: [],
    redundancy: 'recomparing_sorted_pairs',
    phase: 1,
    prerequisites: ['arrays_basics'],
    canonicalLadder: {
      frame: 'Input: ascending int array, distance D. Output: the best pair with separation <= D. n up to 5e5.',
      brute: 'Check every pair. O(n^2).',
      bottleneck:
        'The array is sorted, so once a pair is too wide, every wider pair on that side is re-tested and rejected for the same reason.',
      lift: 'Converge two pointers from the ends; sortedness makes each rejection eliminate a whole block of pairs.',
      invariant: 'Every pair outside the current [lo, hi] span has already been decided.',
      verify: 'n<2 returns nothing. All-identical positions give separation 0. O(n) after the sort is given.',
    },
    hints: [
      'The input is already sorted. Does your approach use that, or merely tolerate it?',
      'You are testing all pairs. What does sortedness tell you the moment a pair is too wide?',
      'When the widest remaining pair overshoots, every pair sharing that outer marker also overshoots — and you test them all anyway.',
      'You are re-comparing sorted pairs: the order already decided the outcome of comparisons you keep making.',
      'Start at both ends and let each comparison retire an entire end.',
      'lo at the front, hi at the back. If separation exceeds D, which end must move, and why is the other one safe to keep?',
      'Converge lo and hi. Separation too large means hi must come in. Otherwise record and advance lo. Each step discards a pointer position permanently, so O(n).',
    ],
    distractors: [
      {
        mechanism: 'binary_search_array',
        temptingBecause:
          'Binary search finds one target per query; here every marker is a query, so the log factor is work you can drop.',
      },
      {
        mechanism: 'sliding_window_variable',
        temptingBecause:
          'A window keeps a contiguous block; this problem cares about two endpoints, not the block between them.',
      },
    ],
    disguiseLevel: 2,
    misleadingFingerprint: null,
    edgeCases: ['fewer than two markers', 'all markers at the same position', 'D of zero'],
    drillVariants: [
      {
        disguiseLevel: 2,
        statement:
          'Marker positions along a rail arrive already sorted ascending. Given a distance D, return the pair whose separation is closest to D without exceeding it. Up to 500,000 markers.',
      },
    ],
  },
  {
    problemId: 'next-taller-building',
    sourceRef: null,
    title: 'Days Until A Taller Building',
    statement:
      'Walking a street you record building heights in order. For each building, report how many buildings you pass before reaching one strictly taller, or 0 if none exists. There can be 100,000 buildings and heights repeat freely.',
    primaryPattern: 'monotonic_stack',
    secondary: [],
    redundancy: 'refinding_next_greater',
    phase: 2,
    prerequisites: ['stack_basics'],
    canonicalLadder: {
      frame: 'Input: int array of heights. Output: int array of distances to the next strictly greater height, 0 if none. n up to 1e5.',
      brute: 'For each index, scan forward until a taller building appears. O(n^2) worst case on a descending street.',
      bottleneck:
        'The forward scans overlap: a long descending run is re-walked from every one of its members.',
      lift: 'A stack of indices with decreasing heights lets each building be resolved once, when the first taller one arrives.',
      invariant: 'The stack always holds indices whose next-taller is still unknown, in non-increasing height order.',
      verify: 'n=1 gives [0]. All-identical gives all zeros because the comparison is strict. Each index is pushed and popped once, O(n).',
    },
    hints: [
      'Heights repeat. Does "taller" mean strictly taller, and what does that do to the all-identical case?',
      'You have the O(n^2) forward scan. What does the scan starting at i re-walk from the scan at i-1?',
      'On a descending run every building re-walks the same suffix before finding its answer.',
      'You are re-finding the next greater element: the same forward search is repeated over overlapping suffixes.',
      'Keep the unresolved buildings around instead of re-scanning for them, and resolve them the moment a taller one shows up.',
      'A stack holding indices of buildings still waiting for an answer, kept in non-increasing height. Why is that ordering guaranteed to hold?',
      'Iterate left to right. While the current height exceeds the height at the stack top, pop and record the index distance. Push the current index. Pushed once, popped once, so O(n).',
    ],
    distractors: [
      {
        mechanism: 'monotonic_deque',
        temptingBecause:
          'A deque is for an extreme leaving a moving window; nothing here leaves — the discriminator is whether items expire.',
      },
      {
        mechanism: 'heap',
        temptingBecause:
          'A heap gives you the global extreme; you need the nearest greater one, which is a position question, not a value question.',
      },
      {
        mechanism: 'sliding_window_variable',
        temptingBecause: 'There is no window here — the span to the answer is the output, not a constraint.',
      },
    ],
    disguiseLevel: 3,
    misleadingFingerprint: 'The phrase "how many you pass" reads like a window width.',
    edgeCases: ['single building', 'strictly descending street', 'all heights identical'],
    drillVariants: [
      {
        disguiseLevel: 3,
        statement:
          'Walking a street you record building heights in order. For each building, report how many buildings you pass before reaching one strictly taller, or 0 if none. Up to 100,000 buildings, heights repeat.',
      },
    ],
  },
  {
    problemId: 'shipping-capacity',
    sourceRef: null,
    title: 'Smallest Truck That Finishes In Time',
    statement:
      'Crates sit in a fixed order on a dock and must ship in that order. Each day one truck takes a prefix of what remains, up to its capacity. Find the smallest capacity that clears the dock within D days. Weights are up to 500 and there can be 50,000 crates.',
    primaryPattern: 'binary_search_answer',
    secondary: ['greedy'],
    redundancy: 'retesting_monotone_feasibility',
    phase: 1,
    prerequisites: ['binary_search_array'],
    canonicalLadder: {
      frame: 'Input: weights in fixed order, day budget D. Output: minimum capacity. Order is fixed, so this is not a partition-choice problem.',
      brute: 'Try every capacity from max(weight) upward, simulating the days each time. O(sum * n).',
      bottleneck:
        'Feasibility is monotone in capacity — once a capacity works, every larger one works — and the linear sweep re-tests capacities it can already rule out.',
      lift: 'Binary search over the capacity, with a linear feasibility check inside.',
      invariant: 'The answer always lies inside [lo, hi], because lo is always infeasible-or-answer and hi is always feasible.',
      verify: 'D=1 forces capacity = total. D >= n gives max weight. O(n log sum).',
    },
    hints: [
      'Crates ship in fixed order. Does your approach quietly assume you may reorder them?',
      'You are sweeping capacities one at a time. What is true about the set of capacities that work?',
      'If capacity C clears the dock in time, C+1 does too. Your sweep still tests every value below the answer.',
      'You are re-testing a monotone feasibility predicate at values whose outcome is already implied.',
      'Search the answer space, not the input. The check itself stays linear.',
      'Binary search on capacity between max(weight) and sum(weight), with a greedy day-count as the predicate. What makes the greedy day-count optimal for a fixed capacity?',
      'lo = max weight, hi = total weight. Feasible(C) counts days greedily by filling each truck until the next crate overflows. Shrink toward the smallest feasible C. O(n log sum).',
    ],
    distractors: [
      {
        mechanism: 'dynamic_programming',
        temptingBecause:
          'DP is for choosing a partition; the order is fixed, so there is nothing to choose — only a threshold to locate.',
      },
      {
        mechanism: 'binary_search_array',
        temptingBecause:
          'You are not searching an index in the input; you are searching a value that never appears in it.',
      },
      {
        mechanism: 'greedy',
        temptingBecause:
          'Greedy is the inner check, not the outer method — it answers "does C work", not "which C".',
      },
    ],
    disguiseLevel: 3,
    misleadingFingerprint: 'Weights capped at 500 look like a counting-sort or DP fingerprint.',
    edgeCases: ['D equal to 1', 'D at least the crate count', 'one crate', 'all weights equal'],
    drillVariants: [
      {
        disguiseLevel: 3,
        statement:
          'Crates sit in fixed order and must ship in that order. Each day one truck takes a prefix of what remains, up to capacity. Find the smallest capacity that clears the dock within D days. Weights up to 500, up to 50,000 crates.',
      },
    ],
  },
  {
    problemId: 'rotting-produce',
    sourceRef: null,
    title: 'Spoilage Across A Crate Grid',
    statement:
      'A crate is a grid of cells, each empty, holding fresh fruit, or holding spoiled fruit. Every hour, spoilage spreads to fruit sharing an edge with spoiled fruit. Report the hours until nothing fresh remains, or -1 if some fruit never spoils. The grid can be 1000 by 1000.',
    primaryPattern: 'bfs',
    secondary: [],
    redundancy: 'reexpanding_equal_cost_frontier',
    phase: 3,
    prerequisites: ['bfs_levels'],
    canonicalLadder: {
      frame: 'Input: grid of three cell states. Output: hours as an int, or -1. Up to 1e6 cells. Multiple spoiled cells may start simultaneously.',
      brute: 'Simulate hour by hour, rescanning the entire grid each hour to find newly adjacent fruit. O(hours * cells).',
      bottleneck:
        'Each hour rescans every cell, including the large untouched regions and the cells already resolved in earlier hours.',
      lift: 'Multi-source BFS: seed the queue with every initially spoiled cell and expand one level per hour.',
      invariant: 'Every cell dequeued at level k spoils at exactly hour k, because BFS visits in non-decreasing distance.',
      verify: 'A grid with no fresh fruit is 0 hours. A fresh cell walled off by empties gives -1. O(cells).',
    },
    hints: [
      'How many starting spoiled cells can there be? Does your approach assume exactly one?',
      'You are re-scanning the whole grid each hour. What fraction of that scan touches anything that changed?',
      'Cells already spoiled, and cells nowhere near the frontier, are visited again every single hour.',
      'You are re-expanding an equal-cost frontier: the same layer is rediscovered by scanning instead of remembered.',
      'Carry the frontier forward rather than re-deriving it. The starting frontier is every spoiled cell at once.',
      'A queue seeded with all initially spoiled cells, drained one level per hour. Why does seeding them all at once still give the correct per-cell hour?',
      'Multi-source BFS. Push all spoiled cells at level 0, expand edge-adjacent fresh cells level by level, count levels. Any fresh cell left unvisited means -1. O(rows * cols).',
    ],
    distractors: [
      {
        mechanism: 'dfs',
        temptingBecause:
          'DFS reaches every cell too, but it does not order visits by distance — the output here is a distance.',
      },
      {
        mechanism: 'union_find',
        temptingBecause:
          'Union-find answers connectivity, not how many steps connectivity took.',
      },
      {
        mechanism: 'dijkstra',
        temptingBecause:
          'Every edge costs one hour, so the priority queue buys nothing a plain queue does not already give.',
      },
    ],
    disguiseLevel: 1,
    misleadingFingerprint: null,
    edgeCases: ['no fresh fruit at all', 'no spoiled fruit at all', 'fresh fruit enclosed by empty cells', 'single cell grid'],
    drillVariants: [
      {
        disguiseLevel: 1,
        statement:
          'A grid holds cells that are empty, fresh, or spoiled. Each hour spoilage spreads to edge-adjacent fresh cells. Report hours until nothing fresh remains, or -1. Grid up to 1000 by 1000.',
      },
    ],
  },
  {
    problemId: 'loudest-k-signals',
    sourceRef: null,
    title: 'The K Loudest Signals In A Live Feed',
    statement:
      'Readings arrive one at a time and never stop. After each arrival, report the k-th loudest reading seen so far. There may be millions of readings and k is at most 1000.',
    primaryPattern: 'heap',
    secondary: [],
    redundancy: 'refinding_extreme_of_changing_set',
    phase: 2,
    prerequisites: ['heapq'],
    canonicalLadder: {
      frame: 'Input: a stream of numbers, a fixed k. Output: the k-th largest after each arrival. Stream length unbounded, k <= 1000.',
      brute: 'Keep everything, sort after each arrival, index k-1. O(n^2 log n) over the stream.',
      bottleneck:
        'The set changes by one element per step and the whole thing gets re-sorted to answer a question about one boundary element.',
      lift: 'A size-k min-heap keeps exactly the current top k, so each arrival costs O(log k).',
      invariant: 'The heap always holds the k largest readings seen so far, and its root is the answer.',
      verify: 'Fewer than k readings so far has no answer. Ties are fine — equal values are still distinct entries. O(log k) per arrival.',
    },
    hints: [
      'The stream never ends and k is small. Which of those two bounds should your memory depend on?',
      'You re-sort after each arrival. How much of the order changed?',
      'One element enters, and you rebuild an ordering of everything to read a single position.',
      'You are re-finding the extreme of a changing set: the boundary element is recomputed from scratch after each mutation.',
      'You only ever need the boundary of the top k, so stop storing and ordering the rest.',
      'A min-heap capped at size k. Why is the root of that heap the k-th largest, and why is discarding the overflow safe?',
      'Push each reading. If size exceeds k, pop the minimum. The root is the k-th largest. O(log k) per arrival, O(k) memory.',
    ],
    distractors: [
      {
        mechanism: 'sorting_preprocess',
        temptingBecause:
          'Sorting needs the whole set up front; the set here is still arriving — that is the discriminator.',
      },
      {
        mechanism: 'monotonic_deque',
        temptingBecause:
          'A deque tracks an extreme over a window that expires items; nothing expires in this stream.',
      },
    ],
    disguiseLevel: 1,
    misleadingFingerprint: null,
    edgeCases: ['fewer than k readings', 'all readings equal', 'k of 1'],
    drillVariants: [
      {
        disguiseLevel: 1,
        statement:
          'Readings arrive one at a time and never stop. After each arrival report the k-th loudest so far. Millions of readings, k at most 1000.',
      },
    ],
  },
  {
    problemId: 'stair-costs',
    sourceRef: null,
    title: 'Cheapest Way Up A Staircase',
    statement:
      'Each step of a staircase charges a toll. From a step you may climb one or two steps. Starting before the first step, find the cheapest total toll to get past the top. There can be 100,000 steps and tolls can be zero.',
    primaryPattern: 'dynamic_programming',
    secondary: [],
    redundancy: 'recomputing_subproblems',
    phase: 4,
    prerequisites: ['memoization'],
    canonicalLadder: {
      frame: 'Input: toll per step. Output: min total toll to pass the top. n up to 1e5, so exponential recursion is out.',
      brute: 'Recurse on both moves from every step. O(2^n).',
      bottleneck:
        'The recursion reaches the same step through many different prefixes and recomputes its entire subtree each time.',
      lift: 'Memoize on the step index — one state, computed once.',
      invariant: 'best[i] is the minimum toll to stand on step i, and it depends only on best[i-1] and best[i-2].',
      verify: 'n=1 returns that toll. All-zero tolls return 0. O(n) time, O(1) space once you drop the table.',
    },
    hints: [
      'Tolls can be zero. Does that break any assumption in your approach?',
      'Your recursion branches twice per step. How many distinct arguments does it ever get called with?',
      'Step 7 is reached by many different prefixes, and each one recomputes everything above it.',
      'You are recomputing subproblems: the same state is solved repeatedly under different call histories.',
      'The number of distinct states is small. Solve each one once and keep the answer.',
      'best[i] as the minimum toll to stand on step i. What are the only two ways to arrive there, and what does that make the recurrence?',
      'best[i] = toll[i] + min(best[i-1], best[i-2]), answer is min(best[n-1], best[n-2]). Only two prior values matter, so two variables suffice. O(n) time, O(1) space.',
    ],
    distractors: [
      {
        mechanism: 'greedy',
        temptingBecause:
          'Greedy needs a locally safe choice; taking the cheaper next step can strand you on an expensive one.',
      },
      {
        mechanism: 'dijkstra',
        temptingBecause:
          'It is a shortest path on a DAG, but the states are already in topological order, so the priority queue is dead weight.',
      },
    ],
    disguiseLevel: 2,
    misleadingFingerprint: null,
    edgeCases: ['one step', 'two steps', 'all tolls zero'],
    drillVariants: [
      {
        disguiseLevel: 2,
        statement:
          'Each step of a staircase charges a toll. From a step you may climb one or two. Starting before the first step, find the cheapest total toll to get past the top. Up to 100,000 steps, tolls may be zero.',
      },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Mastery fixtures
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (d: number) => new Date(Date.now() - d * DAY)

const MASTERY: MasteryState[] = [
  {
    node: 'hashing',
    recognition: 0.91,
    derivation: 0.82,
    implementation: 0.78,
    articulation: null,
    lastSeen: daysAgo(3),
    decayRate: 1,
    failureCodes: {},
  },
  {
    node: 'sliding_window_variable',
    recognition: 0.64,
    derivation: 0.58,
    implementation: 0.61,
    articulation: null,
    lastSeen: daysAgo(9),
    decayRate: 1,
    failureCodes: { F4: 3, F3: 1 },
  },
  {
    node: 'two_pointers_opposite',
    recognition: 0.72,
    derivation: 0.66,
    implementation: 0.7,
    articulation: null,
    lastSeen: daysAgo(11),
    decayRate: 1,
    failureCodes: { F4: 2 },
  },
  {
    node: 'monotonic_stack',
    recognition: 0.41,
    derivation: 0.33,
    implementation: 0.29,
    articulation: null,
    lastSeen: daysAgo(21),
    decayRate: 1,
    failureCodes: { F3: 4, F5: 1 },
  },
  {
    node: 'binary_search_answer',
    recognition: 0.55,
    derivation: 0.48,
    implementation: 0.52,
    articulation: null,
    lastSeen: daysAgo(6),
    decayRate: 1,
    failureCodes: { F1: 1 },
  },
  {
    node: 'heap_topk',
    recognition: 0.79,
    derivation: 0.71,
    implementation: 0.64,
    articulation: null,
    lastSeen: daysAgo(14),
    decayRate: 1,
    failureCodes: {},
  },
]

/**
 * Deltas the session produced. In the real system these are emitted by the runtime
 * agents and applied only by `curriculum-planner`; here they are pre-seeded so the
 * summary screen has something honest to render.
 */
const PENDING_DELTAS: MasteryDelta[] = [
  {
    id: 'd1',
    node: 'monotonic_stack',
    dimension: 'recognition',
    observed: 0.5,
    source: 'recognition-drill',
    observedAt: new Date(),
    appliedAt: null,
  },
  {
    id: 'd2',
    node: 'monotonic_stack',
    dimension: 'derivation',
    observed: 0.6,
    source: 'socratic-coach',
    observedAt: new Date(),
    appliedAt: null,
  },
  {
    id: 'd3',
    node: 'sliding_window_variable',
    dimension: 'recognition',
    observed: 0.8,
    source: 'recognition-drill',
    observedAt: new Date(),
    appliedAt: null,
  },
  {
    id: 'd4',
    node: 'two_pointers_opposite',
    dimension: 'recognition',
    observed: 0.3,
    source: 'recognition-drill',
    observedAt: new Date(),
    appliedAt: null,
  },
  {
    id: 'd5',
    node: 'heap_topk',
    dimension: 'derivation',
    observed: 0.75,
    source: 'socratic-coach',
    observedAt: new Date(),
    appliedAt: null,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// The mock store
// ─────────────────────────────────────────────────────────────────────────────

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v), (_k, x) => x) as T

class UiMockStore implements DataStore {
  private mastery = MASTERY.map((m) => ({ ...m }))
  private deltas = PENDING_DELTAS.map((d) => ({ ...d }))
  private sessions = new Map<string, LadderSessionState>()
  private attempts: DrillAttempt[] = []
  private seq = 0

  async getMastery(_learnerId: string, node: string): Promise<MasteryState | null> {
    return this.mastery.find((m) => m.node === node) ?? null
  }

  async getAllMastery(_learnerId: string): Promise<MasteryState[]> {
    // The real store applies decay from lastSeen here. The mock returns stored values.
    return this.mastery.map((m) => ({ ...m }))
  }

  async applyDeltas(
    _learnerId: string,
    deltas: MasteryDelta[],
    source: AgentName,
  ): Promise<MasteryState[]> {
    if (source !== MASTERY_WRITER) {
      throw new Error(`Single-writer violation: ${source} may not write mastery.`)
    }
    for (const d of deltas) {
      const target = this.mastery.find((m) => m.node === d.node)
      if (!target) continue
      const prior = target[d.dimension]
      if (prior === null) continue
      target[d.dimension] = 0.3 * d.observed + 0.7 * prior
      target.lastSeen = new Date()
    }
    return this.getAllMastery(_learnerId)
  }

  async enqueueDelta(_learnerId: string, delta: MasteryDelta): Promise<void> {
    this.deltas.push({ ...delta, id: delta.id ?? `d${++this.seq}` })
  }

  async pendingDeltas(_learnerId: string): Promise<MasteryDelta[]> {
    return this.deltas.filter((d) => d.appliedAt === null).map((d) => ({ ...d }))
  }

  async getProblem(problemId: string): Promise<ProblemContent | null> {
    const found = PROBLEMS.find((p) => p.problemId === problemId)
    return found ? clone(found) : null
  }

  async listProblems(filter?: { mechanism?: Mechanism; phase?: PhaseNumber }): Promise<ProblemContent[]> {
    return PROBLEMS.filter(
      (p) =>
        (filter?.mechanism === undefined || p.primaryPattern === filter.mechanism) &&
        (filter?.phase === undefined || p.phase === filter.phase),
    ).map((p) => clone(p))
  }

  async seenProblemIds(_learnerId: string): Promise<string[]> {
    return []
  }

  async createLadderSession(_learnerId: string, problemId: string): Promise<LadderSessionState> {
    const sessionId = `ladder-${problemId}-${++this.seq}`
    const state: LadderSessionState = {
      sessionId,
      problemId,
      currentRung: 1,
      commits: [],
      hints: [],
      difficultyMiscalibrated: false,
      completedAt: null,
    }
    this.sessions.set(sessionId, state)
    return { ...state }
  }

  async getLadderSession(sessionId: string): Promise<LadderSessionState | null> {
    const s = this.sessions.get(sessionId)
    return s ? { ...s, commits: [...s.commits], hints: [...s.hints] } : null
  }

  async logCommit(sessionId: string, commit: LadderCommit): Promise<LadderSessionState> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`No ladder session ${sessionId}`)
    s.commits.push({ ...commit, id: commit.id ?? `c${++this.seq}` })
    return (await this.getLadderSession(sessionId))!
  }

  async logHint(sessionId: string, hint: HintRelease): Promise<LadderSessionState> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`No ladder session ${sessionId}`)
    s.hints.push({ ...hint })
    return (await this.getLadderSession(sessionId))!
  }

  async recordDrillAttempt(_learnerId: string, attempt: DrillAttempt): Promise<void> {
    this.attempts.push(attempt)
  }

  // ── mock-only helpers, not part of DataStore ──────────────────────────────

  /** Advances the rung after a correct commit. The real service owns this transition. */
  advanceRung(sessionId: string): LadderSessionState | null {
    const s = this.sessions.get(sessionId)
    if (!s) return null
    if (s.currentRung < 6) s.currentRung = (s.currentRung + 1) as LadderSessionState['currentRung']
    else s.completedAt = new Date()
    return { ...s, commits: [...s.commits], hints: [...s.hints] }
  }

  flagMiscalibrated(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (s) s.difficultyMiscalibrated = true
  }
}

/**
 * The seam, now closed. `store` is Track A's Prisma-backed implementation, so
 * the screens read the same rows the agents and the seed script write, and
 * mastery survives a restart with decay applied on read.
 *
 * UiMockStore is kept — not dead weight — because the invariant tests and any
 * offline/demo run need a DataStore with no database behind it.
 */
export const store: DataStore = prismaStore
export const uiStore = prismaStore

export const MOCK_LEARNER_ID = 'demo-learner'

/** The problem the coach screen walks. Chosen for its deep hint ladder. */
export const COACH_PROBLEM_ID = 'largest-rectangle-in-a-skyline'

// ─────────────────────────────────────────────────────────────────────────────
// Session-summary fixtures
//
// `SessionPlan` and `FailureAnalysis` are agent outputs, not persisted rows — the
// DataStore interface has no accessor for them. Until Track B/C wire the agents in,
// the summary screen reads these. They are typed against the contract so the swap is
// a one-line change in src/app/session/data.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const MOCK_SESSION_PLAN: SessionPlan = {
  sessionPlan: [
    {
      block: 'warmup',
      agent: 'recognition-drill',
      minutes: 5,
      content: '8 interleaved items, weighted toward monotonic stack against deque and heap.',
      why: 'Your monotonic-stack recognition is 0.41 and three of your last four failures were F3 on it.',
    },
    {
      block: 'core',
      agent: 'socratic-coach',
      minutes: 30,
      content: 'Days Until A Taller Building, disguise level 3.',
      why: 'Disguised phrasing forces the discriminator to run instead of the keyword.',
    },
    {
      block: 'review',
      agent: 'invariant-examiner',
      minutes: 8,
      content: 'Probe the stack ordering claim.',
      why: 'You reached the mechanism but stated the invariant as a restatement of the goal.',
    },
    {
      block: 'postmortem',
      agent: 'failure-analyst',
      minutes: 5,
      content: 'Classify the session and prescribe.',
      why: 'The commit log has enough signal to name where you fell off rather than guess.',
    },
    {
      block: 'plan',
      agent: 'curriculum-planner',
      minutes: 2,
      content: 'Apply deltas, schedule the next monotonic-stack review.',
      why: 'Deltas stay pending until the planner applies them, so the next session is chosen from current state.',
    },
  ],
  gateStatus: {
    phase: 2,
    criteriaMet: 3,
    criteriaTotal: 5,
    missing: ['monotonic_stack recognition >= 0.85', 'monotonic_stack implementation >= 0.70'],
  },
  estimatedSessionsToGate: 4,
  learnerMessage:
    'Phase 2 is held open by one node. Monotonic stack is the only thing between you and Phase 3.',
}

export const MOCK_FAILURE_ANALYSIS: FailureAnalysis = {
  primaryCode: 'F3',
  secondaryCodes: ['F4'],
  evidence:
    'Rung 2 commit was a correct O(n^2) forward scan with complexity stated. Rung 3 commit was "the scan is slow" — no repeated operation named — and needed two hint levels before "re-walking the same suffix" appeared. Rung 4 then committed to monotonic deque before correcting to monotonic stack.',
  node: 'monotonic_stack',
  prerequisiteGap: false,
  prescription: {
    drillType: 'redundancy-naming on solved problems',
    target: 'monotonic_stack',
    reps: 8,
    sessions: 3,
  },
  learnerMessage:
    'You had a working brute force and stated its complexity without prompting. What you could not do was say what it repeated. That is F3, and it is the rung that predicts unseen problems, so it is where the next three sessions go. The deque slip at rung 4 is secondary — it followed from not having named the waste precisely.',
}
