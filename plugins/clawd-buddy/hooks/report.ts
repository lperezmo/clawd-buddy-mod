// /clawd context: what the band and the sidebar show, as plain text, for a
// screen that gets the command's answer but not the mod's own lines (the
// phone, through remote control). No bars: they do not line up there.

import type { Cache } from './cache'
import type { Compactor } from './compactor'
import type { Lens } from './lens'
import { short, until } from './weather'
import type { Weather } from './weather'

const text = (pieces: { text: string }[]) => pieces.map((p) => p.text).join('')

export function report(o: { weather: Weather; lens: Lens; cache: Cache; compactor: Compactor; now: number }): string {
  const { weather, lens, cache, compactor, now } = o
  const lines: string[] = []

  const current = weather.current()
  const b = lens.breakdown
  if (b) {
    const word = current ? `${current.icon} ${current.word}, ` : ''
    lines.push(
      `Context  ${word}${b.percentage}% of ${short(b.rawMaxTokens)} (${short(b.totalTokens)} used), ${b.model}`,
    )
    for (const row of lens.rows(80, weather.growth())) {
      if (row.key === 'head') {
        continue
      }
      const rest = row.figures ? row.figures.map((f) => f.text.padStart(f.width)).join('') : ` ${text(row.pieces)}`
      lines.push(`  ${row.label}${rest}`)
    }
  } else if (current) {
    const r = current.reading
    lines.push(
      `Context  ${current.icon} ${current.word}, ${r.percent}% of ${short(r.window)} (${short(r.tokens)} used)`,
    )
  } else {
    lines.push('Context  no reading yet; the first reply brings one')
  }

  const left = cache.left(now)
  if (left === null) {
    lines.push(`Cache    no request yet this session (${cache.label} TTL, ${cache.source})`)
  } else {
    const ago = until(now - cache.lastAt)
    lines.push(
      left > 0
        ? `Cache    hot, ${until(left)} left of ${cache.label} (${cache.source}, last request ${ago} ago)`
        : `Cache    cold for ${until(-left)} (${cache.label} TTL, ${cache.source}, last request ${ago} ago)`,
    )
  }

  const windows = weather.windowsLeft(now)
  windows.forEach((w, i) => {
    const resets = now > 0 && !Number.isNaN(w.resetsAt) ? `, resets in ${until(w.resetsAt - now)}` : ''
    lines.push(`${i === 0 ? 'Limits ' : '       '}  ${w.label}: ${w.left}% left${resets}`)
  })
  if (!windows.length) {
    lines.push('Limits   not reported yet')
  }

  lines.push(`Compact  Clawd's auto-compact ${compactor.isOn ? `on, at ${short(compactor.at)}` : 'off'}`)

  return lines.join('\n')
}
