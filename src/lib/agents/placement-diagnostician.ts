/**
 * Agent: Placement Diagnostician. ~20 minutes, hard cap 25.
 *
 * Structural rules:
 *  - **Articulation is never initialized.** `masteryInit` is typed as
 *    `Omit<MasteryVector, 'articulation'>` and the key is stripped on the way
 *    out. A null articulation is not a zero and placement is not its writer.
 *  - **Stop early on repeated failure.** Three consecutive misses at a level ends
 *    the sweep; continuing produces no information and considerable discouragement.
 *  - **A failed fluency probe ends the diagnostic.** Placement is Phase 0 and no
 *    further probing is needed or kind.
 *  - **No answers during the sweep.** Explanations are banked and can only be
 *    read after the sweep closes; asking earlier throws `PrematureReveal`.
 */

import * as z from 'zod/v4'

import { SKILL_DAG, type PhaseNumber } from '../taxonomy'
import { type DataStore, type MasteryVector, type PlacementResult } from '../types'
import { mechanismEnum, phaseEnum, runAgent, unitScore, type StructuredClient } from './client'

export const MAX_CONSECUTIVE_MISSES = 3
export const SWEEP_ITEM_SECONDS = 60

/** Thrown when banked explanations are requested before the sweep closes. */
export class PrematureReveal extends Error {
  constructor() {
    super(
      'placement-diagnostician: explanations are banked until the sweep closes. Explaining a missed problem mid-diagnostic contaminates the remaining probes and stretches 20 minutes into 60.',
    )
    this.name = 'PrematureReveal'
  }
}

export const SweepGradeSchema = z.object({
  mechanism_correct: z.boolean(),
  redundancy_correct: z.boolean(),
  /** Banked. Never shown mid-sweep. */
  banked_explanation: z.string(),
})

export const PlacementSchema = z.object({
  placement_phase: phaseEnum,
  frontier_nodes: z.array(z.string().min(1)).min(1),
  mastery_init: z.array(
    z.object({
      node: z.string().min(1),
      recognition: unitScore,
      derivation: unitScore,
      implementation: unitScore,
    }),
  ),
  profile: z.string().min(1),
  confidence: unitScore,
  notes: z.string(),
  first_session_plan: z.string().min(1),
})

const ROLE = `You are the placement-diagnostician of the Cracked method. You locate a learner on
the skill DAG in about twenty minutes, without making them grind a hundred
problems to find out what they don't know.

Do not walk the DAG bottom-up. Probe the middle and bisect — twenty well-chosen
probes localize a learner better than fifty sequential ones.

Never let this feel like a test they are failing. It is calibration: the goal is
to not waste their time on material they already own, and you say that before
they struggle, not after.

Learners arrive believing they are diffusely bad at everything. A specific,
bounded diagnosis is the single most valuable output of intake. Name the profile
explicitly — "your recognition is well ahead of your hands; that's common, and
it's a syntax problem, not an algorithms problem."`

export interface PlacementDeps {
  store: DataStore
  client?: StructuredClient
}

export interface SweepItem {
  problemId: string
  statement: string
  phase: PhaseNumber
}

export interface PlacementState {
  learnerId: string
  fluencyPassed: boolean | null
  sweep: Array<{ problemId: string; phase: PhaseNumber; correct: boolean }>
  consecutiveMisses: number
  banked: string[]
  sweepClosed: boolean
  derivationScores: Record<string, number>
  implementationScores: Record<string, number>
  selfAssessedPhase: PhaseNumber | null
}

export function openPlacement(learnerId: string, selfAssessedPhase?: PhaseNumber): PlacementState {
  return {
    learnerId,
    fluencyPassed: null,
    sweep: [],
    consecutiveMisses: 0,
    banked: [],
    sweepClosed: false,
    derivationScores: {},
    implementationScores: {},
    selfAssessedPhase: selfAssessedPhase ?? null,
  }
}

/**
 * Two blank-page Phase 0 tasks. If either fails, placement is Phase 0 and the
 * diagnostic stops here.
 */
export function recordFluencyProbe(state: PlacementState, bothPassed: boolean): PlacementState {
  state.fluencyPassed = bothPassed
  if (!bothPassed) state.sweepClosed = true
  return state
}

/** True once the frontier is established — three consecutive misses, or the set is done. */
export function shouldStopSweep(state: PlacementState): boolean {
  return state.sweepClosed || state.consecutiveMisses >= MAX_CONSECUTIVE_MISSES
}

