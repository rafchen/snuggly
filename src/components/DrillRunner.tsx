'use client'

/**
 * The recognition drill, client side.
 *
 * What this component owns: what is drawn, and blocking an incomplete submit.
 * What it does not own: the clock that scores, correctness, and the feedback line.
 * All three come back from the server. The component holds no timing state that any
 * server action reads.
 */

import { useCallback, useState, useTransition } from 'react'
import Link from 'next/link'
import type { DrillAnswer, DrillSessionResult, Mechanism } from '@/lib/types'
import type { DrillFeedback, DrillItemPayload } from '@/app/drill/drill-service'
import {
  advanceDrillRunAction,
  expireDrillItemAction,
  submitDrillAnswerAction,
} from '@/app/drill/actions'
import { Countdown } from './Countdown'
import { MechanismPicker } from './MechanismPicker'
import { MECHANISM_LABEL } from './labels'
import styles from './DrillRunner.module.css'

type Phase =
  | { kind: 'answering' }
  | { kind: 'feedback'; feedback: DrillFeedback; itemsRemaining: number }
  | { kind: 'done'; summary: DrillSessionResult }

const EMPTY = { mechanism: null as Mechanism | null, redundancy: '' }

export function DrillRunner({
  runId,
  initial,
}: {
  runId: string
  initial: DrillItemPayload
}) {
  const [payload, setPayload] = useState<DrillItemPayload>(initial)
  const [answer, setAnswer] = useState<{ mechanism: Mechanism | null; redundancy: string }>(EMPTY)
  const [phase, setPhase] = useState<Phase>({ kind: 'answering' })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const mechanismMissing = answer.mechanism === null
  const redundancyMissing = answer.redundancy.trim() === ''
  const canSubmit = !mechanismMissing && !redundancyMissing && !pending && phase.kind === 'answering'

  const currentAnswer = (): DrillAnswer => ({
    mechanism: answer.mechanism,
    redundancy: answer.redundancy,
  })

  const submit = () => {
    // Mirrors the server's own precondition. Both checks exist; neither is alone.
    if (!canSubmit) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await submitDrillAnswerAction(runId, payload.token, currentAnswer())
        if (result.kind === 'still-running') {
          setPayload(result.payload)
          return
        }
        setPhase({ kind: 'feedback', feedback: result.feedback, itemsRemaining: result.itemsRemaining })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That submission did not go through.')
      }
    })
  }

  /**
   * The display clock hit zero. This is a request to the server, not a verdict — if
   * the server's own elapsed says time remains, it hands the item back and we resync.
   */
  const expire = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await expireDrillItemAction(runId, payload.token, currentAnswer())
        if (result.kind === 'still-running') {
          setPayload(result.payload)
          return
        }
        setPhase({ kind: 'feedback', feedback: result.feedback, itemsRemaining: result.itemsRemaining })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The item could not be closed out.')
      }
    })
    // `currentAnswer` reads fresh state on each call through the closure below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, payload.token, answer.mechanism, answer.redundancy])

  const next = () => {
    startTransition(async () => {
      try {
        const result = await advanceDrillRunAction(runId)
        if (result.kind === 'done') {
          setPhase({ kind: 'done', summary: result.summary })
          return
        }
        setPayload(result.payload)
        setAnswer(EMPTY)
        setPhase({ kind: 'answering' })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The next item could not be issued.')
      }
    })
  }

  if (phase.kind === 'done') return <DrillSummary summary={phase.summary} />

  const settled = phase.kind === 'feedback'

  return (
    <div className={styles.runner}>
      <header className={styles.head}>
        <div>
          <p className="eyebrow">Recognition drill</p>
          {/* Item count, not a score-so-far. The score is the post-mortem's business. */}
          <p className={styles.count}>
            Item {payload.index} of {payload.totalItems}
          </p>
          <p className={styles.sub}>
            Name the mechanism and the waste it removes. No coding.
          </p>
        </div>
        <Countdown clock={payload.displayClock} paused={settled} onExpire={expire} />
      </header>

      <section className={styles.statement} aria-label="Problem statement">
        <p>{payload.item.statement}</p>
      </section>

      <div className={styles.fields} aria-disabled={settled}>
        <MechanismPicker
          name={`mechanism-${payload.token}`}
          value={answer.mechanism}
          disabled={settled || pending}
          onChange={(m) => setAnswer((a) => ({ ...a, mechanism: m }))}
        />

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`redundancy-${payload.token}`}>
            Redundancy — required
          </label>
          <p className={styles.help}>
            What is the brute force doing over and over that it shouldn&rsquo;t have to? Plain words.
          </p>
          <textarea
            id={`redundancy-${payload.token}`}
            value={answer.redundancy}
            disabled={settled || pending}
            onChange={(e) => setAnswer((a) => ({ ...a, redundancy: e.target.value }))}
            placeholder="It re-scans the whole array to answer one question it already answered."
          />
        </div>
      </div>

      {settled ? (
        <FeedbackBar
          feedback={phase.feedback}
          itemsRemaining={phase.itemsRemaining}
          pending={pending}
          onNext={next}
        />
      ) : (
        <div className={styles.actions}>
          <button className="btn" type="button" disabled={!canSubmit} onClick={submit}>
            {pending ? 'Submitting' : 'Submit'}
          </button>
          <p className={styles.gate} role="status">
            {mechanismMissing && redundancyMissing
              ? 'Both fields are required. Mechanism alone is keyword matching.'
              : mechanismMissing
                ? 'Pick a mechanism.'
                : redundancyMissing
                  ? 'Name the redundancy. Mechanism alone is keyword matching.'
                  : 'Ready.'}
          </p>
        </div>
      )}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function FeedbackBar({
  feedback,
  itemsRemaining,
  pending,
  onNext,
}: {
  feedback: DrillFeedback
  itemsRemaining: number
  pending: boolean
  onNext: () => void
}) {
  const tone = feedback.timedOut
    ? 'timeout'
    : feedback.mechanismCorrect && feedback.redundancyCorrect
      ? 'both'
      : feedback.mechanismCorrect || feedback.redundancyCorrect
        ? 'partial'
        : 'miss'

  return (
    <div className={styles.feedback} data-tone={tone} role="status">
      <p className={styles.feedbackLine}>{feedback.line}</p>
      <div className={styles.feedbackFoot}>
        <span className="mono">
          {feedback.elapsedSec}s recorded by the server
        </span>
        <button className="btn" type="button" onClick={onNext} disabled={pending}>
          {itemsRemaining > 0 ? 'Next item' : 'Finish drill'}
        </button>
      </div>
    </div>
  )
}

