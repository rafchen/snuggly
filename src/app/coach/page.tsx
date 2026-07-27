/**
 * /coach — the Ladder, one problem, Commit Rule enforced.
 *
 * The session is created server-side. Which problem it walks is a planner decision;
 * until Track C wires the planner in, it comes from `COACH_PROBLEM_ID` in the mock
 * store, which is the only line that changes at integration.
 */

import { CoachLadder } from '@/components/CoachLadder'
import { startSession } from './coach-service'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Coach — Cracked',
}

export default async function CoachPage() {
  const view = await startSession()
  return <CoachLadder initial={view} />
}
