# Cracked

A diagnostic instrument for algorithmic problem solving. It turns "I can solve problems I've seen" into "I can derive solutions to problems I haven't," and it refuses to become another solutions website while doing it.

The pedagogy lives in [`cracked/SKILL.md`](cracked/SKILL.md). This README covers how to run the thing and every decision made building it.

---

## Run it

```bash
npm install

cp .env.example .env          # DATABASE_URL="file:./dev.db"
npx prisma db push            # create the SQLite schema
npx tsx prisma/seed.ts        # skill DAG + demo learner + the 60 forged problems

npm run dev                   # http://localhost:3000
```

| Route | What it does |
|---|---|
| `/` | The claim, and the three entry points |
| `/drill` | Recognition drill — 90-second timer, both fields required |
| `/coach` | The six-rung Ladder with the commit gate |
| `/session` | What was scheduled and why, what moved, and the failure code with its evidence |

Agent behaviour runs through the Claude API. Set `ANTHROPIC_API_KEY` to exercise it:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx scripts/verify-agents.ts   # runs placement, failure-analyst, planner,
                                   # examiner, critic and interview against the live API
```

The screens themselves run without a key — drill grading falls back to `gradeRedundancyOffline`, a deliberately conservative keyword grader that lands an ungraded answer on the 0.5 row rather than inflating it to 0.8.

```bash
npm test          # 51 tests, no network
npm run typecheck
```

`npm run db:reset` wipes and rebuilds the database. Prisma's CLI blocks `--force-reset` for AI agents without explicit human consent, so run that one yourself; `db:push` + `db:seed` cover everything else.

---

## Layout

```
cracked/              the method — the specification this repo implements
  SKILL.md            the Ladder, the Commit Rule, the non-negotiables
  references/         patterns, rubrics, curriculum (DAG, thresholds, decay)
  agents/             one contract per agent, with refusal rules and output schema
src/lib/
  types.ts            THE CONTRACT. Every layer imports from here.
  taxonomy.ts         24 mechanisms, 18 redundancies, the ~50-node skill DAG
  mastery.ts          EMA + decay. No Prisma import, no ambient clock — pure.
  store.ts            PrismaDataStore. The only writer path to Mastery.
  scoring.ts          the rubric tables, verbatim
  interleave.ts       drill selection; throws rather than emit a blocked run
  agents/             the nine agents
