/**
 * /session — the post-mortem.
 *
 * Data comes from `./data`, never from a component.
 */

import { SessionSummary } from '@/components/SessionSummary'
import { loadSessionSummary } from './data'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Session summary — Cracked',
}

export default async function SessionPage() {
  const data = await loadSessionSummary()
  return <SessionSummary data={data} />
}