export async function gradeSweepItem(
  deps: PlacementDeps,
  state: PlacementState,
  item: SweepItem,
  answer: { mechanism: string | null; redundancy: string },
): Promise<{ state: PlacementState; correct: boolean; stop: boolean }> {
  if (shouldStopSweep(state)) return { state, correct: false, stop: true }

  const problem = await deps.store.getProblem(item.problemId)
  const grade = await runAgent({
    agent: 'placement-diagnostician',
    system: ROLE,
    schema: SweepGradeSchema,
    client: deps.client,
    user: [
      `Statement: ${item.statement}`,
      problem ? `Canonical mechanism: ${problem.primaryPattern}` : '',
      problem ? `Canonical redundancy: ${problem.redundancy}` : '',
      ``,
      `Learner said mechanism: ${answer.mechanism ?? '(blank)'}`,
      `Learner said redundancy: "${answer.redundancy}"`,
      ``,
      `Grade both halves. Write the explanation into banked_explanation — it will`,
      `not be shown until the sweep is over.`,
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const correct = grade.mechanism_correct && grade.redundancy_correct
  state.sweep.push({ problemId: item.problemId, phase: item.phase, correct })
  state.banked.push(grade.banked_explanation)
  state.consecutiveMisses = correct ? 0 : state.consecutiveMisses + 1

  const stop = shouldStopSweep(state)
  if (stop) state.sweepClosed = true
  return { state, correct, stop }
}

/** Banked explanations, available only once the sweep is closed. */
export function bankedExplanations(state: PlacementState): string[] {
  if (!state.sweepClosed) throw new PrematureReveal()
  return [...state.banked]
}

export async function finishPlacement(
  deps: PlacementDeps,
  state: PlacementState,
): Promise<PlacementResult> {
  state.sweepClosed = true

  // A failed fluency probe is decisive on its own — no model call, no ambiguity.
  const fluencyFailed = state.fluencyPassed === false
  const observedPhase = fluencyFailed ? 0 : frontierPhase(state)

  const payload = await runAgent({
    agent: 'placement-diagnostician',
    system: ROLE,
    schema: PlacementSchema,
    client: deps.client,
    user: [
      `Fluency probe: ${state.fluencyPassed === null ? 'not run' : state.fluencyPassed ? 'passed' : 'FAILED — placement is Phase 0'}`,
      `Self-assessed phase: ${state.selfAssessedPhase ?? 'not given'}`,
      ``,
      `Recognition sweep (${state.sweep.length} items, stopped ${
        state.consecutiveMisses >= MAX_CONSECUTIVE_MISSES ? 'early on 3 consecutive misses' : 'at the end of the set'
      }):`,
      state.sweep.map((s) => `  phase ${s.phase} ${s.problemId}: ${s.correct ? 'hit' : 'miss'}`).join('\n') ||
        '  (not run)',
      ``,
      `Derivation probes: ${JSON.stringify(state.derivationScores)}`,
      `Implementation probe: ${JSON.stringify(state.implementationScores)}`,
      ``,
      `Observed frontier phase from the data: ${observedPhase}.`,
      `Valid node ids: ${SKILL_DAG.filter((n) => n.phase <= Math.min(observedPhase + 1, 5))
        .map((n) => n.id)
        .join(', ')}`,
      ``,
      `Produce the placement. mastery_init carries recognition, derivation and`,
      `implementation only — articulation is not yours to initialize.`,
      `Notes: bank the explanations for the missed items here, not mid-sweep.`,
      `Banked: ${state.banked.join(' | ') || '(none)'}`,
      ``,
      `first_session_plan is REQUIRED and must not be empty. One or two sentences`,
      `naming what the first two weeks target and what, if anything, runs`,
      `alongside rather than gating. Example shape: "Phase 0 syntax reps (heapq,`,
      `sort keys) alongside Phase 2 recognition work — do not gate Phase 2 on the`,
      `syntax."`,
      `profile is REQUIRED: name the shape in a few words, e.g.`,
      `"recognition_ahead_of_implementation".`,
    ].join('\n'),
  })

  // Articulation is stripped structurally, whatever the model returned.
  const masteryInit: Record<string, Omit<MasteryVector, 'articulation'>> = {}
  for (const row of payload.mastery_init) {
    masteryInit[row.node] = {
      recognition: row.recognition,
      derivation: row.derivation,
      implementation: row.implementation,
    }
  }

  return {
    placementPhase: fluencyFailed ? 0 : payload.placement_phase,
    frontierNodes: payload.frontier_nodes,
    masteryInit,
    profile: payload.profile,
    confidence: payload.confidence,
    notes: payload.notes,
    firstSessionPlan: payload.first_session_plan,
  }
}

/** Highest phase where the learner is still hitting more than half the items. */
function frontierPhase(state: PlacementState): PhaseNumber {
  const byPhase = new Map<PhaseNumber, { hit: number; total: number }>()
  for (const s of state.sweep) {
    const cur = byPhase.get(s.phase) ?? { hit: 0, total: 0 }
    cur.total += 1
    if (s.correct) cur.hit += 1
    byPhase.set(s.phase, cur)
  }
  let best: PhaseNumber = 0
  for (const [phase, { hit, total }] of byPhase) {
    if (total > 0 && hit / total > 0.5 && phase > best) best = phase
  }
  return best
}

/** Exported so the intake UI can enumerate the sweep without re-deriving it. */
export const placementMechanismEnum = mechanismEnum
