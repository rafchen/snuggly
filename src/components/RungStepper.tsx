'use client'

/**
 * The six-rung stepper. Rung names come from RUNG_NAMES in the contract.
 *
 * Rungs are shown in order and the current one is marked. Rungs ahead of the learner
 * are dimmed but not hidden — the shape of the ladder is part of what is being taught,
 * and rung 3 to 4 is the hinge.
 */

import { RUNG_NAMES, type RungNumber } from '@/lib/types'
import styles from './RungStepper.module.css'

const RUNGS: RungNumber[] = [1, 2, 3, 4, 5, 6]

export function RungStepper({
  current,
  clearedRungs,
}: {
  current: RungNumber
  /** Rungs with a correct commit logged. */
  clearedRungs: RungNumber[]
}) {
  return (
    <ol className={styles.stepper} aria-label="The Ladder">
      {RUNGS.map((r) => {
        const state = clearedRungs.includes(r) ? 'cleared' : r === current ? 'current' : r < current ? 'passed' : 'ahead'
        return (
          <li key={r} className={styles.rung} data-state={state} aria-current={r === current ? 'step' : undefined}>
            <span className={styles.num}>{r}</span>
            <span className={styles.name}>{RUNG_NAMES[r]}</span>
          </li>
        )
      })}
    </ol>
  )
}
