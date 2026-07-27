/**
 * The only place the session screen fetches anything.
 *
 * Components receive a `SessionSummary` and render it; none of them import a store.
 * At integration, the three sources below are repointed and no component changes:
 *   - mastery and pending deltas already come from the `DataStore`
 *   - the plan comes from `curriculum-planner`
 *   - the failure analysis comes from `failure-analyst`
 */

import type { FailureAnalysis, MasteryDelta, MasteryState, SessionPlan } from '@/lib/types'
import { EMA_ALPHA } from '@/lib/types'
import {
  MOCK_FAILURE_ANALYSIS,
  MOCK_LEARNER_ID,
  MOCK_SESSION_PLAN,
  store,
} from '@/lib/ui-store'

export interface DeltaRow {
  delta: MasteryDelta
  /** Current value on that node/dimension, or null if the dimension is unset. */
  prior: number | null
  /** What the value becomes once the planner applies the delta. Nobody else may. */
  projected: number | null
}

export interface SessionSummary {
  plan: SessionPlan
  failure: FailureAnalysis
  mastery: MasteryState[]
  deltas: DeltaRow[]
}

export async function loadSessionSummary(
  learnerId: string = MOCK_LEARNER_ID,
): Promise<SessionSummary> {
  const [mastery, pending] = await Promise.all([
    store.getAllMastery(learnerId),
    store.pendingDeltas(learnerId),
  ])

  const deltas: DeltaRow[] = pending.map((delta) => {
    const node = mastery.find((m) => m.node === delta.node)
    const prior = node ? node[delta.dimension] : null
    // EMA_ALPHA is fixed by the contract; this is a projection for display, not a write.
    const projected = prior === null ? null : EMA_ALPHA * delta.observed + (1 - EMA_ALPHA) * prior
    return { delta, prior, projected }
  })

  return {
    plan: MOCK_SESSION_PLAN,
    failure: MOCK_FAILURE_ANALYSIS,
    mastery,
    deltas,
  }
}
