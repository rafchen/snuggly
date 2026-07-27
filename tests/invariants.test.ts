/**
 * Criterion 10's two named tests.
 *
 * Both assert the guarantees are IMPOSSIBLE to violate, not merely instructed.
 * The distinction matters: an LLM told "never hint before a commit" complies
 * almost always, and almost always is not what impossible means.
 *
 * So the hint tests inject a client that THROWS if it is ever invoked. A passing
 * test therefore proves two things at once — the request was refused, and the
 * refusal happened in our code, before any model got a chance to be persuaded
 * by a learner insisting they are frustrated or short on time.
 */

import { describe, expect, it } from 'vitest'
import {
  HintLadderViolation,
  RungOrderViolation,
  assertHintLevel,
  assertRungOrder,
  requestHint,
  submitCommit,
} from '@/lib/agents/socratic-coach'
import { MockDataStore, makeProblem } from '@/lib/agents/mock-store'
import { assertInterleaved, mulberry32, selectDrillItems } from '@/lib/interleave'
import { MECHANISMS } from '@/lib/taxonomy'
import {
  CommitRuleViolation,
  InterleavingViolation,
  type DrillItem,
  type LadderSessionState,
  type Mechanism,
  type ProblemContent,
  type RungNumber,
} from '@/lib/types'

/** Fails the test if the runtime ever reaches the model. */
const exploding = {
  messages: {
    parse: async () => {
      throw new Error('UNREACHABLE: the model was called despite a refusal being due')
    },
  },
}

/**
 * A stub returning a superset object that satisfies both CommitEvaluationSchema
 * and HintDraftSchema, so commits and hints can be exercised without network.
 * Every field the runtime actually gates on is computed by our code, not here.
 */
function grader(correct: boolean) {
  return {
    messages: {
      parse: async () => ({
        parsed_output: {
          // CommitEvaluationSchema
          rung: 1,
          commit: 'logged',
          correct,
          response: correct ? 'That holds. Move on.' : 'Not yet — that names the goal, not the waste.',
          clean_derivation: correct,
          // HintDraftSchema
          level: 0,
          text: HINTS[0],
          reason: null,
        },
      }),
    },
  }
}

const HINTS = [
  'How large can the array be?',
  'You have a brute force. What is it recomputing?',
  'For each bar you rescan both sides. Every time.',
  'You are recomputing max-so-far over overlapping ranges.',
  'Precompute those maxima, or converge two pointers from the ends.',
  'One at each end, tracking left_max and right_max. Why is moving the smaller side safe?',
  'Full derivation of all six rungs.',
]

async function seededCoach() {
  const store = new MockDataStore().seedProblems([
    makeProblem({ problemId: 'p1', primaryPattern: 'monotonic_stack', hints: HINTS }),
  ])
  const state = await store.createLadderSession('learner-1', 'p1')
  return { store, state }
}

