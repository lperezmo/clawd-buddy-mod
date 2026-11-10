// The line under Clawd: how full the context window is, as a weather forecast,
// and what is left of the 5-hour, weekly and Fable usage limits. The host
// reports the first two; the Fable limit (the model-scoped weekly window) is
// read from the rate-limit headers of Claude's own replies, so it shows after
// the first reply from a Fable model, and only on a subscription.
//
// The forecast follows token-weather from anthropics/claude-code-playground
// (Apache-2.0, see LICENSE-APACHE and NOTICE): same bands, icons and turn
// chart. Changed from the original: folded into this line, usage limits added.

export type Context = { tokens?: number; window: number; percent?: number }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Piece = { text: string; color?: string; dim?: boolean; bold?: boolean }

type Reading = { tokens: number; window: number; percent: number }

const HISTORY = 12
const BARS = '▁▂▃▄▅▆▇█'
const METER = 8
const GAP = '   '

// Single-width text symbols, not emoji: they line up in every terminal font.
const FORECAST = [
  { upTo: 25, icon: '☀', word: 'Clear', color: 'yellow' },
  { upTo: 50, icon: '☁', word: 'Cloudy', color: 'cyan' },
  { upTo: 75, icon: '☂', word: 'Showers', color: 'blue' },
  { upTo: 90, icon: '☇', word: 'Storm', color: 'magenta' },
  { upTo: Infinity, icon: '↯', word: 'Compact soon', color: 'red' },
]

// The Fable limit, by the name Claude Code uses internally for that window (the
// headers call it `7d_oi`); the mod API does not report it.
export const FABLE = 'seven_day_overage_included'

const FABLE_LABEL = 'fable'

// The usage windows shown, in order; a gateway's spend limit is left out.
const WINDOWS = [
  { kind: 'five_hour', label: '5h' },
  { kind: 'seven_day', label: 'week' },
  { kind: FABLE, label: FABLE_LABEL },
]

// A header's value as a plain decimal (`0.11`, `1794740400`): anything else,
// hex, an exponent, an empty or non-string value, is NaN.
function decimal(value: unknown): number {
  const s = typeof value === 'string' ? value.trim() : ''
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}

// Past this an epoch reset is not in seconds (a time in milliseconds, say).
const MAX_RESET = 1e11

// The Fable limit as a reply's headers carry it: the fraction used and the
// reset in epoch seconds, both needed, as the host's own parser wants them (a
// reading with no reset would never expire). Headers without it (another
// model, an API key, an error) give nothing, and the last reading stands.
export function limitsFromHeaders(headers: unknown): Limit[] {
  try {
    if (typeof headers !== 'object' || headers === null) {
      return []
    }
    const h = headers as Record<string, unknown>
    const fraction = decimal(h['anthropic-ratelimit-unified-7d_oi-utilization'])
    const reset = decimal(h['anthropic-ratelimit-unified-7d_oi-reset'])
    if (!Number.isFinite(fraction) || !(reset > 0 && reset < MAX_RESET)) {
      return []
    }
    // as the host converts it: a percentage to one decimal, at most 100
    const percentUsed = Math.min(Math.round(fraction * 1000) / 10, 100)
    return [{ kind: FABLE, percentUsed, resetsAt: new Date(reset * 1000).toISOString() }]
  } catch {
    return []
  }
}

