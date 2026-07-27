import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cracked',
  description:
    'Every efficient algorithm is brute force minus redundant work. This is the instrument that trains the subtraction.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link className="wordmark" href="/">
              CRACKED
            </Link>
            <nav className="nav" aria-label="Primary">
              <Link href="/drill">Drill</Link>
              <Link href="/coach">Coach</Link>
              <Link href="/session">Session</Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  )
}
