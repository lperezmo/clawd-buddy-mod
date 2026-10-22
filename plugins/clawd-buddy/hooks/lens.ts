// The context view under the weather line: one stacked bar of the window by
// category, opened in place into a row per category, the way /context lists
// them. The rows follow context-lens from Arunjay4213/claude-mods.

import { short } from './weather'
import type { Piece } from './weather'

export type Category = { name: string; tokens: number; color: string; kind: string }
export type Breakdown = {
  categories: Category[]
  totalTokens: number
  rawMaxTokens: number
  percentage: number
  model: string
  autoCompactThreshold?: number
}
// A figure right-aligned in a column `width` cells wide.
export type Figure = { text: string; width: number; dim?: boolean }
// `bar`: the cells the pieces take, when they are a bar; drawn in boxes of
// those widths, so rows line up on surfaces whose text is not monospace.
export type Row = { key: string; label: string; pieces: Piece[]; bar?: number; figures?: Figure[] }

export const LABEL = 20
const NUMBERS = 13

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))

// A bar of `width` cells with `tokens` of `total` filled in `color`.
function meter(tokens: number, total: number, width: number, color: string): Piece[] {
  const full = total > 0 ? Math.min(width, Math.round((tokens / total) * width)) : 0
  const shown = tokens > 0 ? Math.max(1, full) : 0
  return [
    { text: '█'.repeat(shown), color },
    { text: '░'.repeat(width - shown), dim: true },
  ]
}

export class Lens {
  breakdown: Breakdown | null = null
  isExact = false
  isOpen = false
  isCounting = false

  set(breakdown: Breakdown | undefined, isExact: boolean): void {
    if (!breakdown || !breakdown.rawMaxTokens) {
      return
    }
    this.breakdown = breakdown
    this.isExact = isExact
  }

  private shown(): Category[] {
    return (this.breakdown?.categories ?? []).filter((c) => c.kind !== 'deferred' && c.tokens > 0)
  }

  // The window as one bar: what is in use by category, then the compaction
  // buffer, then the free space.
  bar(width: number): Piece[] {
    const b = this.breakdown
    if (!b || width < 1) {
      return []
    }
    const order = ['used', 'buffer', 'free']
    const rows = this.shown().sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind))
    const pieces: Piece[] = []
    let tokens = 0
    let cells = 0
    for (const c of rows) {
      tokens += c.tokens
      const end = Math.min(width, Math.round((tokens / b.rawMaxTokens) * width))
      // anything in use shows, if only as one cell
      const n = c.kind === 'used' ? Math.max(1, end - cells) : Math.max(0, end - cells)
      const fill = Math.min(n, width - cells)
      if (fill > 0) {
        pieces.push(
          c.kind === 'free'
            ? { text: '░'.repeat(fill), dim: true }
            : { text: (c.kind === 'buffer' ? '▒' : '█').repeat(fill), color: c.color },
        )
        cells += fill
      }
    }
    if (cells < width) {
      pieces.push({ text: '░'.repeat(width - cells), dim: true })
    }
    return pieces
  }

  summary(): string {
    const b = this.breakdown
    return b ? ` ${b.percentage}% · ${short(b.totalTokens)} / ${short(b.rawMaxTokens)}` : ''
  }

  // The open view: a header, a row per category, then the growth figures.
  rows(columns: number, growth: { last: number; average: number; turns: number } | null): Row[] {
    const b = this.breakdown
    if (!b) {
      return []
    }
    const width = Math.max(8, columns - LABEL - NUMBERS - 2)
    const rows: Row[] = [
      {
        key: 'head',
        label: '',
        pieces: [
          {
            text: `${short(b.totalTokens)} of ${short(b.rawMaxTokens)} used · ${b.percentage}% · ${b.model}`,
            bold: true,
          },
        ],
      },
    ]
    for (const c of this.shown()) {
      const percent = Math.round((c.tokens / b.rawMaxTokens) * 100)
      rows.push({
        key: `cat-${c.name}`,
        label: pad(c.name.toLowerCase(), LABEL),
        pieces: meter(c.tokens, b.rawMaxTokens, width, c.kind === 'free' ? 'inactive' : c.color),
        bar: width,
        figures: [
          { text: short(c.tokens), width: 7 },
          { text: `${percent}%`, width: 5, dim: true },
        ],
      })
    }

    const limit = b.autoCompactThreshold
    if (growth && growth.average > 0) {
      const room = (limit ?? b.rawMaxTokens) - b.totalTokens
      const turns = Math.floor(room / growth.average)
      const sign = growth.last >= 0 ? '+' : '-'
      rows.push({
        key: 'growth',
        label: pad('growth', LABEL),
        pieces: [
          {
            text: `${sign}${short(Math.abs(growth.last))} last turn, +${short(Math.round(growth.average))} average over ${growth.turns} turns`,
          },
        ],
      })
      rows.push({
        key: 'headroom',
        label: pad('headroom', LABEL),
        pieces: [
          { text: `${turns > 99 ? '99+' : Math.max(0, turns)} turns at that rate, ${short(Math.max(0, room))} left` },
        ],
      })
    }
    if (limit) {
      rows.push({
        key: 'limit',
        label: pad('limit', LABEL),
        pieces: [{ text: `${short(limit)}, where auto-compaction runs` }],
      })
    }
    rows.push({
      key: 'counted',
      label: pad('counted', LABEL),
      pieces: [
        {
          text: this.isCounting
            ? 'counting…'
            : this.isExact
              ? 'exactly, with the token-count API'
              : 'locally, as an estimate',
          dim: true,
        },
      ],
    })
    return rows
  }
}