src/app/              Next.js App Router — drill, coach, session
content/problems/     60 forged problems, one JSON file each
prisma/               schema + seed
tests/                51 tests
```

---

## Decisions

### The three reconciliations

The source docs contradicted themselves in three places. Each is now one number everywhere.

**Taxonomy size — 24.** `SKILL.md` said "about twenty", `patterns.md` said "Twenty-two" above a list numbered to 24, and `content-forge.md` said "the 24". The list itself runs to 24, so 24 it is. `tests/taxonomy.test.ts` pins it.

**Redundancy count — 18.** `SKILL.md` said "roughly a dozen" over an 18-row table. Eighteen.

**Articulation is a real mastery score, nullable, Phase-5 gated.** `SKILL.md` said "Three separable skills" above a four-row table; `curriculum.md` persisted articulation; `placement-diagnostician.md` omitted it. Resolution: it is persisted alongside the other three, written only by Phase 5 coaching and the interview simulator, and it gates only the Phase 5 exit. **Null is not zero.** It is never decayed toward zero, never averaged as one, and excluded from the mastery check — otherwise every learner stalls at the first gate forever. At the Phase 5 gate a null fails as *not yet measured*, which is a different thing from failing.

### The invariants are structural, not prompted

This is the single most important decision in the build.

The criteria required a test that blocked sequences are *impossible* and that a hint *cannot* be obtained without a commit. An LLM instructed "never release a hint before a commit" complies almost always — and almost always is not what impossible means. A learner who says they are frustrated, or short on time, or who simply asks four times, is exactly the pressure the rule exists to withstand.

So the rules live in the service layer:

- `requestHint` reads the commit log and throws `CommitRuleViolation` **before any API call**. The tests inject a client that throws on invocation, so a passing test proves both that the request was refused and that no model was ever given the chance to be talked round.
- `selectDrillItems` throws `InterleavingViolation` rather than emit two consecutive items on one mechanism. A single-mechanism pool errors instead of quietly degrading into a blocked run.
- `assertRungOrder` refuses a commit at rung N unless every lower rung already has a correct one, so rung 2 cannot be skipped by a learner who says they already know the answer.
- Hint levels cannot be skipped; level 6 requires a stated reason so the planner can correct its difficulty calibration.
- Coach output is redacted against a 24-mechanism alias table, so the pattern name cannot leak before a rung-4 commit.

The agents still carry these rules in their prompts, as defence in depth. The tests assert against the service layer, where the guarantee is real.

### Data model

**`curriculum-planner` is the only writer to Mastery.** `applyDeltas` throws `SingleWriterViolation` before any I/O if called by anything else; every other agent calls `enqueueDelta`. Enforced, not conventional.

**Decay is applied on read.** Scores are stored raw with a `lastSeen` stamp and decayed when fetched, so callers always see current values. A 30-day-stale implementation score of 0.44 reads back as 0.055 at its 10-day half-life. Half-lives are 10 / 21 / 45 days for implementation / derivation / recognition — syntax evaporates, pattern intuition is sticky.

**EMA at alpha 0.3**: `new = 0.3·observed + 0.7·decayed_prior`. A first observation is adopted outright rather than dragged toward an implicit zero. The prior is decayed *before* blending, so a stale score is not over-credited.

**`mastery.ts` imports no Prisma and holds no clock.** That is what makes the math testable in isolation, and it is why the decay and EMA tests need no database.

**The DAG routes DP through backtracking and memoization, never off arrays.** A learner admitted to dynamic programming without solid backtracking produces endless F2 and F3 failures and concludes they are bad at DP, when in fact they were admitted early. `tests/taxonomy.test.ts` asserts every Phase 4 node reaches `memoization` and `backtracking` transitively and none hangs directly off `arrays_basics`.

**Foreign keys are deliberately absent** on `Mastery.node`, `DrillAttempt.problemId` and `LadderSession.problemId`. A delta must be recordable before content is seeded; an FK would make seeding order a runtime failure.

### Content

**Original prose, classic problems.** The underlying problems are the recognizable ones — largest rectangle, course schedule, trapping rain water — because those are what the method's own examples assume and what a learner can cross-reference. But every word of every statement is written for this repo. Canonical problems are referenced by URL in `sourceRef` only; **no third-party statement text is stored anywhere in this repo**. Algorithms aren't copyrightable; specific prose is.

**The quality bar is machine-checked, not trusted.** `content-schema.ts` rejects a vague rung 3 by regex and requires a repetition marker, so "it's slow" cannot ship as a bottleneck. A per-mechanism token table bans the giveaway words in hint levels 0–3 and requires them in 4–6, which turns "a level-2 hint must not give away level 4" from an aspiration into a check.

60 problems, 20 distinct primary mechanisms, all 18 redundancy rows covered, disguise levels 0/1/2/3 at 11/20/21/8, misleading fingerprints on 33.

**Known gap:** four mechanisms (`two_pointers_fast_slow`, `sorting_preprocess`, `linked_list`, `tree_traversal`) appear in the 24 but in none of the 18 redundancy rows, because `patterns.md`'s table has no row for them. Under the rule "a problem's redundancy must list its primary pattern", those four can never be a primary — they ship as `secondary` instead. That is arguably correct, since they are structures and preprocessing rather than redundancy-elimination mechanisms, but it means they cannot currently be drilled as a target. Changing it would alter what `content-forge` accepts and what F4 grading compares against, so it is left as the source doc has it.

### The timer is part of the scoring function

`issuedAtMs` is stamped by the server at issuance and never accepted as input. **No function in the submit path takes a time argument**, so a tampered or merely skewed client clock cannot change a score — elapsed is always `Date.now()` minus the server's own stamp. The browser receives `displayClock`, named that at the component boundary, which draws the countdown and never round-trips.

A timeout is a *request*, not an assertion: when the display clock hits zero the client asks to expire, the server re-derives elapsed from its own timestamp, and a disagreement returns `still-running` with a resynced clock. Issuing the next item is a separate call from settling the current one, so seconds spent reading feedback are not charged to the next item's ninety.

### Claude API

`claude-opus-5`, structured output via `messages.parse` with `zodOutputFormat`. Thinking is on by default on this model; `budget_tokens`, `temperature`, `top_p` and `top_k` are not sent — they return 400. Each agent's Zod schema mirrors the output schema documented in its `cracked/agents/*.md` file, and the schemas are revalidated after parsing.

---

## Known limitations

- **`UiMockStore` and `MockDataStore` both duplicate the decay and EMA math** that `mastery.ts` owns. Deliberate — the invariant tests need a `DataStore` with no database behind it — but it is a second source of truth and should be collapsed onto `mastery.ts`.
- **`REVIEW_THRESHOLD = 0.7` is defined locally in `interleave.ts`** rather than in the contract, where the other thresholds live.
- **Drill run state and ladder-session state also exist in module-level `Map`s** in the service modules; the Prisma store is authoritative, but that duplication is single-process only.
- **The offline redundancy grader is keyword-based** and says so. It decides nothing the Commit Rule depends on.
- **Session-summary `SessionPlan` and `FailureAnalysis` are typed fixtures** — those two have no `DataStore` accessor yet, so the screen reads them from constants while mastery and pending deltas come from the database.
