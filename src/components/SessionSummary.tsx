/**
 * The session summary. A server component: it renders what it is handed and fetches
 * nothing.
 *
 * Three things have to be visible here or the screen is decoration:
 *   1. every block with the reason it was scheduled — no unmotivated problem lists
 *   2. the mastery deltas, marked pending, because only the planner may apply them
 *   3. the failure code with the evidence that earned it, quoted from the commit log
 */

import type { SessionSummary as SessionSummaryData } from '@/app/session/data'
import { BLOCK_LABEL, DIMENSION_LABEL, FAILURE_LABEL } from './labels'
import { FAILURE_RUNG, RUNG_NAMES } from '@/lib/types'
import styles from './SessionSummary.module.css'

const pct = (v: number) => `${Math.round(v * 100)}`

export function SessionSummary({ data }: { data: SessionSummaryData }) {
  const { plan, failure, deltas, mastery } = data

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className="eyebrow">Session summary</p>
        <h1>{plan.learnerMessage}</h1>
        <p className={styles.gate}>
          Phase {plan.gateStatus.phase} gate: {plan.gateStatus.criteriaMet} of{' '}
          {plan.gateStatus.criteriaTotal} criteria met. Roughly {plan.estimatedSessionsToGate}{' '}
          sessions at the current rate.
        </p>
        {plan.gateStatus.missing.length > 0 ? (
          <ul className={styles.missing}>
            {plan.gateStatus.missing.map((m) => (
              <li key={m} className="mono">
                {m}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <section className={styles.section}>
        <h2>Blocks, and why each one was scheduled</h2>
        <ol className={styles.blocks}>
          {plan.sessionPlan.map((b, i) => (
            <li key={`${b.block}-${i}`} className={styles.block}>
              <div className={styles.blockHead}>
                <span className={styles.kind}>{BLOCK_LABEL[b.block]}</span>
                <span className="mono">
                  {b.minutes} min · {b.agent}
                </span>
              </div>
              <p className={styles.blockContent}>{b.content}</p>
              <p className={styles.why}>{b.why}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Mastery deltas</h2>
          <span className="mono">pending — only the planner applies them</span>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Node</th>
              <th scope="col">Dimension</th>
              <th scope="col">Observed</th>
              <th scope="col">Now</th>
              <th scope="col">After</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {deltas.map((row, i) => {
              const direction =
                row.prior === null || row.projected === null
                  ? 'flat'
                  : row.projected > row.prior
                    ? 'up'
                    : row.projected < row.prior
                      ? 'down'
                      : 'flat'
              return (
                <tr key={row.delta.id ?? i} data-direction={direction}>
                  <th scope="row" className="mono">
                    {row.delta.node}
                  </th>
                  <td>{DIMENSION_LABEL[row.delta.dimension]}</td>
                  <td className={styles.num}>{pct(row.delta.observed)}</td>
                  <td className={styles.num}>{row.prior === null ? 'unset' : pct(row.prior)}</td>
                  <td className={styles.num}>
                    <span className={styles.after}>
                      {row.projected === null ? 'unset' : pct(row.projected)}
                    </span>
                  </td>
                  <td className="mono">{row.delta.source}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="muted">
          Articulation stays unset outside Phase 5. It is not zero, and it is never averaged in as
          one.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Where you are</h2>
        <div className={styles.nodes}>
          {mastery.map((m) => (
            <div key={m.node} className={styles.node}>
              <div className={styles.nodeName}>{m.node}</div>
              <dl className={styles.bars}>
                {(['recognition', 'derivation', 'implementation'] as const).map((dim) => (
                  <div key={dim} className={styles.barRow}>
                    <dt>{DIMENSION_LABEL[dim]}</dt>
                    <dd>
                      <div className={styles.bar} aria-hidden="true">
                        <div className={styles.barFill} style={{ width: `${pct(m[dim])}%` }} />
                      </div>
                      <span className={styles.barValue}>{pct(m[dim])}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.failure}`}>
        <div className={styles.sectionHead}>
          <h2>
            <span className={styles.code}>{failure.primaryCode}</span> {FAILURE_LABEL[failure.primaryCode]}
          </h2>
          <span className="mono">
            fell off at rung {FAILURE_RUNG[failure.primaryCode]} ·{' '}
            {RUNG_NAMES[FAILURE_RUNG[failure.primaryCode]]}
          </span>
        </div>

        <div>
          <p className="eyebrow">Evidence</p>
          <p className={styles.evidence}>{failure.evidence}</p>
        </div>

        {failure.secondaryCodes.length > 0 ? (
          <div>
            <p className="eyebrow">Secondary</p>
            <ul className={styles.secondary}>
              {failure.secondaryCodes.map((c) => (
                <li key={c}>
                  <span className={styles.codeSmall}>{c}</span> {FAILURE_LABEL[c]}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <p className="eyebrow">Prescription</p>
          <p className={styles.prescription}>
            {failure.prescription.reps} reps of {failure.prescription.drillType} on{' '}
            <span className="mono">{failure.prescription.target}</span>, across{' '}
            {failure.prescription.sessions} sessions.
            {failure.prerequisiteGap
              ? ' A prerequisite is missing, so this backs up a node rather than pushing forward.'
              : ''}
          </p>
        </div>

        <p className={styles.learnerMessage}>{failure.learnerMessage}</p>
      </section>
    </div>
  )
}