/** Hand-build a session state, so the pure guards can be probed directly. */
function stateWith(over: Partial<LadderSessionState>): LadderSessionState {
  return {
    sessionId: 's',
    problemId: 'p1',
    currentRung: 1,
    commits: [],
    hints: [],
    difficultyMiscalibrated: false,
    completedAt: null,
    ...over,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('criterion 10 — a hint cannot be obtained without a prior commit', () => {
  it('refuses a hint when the commit log is empty, without calling the model', async () => {
    const { store, state } = await seededCoach()
    await expect(
      requestHint({ store, client: exploding }, { sessionId: state.sessionId, rung: 1 }),
    ).rejects.toBeInstanceOf(CommitRuleViolation)
  })

  it('still refuses when the learner committed at a DIFFERENT rung', async () => {
    // Commits do not transfer. A hypothesis at rung 1 buys nothing at rung 3.
    const { store, state } = await seededCoach()
    await submitCommit({ store, client: grader(true) }, state.sessionId, 1, 'n <= 2e4, return units')

    await expect(
      requestHint({ store, client: exploding }, { sessionId: state.sessionId, rung: 3 }),
    ).rejects.toBeInstanceOf(CommitRuleViolation)
  })

  it('releases a hint once a hypothesis is logged — and a WRONG one is enough', async () => {
    // The gate is falsifiability, not correctness. A wrong commit is the more
    // valuable record: a labeled example of this learner's misconception.
    const { store, state } = await seededCoach()
    await submitCommit({ store, client: grader(false) }, state.sessionId, 1, "idk, it's just slow")

    const { hint } = await requestHint(
      { store, client: grader(false) },
      { sessionId: state.sessionId, rung: 1 },
    )
    expect(hint.level).toBe(0)
  })

  it('refuses to skip hint levels', () => {
    // Jumping 1 → 4 collapses four levels into one and destroys the diagnostic:
    // we would no longer know whether the learner could have found it themselves.
    const s = stateWith({
      commits: [{ rung: 1, text: 'x', correct: false, hintsUsedAtCommit: 0, committedAt: new Date() }],
      hints: [{ rung: 1, level: 0, text: HINTS[0], reason: null, releasedAt: new Date() }],
    })
    expect(() => assertHintLevel(s, 1, 4, null)).toThrow(HintLadderViolation)
    expect(() => assertHintLevel(s, 1, 1, null)).not.toThrow()
  })

  it('refuses the full derivation unless a reason is stated', () => {
    // Level 6 is a legitimate outcome, but it must be logged with a cause so the
    // planner can correct its difficulty calibration.
    const s = stateWith({
      commits: [{ rung: 1, text: 'x', correct: false, hintsUsedAtCommit: 0, committedAt: new Date() }],
      hints: [0, 1, 2, 3, 4, 5].map((level) => ({
        rung: 1 as RungNumber,
        level: level as 0,
        text: HINTS[level],
        reason: null,
        releasedAt: new Date(),
      })),
    })
    expect(() => assertHintLevel(s, 1, 6, null)).toThrow(HintLadderViolation)
    expect(() => assertHintLevel(s, 1, 6, 'out of time; problem was above level')).not.toThrow()
  })

  it('refuses to skip rung 2, even when the learner claims to know the answer', () => {
    // Skipping brute force skips the thing the fast solution optimizes away from.
    const s = stateWith({
      commits: [{ rung: 1, text: 'framed', correct: true, hintsUsedAtCommit: 0, committedAt: new Date() }],
    })
    expect(() => assertRungOrder(s, 4)).toThrow(RungOrderViolation)
  })

  it('refuses a rung-2 skip through the real runtime path too', async () => {
    const { store, state } = await seededCoach()
    await submitCommit({ store, client: grader(true) }, state.sessionId, 1, 'framed it')

    await expect(
      submitCommit(
        { store, client: exploding },
        state.sessionId,
        4,
        "it's a monotonic stack, I've seen this one",
      ),
    ).rejects.toBeInstanceOf(RungOrderViolation)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('criterion 10 — blocked (non-interleaved) sequences are impossible', () => {
  const mechanisms = MECHANISMS.slice(0, 8) as Mechanism[]

  function pool(perMechanism = 4): ProblemContent[] {
    const out: ProblemContent[] = []
    for (const m of mechanisms) {
      for (let i = 0; i < perMechanism; i++) {
        out.push(makeProblem({ problemId: `${m}-${i}`, primaryPattern: m }))
      }
    }
    return out
  }

  function drillItem(m: Mechanism, id: string): DrillItem {
    return {
      problemId: id,
      statement: `A problem exercising ${m}.`,
      disguiseLevel: 1,
      targetMechanism: m,
      targetRedundancy: 'reseeking_membership',
      isDueReview: false,
      hasMisleadingFingerprint: false,
    }
  }

  it('never emits two consecutive items of the same mechanism, across 50 seeds', () => {
    // Blocked practice inflates in-session accuracy and destroys transfer: when
    // every item is a sliding-window item, the recognition step is given away.
    for (let seed = 1; seed <= 50; seed++) {
      const selected = selectDrillItems({ pool: pool(), count: 10, rng: mulberry32(seed) })
      expect(selected).toHaveLength(10)
      for (let i = 1; i < selected.length; i++) {
        expect(
          selected[i].targetMechanism,
          `seed ${seed}: items ${i - 1} and ${i} are both ${selected[i].targetMechanism}`,
        ).not.toBe(selected[i - 1].targetMechanism)
      }
    }
  })

  it('throws rather than emitting a blocked run when the pool cannot be interleaved', () => {
    // A single-mechanism pool CANNOT produce a legal sequence of 3. The engine
    // must refuse, not quietly degrade into serving a blocked run.
    const oneMechanism = [0, 1, 2].map((i) =>
      makeProblem({ problemId: `only-${i}`, primaryPattern: 'hashing' }),
    )
    expect(() =>
      selectDrillItems({ pool: oneMechanism, count: 3, rng: mulberry32(7) }),
    ).toThrow(InterleavingViolation)
  })

  it('assertInterleaved rejects a hand-built blocked sequence', () => {
    // Independently callable, so nothing can build a sequence, bypass the
    // selector, and hand a blocked run to the runtime unchecked.
    const blocked = [drillItem('hashing', 'a'), drillItem('hashing', 'b')]
    expect(() => assertInterleaved(blocked)).toThrow(InterleavingViolation)
  })

  it('accepts a legal alternating sequence', () => {
    const legal = [drillItem('hashing', 'a'), drillItem('prefix_sums', 'b'), drillItem('hashing', 'c')]
    expect(() => assertInterleaved(legal)).not.toThrow()
  })

  it('is deterministic for a given seed', () => {
    const a = selectDrillItems({ pool: pool(), count: 10, rng: mulberry32(42) })
    const b = selectDrillItems({ pool: pool(), count: 10, rng: mulberry32(42) })
    expect(a.map((i) => i.problemId)).toEqual(b.map((i) => i.problemId))
  })
})
