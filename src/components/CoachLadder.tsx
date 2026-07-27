'use client'

/**
 * The Socratic coach, client side.
 *
 * The hint button is disabled until a hypothesis is logged at the current rung. That
 * disabled attribute is a *mirror* of the server invariant in
 * `src/app/coach/coach-service.ts`, which throws `CommitRuleViolation` on the same
 * condition. Deleting this component's gate does not open the hint; it only removes
 * the explanation of why the hint stays shut.
 *
 * There is deliberately no control anywhere on this screen that skips a rung, skips a
 * hint level, or reveals the mechanism. Those are not missing features.
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { RUNG_NAMES, type RungNumber } from '@/lib/types'
import type { CoachActionResult, CoachView } from '@/app/coach/coach-service'
import { logHypothesisAction, requestHintAction } from '@/app/coach/actions'
import { RungStepper } from './RungStepper'
import styles from './CoachLadder.module.css'

export function CoachLadder({ initial }: { initial: CoachView }) {
  const [view, setView] = useState<CoachView>(initial)
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<{ message: string; rule: boolean } | null>(null)
  const [pending, startTransition] = useTransition()

  const clearedRungs = Array.from(
    new Set(view.commits.filter((c) => c.correct).map((c) => c.rung)),
  ) as RungNumber[]

  const commitReady = text.trim().length > 0 && !pending && !view.completed
  const hintReady = view.hintUnlocked && !pending && !view.completed && !view.hintsExhausted

  const run = (fn: () => Promise<CoachActionResult>, after?: () => void) => {
    setNotice(null)
    startTransition(async () => {
      const result = await fn()
      if (result.ok) {
        setView(result.view)
        after?.()
      } else {
        setNotice({ message: result.message, rule: result.commitRuleViolation })
      }
    })
  }

  const commit = () => {
    if (!commitReady) return
    run(
      () => logHypothesisAction(view.sessionId, text),
      () => setText(''),
    )
  }

  const hint = () => {
    // The server checks this again and refuses on its own authority.
    if (!hintReady) return
    run(
      () => requestHintAction(view.sessionId, view.reasonRequired ? reason : null),
      () => setReason(''),
    )
  }

  return (
    <div className={styles.coach}>
      <header className={styles.head}>
        <p className="eyebrow">Core block — the Ladder</p>
        <h1>{view.title}</h1>
      </header>

      <RungStepper current={view.currentRung} clearedRungs={clearedRungs} />

      <section className={styles.statement} aria-label="Problem statement">
        <p>{view.statement}</p>
      </section>

      <div className={styles.columns}>
        <div className={styles.main}>
          {view.completed ? (
            <section className={styles.done}>
              <h2>Six rungs, logged.</h2>
              <p>
                The record of how you got here is the output, not the answer. Take it to the
                post-mortem.
              </p>
              <Link className="btn" href="/session">
                Session summary
              </Link>
            </section>
          ) : (
            <section className={styles.rungBlock}>
              <p className="eyebrow">
                Rung {view.currentRung} — {RUNG_NAMES[view.currentRung]}
              </p>
              {/* RUNG_PROMPTS, verbatim from the contract. */}
              <p className={styles.prompt}>{view.prompt}</p>

              <label className={styles.label} htmlFor="hypothesis">
                Your hypothesis
              </label>
              <textarea
                id="hypothesis"
                value={text}
                disabled={pending}
                onChange={(e) => setText(e.target.value)}
                placeholder="Brief is fine. Falsifiable is the requirement."
              />
              <div className={styles.actions}>
                <button className="btn" type="button" disabled={!commitReady} onClick={commit}>
                  {pending ? 'Logging' : 'Log hypothesis'}
                </button>
                <p className={styles.help}>
                  Logged either way, right or wrong. A wrong one is the more useful record.
                </p>
              </div>
            </section>
          )}

          <section className={styles.hintBlock}>
            <div className={styles.hintHead}>
              <h2>Hints</h2>
              <span className="mono">
                {view.hintsExhausted ? 'ladder exhausted' : `level ${view.nextHintLevel} next`}
              </span>
            </div>

            {view.reasonRequired && !view.hintsExhausted ? (
              <div className={styles.reason}>
                <label className={styles.label} htmlFor="hint-reason">
                  Level 6 is the full derivation. State the cause.
                </label>
                <input
                  id="hint-reason"
                  value={reason}
                  disabled={pending}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Out of time / the problem is above the current node"
                />
              </div>
            ) : null}

            <div className={styles.actions}>
              <button
                className="btn-secondary"
                type="button"
                disabled={!hintReady}
                onClick={hint}
                aria-describedby="commit-gate"
              >
                Get a hint
              </button>
              <p id="commit-gate" className={styles.help}>
                {view.completed
                  ? 'The problem is closed.'
                  : view.hintsExhausted
                    ? 'Every level has been released. There is nothing further to give.'
                    : view.hintUnlocked
                      ? `Unlocked by your commit at rung ${view.currentRung}. One level, not a leap.`
                      : `Log a hypothesis at rung ${view.currentRung} first. The hint is withheld until something falsifiable is on the log.`}
              </p>
            </div>

            {notice ? (
              <p className={notice.rule ? styles.ruleNotice : styles.error} role="alert">
                {notice.message}
              </p>
            ) : null}

            {view.hints.length === 0 ? (
              <p className="muted">Nothing released yet.</p>
            ) : (
              <ol className={styles.hints}>
                {view.hints.map((h, i) => (
                  <li key={`${h.rung}-${h.level}-${i}`} className={styles.hint}>
                    <div className={styles.hintMeta}>
                      <span className={styles.level}>Level {h.level}</span>
                      <span className="mono">
                        rung {h.rung} · {RUNG_NAMES[h.rung]}
                      </span>
                    </div>
                    <p>{h.text}</p>
                    {h.reason ? <p className={styles.hintReason}>Logged cause: {h.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {view.difficultyMiscalibrated ? (
            <p className={styles.flag} role="status">
              Four hints on one rung. This problem is above your current node — that is a
              calibration error on our side, not a failure on yours. The planner has been flagged.
            </p>
          ) : null}
        </div>

        <aside className={styles.log} aria-label="Commit log">
          <h2>Commit log</h2>
          <p className="muted">
            The session&rsquo;s memory. A solved problem with an empty log has produced nothing
            durable.
          </p>
          {view.commits.length === 0 ? (
            <p className={styles.empty}>Empty.</p>
          ) : (
            <ol className={styles.commits}>
              {view.commits.map((c, i) => (
                <li key={c.id ?? i} className={styles.commit} data-correct={c.correct}>
                  <div className={styles.commitMeta}>
                    <span className={styles.mark} aria-hidden="true">
                      {c.correct ? '✓' : '✕'}
                    </span>
                    <span className="mono">
                      rung {c.rung} · {RUNG_NAMES[c.rung]}
                    </span>
                    <span className={styles.srOnly}>{c.correct ? 'correct' : 'incorrect'}</span>
                  </div>
                  <p className={styles.commitText}>{c.text}</p>
                  <p className={styles.commitHints}>
                    {c.hintsUsedAtCommit === 0
                      ? 'no hints at commit'
                      : `${c.hintsUsedAtCommit} hint${c.hintsUsedAtCommit === 1 ? '' : 's'} at commit`}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  )
}
