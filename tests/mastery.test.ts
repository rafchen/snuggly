import { describe, expect, it } from 'vitest'
import {
  applyEma,
  applyObservation,
  decay,
  decayState,
  decayVector,
  emptyMastery,
  isMastered,
  isUnlocked,
  meetsArticulationGate,
} from '@/lib/mastery'
import { EMA_ALPHA, HALF_LIFE_DAYS, type MasteryState } from '@/lib/types'

const DAY = 24 * 60 * 60 * 1000

function stateAt(node: string, v: Partial<MasteryState>, daysAgo = 0): MasteryState {
  return {
    node,
    recognition: 0,
    derivation: 0,
    implementation: 0,
    articulation: null,
    lastSeen: new Date(Date.now() - daysAgo * DAY),
    decayRate: 1,
    failureCodes: {},
    ...v,
  }
}

describe('EMA, alpha = 0.3', () => {
  it('blends prior and observation at the fixed alpha', () => {
    expect(applyEma(0.5, 1.0)).toBeCloseTo(0.65, 10)
    expect(applyEma(0.62, 0.8)).toBeCloseTo(EMA_ALPHA * 0.8 + 0.7 * 0.62, 10)
  })

  it('adopts the observation outright when there is no prior', () => {
    // A first observation must not be dragged toward an implicit zero.
    expect(applyEma(null, 0.8)).toBeCloseTo(0.8, 10)
    expect(applyEma(undefined, 0.42)).toBeCloseTo(0.42, 10)
  })

  it('stays inside [0,1]', () => {
    expect(applyEma(1, 1)).toBeLessThanOrEqual(1)
    expect(applyEma(0, 0)).toBeGreaterThanOrEqual(0)
  })

  it('is monotone in the observation', () => {
    expect(applyEma(0.5, 0.9)).toBeGreaterThan(applyEma(0.5, 0.1))
  })
})

describe('exponential decay', () => {
  it('halves at exactly one half-life', () => {
    expect(decay(1, 10, 10)).toBeCloseTo(0.5, 10)
    expect(decay(0.8, 21, 21)).toBeCloseTo(0.4, 10)
  })

  it('quarters at two half-lives', () => {
    expect(decay(1, 10, 20)).toBeCloseTo(0.25, 10)
  })

  it('is a no-op at zero elapsed days', () => {
    expect(decay(0.73, 10, 0)).toBeCloseTo(0.73, 10)
  })

  it('decays implementation fastest and recognition slowest', () => {
    // Syntax evaporates; pattern intuition is sticky. The ordering is the pedagogy.
    const days = 30
    const impl = decay(1, HALF_LIFE_DAYS.implementation, days)
    const der = decay(1, HALF_LIFE_DAYS.derivation, days)
    const rec = decay(1, HALF_LIFE_DAYS.recognition, days)
    expect(impl).toBeLessThan(der)
    expect(der).toBeLessThan(rec)
  })
})

describe('decay on read', () => {
  it('reports a stale implementation score far below its stored value', () => {
    const stale = stateAt('monotonic_stack', { implementation: 0.44 }, 30)
    const current = decayState(stale)
    // 0.44 at a 10-day half-life, 30 days on: 0.44 / 8
    expect(current.implementation).toBeCloseTo(0.055, 3)
  })

  it('never decays a null articulation into a number', () => {
    const v = decayVector(
      { recognition: 0.9, derivation: 0.8, implementation: 0.7, articulation: null },
      100,
    )
    expect(v.articulation).toBeNull()
  })

  it('does decay a measured articulation', () => {
    const v = decayVector(
      { recognition: 0.9, derivation: 0.8, implementation: 0.7, articulation: 0.6 },
      HALF_LIFE_DAYS.articulation,
    )
    expect(v.articulation).toBeCloseTo(0.3, 10)
  })

  it('does not mutate its input', () => {
    const original = stateAt('hashing', { recognition: 0.9 }, 40)
    const snapshot = { ...original }
    decayState(original)
    expect(original).toEqual(snapshot)
  })
})

describe('unlock and mastery gates', () => {
  it('unlocks a node when every prerequisite clears recognition 0.5', () => {
    const all = [
      stateAt('collections', { recognition: 0.9 }),
      stateAt('defaultdict', { recognition: 0.7 }),
    ]
    expect(isUnlocked('hashing', all)).toBe(true)
  })

  it('keeps a node locked when any prerequisite is short', () => {
    const all = [
      stateAt('collections', { recognition: 0.9 }),
      stateAt('defaultdict', { recognition: 0.49 }),
    ]
    expect(isUnlocked('hashing', all)).toBe(false)
  })

  it('keeps a node locked when a prerequisite has never been seen', () => {
    expect(isUnlocked('hashing', [])).toBe(false)
  })

  it('does not unlock an unknown node id', () => {
    expect(isUnlocked('not_a_real_node', [])).toBe(false)
  })

  it('masters on the three gated dimensions, ignoring articulation', () => {
    // Articulation gates Phase 5 exit only. A null must not block mastery here,
    // or every learner stalls at the first gate forever.
    expect(
      isMastered({ recognition: 0.86, derivation: 0.76, implementation: 0.71, articulation: null }),
    ).toBe(true)
  })

  it('withholds mastery when any gated dimension is short', () => {
    expect(
      isMastered({ recognition: 0.86, derivation: 0.74, implementation: 0.71, articulation: 0.9 }),
    ).toBe(false)
  })

  it('fails the articulation gate on null as unmeasured, never as zero', () => {
    expect(
      meetsArticulationGate({
        recognition: 1,
        derivation: 1,
        implementation: 1,
        articulation: null,
      }),
    ).toBe(false)
  })
})

describe('applyObservation', () => {
  it('decays the prior before blending, so a stale score is not over-credited', () => {
    const stale = stateAt('dp_1d', { derivation: 0.8 }, HALF_LIFE_DAYS.derivation)
    const updated = applyObservation(stale, 'derivation', 0.9)
    // prior decays 0.8 → 0.4, then EMA with 0.9 → 0.3*0.9 + 0.7*0.4 = 0.55
    expect(updated.derivation).toBeCloseTo(0.55, 6)
  })

  it('promotes a null articulation to a real number only when observed', () => {
    const fresh = emptyMastery('interview_sim')
    expect(fresh.articulation).toBeNull()
    const scored = applyObservation(fresh, 'articulation', 0.6)
    expect(scored.articulation).toBeCloseTo(0.6, 10)
  })

  it('leaves untargeted dimensions alone apart from decay', () => {
    const s = stateAt('trie', { recognition: 0.9, implementation: 0.5 })
    const updated = applyObservation(s, 'recognition', 1)
    expect(updated.implementation).toBeCloseTo(0.5, 6)
  })
})
