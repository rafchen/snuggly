import Link from 'next/link'
import styles from './page.module.css'

export default function HomePage() {
  return (
    <div className={styles.home}>
      <section className={styles.hero}>
        <p className="eyebrow">The claim</p>
        <h1 className={styles.claim}>
          Every efficient algorithm is brute force minus redundant work.
        </h1>
        <p className={styles.lede}>
          Eighteen kinds of redundancy, twenty-four mechanisms that eliminate them. Own that
          mapping and you do not need to have seen the problem before. This is the instrument that
          installs it: six rungs, a commit before every hint, and a record of where you actually
          fell off.
        </p>
      </section>

      <section className={styles.routes}>
        <Link className={styles.route} href="/drill">
          <span className={styles.routeName}>Recognition drill</span>
          <span className={styles.routeDesc}>
            90 seconds an item. Name the mechanism and the waste it removes. No coding, no tags,
            interleaved so the answer is never given away by context.
          </span>
          <span className={styles.routeMeta}>5 min warm-up</span>
        </Link>

        <Link className={styles.route} href="/coach">
          <span className={styles.routeName}>The Ladder</span>
          <span className={styles.routeDesc}>
            Frame, Brute, Bottleneck, Lift, Invariant, Verify. No hint is released until a
            hypothesis is logged at the current rung. A wrong one counts.
          </span>
          <span className={styles.routeMeta}>30 min core block</span>
        </Link>

        <Link className={styles.route} href="/session">
          <span className={styles.routeName}>Session summary</span>
          <span className={styles.routeDesc}>
            What was scheduled and why, what moved, and the failure code with the commit-log
            evidence that earned it.
          </span>
          <span className={styles.routeMeta}>Post-mortem</span>
        </Link>
      </section>

      <p className={styles.foot}>
        Rung 3 to rung 4 is the hinge — naming the waste, then naming the tool that kills it. It is
        the rung nobody teaches explicitly and the one that predicts unseen problems.
      </p>
    </div>
  )
}
