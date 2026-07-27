# Rubrics Reference

## The hint ladder

Hints are released one level at a time, and **only after a commit**. Each level should cost the learner as little of the remaining insight as possible.

| Level | Form | Example (Trapping Rain Water) |
|-------|------|-------------------------------|
| 0 | Restate a constraint they may have skimmed | "How large can the array be?" |
| 1 | Point at the rung they're stuck on | "You have a brute force. What is it recomputing?" |
| 2 | Narrow the rung | "For each bar you rescan for the max on both sides. Every time." |
| 3 | Name the redundancy explicitly | "You're recomputing max-so-far repeatedly over overlapping ranges." |
| 4 | Give the mechanism, withhold the details | "Precompute those maxima. Or converge two pointers from the ends." |
| 5 | Give the setup, withhold the logic | "Two pointers, one at each end, tracking left_max and right_max. Why is it safe to move the smaller side?" |
| 6 | Full derivation | Complete walkthrough of all six rungs |

**Never skip levels.** Jumping from 1 to 4 collapses the diagnostic — you no longer know whether the learner could have found the mechanism themselves, which is exactly the number the system exists to measure.

**Level 6 requires a stated reason.** Reaching full derivation is a legitimate outcome (the problem was too far above level, the learner is out of time), but it must be logged with a cause so the planner can correct the difficulty calibration.

---

## Failure classification heuristics

`failure-analyst` assigns exactly one primary code. Diagnostic questions in order:

**F1 — Frame.** Did the learner solve a different problem than the one asked? Did they miss a constraint that changes the intended complexity? Did they misread the return type or an edge condition stated in the prompt?
> Tell: their solution is correct for a problem that wasn't posed.

**F2 — Brute.** Could they produce *any* correct approach, however slow? If not, the gap is a missing primitive, not a missing optimization.
> Tell: they stared at a blank page without even an exponential idea. **Never treat this as needing a hint about the optimal approach — back up to the prerequisite node.**

**F3 — Bottleneck.** They had a working brute force but could not articulate what it was doing redundantly. This is the most common failure and the least addressed by existing resources.
> Tell: "I know it's too slow but I don't know what to do about it."

**F4 — Lift.** They named the redundancy correctly and selected the wrong mechanism. Check `patterns.md §5` — it is nearly always one of the confusable pairs.
> Tell: correct diagnosis, wrong prescription. Log *which* pair was confused; that's the drill target.

**F5 — Implementation.** Approach was right, code was wrong. Sub-classify: off-by-one, wrong data structure API, mutation-during-iteration, uninitialized edge case, recursion depth/base case.
> Tell: they can explain the correct algorithm while their code fails.

**F6 — Invariant.** Code passes, learner cannot say why it's correct. This is a real failure even with a green checkmark, and the system must treat it as one — it predicts inability to modify the approach under interview follow-ups.
> Tell: "it works but I'm not totally sure why."

**When multiple apply**, assign the *earliest rung* as primary and note the others as secondary. A learner with F3 and F5 needs the F3 work first; fixing their syntax while they can't find bottlenecks addresses the symptom they noticed rather than the one that's limiting them.

---

## Recognition drill scoring

Learner sees a problem statement, no tags, no code. 90-second cap.

Required response: **(a) the pattern, (b) the redundancy it eliminates.**

| Score | Condition |
|-------|-----------|
| 1.0 | Correct pattern + correct redundancy, under 45s |
| 0.8 | Correct pattern + correct redundancy, under 90s |
| 0.5 | Correct pattern, redundancy vague or absent |
| 0.3 | Wrong pattern, but the redundancy was correctly named |
| 0.0 | Both wrong, or timeout |

**The 0.3 row is deliberate and important.** A learner who correctly identifies the waste but picks the wrong tool is much closer to competence than one who guesses the right tool from surface keywords. Scoring pattern-only-correct at 0.5 while redundancy-only-correct gets 0.3 is a defensible calibration, but never score a keyword-matched right answer at 1.0 — that's rewarding the exact habit this system is built to break.

---

## Derivation rubric

Learner produces rungs 1–5 in writing, no code.

| Rung | Full credit requires |
|------|---------------------|
| Frame | Constraints restated with n's magnitude and its complexity implication |
| Brute | A correct approach + its complexity, stated explicitly |
| Bottleneck | The specific repeated operation, in concrete terms — not "it's slow" |
| Lift | Mechanism named **and** connected to the stated bottleneck |
| Invariant | A statement that is true before and after every iteration/recursion step |

Score = mean of rungs. **Rung 3 is weighted double** — it's the hinge and it's the rung that predicts performance on unseen problems.

---

## Implementation rubric

| Dimension | Full credit |
|-----------|-------------|
| Correctness | Passes all cases including edges, first submission |
| Complexity | Matches the intended bound |
| Idiom | Uses the language's natural constructs; no reimplemented built-ins |
| Legibility | A reader follows it without the author present — meaningful names, no clever one-liners |
| Independence | No lookups of syntax or API during writing |

Independence is scored separately and honestly. A learner who googled `heapq.heappush` signature has an implementation gap even if the code is perfect, and it will surface under interview conditions.

---

## Articulation rubric

Scored only in Phase 5 and interview simulation.

| Dimension | Full credit |
|-----------|-------------|
| Clarifying questions | Asked before solving; surfaced at least one genuine ambiguity |
| Brute force stated | Out loud, with complexity, before optimizing |
| Optimization justified | Explained the bottleneck before naming the mechanism |
| Thinking audible | No silences longer than ~20 seconds without narration |
| Self-testing | Drove their own edge cases without prompting |
| Composure | Recovered from being wrong without unraveling |

Composure is scored because it's trainable and because the most common interview failure among technically-ready candidates is a spiral after the first wrong turn. The simulation should deliberately induce one wrong turn.

---

## Invariant examination

`invariant-examiner` grades the *why*. Standard probes:

- "What is true after every iteration of this loop, regardless of input?"
- "Why is it safe to discard the half you're discarding?"
- "What would break if you moved the other pointer instead?"
- "Convince me this terminates."
- "Give me an input where this fails." *(when it doesn't — the learner should be able to defend it)*
- "Your greedy takes the locally best option. Why is that never regretted later?"

**Accept informal proofs.** The bar is a correct argument in plain language, not formal induction. Rejecting valid intuitive reasoning for lacking formalism teaches learners that the "why" step is academic ritual rather than the thing that makes them able to adapt an approach under pressure.

**Reject circular arguments.** "It works because it finds the answer" is not an invariant. Push once, specifically: "That's a restatement of the goal. What's true at each *step* that makes the goal reachable?"
