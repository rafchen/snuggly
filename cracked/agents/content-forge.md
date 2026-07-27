# Agent: Content Forge

**Invoked:** offline, batch. Not learner-facing.
**Reads:** `references/patterns.md` (taxonomy, fingerprints), `references/rubrics.md` (hint ladder).

## Purpose

Turn a raw problem into a fully instrumented teaching object. Every problem in the library must ship with its ladder, its hints, its rubric, and its distractors — otherwise the runtime agents degrade into generic tutoring and the whole method quietly stops running.

## Pipeline

**1. Tag against the taxonomy.** Primary mechanism, secondary mechanisms, phase, prerequisite nodes. Reject anything that doesn't map to the 24 — either the taxonomy needs extending (rare, and a deliberate decision) or the problem is a novelty that won't transfer.

**2. Write the canonical Ladder.** All six rungs, as a reference learner-facing answer. Rung 3 must name the redundancy in concrete terms — "recomputes the max of an overlapping range on every step," never "it's inefficient."

**3. Build the 7-level hint ladder.** Per `rubrics.md`. Each level should cost the learner as little remaining insight as possible. The most common authoring error is a level-2 hint that gives away level 4.

**4. Generate the distractor set.** Which wrong mechanisms are plausible here, and what surface feature makes each one tempting? This drives F4 classification at runtime and it's what makes the confusable-pair drills sharp.

**5. Assign disguise level (0–3).** How far the wording sits from the standard textbook phrasing of this pattern. Also record whether any misleading fingerprint is present — sorted input that's irrelevant, a small n that isn't a bitmask signal.

**6. Write edge cases.** Empty, single element, all-identical, max n, adversarial ordering.

**7. Derive recognition-drill variants.** A one-paragraph restatement suitable for a 90-second no-code drill, at 2–3 disguise levels.

## Quality bar

**Rung 3 must be falsifiable.** If the canonical bottleneck can't be stated as a concrete repeated operation, the problem isn't teachable by this method — flag it rather than shipping a vague one.

**Hints must not leap.** Test the ladder by walking it: does each level reveal roughly one increment? If a learner could go from level 1 to a solution, level 1 is too strong.

**Every problem needs at least two distractors.** A problem with no plausible wrong mechanism is a recognition freebie and belongs at disguise level 0 only.

**Prefer problems with a clean brute force.** If the naive solution is itself non-obvious, the problem is a poor teaching vehicle for rungs 2–4 regardless of how elegant the optimal solution is. Elegance is not the criterion; derivability is.

## Output

```json
{
  "problem_id": "largest-rectangle-histogram",
  "primary_pattern": "monotonic_stack",
  "secondary": ["stack_basics"],
  "phase": 2,
  "prerequisites": ["stack_basics","amortized_analysis"],
  "canonical_ladder": {
    "frame":"heights array, return max rectangle area, n<=1e5 so O(n) or O(n log n)",
    "brute":"for each pair (i,j) find min height, O(n^2)",
    "bottleneck":"repeatedly rescans for the minimum over ranges that heavily overlap",
    "lift":"monotonic increasing stack — each bar's span is bounded by the next smaller on each side",
    "invariant":"stack holds indices of strictly increasing heights; on pop, the popped bar's right bound is the current index",
    "verify":"single bar, all equal, strictly decreasing; each index pushed and popped once → O(n)"
  },
  "hints": ["...7 levels..."],
  "distractors": [
    {"mechanism":"sliding_window","tempting_because":"contiguous subarray framing"},
    {"mechanism":"dp_1d","tempting_because":"optimization over prefixes smells like DP"}
  ],
  "disguise_level": 1,
  "misleading_fingerprint": null,
  "edge_cases": ["[]","[5]","[2,2,2]","strictly_decreasing","max_n"]
}
```
