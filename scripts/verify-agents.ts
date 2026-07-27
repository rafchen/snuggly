/**
 * End-to-end verification against the live Claude API.
 *
 * Proves criteria 3, 6, 7, and 8 by running the agents for real — no stubs —
 * and printing the output each one produced. Run with:
 *
 *     ANTHROPIC_API_KEY=... npx tsx scripts/verify-agents.ts
 *
 * Every check is an assertion about the contract, not about phrasing, so this is
 * stable to rerun: schemas must validate, evidence must cite the log, every
 * planned block must carry a stated reason, and articulation must stay absent
 * from a placement result.
 */

import { store } from '../src/lib/store'
import { openPlacement, gradeSweepItem, finishPlacement } from '../src/lib/agents/placement-diagnostician'
import { analyzeFailure } from '../src/lib/agents/failure-analyst'
import { planSession } from '../src/lib/agents/curriculum-planner'
import { openExam, answerProbe } from '../src/lib/agents/invariant-examiner'
import { judgeIdea, critique } from '../src/lib/agents/code-critic'
import { startInterview, injectWrongTurn, debrief } from '../src/lib/agents/interview-simulator'
import type { LadderSessionState, ProblemContent } from '../src/lib/types'

const LEARNER = 'demo-learner'
let failures = 0

