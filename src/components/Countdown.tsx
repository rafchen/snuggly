'use client'

/**
 * DISPLAY ONLY.
 *
 * This component draws a countdown. It does not measure anything the system records.
 * The elapsed time that reaches `DrillAttempt.elapsedSec` is computed on the server
 * from the timestamp the server wrote at issuance (see `src/app/drill/drill-service.ts`).
 *
 * The one thing this component can do is *ask* the server to expire the item, via
 * `onExpire`. The server independently re-derives elapsed and refuses if it disagrees,
 * so a fast, slow, paused, or hostile client clock changes what is drawn here and
 * nothing else.
 */

import { useEffect, useRef, useState } from 'react'
import type { DisplayClock } from '@/app/drill/drill-service'
import styles from './Countdown.module.css'

function remainingSeconds(clock: DisplayClock, sinceMountMs: number): number {
  // Elapsed the server had already counted when it built this payload, plus local
  // ticks since. The local part is drift, and drift is acceptable in a drawing.
  const elapsedAtIssueSec = (clock.serverNowMs - clock.issuedAtServerMs) / 1000
  return Math.max(0, clock.capSec - elapsedAtIssueSec - sinceMountMs / 1000)
}

export function Countdown({
  clock,
  paused = false,
  onExpire,
}: {
  clock: DisplayClock
  paused?: boolean
  onExpire?: () => void
}) {
  const [remaining, setRemaining] = useState(() => remainingSeconds(clock, 0))
  const firedRef = useRef(false)

  // Held in a ref so that a new `onExpire` closure — which the parent rebuilds on
  // every keystroke — cannot restart the tick and hand the learner seconds back.
  const expireRef = useRef(onExpire)
  useEffect(() => {
    expireRef.current = onExpire
  })

  useEffect(() => {
    // Pausing stops the tick and leaves the reading where it stopped. It does not
    // refill: the item is settled and its recorded time is already the server's.
    if (paused) return

    firedRef.current = false
    const startedAt = Date.now()
    setRemaining(remainingSeconds(clock, 0))

    const id = setInterval(() => {
      const left = remainingSeconds(clock, Date.now() - startedAt)
      setRemaining(left)
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true
        expireRef.current?.()
      }
    }, 250)
    return () => clearInterval(id)
    // `clock` identity changes exactly once per issued item, which is the intent.
  }, [clock, paused])

  const shown = Math.ceil(remaining)
  const pct = Math.max(0, Math.min(1, remaining / clock.capSec))
  const level = remaining <= 10 ? 'low' : remaining <= 30 ? 'mid' : 'ok'

  return (
    <div className={styles.wrap} data-level={level}>
      <div className={styles.readout} role="timer" aria-live="off">
        <span className={styles.value}>{shown}</span>
        <span className={styles.unit}>s</span>
      </div>
      <div className={styles.track} aria-hidden="true">
        <div className={styles.fill} style={{ transform: `scaleX(${pct})` }} />
      </div>
      <p className={styles.note}>
        {paused ? 'Clock stopped. This item is settled.' : 'Displayed. The server keeps the time that counts.'}
      </p>
    </div>
  )
}
