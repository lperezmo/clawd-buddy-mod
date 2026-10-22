// What Clawd does on his own: three moods, each a pool of rides and acts to
// pick from. Only the session's own signals steer them (tool names, file
// paths, failures, quiet time, turn boundaries), never what anyone wrote.

import { ACTS } from './sprites'

export type Mood = 'lockin' | 'chill' | 'celebrate'

// The kind of work the last tool call did, from its name and path.
export type Work = 'none' | 'code' | 'notes' | 'shell' | 'web' | 'agent' | 'mcp' | 'other'

const NOTES = /\.(md|mdx|markdown|txt|rst|adoc)$/i

export function workFor(tool: string, path = ''): Work {
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    return NOTES.test(path) ? 'notes' : 'code'
  }
  if (tool === 'Bash' || tool === 'PowerShell') return 'shell'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'web'
  if (tool === 'Agent' || tool === 'Task') return 'agent'
  if (tool.startsWith('mcp__')) return 'mcp'
  return 'other'
}

// Lock in: tools are firing.
export const RIDES = ['walk', 'skate', 'car', 'scooter', 'bike', 'kite'] as const
export const WORK_ACTS = [
  'laptop',
  'desktop',
  'notebook',
  'phone',
  'thinking',
  'coffee',
  'lightbulb',
  'watch',
  'turning',
] as const

// Extra weight the work puts on a pick, on top of 1 each.
const LEAN: Record<Work, Partial<Record<string, number>>> = {
  none: { thinking: 4, walk: 3 },
  code: { laptop: 5, desktop: 5, notebook: 1, scooter: 3 },
  notes: { notebook: 6, laptop: 2, scooter: 3 },
  shell: { coffee: 3, skate: 6 },
  web: { lightbulb: 6, kite: 6 },
  agent: { car: 8, thinking: 3 },
  mcp: { phone: 6, bike: 6 },
  other: { thinking: 2, notebook: 2, walk: 2 },
}

export const lean = (work: Work) => (name: string) => 1 + (LEAN[work][name] ?? 0)

// Chill: nothing has happened for a while. First a think or a look around,
// then the site's own random pick, then a nap or the pool until something happens.
export const CHILL_FIRST = ['thinking', 'looking'] as const
export const CHILL = [
  'snooze',
  'headphones',
  'sunglasses',
  'fishing',
  'watering',
  'meditating',
  'swaying',
  'bubble',
  'berryPicking',
  'blooming',
  'rose',
  'heart',
  'rainbow',
  'pool',
  'space',
] as const
export const CHILL_DEEP = ['snooze', 'pool'] as const

// Celebration: a turn that took a while or many tools has ended.
export const CELEBRATE = [
  'confetti',
  'confettiHappy',
  'dancing',
  'dancingHappy',
  'jumpingHappy',
  'excited',
  'breakDancing',
  'juggling',
  'hulaHoop',
  'arcade',
  'spark',
] as const

// The site's odds for its acts; the two floats get about a snooze's worth.
export const siteWeight = (name: string) => ACTS[name]?.weight || 3

/** A weighted pick from `names`, never `avoid` while anything else is there. */
export function pick(
  names: readonly string[],
  weight: (name: string) => number,
  random: () => number,
  avoid?: string,
): string {
  const pool = names.length > 1 ? names.filter((n) => n !== avoid) : names
  const total = pool.reduce((sum, n) => sum + weight(n), 0)
  let at = random() * total
  for (const n of pool) {
    at -= weight(n)
    if (at < 0) return n
  }
  return pool[pool.length - 1]!
}

// Where the act holds a frame, as the site does: coffee for a sip, watering
// while the can pours.
export const HOLDS: Record<string, { at: number; seconds: number }> = {
  coffee: { at: 0.55, seconds: 4.5 },
  watering: { at: 0.6, seconds: 5 },
}

// When a turn earns a celebration rather than just a hop.
export const LONG_TURN_SECONDS = 30
export const MANY_TOOLS = 5
// Quiet time that starts chill, its second stage, and the nap that lasts.
export const CHILL_AFTER = 20
export const CHILL_DEEPER = 60
export const CHILL_DEEPEST = 180
// A shell command running this long gets a coffee.
export const LONG_SHELL = 4

// A prompt that says thanks gets the happy hop: a plain keyword, nothing more.
export const isThanks = (text: string) => /\b(yay|thanks)\b|\bthank you\b/i.test(text)
