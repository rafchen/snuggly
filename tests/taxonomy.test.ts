import { describe, expect, it } from 'vitest'
import {
  CONFUSABLE_PAIRS,
  MECHANISMS,
  REDUNDANCIES,
  REDUNDANCY_TO_MECHANISM,
  SKILL_DAG,
  SKILL_NODE_IDS,
} from '@/lib/taxonomy'
import { FAILURE_CODES, FAILURE_RUNG, RUNG_PROMPTS } from '@/lib/types'

describe('taxonomy counts are the single reconciled numbers', () => {
  it('has exactly 24 mechanisms', () => {
    expect(MECHANISMS).toHaveLength(24)
  })

  it('has exactly 18 redundancies', () => {
    expect(REDUNDANCIES).toHaveLength(18)
  })

  it('has no duplicate mechanism ids', () => {
    expect(new Set(MECHANISMS).size).toBe(MECHANISMS.length)
  })

  it('has no duplicate redundancy ids', () => {
    expect(new Set(REDUNDANCIES).size).toBe(REDUNDANCIES.length)
  })
})

describe('redundancy → mechanism mapping', () => {
  it('covers every redundancy — the rung 3→4 hinge is total', () => {
    for (const r of REDUNDANCIES) {
      expect(REDUNDANCY_TO_MECHANISM[r], `missing mapping for ${r}`).toBeDefined()
      expect(REDUNDANCY_TO_MECHANISM[r].length).toBeGreaterThan(0)
    }
  })

  it('only maps to mechanisms in the closed list', () => {
    for (const [redundancy, mechanisms] of Object.entries(REDUNDANCY_TO_MECHANISM)) {
      for (const m of mechanisms) {
        expect(MECHANISMS, `${redundancy} → ${m}`).toContain(m)
      }
    }
  })
})

describe('confusable pairs', () => {
  it('reference only real mechanisms', () => {
    for (const [a, b] of CONFUSABLE_PAIRS) {
      expect(MECHANISMS).toContain(a)
      expect(MECHANISMS).toContain(b)
    }
  })

  it('never pairs a mechanism with itself', () => {
    for (const [a, b] of CONFUSABLE_PAIRS) {
      expect(a).not.toBe(b)
    }
  })
})

describe('skill DAG', () => {
  it('has unique node ids', () => {
    expect(new Set(SKILL_NODE_IDS).size).toBe(SKILL_NODE_IDS.length)
  })

  it('has no dangling prerequisites', () => {
    for (const node of SKILL_DAG) {
      for (const p of node.prereqs) {
        expect(SKILL_NODE_IDS, `${node.id} requires unknown node ${p}`).toContain(p)
      }
    }
  })

  it('is acyclic', () => {
    const state = new Map<string, 'visiting' | 'done'>()
    const byId = new Map(SKILL_DAG.map((n) => [n.id, n]))

    const visit = (id: string, trail: string[]): void => {
      const mark = state.get(id)
      if (mark === 'done') return
      if (mark === 'visiting') {
        throw new Error(`cycle: ${[...trail, id].join(' → ')}`)
      }
      state.set(id, 'visiting')
      for (const p of byId.get(id)?.prereqs ?? []) visit(p, [...trail, id])
      state.set(id, 'done')
    }

    expect(() => SKILL_DAG.forEach((n) => visit(n.id, []))).not.toThrow()
  })

  it('never lets a node depend on a later phase', () => {
    const byId = new Map(SKILL_DAG.map((n) => [n.id, n]))
    for (const node of SKILL_DAG) {
      for (const p of node.prereqs) {
        const prereq = byId.get(p)!
        expect(prereq.phase, `${node.id} (phase ${node.phase}) requires ${p} (phase ${prereq.phase})`).toBeLessThanOrEqual(node.phase)
      }
    }
  })

  it('routes DP through backtracking and memoization, never off arrays', () => {
    // Encodes the pedagogy: DP is reached by caching a recursive brute force,
    // never by memorizing recurrences. A learner admitted to DP without solid
    // backtracking produces endless F2/F3 and concludes they're bad at DP.
    const byId = new Map(SKILL_DAG.map((n) => [n.id, n]))
    const memoization = byId.get('memoization')!
    expect(memoization.prereqs).toContain('backtracking')

    const reaches = (from: string, target: string): boolean => {
      const seen = new Set<string>()
      const stack = [from]
      while (stack.length) {
        const id = stack.pop()!
        if (id === target) return true
        if (seen.has(id)) continue
        seen.add(id)
        stack.push(...(byId.get(id)?.prereqs ?? []))
      }
      return false
    }

    for (const node of SKILL_DAG.filter((n) => n.phase === 4 && n.id !== 'memoization')) {
      expect(reaches(node.id, 'memoization'), `${node.id} must reach memoization`).toBe(true)
      expect(reaches(node.id, 'backtracking'), `${node.id} must reach backtracking`).toBe(true)
      expect(node.prereqs, `${node.id} must not hang directly off arrays`).not.toContain('arrays_basics')
    }
  })
})

describe('failure taxonomy', () => {
  it('has six codes', () => {
    expect(FAILURE_CODES).toHaveLength(6)
  })

  it('maps every code to a rung', () => {
    for (const code of FAILURE_CODES) {
      expect(FAILURE_RUNG[code]).toBeGreaterThanOrEqual(1)
      expect(FAILURE_RUNG[code]).toBeLessThanOrEqual(6)
    }
  })
})

describe('rung prompts', () => {
  it('asks rung 3 about repeated work, never about pattern identity', () => {
    // Load-bearing: "what pattern is this?" is answerable only from memory,
    // which is the crutch the method exists to remove.
    expect(RUNG_PROMPTS[3].toLowerCase()).toContain('over and over')
    expect(RUNG_PROMPTS[3].toLowerCase()).not.toContain('what pattern')
  })

  it('defines a prompt for all six rungs', () => {
    for (const rung of [1, 2, 3, 4, 5, 6] as const) {
      expect(RUNG_PROMPTS[rung]?.length ?? 0).toBeGreaterThan(10)
    }
  })
})
