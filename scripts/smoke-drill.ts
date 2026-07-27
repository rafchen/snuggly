/** Proves a drill item can be issued, answered and advanced across the action boundary. */
import { startRun, submitAnswer, advanceRun } from '../src/app/drill/drill-service'

async function main() {
  const r = await startRun()
  console.log(`started run ${r.runId}`)
  console.log(`  item 1/${r.payload.totalItems}: ${r.payload.item.problemId} (${r.payload.item.targetMechanism})`)

  const res = await submitAnswer(r.runId, r.payload.token, {
    mechanism: r.payload.item.targetMechanism,
    redundancy: 'it keeps rescanning the same overlapping range on every step',
  })
  console.log(`  submit -> ${res.kind}`)
  if (res.kind !== 'settled') throw new Error('expected the item to settle')
  console.log(`    score ${res.feedback.score}, elapsed ${res.feedback.elapsedSec}s (server-derived)`)
  console.log(`    feedback: ${res.feedback.line}`)

  const nxt = await advanceRun(r.runId)
  console.log(`  advance -> ${nxt.kind}${nxt.kind === 'next' ? `: ${nxt.payload.item.problemId}` : ''}`)
  if (nxt.kind !== 'next') throw new Error('expected a next item')
  console.log('\nDrill run survives the action boundary.')
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
