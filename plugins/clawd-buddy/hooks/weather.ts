// The line under Clawd: how full the context window is, as a weather forecast,
// and what is left of the 5-hour and weekly usage limits.
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

// The usage windows shown, in order; a gateway's spend limit is left out.
const WINDOWS = [
  { kind: 'five_hour', label: '5h' },
  { kind: 'seven_day', label: 'week' },
]

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
    // [context detail, reset times, meters], richest first. Context detail:
    // 0 chart and trend, 1 `of ctx (36k/200k)`, 2 `(36k/200k)`, 3 `ctx`, 4 `ctx` without the word.
    // The token counts outlast the reset times and meters on the right.
    const tries: [number, boolean, boolean][] = [
      [0, true, true],
      [1, true, true],
      [1, false, true],
      [2, false, true],
      [2, false, false],
      [3, false, false],
      [4, false, false],
    ]
    let pair = { left: [] as Piece[], right: [] as Piece[] }
    for (const [detail, isTimed, isMetered] of tries) {
      pair = {
        left: this.forecast(detail),
        right: this.withLead(lead, this.windows(isTimed, isMetered, now)),
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

  private windows(isTimed: boolean, isMetered: boolean, now: number): Piece[] {
    const pieces: Piece[] = []
    for (const { label, left, color, resetsAt: resets } of this.windowsLeft(now)) {
      if (pieces.length) {
        pieces.push({ text: GAP })
      }
      pieces.push({ text: `${label} `, dim: true })
      if (isMetered) {
        const full = Math.round((left / 100) * METER)
        pieces.push({ text: '━'.repeat(full), color })
        pieces.push({ text: '━'.repeat(METER - full) + ' ', dim: true })
      }
      pieces.push({ text: `${left}% left`, color })
      if (isTimed && now > 0 && !Number.isNaN(resets)) {
        pieces.push({ text: ` ↻ ${until(resets - now)}`, dim: true })
      }
    }
    return pieces
  }
}
