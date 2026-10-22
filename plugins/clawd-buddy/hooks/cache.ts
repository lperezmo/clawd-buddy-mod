// The prompt cache's countdown. Each main-thread request reads the cached
// prefix and starts its time to live again, so the cache goes cold one TTL
// after the last request. Which TTL, as cache-caffeine settles it: what
// Claude Code's environment pins, else what the requests' timing proved,
// else Claude Code's own choice by plan (1 hour on a subscription within its
// limits, the only sessions with rate-limit windows; 5 minutes on an API key).

import { until } from './weather'
import type { Limit, Piece } from './weather'

const minute = 60_000
export const TTL_5M = 5 * minute
export const TTL_1H = 60 * minute
// past this a 5-minute cache has expired
const GAP = 5.5 * minute

const isSet = (v: string | undefined) => v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false'

// CLAUDE_CODE_PROMPT_CACHE_TTL ("5m" or "1h") wins, then FORCE_PROMPT_CACHING_5M,
// then ENABLE_PROMPT_CACHING_1H; null leaves the choice automatic.
export function ttlFromEnv(
  cacheTtl: string | undefined,
  force5m: string | undefined,
  enable1h: string | undefined,
): number | null {
  const v = cacheTtl?.trim().toLowerCase()
  if (v === '1h') return TTL_1H
  if (v === '5m') return TTL_5M
  if (isSet(force5m)) return TTL_5M
  if (isSet(enable1h)) return TTL_1H
  return null
}

type Usage = { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// What one request's timing says about the TTL: past 5.5 minutes idle a
// mostly-read prompt proves 1 hour, and a mostly-written one under an hour
// means 5 minutes, unless something else rewrote it (`isExempt`: the first
// request, after a compaction or a model switch). Small prompts say nothing.
export function ttlFromTiming(gap: number, u: Usage, isExempt: boolean): number | null {
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  if (total < 30_000 || gap < GAP) return null
  if (u.cache_read_input_tokens / total > 0.8) return TTL_1H
  if (u.cache_creation_input_tokens / total > 0.5 && !isExempt && gap < TTL_1H) return TTL_5M
  return null
}

export class Cache {
  envTtl: number | null = null
  timedTtl: number | null = null
  limits: readonly Limit[] = []
  // when the last main-thread request went out; 0 before one this session
  lastAt = 0

  get ttl(): number {
    return (
      this.envTtl ??
      this.timedTtl ??
      (this.limits.length > 0 && this.limits.every((l) => l.percentUsed < 100) ? TTL_1H : TTL_5M)
    )
  }

  // pinned, as the environment would
  set ttl(ms: number) {
    this.envTtl = ms
  }

  get label(): string {
    return this.ttl >= TTL_1H ? '1h' : '5m'
  }

  // where the TTL comes from, for /clawd context
  get source(): string {
    if (this.envTtl !== null) return 'from the environment'
    if (this.timedTtl !== null) return 'measured from request timing'
    return this.limits.length ? 'subscription default' : 'API-key default'
  }

  left(now: number): number | null {
    return this.lastAt > 0 && now > 0 ? this.lastAt + this.ttl - now : null
  }

  color(now: number): string {
    const left = this.left(now) ?? 0
    return left > this.ttl * 0.5 ? 'green' : left > this.ttl * 0.15 ? 'yellow' : 'red'
  }

  // `cache 42m`, or `cache cold` once it has expired
  pieces(now: number): Piece[] {
    const left = this.left(now)
    if (left === null) {
      return []
    }
    return [
      { text: 'cache ', dim: true },
      left > 0 ? { text: until(left), color: this.color(now) } : { text: 'cold', color: 'red', bold: true },
    ]
  }
}
