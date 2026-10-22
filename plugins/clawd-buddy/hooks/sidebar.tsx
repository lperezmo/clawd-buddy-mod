// The sidebar: the lines under Clawd, moved into a pane of their own and
// given room. A badge with the context fill on top, then the usage limits,
// the prompt cache and the context by category, each under its heading.
// Laid out like topic-filter's sidebar: one row per element, sections under
// a bold title, bars that fill toward the right.

import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { Cache } from './cache'
import type { Compactor } from './compactor'
import type { Files, Touch } from './files'
import { LABEL as LENS_LABEL } from './lens'
import type { Lens } from './lens'
import { short, until } from './weather'
import type { Piece, Weather } from './weather'

export const SIDEBAR_ID = 'clawd-buddy'
export const SIDEBAR_TITLE = 'clawd-buddy'

export type SidebarUi = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export type SidebarInput = {
  weather: Weather
  lens: Lens
  cache: Cache
  compactor: Compactor
  now: number
  // the pane's body, in cells
  columns: number
  rows: number
  files: Files
  // the editor's command name, for the words on its buttons
  editorName: string
  onOpen: (t: Touch) => void
  onProject: () => void
  onFollow: () => void
  onCount: () => void
  // reads the limits again
  onRefresh: () => void
  onCompact: () => void
  onAuto: () => void
  onSlide: (at: number) => void
  // Clawd's size in the desktop app: absent where he is drawn in cells
  size?: { stops: readonly number[]; at: number; onPick: (scale: number) => void }
}

const LABEL = 7
const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  k: 'ᵏ',
  M: 'ᴹ',
  '.': '·',
}

