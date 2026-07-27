'use client'

/**
 * The constrained mechanism picker.
 *
 * Free text is not an option here by design: the mechanism half of a drill answer is
 * a choice from the closed taxonomy, and typing it would let surface wording stand in
 * for a decision. The options are generated from MECHANISM_GROUPS, which is keyed by
 * the `Mechanism` union, so the picker cannot drift from taxonomy.ts.
 */

import type { Mechanism } from '@/lib/types'
import { MECHANISM_GROUPS, MECHANISM_LABEL } from './labels'
import styles from './MechanismPicker.module.css'

export function MechanismPicker({
  name,
  value,
  onChange,
  disabled = false,
}: {
  name: string
  value: Mechanism | null
  onChange: (m: Mechanism) => void
  disabled?: boolean
}) {
  return (
    <fieldset className={styles.picker}>
      <legend className={styles.legend}>Mechanism — required</legend>
      <div className={styles.groups}>
        {MECHANISM_GROUPS.map((group) => (
          <div key={group.label} className={styles.group}>
            <div className={styles.groupLabel}>{group.label}</div>
            <div className={styles.chips}>
              {group.members.map((m) => (
                <label key={m} className={styles.chip}>
                  <input
                    type="radio"
                    name={name}
                    value={m}
                    checked={value === m}
                    disabled={disabled}
                    onChange={() => onChange(m)}
                  />
                  <span>{MECHANISM_LABEL[m]}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  )
}
