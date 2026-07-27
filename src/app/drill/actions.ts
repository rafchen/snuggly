'use server'

/**
 * Server actions for the drill.
 *
 * Note what these signatures do NOT accept: an elapsed time, a deadline, or a
 * timestamp of any kind. The scored duration is derived inside `drill-service` from
 * the timestamp the server wrote at issuance, so there is no parameter through which
 * a client clock could reach the score.
 */

import type { DrillAnswer } from '@/lib/types'
import {
  advanceRun,
  expireItem,
  startRun,
  submitAnswer,
  type AdvanceResult,
  type SettleResult,
} from './drill-service'

export async function startDrillRunAction() {
  return startRun()
}

export async function submitDrillAnswerAction(
  runId: string,
  token: string,
  answer: DrillAnswer,
): Promise<SettleResult> {
  return submitAnswer(runId, token, answer)
}

export async function expireDrillItemAction(
  runId: string,
  token: string,
  partial: DrillAnswer,
): Promise<SettleResult> {
  return expireItem(runId, token, partial)
}

export async function advanceDrillRunAction(runId: string): Promise<AdvanceResult> {
  return advanceRun(runId)
}