// 300k as ³⁰⁰ᵏ: the slider's cutesie little numbers
export const little = (n: number) => [...short(n)].map((c) => SUPERSCRIPT[c] ?? c).join('')
// git's marks: changed, added, deleted, untracked
const MARK_COLOR: Record<string, string> = { M: 'yellow', A: 'green', D: 'red', U: 'green' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const clock = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 14:10 today, Thu 16:00 further out
const when = (at: number, now: number) =>
  at - now < 20 * 3_600_000 ? clock(at) : `${DAYS[new Date(at).getDay()]} ${clock(at)}`

export function sidebarView({ Box, Text, Button }: SidebarUi, input: SidebarInput): RenderElement {
  const { weather, lens, cache, compactor, now } = input
  const columns = Math.max(24, input.columns - 1)
  const top: RenderElement[] = []
  const body: RenderElement[] = []
  const bottom: RenderElement[] = []
  let used = 0
  const add = (to: RenderElement[], element: RenderElement, rows = 1) => {
    to.push(element)
    used += rows
  }
  const draw = (key: string, pieces: Piece[]) =>
    pieces
      .filter((p) => p.text !== '')
      .map((p, i) => (
        <Text key={`${key}-${i}`} color={p.color} dimColor={p.dim} bold={p.bold}>
          {p.text}
        </Text>
      ))
  // a bar `width` wide, `share` (0 to 1) of it filled
  const bar = (key: string, share: number, width: number, color: string) => {
    const fill = Math.max(share > 0 ? 1 : 0, Math.min(width, Math.round(share * width)))
    return draw(key, [
      { text: '█'.repeat(fill), color },
      { text: '░'.repeat(width - fill), dim: true },
    ])
  }
  const heading = (key: string, title: string, aside?: string) =>
    add(
      body,
      <Box key={key} flexDirection="row" marginTop={1}>
        <Box key="title" flexGrow={1}>
          <Text key="title" bold>
            {title}
          </Text>
        </Box>
        {aside ? (
          <Text key="aside" dimColor>
            {aside}
          </Text>
        ) : null}
      </Box>,
      2,
    )

  header()
  limits()
  prompt()
  touched()
  context()
  auto()
  size()
  footer()

  // Pin the footer to the floor when everything fits; else the pane scrolls.
  const spare = input.rows - used
  return (
    <Box flexDirection="column" paddingRight={1}>
      {top}
      {body}
      {spare > 0 ? <Box key="spacer" height={spare} /> : null}
      {bottom}
    </Box>
  )

  function header(): void {
    const b = lens.breakdown
    const f = weather.current()
    const percent = b?.percentage ?? f?.reading.percent
    if (percent === undefined) {
      add(
        top,
        <Text key="waiting" dimColor>
          Waiting for Claude's first answer.
        </Text>,
      )
      return
    }
    add(
      top,
      <Box key="badge" flexDirection="row">
        <Text key="n" bold inverse color="claude">{` ${percent}% `}</Text>
        <Text key="what" bold>
          {' of context'}
        </Text>
        <Box key="gap" flexGrow={1} />
        {f ? (
          <Text key="sky" color={f.color} bold>
            {`${f.icon}  ${f.word}`}
          </Text>
        ) : null}
      </Box>,
    )
    const tokens = b
      ? `${short(b.totalTokens)} of ${short(b.rawMaxTokens)}`
      : f
        ? `${short(f.reading.tokens)} of ${short(f.reading.window)}`
        : ''
    add(
      top,
      <Text key="detail" dimColor wrap="truncate-end">
        {[tokens, b?.model].filter(Boolean).join(' · ')}
      </Text>,
    )
    if (weather.readings.length > 1) {
      add(
        top,
        <Box key="trend" flexDirection="row">
          <Text key="chart" color={f?.color}>
            {weather.chart()}
          </Text>
          <Text key="delta" dimColor>{`  ${weather.trend()} last turn`}</Text>
        </Box>,
      )
    }
  }

  function limits(): void {
    const windows = weather.windowsLeft(now)
    if (!windows.length) {
      return
    }
    add(
      body,
      <Box key="limits" flexDirection="row" marginTop={1}>
        <Box key="title" flexGrow={1}>
          <Text key="title" bold>
            Usage limits
          </Text>
        </Box>
        <Button key="limits-refresh" plain hotkey="l" dimColor onPress={input.onRefresh}>
          ↻ refresh
        </Button>
      </Box>,
      2,
    )
    const width = Math.max(4, columns - LABEL - 10)
    for (const w of windows) {
      add(
        body,
        <Box key={`limit-${w.label}`} flexDirection="row">
          <Text key="label" dimColor>
            {w.label.padEnd(LABEL)}
          </Text>
          {bar(`limit-${w.label}`, w.left / 100, width, w.color)}
          <Text key="n" color={w.color}>
            {`${w.left}%`.padStart(5)}
          </Text>
        </Box>,
      )
      if (!Number.isNaN(w.resetsAt) && now > 0) {
        add(
          body,
          <Text key={`limit-${w.label}-reset`} dimColor wrap="truncate-end">
            {`${''.padEnd(LABEL)}resets in ${until(w.resetsAt - now)} · ${when(w.resetsAt, now)}`}
          </Text>,
        )
      }
    }
  }

  function prompt(): void {
    heading('cache', 'Prompt cache', `${cache.label} TTL`)
    const left = cache.left(now)
    if (left === null) {
      add(
        body,
        <Text key="cache-waiting" dimColor>
          Starts with Claude's next request.
        </Text>,
      )
      return
    }
    const width = Math.max(4, columns - LABEL - 10)
    const isWarm = left > 0
    add(
      body,
      <Box key="cache-bar" flexDirection="row">
        <Text key="label" dimColor>
          {(isWarm ? 'warm' : 'cold').padEnd(LABEL)}
        </Text>
        {bar('cache', isWarm ? left / cache.ttl : 0, width, cache.color(now))}
        <Text key="n" color={cache.color(now)} bold={!isWarm}>
          {(isWarm ? until(left) : 'cold').padStart(Math.max(5, until(left).length + 1))}
        </Text>
      </Box>,
    )
    add(
      body,
      <Text key="cache-at" dimColor wrap="truncate-end">
        {`${''.padEnd(LABEL)}${isWarm ? 'goes cold at' : 'went cold at'} ${clock(cache.lastAt + cache.ttl)} · last request ${clock(cache.lastAt)}`}
      </Text>,
    )
  }

  // The files Claude touched, newest first, each with git's mark: press one to
  // open it where Claude left it. Follow opens each as Claude changes it.
  function touched(): void {
    const { files } = input
    heading('files', 'Files', `opens in ${input.editorName}`)
    add(
      body,
      <Box key="files-follow" flexDirection="row" gap={2}>
        <Button key="follow-toggle" plain hotkey="f" dimColor={!files.isFollowing} onPress={input.onFollow}>
          {files.isFollowing ? '● follow' : '○ follow'}
        </Button>
        <Text key="follow-what" dimColor wrap="truncate-end">
          {files.isFollowing ? `each change opens in ${input.editorName}` : 'open each change as it happens'}
        </Text>
      </Box>,
    )
    if (!files.touches.length) {
      add(
        body,
        <Text key="files-none" dimColor>
          None yet.
        </Text>,
      )
      return
    }
    files.touches.forEach((t, i) => {
      const mark = files.mark(t)
      add(
        body,
        <Box key={`file-${i}`} flexDirection="row">
          <Text key="mark" color={MARK_COLOR[mark]} bold>
            {(mark || ' ').padEnd(2)}
          </Text>
          <Button key={`open-${i}`} plain dimColor={t.kind === 'read'} onPress={() => input.onOpen(t)}>
            {files.label(t, columns - 2)}
          </Button>
        </Box>,
      )
    })
  }

  function context(): void {
    if (!lens.breakdown) {
      return
    }
    heading('context', 'Context', lens.isCounting ? 'counting…' : lens.isExact ? 'counted exactly' : 'estimated')
    for (const row of lens.rows(columns, weather.growth())) {
      if (row.key === 'head' || row.key === 'counted') {
        continue
      }
      add(
        body,
        <Box key={`lens-${row.key}`} flexDirection="row">
          <Box key="label" width={LENS_LABEL} flexShrink={0} overflow="hidden">
            <Text dimColor wrap="truncate">
              {row.label}
            </Text>
          </Box>
          {row.bar === undefined ? (
            draw(row.key, row.pieces)
          ) : (
            <Box key="bar" width={row.bar} flexShrink={0} flexDirection="row" overflow="hidden">
              {draw(row.key, row.pieces)}
            </Box>
          )}
          {row.figures?.map((f, i) => (
            <Box key={`figure-${i}`} width={f.width} flexShrink={0} justifyContent="flex-end">
              <Text dimColor={f.dim}>{f.text}</Text>
            </Box>
          ))}
        </Box>,
      )
    }
  }

  // Auto-compact: on or off, and a slider of thresholds, each stop clickable.
  // Clawd's size on the desktop: a stop per size, dot over number, each
  // clickable, in boxes of fixed width so they line up in any font.
  function size(): void {
    if (!input.size) {
      return
    }
    const { stops, at, onPick } = input.size
    heading('size', 'Clawd size', `${at}× pixels`)
    const slot = Math.max(5, Math.min(9, Math.floor((columns - 2) / stops.length)))
    add(
      body,
      <Box key="size-slider" flexDirection="row">
        {stops.map((v) => (
          <Box key={`size-${v}`} width={slot} flexDirection="column" alignItems="center">
            <Button key={`size-dot-${v}`} plain dimColor={v !== at} onPress={() => onPick(v)}>
              {v === at ? '●' : '○'}
            </Button>
            <Button key={`size-num-${v}`} plain dimColor={v !== at} onPress={() => onPick(v)}>
              {String(v)}
            </Button>
          </Box>
        ))}
      </Box>,
      2,
    )
  }

  function auto(): void {
    const window = lens.breakdown?.rawMaxTokens ?? weather.current()?.reading.window ?? 0
    const stops = compactor.stops(window)
    const isOn = compactor.isOn
    heading('auto', 'Auto-compact', isOn ? `at ${short(compactor.at)}` : 'off')
    add(
      body,
      <Box key="auto-switch" flexDirection="row" gap={2}>
        <Button key="auto-toggle" plain hotkey="u" onPress={input.onAuto}>
          {isOn ? '● on' : '○ off'}
        </Button>
        <Text key="auto-what" dimColor wrap="truncate-end">
          {isOn ? 'compacts after the turn that passes it' : 'turn on to compact at your own threshold'}
        </Text>
      </Box>,
    )
    if (!stops.length) {
      add(
        body,
        <Text key="auto-none" dimColor>
          Needs a context window over 300k.
        </Text>,
      )
      return
    }
    // Each stop gets a slot of equal width: the dot on the track, its little
    // number under it, both clickable. The lit stop and the track up to it are
    // in Claude's orange while auto-compact is on.
    const lit = Math.max(
      0,
      stops.findIndex((v) => v >= compactor.at),
    )
    const slot = Math.max(5, Math.min(9, Math.floor((columns - 2) / stops.length)))
    const left = Math.floor((slot - 1) / 2)
    const right = slot - 1 - left
    const color = isOn ? 'claude' : undefined
    // one column a stop: its track and dot over its number, each part in a box
    // of fixed width so the dots land in the same place in any font
    const columnsOf = stops.map((v, i) => {
      const isPast = i <= lit
      const pick = () => input.onSlide(v)
      return (
        <Box key={`stop-col-${v}`} width={slot} flexShrink={0} flexDirection="column">
          <Box key="track" flexDirection="row">
            <Box key="l" width={left} flexShrink={0} overflow="hidden">
              <Text color={isPast && i > 0 ? color : undefined} dimColor={!isOn || !isPast} wrap="truncate">
                {(i === 0 ? ' ' : '─').repeat(left)}
              </Text>
            </Box>
            <Button key={`stop-${v}`} plain dimColor={!isOn || i !== lit} onPress={pick}>
              {i === lit ? '●' : '○'}
            </Button>
            <Box key="r" width={right} flexShrink={0} overflow="hidden">
              <Text color={i < lit ? color : undefined} dimColor={!isOn || i >= lit} wrap="truncate">
                {(i === stops.length - 1 ? ' ' : '─').repeat(right)}
              </Text>
            </Box>
          </Box>
          <Box key="number" width={slot} justifyContent="center">
            <Button key={`num-${v}`} plain dimColor={!isOn || i !== lit} onPress={pick}>
              {little(v)}
            </Button>
          </Box>
        </Box>
      )
    })
    add(
      body,
      <Box key="auto-slider" flexDirection="row">
        {columnsOf}
      </Box>,
      2,
    )
  }

  function footer(): void {
    add(
      bottom,
      <Text key="rule" dimColor>
        {'─'.repeat(columns)}
      </Text>,
    )
    add(
      bottom,
      <Box key="actions" flexDirection="row" gap={2}>
        <Button key="side-compact" plain hotkey="c" dimColor={!compactor.isArmed} onPress={input.onCompact}>
          {compactor.isCompacting ? 'compacting…' : compactor.isArmed ? 'press again to compact' : 'compact now'}
        </Button>
        {lens.breakdown && !lens.isExact && !lens.isCounting ? (
          <Button key="side-count" plain hotkey="r" dimColor onPress={input.onCount}>
            count exactly
          </Button>
        ) : null}
        <Button key="side-project" plain hotkey="z" dimColor onPress={input.onProject}>
          {`project in ${input.editorName}`}
        </Button>
      </Box>,
    )
  }
}
