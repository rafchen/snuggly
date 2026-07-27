'use server'

/**
 * Server actions for the coach.
 *
 * The service throws `CommitRuleViolation` — that throw is the invariant and it is
 * not softened here. What this layer does is catch it at the boundary so the browser
 * can render the reason instead of a generic error page. The rule already ran and
 * already refused; this only decides how the refusal reads.
 */

import { CommitRuleViolation } from '@/lib/types'
import { logHypothesis, releaseHint, type CoachActionResult } from './coach-service'

function refusal(e: unknown): CoachActionResult {
  if (e instanceof CommitRuleViolation) {
    return { ok: false, message: e.message, commitRuleViolation: true }
  }
  return {
    ok: false,
    message: e instanceof Error ? e.message : 'That did not go through.',
    commitRuleViolation: false,
  }
}

export async function logHypothesisAction(
  sessionId: string,
  text: string,
): Promise<CoachActionResult> {
  try {
    return { ok: true, view: await logHypothesis(sessionId, text) }
  } catch (e) {
    return refusal(e)
  }
}

export async function requestHintAction(
  sessionId: string,
  reason: string | null,
): Promise<CoachActionResult> {
  try {
    return { ok: true, view: await releaseHint(sessionId, reason) }
  } catch (e) {
    return refusal(e)
  }
}