// The Fable limit from what an `http.fetch` hook's `next` gave: only the reply
// to a model request (`/v1/messages`, on any host) counts, as the response
// itself or wrapped as `{ value }`. Anything else gives nothing.
export function limitsFromReply(url: string, answer: unknown): Limit[] {
  try {
    const path = typeof url === 'string' ? url.split(/[?#]/)[0]! : ''
    if (!path.endsWith('/v1/messages') || typeof answer !== 'object' || answer === null) {
      return []
    }
    const a = answer as { value?: unknown; headers?: unknown }
    const reply = typeof a.value === 'object' && a.value !== null ? (a.value as { headers?: unknown }) : a
    const headers = reply.headers
    return typeof headers === 'object' && headers !== null ? limitsFromHeaders(headers) : []
  } catch {
    return []
  }
}

export function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`
  return String(n)
}

// 3d 4h, 2h 10m, 45m
export function until(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const width = (pieces: Piece[]) => pieces.reduce((n, p) => n + [...p.text].length, 0)

export class Weather {
  readings: Reading[] = []
  limits: Limit[] = []

  // The windows the host reports, without the Fable limit read from the replies' headers.
  get hostLimits(): Limit[] {
    return this.limits.filter((l) => l.kind !== FABLE)
  }

  record(context: Context | undefined, limits: Limit[] | undefined): void {
    // a measure without a window keeps the last one known: only replies carry them
    if (limits?.length) {
      this.limits = [...this.limits.filter((l) => !limits.some((n) => n.kind === l.kind)), ...limits]
    }
    // no response has reported a fill yet
    if (!context?.window || !context.tokens) {
      return
    }
    const tokens = context.tokens
    const percent = Math.round(context.percent ?? (tokens / context.window) * 100)
    if (this.readings.at(-1)?.tokens === tokens) {
      return
    }
    this.readings.push({ tokens, window: context.window, percent })
    if (this.readings.length > HISTORY) {
      this.readings = this.readings.slice(-HISTORY)
    }
  }

  // What the last turn added and the average of the recent turns that grew.
  growth(): { last: number; average: number; turns: number } | null {
    const deltas = this.readings.slice(1).map((r, i) => r.tokens - this.readings[i]!.tokens)
    const grew = deltas.filter((d) => d > 0).slice(-5)
    if (!grew.length) {
      return null
    }
    return {
      last: deltas.at(-1) ?? 0,
      average: grew.reduce((a, b) => a + b, 0) / grew.length,
      turns: grew.length,
    }
  }

  get isEmpty(): boolean {
    return this.readings.length === 0 && this.usage().length === 0
  }

  // The latest reading and its forecast, for the sidebar.
  current(): { reading: Reading; icon: string; word: string; color: string } | null {
    const reading = this.readings.at(-1)
    if (!reading) {
      return null
    }
    const f = FORECAST.find((b) => reading.percent < b.upTo) ?? FORECAST[FORECAST.length - 1]!
    return { reading, ...f }
  }

  // Each usage window: what is left, its color and when it resets (NaN unknown).
  // A window whose reset has passed since the last reply is full again.
  windowsLeft(now = 0): { label: string; left: number; color: string; resetsAt: number }[] {
    return this.usage().map(({ label, limit }) => {
      const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
      if (now > 0 && resetsAt <= now) {
        return { label, left: 100, color: 'green', resetsAt: NaN }
      }
      const left = Math.max(0, Math.min(100, Math.round(100 - limit.percentUsed)))
      return {
        label,
        left,
        color: left > 50 ? 'green' : left > 20 ? 'yellow' : 'red',
        resetsAt,
      }
    })
  }

  // Left and right halves of the line, the richest pair that fits `columns`;
  // `lead` (the cache countdown) opens the right half and always stays.
  line(columns: number, now: number, lead: Piece[] = []): { left: Piece[]; right: Piece[] } {
    // [context detail, reset times, meters, `left` on each, the Fable window], richest first.
    // Context detail: 0 chart and trend, 1 `of ctx (36k/200k)`, 2 `(36k/200k)`, 3 `ctx`,
    // 4 `ctx` without the word. The token counts outlast the reset times and meters on the right.
    // Past the first seven, `left` is said once, after the last window; then the Fable window
    // goes, which leaves the narrowest line exactly as it is with two windows. Without a Fable
    // reading the `left` once tier is skipped, so two windows narrow just as they always have.
    const tries: [number, boolean, boolean, boolean, boolean][] = [
      [0, true, true, true, true],
      [1, true, true, true, true],
      [1, false, true, true, true],
      [2, false, true, true, true],
      [2, false, false, true, true],
      [3, false, false, true, true],
      [4, false, false, true, true],
      [4, false, false, false, true],
      [4, false, false, true, false],
    ]
    const hasFable = this.usage().some((u) => u.label === FABLE_LABEL)
    let pair = { left: [] as Piece[], right: [] as Piece[] }
    for (const [detail, isTimed, isMetered, isWorded, isFable] of tries) {
      if (!isWorded && !hasFable) {
        continue
      }
      pair = {
        left: this.forecast(detail),
        right: this.withLead(lead, this.windows(isTimed, isMetered, isWorded, isFable, now)),
      }
      if (width(pair.left) + width(pair.right) + GAP.length <= columns) {
        break
      }
    }
    return pair
  }

  private withLead(lead: Piece[], rest: Piece[]): Piece[] {
    return lead.length && rest.length ? [...lead, { text: GAP }, ...rest] : [...lead, ...rest]
  }

  private usage(): { label: string; limit: Limit }[] {
    return WINDOWS.flatMap((w) => {
      const limit = this.limits.find((l) => l.kind === w.kind)
      return limit ? [{ label: w.label, limit }] : []
    })
  }

  private forecast(detail: number): Piece[] {
    const now = this.readings.at(-1)
    if (!now) {
      return []
    }
    const f = FORECAST.find((b) => now.percent < b.upTo) ?? FORECAST[FORECAST.length - 1]!
    const counts = `(${short(now.tokens)}/${short(now.window)})`
    const pieces: Piece[] = [
      { text: detail < 4 ? `${f.icon}  ${f.word}` : f.icon, color: f.color, bold: true },
      { text: `  ${now.percent}%` },
    ]
    if (detail <= 1) {
      pieces.push({ text: ' of ctx ' }, { text: counts, dim: true })
    } else if (detail === 2) {
      pieces.push({ text: ' ' }, { text: counts, dim: true })
    } else {
      pieces.push({ text: ' ctx' })
    }
    if (detail === 0 && this.readings.length > 1) {
      pieces.push({ text: '  ' + this.chart(), color: f.color })
      pieces.push({ text: '  ' + this.trend(), dim: true })
    }
    return pieces
  }

  // Bars scale to the busiest reading shown, so growth shows at any fill level.
  chart(): string {
    const top = Math.max(...this.readings.map((r) => r.tokens), 1)
    return this.readings
      .map((r) => BARS[Math.min(BARS.length - 1, Math.floor((r.tokens / top) * (BARS.length - 1)))])
      .join('')
  }

  trend(): string {
    const [before, now] = this.readings.slice(-2)
    const delta = (now?.tokens ?? 0) - (before?.tokens ?? 0)
    if (delta > 0) return `▲ +${short(delta)}`
    if (delta < 0) return `▼ ${short(-delta)}`
    return 'steady'
  }

  private windows(isTimed: boolean, isMetered: boolean, isWorded: boolean, isFable: boolean, now: number): Piece[] {
    const pieces: Piece[] = []
    const windows = this.windowsLeft(now).filter((w) => isFable || w.label !== FABLE_LABEL)
    for (const [i, { label, left, color, resetsAt: resets }] of windows.entries()) {
      if (pieces.length) {
        pieces.push({ text: GAP })
      }
      pieces.push({ text: `${label} `, dim: true })
      if (isMetered) {
        const full = Math.round((left / 100) * METER)
        pieces.push({ text: '━'.repeat(full), color })
        pieces.push({ text: '━'.repeat(METER - full) + ' ', dim: true })
      }
      pieces.push({ text: isWorded || i === windows.length - 1 ? `${left}% left` : `${left}%`, color })
      if (isTimed && now > 0 && !Number.isNaN(resets)) {
        pieces.push({ text: ` ↻ ${until(resets - now)}`, dim: true })
      }
    }
    return pieces
  }
}
