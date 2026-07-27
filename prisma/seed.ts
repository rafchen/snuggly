/**
 * Seed: the skill DAG, a demo learner, and whatever content Track B has produced.
 *
 * Run with `npm run db:seed` (or `npm run db:reset` for a clean slate).
 *
 * The content step is deliberately tolerant. Track B authors content/*.json in
 * parallel with this file, so an empty or missing content directory is a normal
 * state, not an error — the seed reports what it found and moves on. A malformed
 * problem is skipped with a named reason rather than aborting the whole seed.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { SKILL_DAG, MECHANISMS, REDUNDANCIES } from '../src/lib/taxonomy'
import type { ProblemContent } from '../src/lib/types'
import { toProblemRow } from '../src/lib/store'

const prisma = new PrismaClient()

const REPO_ROOT = resolve(__dirname, '..')
const CONTENT_DIR = join(REPO_ROOT, 'content')

const DEMO_LEARNER_ID = 'demo-learner'

// ─────────────────────────────────────────────────────────────────────────────
// Skill DAG
// ─────────────────────────────────────────────────────────────────────────────

async function seedSkillDag(): Promise<void> {
  for (const node of SKILL_DAG) {
    await prisma.skillNode.upsert({
      where: { id: node.id },
      create: { id: node.id, phase: node.phase, mechanism: node.mechanism },
      update: { phase: node.phase, mechanism: node.mechanism },
    })
  }

  // Edges second: every prereq node must exist before it can be referenced.
  let edges = 0
  for (const node of SKILL_DAG) {
    for (const prereqId of node.prereqs) {
      await prisma.skillEdge.upsert({
        where: { nodeId_prereqId: { nodeId: node.id, prereqId } },
        create: { nodeId: node.id, prereqId },
        update: {},
      })
      edges++
    }
  }

  console.log(`  skill DAG: ${SKILL_DAG.length} nodes, ${edges} prerequisite edges`)
}

/** Cheap integrity check — a dangling prereq would silently lock a node forever. */
function assertDagIntegrity(): void {
  const ids = new Set(SKILL_DAG.map((n) => n.id))
  const dangling: string[] = []
  for (const node of SKILL_DAG) {
    for (const p of node.prereqs) if (!ids.has(p)) dangling.push(`${node.id} -> ${p}`)
  }
  if (dangling.length > 0) {
    throw new Error(`Skill DAG references unknown prerequisites: ${dangling.join(', ')}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo learner
// ─────────────────────────────────────────────────────────────────────────────

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

/**
 * A learner mid-Phase-1: Phase 0 fluency solid, the early primitives in motion,
 * and one node deliberately left stale so decay-on-read is visible immediately.
 *
 * Note every articulation here is null. Placement never initializes it, and neither
 * does the seed — Phase 5 and interview simulation are the only writers.
 */
const DEMO_MASTERY: Array<{
  node: string
  recognition: number
  derivation: number
  implementation: number
  lastSeen: Date
  failureCodes?: Record<string, number>
}> = [
  { node: 'collections', recognition: 0.95, derivation: 0.9, implementation: 0.88, lastSeen: daysAgo(2) },
  { node: 'defaultdict', recognition: 0.92, derivation: 0.86, implementation: 0.84, lastSeen: daysAgo(2) },
  { node: 'sorting_with_keys', recognition: 0.9, derivation: 0.82, implementation: 0.8, lastSeen: daysAgo(3) },
  { node: 'heapq', recognition: 0.78, derivation: 0.7, implementation: 0.66, lastSeen: daysAgo(6) },
  { node: 'string_ops', recognition: 0.88, derivation: 0.8, implementation: 0.79, lastSeen: daysAgo(4) },
  { node: 'tuple_unpacking', recognition: 0.93, derivation: 0.85, implementation: 0.85, lastSeen: daysAgo(3) },
  { node: 'arrays_basics', recognition: 0.9, derivation: 0.82, implementation: 0.78, lastSeen: daysAgo(1) },
  { node: 'hashing', recognition: 0.86, derivation: 0.76, implementation: 0.72, lastSeen: daysAgo(1) },
  { node: 'sliding_window_fixed', recognition: 0.74, derivation: 0.62, implementation: 0.55, lastSeen: daysAgo(3) },
  {
    node: 'sliding_window_variable',
    recognition: 0.58,
    derivation: 0.41,
    implementation: 0.3,
    lastSeen: daysAgo(5),
    // The classic confusion from patterns.md §5 — an F4 cluster the planner should target.
    failureCodes: { F3: 2, F4: 3 },
  },
  { node: 'two_pointers_opposite', recognition: 0.63, derivation: 0.48, implementation: 0.4, lastSeen: daysAgo(9) },
  { node: 'two_pointers_fast_slow', recognition: 0.52, derivation: 0.33, implementation: 0.25, lastSeen: daysAgo(12) },
  { node: 'prefix_sums', recognition: 0.69, derivation: 0.55, implementation: 0.5, lastSeen: daysAgo(7) },
  { node: 'binary_search_array', recognition: 0.71, derivation: 0.58, implementation: 0.46, lastSeen: daysAgo(4) },
  // Left stale on purpose: 30 days of decay, so `getAllMastery` visibly differs
  // from the stored row the moment anyone reads it.
  { node: 'stack_basics', recognition: 0.66, derivation: 0.5, implementation: 0.44, lastSeen: daysAgo(30), failureCodes: { F5: 1 } },
]

async function seedDemoLearner(): Promise<void> {
  await prisma.learner.upsert({
    where: { id: DEMO_LEARNER_ID },
    create: { id: DEMO_LEARNER_ID, name: 'Demo Learner', email: 'demo@cracked.local', phase: 1 },
    update: { name: 'Demo Learner', phase: 1 },
  })

  for (const m of DEMO_MASTERY) {
    const payload = {
      recognition: m.recognition,
      derivation: m.derivation,
      implementation: m.implementation,
      articulation: null, // never initialized outside Phase 5 / interview sim
      lastSeen: m.lastSeen,
      decayRate: 1,
      failureCodes: JSON.stringify(m.failureCodes ?? {}),
    }
    await prisma.mastery.upsert({
      where: { learnerId_node: { learnerId: DEMO_LEARNER_ID, node: m.node } },
      create: { learnerId: DEMO_LEARNER_ID, node: m.node, ...payload },
      update: payload,
    })
  }

  console.log(`  demo learner: ${DEMO_LEARNER_ID}, ${DEMO_MASTERY.length} mastery rows (articulation null throughout)`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Content (Track B — may not exist yet)
// ─────────────────────────────────────────────────────────────────────────────

function listJsonFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    // index.json is Track B's problemId manifest, not a problem. Reading it as
    // one yields a string per entry and one "not an object" line per id.
    if (isDir) files.push(...listJsonFiles(full))
    else if (entry === 'index.json') continue
    else if (entry.endsWith('.json')) files.push(full)
  }
  return files.sort()
}

/** Accepts an array, a { problems: [...] } wrapper, or a single problem object. */
function extractProblems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const wrapper = parsed as Record<string, unknown>
    for (const key of ['problems', 'items', 'data']) {
      if (Array.isArray(wrapper[key])) return wrapper[key] as unknown[]
    }
    if (typeof wrapper.problemId === 'string' || typeof wrapper.id === 'string') return [parsed]
  }
  return []
}

const MECHANISM_SET = new Set<string>(MECHANISMS)
const REDUNDANCY_SET = new Set<string>(REDUNDANCIES)

/** Returns the reason it is unusable, or null if it can be stored. */
function rejectionReason(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'not an object'
  const p = raw as Record<string, unknown>
  const id = p.problemId ?? p.id
  if (typeof id !== 'string' || id.length === 0) return 'missing problemId'
  if (typeof p.title !== 'string' || p.title.length === 0) return `${id}: missing title`
  if (typeof p.statement !== 'string' || p.statement.length === 0) return `${id}: missing statement`
  if (typeof p.primaryPattern !== 'string' || !MECHANISM_SET.has(p.primaryPattern)) {
    return `${id}: primaryPattern "${String(p.primaryPattern)}" is not one of the 24 mechanisms`
  }
  if (typeof p.redundancy !== 'string' || !REDUNDANCY_SET.has(p.redundancy)) {
    return `${id}: redundancy "${String(p.redundancy)}" is not one of the 18 redundancies`
  }
  return null
}

function normalize(raw: Record<string, unknown>): ProblemContent {
  const id = (raw.problemId ?? raw.id) as string
  return {
    problemId: id,
    sourceRef: (raw.sourceRef as string | null) ?? null,
    title: raw.title as string,
    statement: raw.statement as string,
    primaryPattern: raw.primaryPattern as ProblemContent['primaryPattern'],
    secondary: (raw.secondary as ProblemContent['secondary']) ?? [],
    redundancy: raw.redundancy as ProblemContent['redundancy'],
    phase: (raw.phase as ProblemContent['phase']) ?? 1,
    prerequisites: (raw.prerequisites as string[]) ?? [],
    canonicalLadder: (raw.canonicalLadder as ProblemContent['canonicalLadder']) ?? {
      frame: '',
      brute: '',
      bottleneck: '',
      lift: '',
      invariant: '',
      verify: '',
    },
    hints: (raw.hints as string[]) ?? [],
    distractors: (raw.distractors as ProblemContent['distractors']) ?? [],
    disguiseLevel: (raw.disguiseLevel as ProblemContent['disguiseLevel']) ?? 0,
    misleadingFingerprint: (raw.misleadingFingerprint as string | null) ?? null,
    edgeCases: (raw.edgeCases as string[]) ?? [],
    drillVariants: (raw.drillVariants as ProblemContent['drillVariants']) ?? [],
  }
}

async function seedContent(): Promise<void> {
  const files = listJsonFiles(CONTENT_DIR)
  if (files.length === 0) {
    console.log('  content: no content/*.json yet — skipping (Track B authors these in parallel)')
    return
  }

  let stored = 0
  const skipped: string[] = []

  for (const file of files) {
    const rel = relative(REPO_ROOT, file)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      skipped.push(`${rel}: unparseable JSON (${(err as Error).message})`)
      continue
    }

    const candidates = extractProblems(parsed)
    if (candidates.length === 0) {
      skipped.push(`${rel}: no problems found`)
      continue
    }

    for (const candidate of candidates) {
      const reason = rejectionReason(candidate)
      if (reason) {
        skipped.push(`${rel}: ${reason}`)
        continue
      }
      const problem = normalize(candidate as Record<string, unknown>)
      const row = toProblemRow(problem)
      const { id: _id, ...rest } = row
      await prisma.problem.upsert({ where: { id: row.id }, create: row, update: rest })
      stored++
    }
  }

  console.log(`  content: ${stored} problem(s) from ${files.length} file(s)`)
  for (const s of skipped) console.warn(`    skipped ${s}`)
}

// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Seeding Cracked...')
  assertDagIntegrity()
  await seedSkillDag()
  await seedDemoLearner()
  await seedContent()
  console.log('Done.')
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