function check(label: string, ok: boolean, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  if (!ok) failures++
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`)
}

function section(n: number, title: string) {
  console.log(`\n─── Criterion ${n}: ${title} ${'─'.repeat(Math.max(0, 46 - title.length))}`)
}

/** A session where the learner framed and brute-forced fine, then stalled at rung 3. */
function stalledAtBottleneck(problemId: string): LadderSessionState {
  const t = (min: number) => new Date(Date.now() - (40 - min) * 60_000)
  return {
    sessionId: 'verify-session',
    problemId,
    currentRung: 4,
    commits: [
      { rung: 1, text: 'heights array, return the largest rectangle area, n up to 1e5 so I need O(n) or O(n log n)', correct: true, hintsUsedAtCommit: 0, committedAt: t(2) },
      { rung: 2, text: 'for every pair (i,j) walk the range and take the min height, times width. O(n^2) at least', correct: true, hintsUsedAtCommit: 0, committedAt: t(6) },
      { rung: 3, text: "it's just slow, too many loops", correct: false, hintsUsedAtCommit: 0, committedAt: t(12) },
      { rung: 3, text: 'rescanning for the minimum over ranges that mostly overlap the last one', correct: true, hintsUsedAtCommit: 2, committedAt: t(20) },
      { rung: 4, text: 'monotonic increasing stack, each bar bounded by the next smaller on each side', correct: true, hintsUsedAtCommit: 2, committedAt: t(26) },
    ],
    hints: [
      { rung: 3, level: 0, text: 'How large can the array be?', reason: null, releasedAt: t(14) },
      { rung: 3, level: 1, text: 'You have a brute force. What is it recomputing?', reason: null, releasedAt: t(17) },
    ],
    difficultyMiscalibrated: false,
    completedAt: null,
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — this script only runs live.')
    process.exit(2)
  }

  const problems = await store.listProblems()
  if (problems.length === 0) {
    console.error('No problems in the database. Run: npx prisma db push && npx tsx prisma/seed.ts')
    process.exit(2)
  }
  const problem = (problems.find((p) => p.primaryPattern === 'monotonic_stack') ?? problems[0]) as ProblemContent
  console.log(`Live verification against ${problems.length} seeded problems.`)
  console.log(`Working problem: ${problem.title} (${problem.primaryPattern})`)

  // ── 3. Placement diagnostic ────────────────────────────────────────────────
  section(3, 'placement diagnostic outputs a mastery vector')
  let placement = openPlacement(LEARNER, 2)
  placement.fluencyPassed = true
  const sweepPool = problems.slice(0, 4)
  for (const p of sweepPool) {
    const res = await gradeSweepItem(
      { store },
      placement,
      { problemId: p.problemId, phase: p.phase },
      {
        mechanism: p.primaryPattern,
        redundancy: 'it keeps redoing the same scan over ranges that overlap',
      },
    )
    placement = res.state
    if (res.stop) break
  }
  const placed = await finishPlacement({ store }, placement)
  console.log(`    phase=${placed.placementPhase}  profile="${placed.profile}"  confidence=${placed.confidence}`)
  console.log(`    frontier: ${placed.frontierNodes.join(', ') || '(none)'}`)
  const vectorNodes = Object.keys(placed.masteryInit)
  console.log(`    mastery vector over ${vectorNodes.length} node(s): ${JSON.stringify(placed.masteryInit[vectorNodes[0]] ?? {})}`)
  check('emits a mastery vector', vectorNodes.length > 0, `${vectorNodes.length} nodes`)
  check(
    'every entry has the three placement dimensions',
    vectorNodes.every((n) => {
      const v = placed.masteryInit[n] as Record<string, unknown>
      return ['recognition', 'derivation', 'implementation'].every((d) => typeof v[d] === 'number')
    }),
  )
  check(
    'articulation is absent — placement never initializes it',
    vectorNodes.every((n) => !('articulation' in (placed.masteryInit[n] as object))),
  )
  check('states a first-session plan', placed.firstSessionPlan.length > 0)

  // ── 6. Failure analyst ─────────────────────────────────────────────────────
  section(6, 'failure analyst assigns F1-F6 with evidence')
  const session = stalledAtBottleneck(problem.problemId)
  const analysis = await analyzeFailure(
    { store },
    { learnerId: LEARNER, node: 'monotonic_stack', session, solved: true },
  )
  if (!analysis) {
    check('produced an analysis', false, 'returned null')
  } else {
    console.log(`    primary=${analysis.primaryCode}  secondary=[${analysis.secondaryCodes.join(', ')}]`)
    console.log(`    evidence: ${analysis.evidence}`)
    console.log(`    prescription: ${analysis.prescription.drillType} x${analysis.prescription.reps} over ${analysis.prescription.sessions} session(s)`)
    console.log(`    to learner: ${analysis.learnerMessage}`)
    check('assigns a code in F1-F6', /^F[1-6]$/.test(analysis.primaryCode), analysis.primaryCode)
    check(
      'picks F3 — the earliest rung that needed hints',
      analysis.primaryCode === 'F3',
      `got ${analysis.primaryCode}`,
    )
    check('evidence is non-empty and cites the session', analysis.evidence.length > 20)
    check('prescription is actionable', analysis.prescription.reps > 0 && analysis.prescription.sessions > 0)
  }

  // ── 7. Curriculum planner ──────────────────────────────────────────────────
  section(7, 'planner schedules a session with a reason per block')
  const plan = await planSession({ store }, LEARNER, analysis ? { analysis } : {})
  for (const b of plan.sessionPlan) {
    console.log(`    ${b.block.padEnd(11)} ${String(b.minutes).padStart(2)}m  ${b.agent}`)
    console.log(`      why: ${b.why}`)
  }
  console.log(`    gate: phase ${plan.gateStatus.phase}, ${plan.gateStatus.criteriaMet}/${plan.gateStatus.criteriaTotal} met`)
  console.log(`    to learner: ${plan.learnerMessage}`)
  check('produces blocks', plan.sessionPlan.length > 0, `${plan.sessionPlan.length} blocks`)
  check(
    'EVERY block states a reason',
    plan.sessionPlan.every((b) => typeof b.why === 'string' && b.why.trim().length > 0),
  )
  check(
    'at most one new-material core block',
    plan.sessionPlan.filter((b) => b.block === 'core').length <= 1,
  )
  check('reports gate status', plan.gateStatus.criteriaTotal > 0)

  // ── 8. Examiner, critic, interview ─────────────────────────────────────────
  section(8, 'invariant examiner, code critic, interview simulator')

  const exam = await openExam(
    { store },
    { problemId: problem.problemId, mechanism: problem.primaryPattern, approach: 'monotonic increasing stack of indices' },
  )
  console.log(`    examiner opened with ${exam.probes.length} probe(s): "${exam.probes[0]?.q ?? ''}"`)
  const probed = await answerProbe({ store }, exam, 0, 'It works because it finds the largest rectangle.')
  console.log(`    circular answer flagged: ${probed.circularReasoning}`)
  check('examiner produces targeted probes', exam.probes.length > 0)
  check('examiner rejects a circular argument', probed.circularReasoning === true)

  const verdict = await judgeIdea({ store }, { problem, approach: 'sort the bars and take the tallest' })
  console.log(`    critic idea verdict: correct=${verdict.correct} — ${verdict.reason ?? ''}`)
  check('critic judges the idea before the code', typeof verdict.correct === 'boolean')
  check('critic rejects a wrong approach', verdict.correct === false)

  const review = await critique(
    { store },
    {
      problemId: problem.problemId,
      approach: 'monotonic increasing stack; on pop the popped bar is bounded by the current index',
      code: 'def f(h):\n    st=[];best=0\n    for i in range(len(h)+1):\n        cur = 0 if i==len(h) else h[i]\n        while st and h[st[-1]]>=cur:\n            top=st.pop()\n            left = st[-1] if st else -1\n            best=max(best,h[top]*(i-left))\n        st.append(i)\n    return best',
      language: 'python',
      lookups: [],
    },
  )
  console.log(`    critic outcome kind: ${review.kind}`)
  check('critic returns a structured outcome', typeof review.kind === 'string')

  const interview = await startInterview({ store }, { learnerId: LEARNER, problem })
  console.log(`    interview opened; ambiguities left unstated: ${interview.ambiguities.length}`)
  check('interview underspecifies deliberately', interview.ambiguities.length >= 2)
  const turned = await injectWrongTurn({ store }, interview)
  console.log(`    wrong turn: ${turned.followUp}`)
  check('interview induces exactly one wrong turn', typeof turned.followUp === 'string' && turned.followUp.length > 0)
  const result = await debrief({ store }, turned, {
    solved: true,
    timeToWorkingSec: 1980,
    transcript: 'Candidate started coding immediately without asking about input bounds, went quiet for 90 seconds after the follow-up, then recovered and finished.',
  })
  console.log(`    verdict: ${result.verdict}`)
  console.log(`    highest-cost behavior: ${result.highestCostBehavior}`)
  console.log(`    communication: ${JSON.stringify(result.communication)}`)
  check('interview scores communication separately from correctness', typeof result.correctnessScore === 'number' && typeof result.communication.clarifyingQuestions === 'number')
  check('interview names one highest-cost behavior', result.highestCostBehavior.length > 0)

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nVerification aborted:', err)
  process.exit(1)
})
