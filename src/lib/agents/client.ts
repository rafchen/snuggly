/**
 * Anthropic client + the one typed entry point every agent in this track uses.
 *
 * Nothing in here knows anything about the Cracked method beyond the shared voice
 * preamble. Agent-specific behaviour lives in the agent files; the refusal rules
 * that matter are enforced in TypeScript there, never by prompt alone.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
// The SDK's zod helper is built against zod v4, which ships from the installed
// zod package under the `zod/v4` subpath. Every schema in this track uses it.
import * as z from 'zod/v4'

import { MECHANISMS, REDUNDANCIES, type Mechanism, type Redundancy } from '../taxonomy'
import { FAILURE_CODES, type AgentName } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Model configuration. Verified against the API — do not "improve" these.
// ─────────────────────────────────────────────────────────────────────────────

/** No date suffix. Thinking is on by default on this model. */
export const MODEL = 'claude-opus-5'

/** Non-streaming ceiling. */
export const MAX_TOKENS = 16000

/**
 * `temperature`, `top_p`, `top_k` and `thinking.budget_tokens` all 400 on this
 * model. The only knob is effort.
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// ─────────────────────────────────────────────────────────────────────────────
// The client seam
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The narrow surface `runAgent` needs. Declared structurally so tests can inject
 * a fake without constructing a real SDK client, and so this track compiles
 * against whatever minor version of the SDK is installed.
 */
export interface StructuredClient {
  messages: {
    parse(body: Record<string, unknown>): Promise<{ parsed_output?: unknown }>
  }
}

let cached: StructuredClient | null = null

export function getClient(apiKey?: string): StructuredClient {
  if (!apiKey && cached) return cached
  const client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY }) as unknown as StructuredClient
  if (!apiKey) cached = client
  return client
}

/** Test hook: force a client (or reset with `null`). */
export function setClient(client: StructuredClient | null): void {
  cached = client
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/** The model returned nothing parseable. Never silently substitute a default. */
export class AgentOutputError extends Error {
  constructor(readonly agent: AgentName, message: string) {
    super(`${agent}: ${message}`)
    this.name = 'AgentOutputError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared voice — every system prompt is built on top of this
// ─────────────────────────────────────────────────────────────────────────────

export const VOICE = `Voice: direct, warm, unimpressed by struggle. Struggle is the mechanism, not a
problem to be soothed away.

Never write: "Great question", "You're so close", "Nice work!", or any other empty
encouragement. Never hedge in a way that obscures whether the learner was right.
Name what happened accurately, then say what is next. Praise the derivation, never
the answer: a learner who reached a wrong answer through clean ladder reasoning had
a better session than one who guessed right, and you say that out loud.`

export const METHOD = `The Cracked Method, in one line: every efficient algorithm is brute force minus
redundant work. There are 18 kinds of redundancy and 24 mechanisms that eliminate
them, and the mapping is close to deterministic.

The Ladder, worked in order, before a single line of code:
  1 Frame      — restated I/O, constraint sizes, answer type, edge cases
  2 Brute      — the dumbest thing that works, plus its complexity
  3 Bottleneck — the specific repeated operation, named concretely
  4 Lift       — the mechanism that kills that waste, justified
  5 Invariant  — what stays true at every step
  6 Verify     — hand-trace, edge cases, final complexity

Rung 3 -> 4 is the hinge of the method. Rung 2 is non-negotiable even when the
learner already knows the fast answer.

The Commit Rule: no hint, test case, or nudge is released until the learner has
logged a falsifiable hypothesis at their current rung. This is enforced in code
above you — if you are being asked for a hint, the commit already exists.`

export function systemPrompt(role: string): string {
  return `${role.trim()}\n\n${METHOD}\n\n${VOICE}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared zod primitives — the taxonomy is closed, so every enum comes from it
// ─────────────────────────────────────────────────────────────────────────────

export const mechanismEnum = z.enum(MECHANISMS as unknown as [Mechanism, ...Mechanism[]])
export const redundancyEnum = z.enum(REDUNDANCIES as unknown as [Redundancy, ...Redundancy[]])
export const failureCodeEnum = z.enum(FAILURE_CODES as unknown as ['F1', ...string[]])
export const rungEnum = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
])
export const hintLevelEnum = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
])
export const disguiseEnum = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
export const phaseEnum = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])
export const unitScore = z.number().min(0).max(1)

// ─────────────────────────────────────────────────────────────────────────────
// runAgent
// ─────────────────────────────────────────────────────────────────────────────

export interface RunAgentOptions<T> {
  agent: AgentName
  /** Role block; `systemPrompt` appends the method brief and the voice rules. */
  system: string
  /** Either a single user turn... */
  user?: string
  /** ...or a full transcript, when the agent is mid-conversation. */
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  schema: z.ZodType<T>
  effort?: Effort
  maxTokens?: number
  client?: StructuredClient
}

/**
 * One structured-output call. Returns the parsed, re-validated payload or throws —
 * it never returns a half-populated object, because every caller in this track uses
 * the result to make a pedagogical decision.
 */
export async function runAgent<T>(opts: RunAgentOptions<T>): Promise<T> {
  const {
    agent,
    system,
    user,
    messages,
    schema,
    effort = 'high',
    maxTokens = MAX_TOKENS,
    client = getClient(),
  } = opts

  const turns = messages ?? (user !== undefined ? [{ role: 'user' as const, content: user }] : [])
  if (turns.length === 0) throw new AgentOutputError(agent, 'no messages supplied')

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt(system),
    messages: turns,
    output_config: { format: zodOutputFormat(schema), effort },
  })

  const parsed = response?.parsed_output
  if (parsed === null || parsed === undefined) {
    throw new AgentOutputError(agent, 'model returned no parsed_output')
  }

  const revalidated = schema.safeParse(parsed)
  if (!revalidated.success) {
    throw new AgentOutputError(agent, `parsed_output failed schema revalidation: ${revalidated.error.message}`)
  }
  return revalidated.data
}
