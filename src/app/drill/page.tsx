/**
 * /drill — the timed recognition drill.
 *
 * The run is started here, on the server, and the first item's timestamp is written
 * at that moment. `force-dynamic` is not a performance choice: a cached render would
 * hand a stale issuance timestamp to a later learner, and the timestamp is scoring
 * input, not chrome.
 */

import { DrillRunner, DrillUnavailable } from '@/components/DrillRunner'
import { startRun } from './drill-service'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Recognition drill — Cracked',
}

export default async function DrillPage() {
  try {
    const { runId, payload } = await startRun()
    return <DrillRunner runId={runId} initial={payload} />
  } catch (e) {
    return (
      <DrillUnavailable
        reason={e instanceof Error ? e.message : 'The problem library returned nothing drillable.'}
      />
    )
  }
}