function DrillSummary({ summary }: { summary: DrillSessionResult }) {
  const rows: Array<[string, number]> = [
    ['Both parts', summary.correctBoth],
    ['Mechanism only', summary.correctPatternOnly],
    ['Redundancy only', summary.correctRedundancyOnly],
    ['Neither', summary.missed],
  ]

  return (
    <div className={styles.runner}>
      <header className={styles.head}>
        <div>
          <p className="eyebrow">Drill complete</p>
          <h1>{summary.items} items</h1>
          <p className={styles.sub}>Median {summary.medianTimeSec}s, server-timed.</p>
        </div>
      </header>

      <div className={styles.summaryGrid}>
        {rows.map(([label, n]) => (
          <div key={label} className={styles.summaryCell}>
            <div className={styles.summaryNum}>{n}</div>
            <div className={styles.summaryLabel}>{label}</div>
          </div>
        ))}
      </div>

      {summary.confusions.length > 0 ? (
        <section className="card stack">
          <h2>Confusions logged</h2>
          <ul className={styles.confusions}>
            {summary.confusions.map(([target, chosen], i) => (
              <li key={`${target}-${chosen}-${i}`}>
                <strong>{MECHANISM_LABEL[target]}</strong> read as {MECHANISM_LABEL[chosen]}
              </li>
            ))}
          </ul>
          <p className="muted">
            These pairs set the next warm-up. The redundancy-only rows matter more than the count:
            naming the waste and reaching for the wrong tool is closer to competence than the reverse.
          </p>
        </section>
      ) : null}

      <div className={styles.actions}>
        <Link className="btn" href="/coach">
          Go to the core block
        </Link>
        <Link className="btn-secondary" href="/session">
          Session summary
        </Link>
      </div>
    </div>
  )
}

/** Exported for the empty-run case, so the page never renders a broken drill. */
export function DrillUnavailable({ reason }: { reason: string }) {
  return (
    <div className="card stack">
      <h1>No drill to run</h1>
      <p className="muted">{reason}</p>
    </div>
  )
}
