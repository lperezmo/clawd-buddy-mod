import { expect, mock, test } from 'claude-code/testing'

import { CLONE_TICKS, Clawd, FPS, MOVES, ROWS, tallest } from '../hooks/actor'
import { Cache, TTL_1H, TTL_5M, ttlFromEnv, ttlFromTiming } from '../hooks/cache'
import { Compactor, FLOOR } from '../hooks/compactor'
import { defaultEditor, Files, lineOf } from '../hooks/files'
import { Lens } from '../hooks/lens'
import {
  CELEBRATE,
  CHILL,
  CHILL_DEEP,
  CHILL_FIRST,
  isThanks,
  lean,
  pick,
  RIDES,
  workFor,
  WORK_ACTS,
} from '../hooks/moods'
import type { Work } from '../hooks/moods'
import { report } from '../hooks/report'
import { little } from '../hooks/sidebar'
import { ACTS } from '../hooks/sprites'
import { cloneNumber, count, encode, windowArgv, windowScript } from '../hooks/multiply'
import { until, Weather } from '../hooks/weather'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 60,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

function decode(cells: string): number[] {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return Array.from(new Uint32Array(bytes.buffer))
}

test('the band draws Clawd standing on the bottom rows', async ($) => {
  const ui = await $.ui.mount({
    plugin: 'clawd-buddy',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: PROPS,
  })
  const raster = await ui.find({ key: 'clawd' })
  expect(raster?.type).toBe('Raster')
  expect(raster?.props.columns).toBe(60)
  expect(raster?.props.rows).toBe(17)

  const words = decode(String(raster?.props.cells))
  expect(words.length).toBe(60 * 17 * 3)
  const inked = (row: number) =>
    Array.from({ length: 60 }, (_, c) => words[(row * 60 + c) * 3]).filter((cp) => cp !== 0x20).length
  // standing Clawd is 24 cells wide and fills the last rows, nothing above
  expect(inked(16)).toBeGreaterThan(0)
  expect(inked(0)).toBe(0)
})

test('the desktop band draws Clawd as an SVG of the same pixels', async ($) => {
  const ui = await $.ui.mount({
    plugin: 'clawd-buddy',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: PROPS,
  })
  // an Svg keeps no key of its own
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.type).toBe('Svg')
  const source = String(svg?.props.source)
  // 60 columns of about 14 CSS pixels: a world 280 sprite pixels wide, three
  // CSS pixels each, sized on the element so the surface cannot stretch it
  expect(source).toContain('viewBox="0 0 280 34"')
  expect(svg?.props.width).toBe(840)
  expect(svg?.props.height).toBe(102)
  expect(source).toContain('shape-rendering="crispEdges"')
  // standing Clawd: orange body and dark eyes, on the bottom row
  expect(source.match(/<path /g)?.length).toBe(2)
  expect(source).toContain('fill="#d97757"')
  expect(source).toContain('fill="#141413"')
  expect(source).toMatch(/M\d+ 33h/)
  expect(source.length).toBeLessThan(131072)
  expect(await ui.find({ key: 'do-chill' })).toBeDefined()
})

test(
  'the desktop size option scales him, and his world still spans the band',
  { options: { desktopSize: '2' } },
  async ($) => {
    const ui = await $.ui.mount({ plugin: 'clawd-buddy', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const svg = await ui.find({ type: 'Svg' })
    expect(String(svg?.props.source)).toContain('viewBox="0 0 420 34"')
    expect(svg?.props.width).toBe(840)
    expect(svg?.props.height).toBe(68)
  },
)

test('a short band leaves a row for the buttons', async ($) => {
  const ui = await $.ui.mount({
    plugin: 'clawd-buddy',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...PROPS, maxRows: 6 },
  })
  expect((await ui.find({ key: 'clawd' }))?.props.rows).toBe(5)
  expect(await ui.find({ key: 'do-chill' })).toBeDefined()
})

test('another mod row beneath shows above Clawd', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>another mod row</Text>
  })
  // a band with no spare row: Clawd gives one up for it
  const ui = await $.ui.mount({
    plugin: 'clawd-buddy',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...PROPS, maxRows: 18 },
  })
  // a key does not cross from another plugin's tree; its text does
  expect(JSON.stringify(await ui.drawn())).toContain('another mod row')
  expect((await ui.find({ key: 'clawd' }))?.props.rows).toBe(16)
})

test('a survey keeps the band', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  const ui = await $.ui.mount({
    plugin: 'clawd-buddy',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...PROPS, hasSurvey: true },
  })
  expect(await ui.find({ key: 'clawd' })).toBeUndefined()
})

test('/clawd knows its moves', async ($) => {
  const run = (args: string) =>
    $.command.run({
      command: 'clawd',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
  expect((await run('car')).text).toBe('Clawd is off: car.')
  expect((await run('fly')).text).toContain('Clawd knows the moods: celebrate, lock in, chill')
  expect((await run('chill')).text).toMatch(/^Clawd: [a-zA-Z]+[.]$/)
  expect((await run('lock in')).text).toMatch(/^Clawd: [a-zA-Z]+[.]$/)
  expect((await run('')).text).toBe('Clawd hops.')
})

test('every move plays through and hands Clawd back', () => {
  for (const move of MOVES) {
    const clawd = new Clawd()
    clawd.resize(80)
    // a stroll to a spot a few cells off is skipped, so walk somewhere far
    clawd.request(move, move === 'walk' ? 70 : undefined)
    clawd.step()
    expect(clawd.play?.move).toBe(move)
    // the open-ended floats run until something happens
    if (move === 'space' || move === 'pool') {
      for (let t = 0; t < 60; t++) clawd.step()
      clawd.wake()
    }
    let ticks = 0
    while (clawd.play && ticks < 2000) {
      clawd.step()
      ticks++
    }
    expect(clawd.play).toBeNull()
  }
})

test('from a wall Clawd rides away from it, and strolls back out after', () => {
  const left = new Clawd()
  left.resize(200)
  left.center = 12
  left.request('car')
  left.step()
  expect(left.play?.move).toBe('car')
  expect(left.facing).toBe(1)

  const right = new Clawd()
  right.resize(200)
  right.center = 188
  right.request('bike')
  right.step()
  expect(right.facing).toBe(-1)

  // a kite stays put; when it ends against the wall he walks back toward the middle
  const parked = new Clawd()
  parked.resize(200)
  parked.center = 12
  parked.request('kite')
  let ticks = 0
  while (parked.play?.move !== 'walk' && ticks < 2000) {
    parked.step()
    ticks++
  }
  expect(parked.play?.move).toBe('walk')
  expect(parked.facing).toBe(1)
})

test('a ride runs on while a stroll gives way', () => {
  const clawd = new Clawd()
  clawd.resize(80)
  clawd.request('car')
  clawd.step()
  clawd.request('kite')
  for (let t = 0; t < 5; t++) clawd.step()
  expect(clawd.play?.move).toBe('car')
  expect(clawd.pending?.move).toBe('kite')
})

const text = (pieces: { text: string }[]) => pieces.map((p) => p.text).join('')

test('the weather line reads the context and what is left of each limit', () => {
  const weather = new Weather()
  expect(weather.isEmpty).toBe(true)
  const now = Date.parse('2026-10-04T12:00:00Z')
  weather.record({ tokens: 20_000, window: 200_000 }, [])
  weather.record({ tokens: 36_000, window: 200_000, percent: 18 }, [
    { kind: 'five_hour', percentUsed: 7, resetsAt: '2026-10-04T14:10:00Z' },
    { kind: 'seven_day', percentUsed: 23.5, resetsAt: '2026-10-07T16:00:00Z' },
    { kind: 'spend_limit', percentUsed: 50 },
  ])
  const wide = weather.line(160, now)
  expect(text(wide.left)).toBe('☀  Clear  18% of ctx (36k/200k)  ▄█  ▲ +16k')
  expect(text(wide.right)).toBe('5h ━━━━━━━━ 93% left ↻ 2h 10m   week ━━━━━━━━ 77% left ↻ 3d 4h')
  // a narrow band keeps the forecast and the percentages
  const narrow = weather.line(47, now)
  expect(text(narrow.left)).toBe('☀  Clear  18% ctx')
  expect(text(narrow.right)).toBe('5h 93% left   week 77% left')
})

test('as the band narrows the token counts outlast the meters and reset times', () => {
  const weather = new Weather()
  const now = Date.parse('2026-10-04T12:00:00Z')
  weather.record({ tokens: 20_000, window: 200_000 }, [])
  weather.record({ tokens: 36_000, window: 200_000, percent: 18 }, [
    { kind: 'five_hour', percentUsed: 7, resetsAt: '2026-10-04T14:10:00Z' },
    { kind: 'seven_day', percentUsed: 23.5, resetsAt: '2026-10-07T16:00:00Z' },
  ])
  const steps = [160, 100, 90, 72, 54, 47, 40].map((columns) => {
    const { left, right } = weather.line(columns, now)
    return `${text(left)} | ${text(right)}`
  })
  expect(steps).toEqual([
    '☀  Clear  18% of ctx (36k/200k)  ▄█  ▲ +16k | 5h ━━━━━━━━ 93% left ↻ 2h 10m   week ━━━━━━━━ 77% left ↻ 3d 4h',
    '☀  Clear  18% of ctx (36k/200k) | 5h ━━━━━━━━ 93% left ↻ 2h 10m   week ━━━━━━━━ 77% left ↻ 3d 4h',
    '☀  Clear  18% of ctx (36k/200k) | 5h ━━━━━━━━ 93% left   week ━━━━━━━━ 77% left',
    '☀  Clear  18% (36k/200k) | 5h ━━━━━━━━ 93% left   week ━━━━━━━━ 77% left',
    '☀  Clear  18% (36k/200k) | 5h 93% left   week 77% left',
    '☀  Clear  18% ctx | 5h 93% left   week 77% left',
    '☀  18% ctx | 5h 93% left   week 77% left',
  ])
})

test('the countdown reads in days, hours or minutes', () => {
  expect(until(45 * 60_000)).toBe('45m')
  expect(until((2 * 60 + 10) * 60_000)).toBe('2h 10m')
  expect(until((3 * 24 + 4) * 3_600_000)).toBe('3d 4h')
})

const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 4_200, color: 'promptBorder', kind: 'used' },
    { name: 'System tools', tokens: 36_600, color: 'inactive', kind: 'used' },
    { name: 'MCP tools', tokens: 9_000, color: 'cyan', kind: 'deferred' },
    { name: 'Messages', tokens: 100_000, color: 'purple', kind: 'used' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', kind: 'buffer' },
    { name: 'Free space', tokens: 826_200, color: 'inactive', kind: 'free' },
  ],
  totalTokens: 140_800,
  rawMaxTokens: 1_000_000,
  percentage: 14,
  model: 'claude-opus-5-5',
  autoCompactThreshold: 967_000,
}

test('the context bar spans its width and the open view lists each category', () => {
  const lens = new Lens()
  lens.set(BREAKDOWN, false)
  for (const width of [10, 37, 100]) {
    expect(text(lens.bar(width)).length).toBe(width)
  }
  expect(lens.summary()).toBe(' 14% · 140.8k / 1M')
  const rows = lens.rows(100, { last: 6_000, average: 5_000, turns: 3 })
  const keys = rows.map((r) => r.key)
  expect(keys).toContain('cat-Messages')
  // deferred tool schemas sit outside the window
  expect(keys).not.toContain('cat-MCP tools')
  expect(text(rows.find((r) => r.key === 'headroom')!.pieces)).toBe('99+ turns at that rate, 826.2k left')
  expect(text(rows.find((r) => r.key === 'counted')!.pieces)).toBe('locally, as an estimate')
})

test('/clawd hide tucks him away and keeps the buttons to bring him back', async ($, on) => {
  mock.store(on)
  const run = (args: string) =>
    $.command.run({
      command: 'clawd',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
  expect((await run('hide')).text).toContain('tucked away')
  const mount = () => $.ui.mount({ plugin: 'clawd-buddy', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  let ui = await mount()
  expect(await ui.find({ key: 'clawd' })).toBeUndefined()
  expect(await ui.find({ key: 'do-chill' })).toBeUndefined()
  expect((await ui.find({ key: 'clawd-toggle' }))?.props.label).toBe('show clawd')
  await ui.press({ key: 'clawd-toggle' })
  ui = await mount()
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
})

test('the reload button runs /reload-plugins', async ($, on) => {
  const ran: string[] = []
  on('command.run', ($, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  const ui = await $.ui.mount({ plugin: 'clawd-buddy', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'reload-plugins' })
  expect(ran).toContain('reload-plugins')
})

test('the cache counts down from the last request and goes cold', () => {
  const cache = new Cache()
  cache.ttl = 60 * 60_000
  const now = Date.parse('2026-10-04T12:00:00Z')
  expect(cache.pieces(now)).toEqual([])
  cache.lastAt = now - 18 * 60_000
  expect(text(cache.pieces(now))).toBe('cache 42m')
  expect(cache.color(now)).toBe('green')
  cache.lastAt = now - 45 * 60_000
  expect(cache.color(now)).toBe('yellow')
  cache.lastAt = now - 61 * 60_000
  expect(text(cache.pieces(now))).toBe('cache cold')
})

test('/clawd context reads the band out as text', () => {
  const now = Date.parse('2026-10-04T12:00:00Z')
  const weather = new Weather()
  const lens = new Lens()
  const cache = new Cache()
  const compactor = new Compactor()
  cache.ttl = 60 * 60_000
  expect(report({ weather, lens, cache, compactor, now })).toBe(
    [
      'Context  no reading yet; the first reply brings one',
      'Cache    no request yet this session (1h TTL, from the environment)',
      'Limits   not reported yet',
      "Compact  Clawd's auto-compact off",
    ].join('\n'),
  )

  weather.record({ tokens: 134_800, window: 1_000_000 }, [])
  weather.record({ tokens: 140_800, window: 1_000_000, percent: 14 }, [
    { kind: 'five_hour', percentUsed: 7, resetsAt: '2026-10-04T14:10:00Z' },
    { kind: 'seven_day', percentUsed: 23.5, resetsAt: '2026-10-07T16:00:00Z' },
  ])
  lens.set(BREAKDOWN, false)
  cache.lastAt = now - 18 * 60_000
  compactor.isOn = true
  const out = report({ weather, lens, cache, compactor, now })
  expect(out).toContain('Context  ☀ Clear, 14% of 1M (140.8k used), claude-opus-5-5')
  expect(out).toContain('  messages               100k  10%')
  expect(out).not.toContain('mcp tools')
  expect(out).toContain('  headroom             ')
  expect(out).toContain('Cache    hot, 42m left of 1h (from the environment, last request 18m ago)')
  expect(out).toContain('Limits   5h: 93% left, resets in 2h 10m')
  expect(out).toContain('         week: 77% left, resets in 3d 4h')
  expect(out).toContain("Compact  Clawd's auto-compact on, at 500k")
  // no bars: they do not line up on the phone
  expect(out).not.toMatch(/[█░▒━]/)

  cache.lastAt = now - 70 * 60_000
  expect(report({ weather, lens, cache, compactor, now })).toContain(
    'Cache    cold for 10m (1h TTL, from the environment, last request 1h 10m ago)',
  )
})

test('the cache TTL: environment, then request timing, then the plan', () => {
  expect(ttlFromEnv('1h', undefined, undefined)).toBe(TTL_1H)
  expect(ttlFromEnv(undefined, '1', '1')).toBe(TTL_5M)
  expect(ttlFromEnv(undefined, undefined, 'true')).toBe(TTL_1H)
  expect(ttlFromEnv(undefined, '0', undefined)).toBeNull()

  const cache = new Cache()
  // an API key: no rate-limit windows
  expect(cache.label).toBe('5m')
  // a subscription within its limits: Claude Code picks 1 hour
  cache.limits = [{ kind: 'five_hour', percentUsed: 40 }]
  expect(cache.label).toBe('1h')
  expect(cache.source).toBe('subscription default')
  cache.limits = [{ kind: 'five_hour', percentUsed: 100 }]
  expect(cache.label).toBe('5m')

  const read = { input_tokens: 10, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 500 }
  const wrote = { input_tokens: 10, cache_read_input_tokens: 500, cache_creation_input_tokens: 50_000 }
  expect(ttlFromTiming(20 * 60_000, read, false)).toBe(TTL_1H)
  expect(ttlFromTiming(20 * 60_000, wrote, false)).toBe(TTL_5M)
  expect(ttlFromTiming(20 * 60_000, wrote, true)).toBeNull()
  expect(ttlFromTiming(3 * 60_000, read, false)).toBeNull()
  cache.timedTtl = TTL_1H
  expect(cache.label).toBe('1h')
  cache.envTtl = TTL_5M
  expect(cache.label).toBe('5m')
})

test('the limits outlast a measure without them, and read full once reset', () => {
  const weather = new Weather()
  const now = Date.parse('2026-10-04T12:00:00Z')
  weather.record(undefined, [
    { kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-04T13:00:00Z' },
    { kind: 'seven_day', percentUsed: 50, resetsAt: '2026-10-07T16:00:00Z' },
  ])
  weather.record({ tokens: 1000, window: 200_000 }, [])
  weather.record(undefined, [{ kind: 'seven_day', percentUsed: 51, resetsAt: '2026-10-07T16:00:00Z' }])
  expect(weather.windowsLeft(now).map((w) => `${w.label} ${w.left}`)).toEqual(['5h 70', 'week 49'])
  const later = Date.parse('2026-10-04T13:05:00Z')
  expect(weather.windowsLeft(later)[0]).toMatchObject({ label: '5h', left: 100 })
})

test('the cache leads the right half of the weather line', () => {
  const weather = new Weather()
  const now = Date.parse('2026-10-04T12:00:00Z')
  weather.record({ tokens: 36_000, window: 200_000 }, [{ kind: 'five_hour', percentUsed: 7 }])
  const right = weather.line(160, now, [{ text: 'cache ' }, { text: '42m' }]).right
  expect(text(right)).toBe('cache 42m   5h ━━━━━━━━ 93% left')
})

test('the sidebar button opens the pane and takes the lines off the band', async ($, on) => {
  mock.store(on)
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  const mount = () => $.ui.mount({ plugin: 'clawd-buddy', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const ui = await mount()
  expect((await ui.find({ key: 'sidebar-toggle' }))?.props.label).toBe('sidebar')
  await ui.press({ key: 'sidebar-toggle' })
  expect(opened).toContain('clawd-buddy')
  const band = await mount()
  expect((await band.find({ key: 'sidebar-toggle' }))?.props.label).toBe('close sidebar')
  expect(await band.find({ key: 'clawd' })).toBeDefined()
})

test('the sidebar draws its sections', async ($) => {
  const ui = await $.ui.mount({
    plugin: 'clawd-buddy',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'clawd-buddy',
    props: {
      title: 'clawd-buddy',
      isFocused: false,
      bodyColumns: 50,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  })
  // no figures yet in a test: it waits, and the cache waits for a request
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain("Waiting for Claude's first answer.")
  expect(drawn).toContain('Prompt cache')
  expect(await ui.find({ key: 'cache' })).toBeDefined()
  expect(await ui.find({ key: 'actions' })).toBeDefined()
})

test("on desktop the sidebar's size slider resizes Clawd in the band", async ($, on) => {
  mock.store(on)
  const pane = {
    plugin: 'clawd-buddy',
    component: 'Pane',
    requestId: 'clawd-buddy',
    props: {
      title: 'clawd-buddy',
      isFocused: false,
      bodyColumns: 50,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  } as const
  // only where he is an SVG
  const terminal = await $.ui.mount({ ...pane, surface: 'terminal' })
  expect(await terminal.find({ key: 'size-slider' })).toBeUndefined()

  const sidebar = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await sidebar.find({ key: 'size-slider' })).toBeDefined()
  await sidebar.press({ key: 'size-num-4' })

  const band = await $.ui.mount({ plugin: 'clawd-buddy', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const svg = await band.find({ type: 'Svg' })
  // four CSS pixels a sprite pixel: 136 tall, and the world still spans the band
  expect(svg?.props.height).toBe(136)
  expect(svg?.props.width).toBe(840)
})

test('the auto-compact slider runs 300k to 900k by 100k and never goes under 200k', () => {
  const c = new Compactor()
  expect(c.stops(1_000_000)).toEqual([300_000, 400_000, 500_000, 600_000, 700_000, 800_000, 900_000])
  // a smaller window caps the slider; one under 300k has none
  expect(c.stops(450_000)).toEqual([300_000, 400_000])
  expect(c.stops(200_000)).toEqual([])
  c.set(10_000)
  expect(c.at).toBe(FLOOR)
  // an old 50k-step setting lands on the nearest stop
  c.restore({ on: true, at: 640_000 })
  expect(c.at).toBe(600_000)
  expect(c.isDue(590_000)).toBe(false)
  expect(c.isDue(610_000)).toBe(true)
  expect(little(300_000)).toBe('³⁰⁰ᵏ')
  expect(little(900_000)).toBe('⁹⁰⁰ᵏ')
})

test('compact asks for a second press, then compacts', async ($, on) => {
  mock.clock(on)
  let compacted = 0
  on('session.compact', () => {
    compacted++
    // a stand-in compaction may not empty the conversation; skipping still counts the ask
    return { skip: 'stand-in' }
  })
  const mount = () => $.ui.mount({ plugin: 'clawd-buddy', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const ui = await mount()
  await ui.press({ key: 'compact' })
  expect(compacted).toBe(0)
  expect((await (await mount()).find({ key: 'compact' }))?.props.label).toBe('press again to compact')
  await (await mount()).press({ key: 'compact' })
  expect(compacted).toBe(1)
})

test('clear asks for a second press, then runs /clear; /clawd clear never clears unasked', async ($, on) => {
  const time = mock.clock(on)
  const ran: string[] = []
  on('command.run', { command: 'clear' }, ($, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  const mount = () => $.ui.mount({ plugin: 'clawd-buddy', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await (await mount()).press({ key: 'clear' })
  expect(ran).toEqual([])
  expect((await (await mount()).find({ key: 'clear' }))?.props.label).toBe('press again to clear')
  await (await mount()).press({ key: 'clear' })
  expect(ran).toEqual(['clear'])

  // the test host has no dialog to ask in, which must leave the conversation alone
  const run = (args: string) =>
    $.command.run({
      command: 'clawd',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 100 },
    })
  expect((await run('clear')).text).toBe('No one to ask here, so nothing was cleared.')
  await time.advance(100)
  expect(ran).toEqual(['clear'])
})

test('files keep the line Claude left them at, newest first', () => {
  const files = new Files()
  files.cwd = 'D:/repo'
  files.touch('D:/repo/hooks/a.ts', 'read', 40)
  files.touch('D:/repo/b.ts', 'write')
  files.touch('D:/repo/hooks/a.ts', 'edit', 12)
  files.touch('D:/repo/hooks/a.ts', 'edit', 30)
  // a read after an edit keeps the edit's place and line
  files.touch('D:/repo/hooks/a.ts', 'read', 1)
  expect(files.touches.map((t) => files.name(t))).toEqual(['a.ts', 'b.ts'])
  expect(files.label(files.touches[0]!, 60)).toBe('✎ a.ts  hooks/  :30 ×2')
  expect(files.label(files.touches[1]!, 60)).toBe('+ b.ts  :1')
  expect(files.lastChanged?.line).toBe(30)
  expect(files.argv(files.touches[0]!)).toEqual(['code', '-g', 'D:/repo/hooks/a.ts:30'])
  expect(lineOf('one\ntwo\nthree\n', 'three')).toBe(3)
  expect(lineOf('one\n', 'missing')).toBe(1)
})

test('the editor: $VISUAL, then $EDITOR, when it opens path:line; else VS Code', () => {
  expect(defaultEditor(undefined, undefined)).toEqual(['code', '-g'])
  expect(defaultEditor('zed', 'vim')).toEqual(['zed'])
  expect(defaultEditor('vim', 'cursor --wait')).toEqual(['cursor', '-g'])
  expect(defaultEditor('C:\\Tools\\Code.exe', undefined)).toEqual(['C:\\Tools\\Code.exe', '-g'])
  expect(defaultEditor('/usr/bin/subl')).toEqual(['/usr/bin/subl'])
  // a terminal editor has no terminal to draw in
  expect(defaultEditor('nvim', 'nano')).toEqual(['code', '-g'])
})

test('an edit puts the file on the band, and pressing it opens the editor at the line', async ($, on) => {
  const ran: string[][] = []
  on('env.get', () => ({ value: undefined }))
  on('tool.call', () => ({ ref: 1, result: {}, text: 'ok' }))
  on('fs.read', () => ({ value: 'import x\n\nconst changed = 1\n' }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.tool.call({ tool: 'Edit', file_path: 'D:/repo/src/app.ts', old_string: 'x', new_string: 'const changed = 1' })
  const ui = await $.ui.mount({ plugin: 'clawd-buddy', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect((await ui.find({ key: 'open-last' }))?.props.label).toBe('open app.ts')
  await ui.press({ key: 'open-last' })
  expect(ran.filter((argv) => argv[0] === 'code')).toEqual([['code', '-g', 'D:/repo/src/app.ts:3']])
})

test('git marks each touched file under the repository', () => {
  const files = new Files()
  files.root = 'D:/repo'
  files.setStatus(' M hooks/a.ts\n?? notes.md\nR  old.ts -> new.ts\n')
  files.touch('D:/repo/hooks/a.ts', 'edit', 3)
  files.touch('D:/repo/notes.md', 'write')
  files.touch('D:/repo/new.ts', 'edit', 1)
  files.touch('D:/repo/clean.ts', 'read', 1)
  expect(files.touches.map((t) => files.mark(t))).toEqual(['', 'A', 'U', 'M'])
})

test('follow opens each file Claude changes, and only those', async ($, on) => {
  mock.store(on)
  const ran: string[][] = []
  on('env.get', () => ({ value: undefined }))
  on('tool.call', () => ({ ref: 1, result: {}, text: 'ok' }))
  on('fs.read', () => ({ value: 'a\nb\n' }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const run = (args: string) =>
    $.command.run({
      command: 'clawd',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
  expect((await run('follow')).text).toContain('Following')
  await $.tool.call({ tool: 'Read', file_path: 'D:/repo/x.ts' })
  await $.tool.call({ tool: 'Edit', file_path: 'D:/repo/y.ts', old_string: 'a', new_string: 'b' })
  expect(ran.filter((argv) => argv[0] === 'code')).toEqual([['code', '-g', 'D:/repo/y.ts:2']])
})

// --- moods -------------------------------------------------------------------

// the same numbers every run
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
}

// Steps until a new play starts (or `limit` ticks pass); returns its name.
function nextPlay(clawd: Clawd, limit = FPS * 400): string | undefined {
  const was = clawd.play
  for (let t = 0; t < limit; t++) {
    clawd.step()
    if (clawd.play && clawd.play !== was) return clawd.play.move
  }
  return undefined
}

function runOut(clawd: Clawd, limit = FPS * 60) {
  for (let t = 0; t < limit && clawd.play; t++) clawd.step()
}

test('a tool call locks him in, and the work leans the pick', () => {
  const clawd = new Clawd(seeded(1))
  clawd.resize(100)
  clawd.turnStart()
  clawd.toolStart('code')
  clawd.toolDone('code', false)
  expect(clawd.mood).toBe('lockin')
  const move = nextPlay(clawd)!
  expect([...RIDES, ...WORK_ACTS]).toContain(move)
  expect(clawd.play?.mood).toBe('lockin')

  // edits lean to the laptop and desktop, shell to the skateboard, web to the kite
  const random = seeded(2)
  const share = (names: readonly string[], work: Work, of: string[]) => {
    let n = 0
    for (let i = 0; i < 400; i++) if (of.includes(pick(names, lean(work), random))) n++
    return n / 400
  }
  expect(share(WORK_ACTS, 'code', ['laptop', 'desktop'])).toBeGreaterThan(0.5)
  expect(share(RIDES, 'shell', ['skate'])).toBeGreaterThan(0.4)
  expect(share(RIDES, 'web', ['kite'])).toBeGreaterThan(0.4)
  expect(share(RIDES, 'agent', ['car'])).toBeGreaterThan(0.5)
  expect(share(WORK_ACTS, 'mcp', ['phone'])).toBeGreaterThan(0.3)
  expect(workFor('Edit', 'D:/repo/README.md')).toBe('notes')
  expect(workFor('Write', 'D:/repo/a.ts')).toBe('code')
  expect(workFor('PowerShell')).toBe('shell')
  expect(workFor('mcp__github__get_pr')).toBe('mcp')
})

test('locked in, about every other pick is a ride, and nothing plays twice in a row', () => {
  const clawd = new Clawd(seeded(3))
  clawd.resize(100)
  clawd.turnStart()
  const picks: string[] = []
  let was = clawd.play
  for (let t = 0; t < FPS * 600; t++) {
    if (t % (FPS * 2) === 0) {
      const work = (['code', 'shell', 'web', 'mcp', 'agent', 'other'] as const)[Math.floor(t / (FPS * 30)) % 6]!
      clawd.toolStart(work)
      clawd.toolDone(work, false)
    }
    clawd.step()
    if (clawd.play && clawd.play !== was && clawd.play.mood === 'lockin') picks.push(clawd.play.move)
    was = clawd.play
  }
  expect(picks.length).toBeGreaterThan(40)
  const rides = picks.filter((p) => (RIDES as readonly string[]).includes(p)).length
  expect(rides / picks.length).toBeGreaterThan(0.35)
  expect(rides / picks.length).toBeLessThan(0.65)
  for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1])
  // never three acts in a row
  for (let i = 2; i < picks.length; i++) {
    const acts = [picks[i], picks[i - 1], picks[i - 2]].filter((p) => !(RIDES as readonly string[]).includes(p!))
    expect(acts.length).toBeLessThan(3)
  }
})

test('a long shell command gets a coffee, held where the site holds it', () => {
  const clawd = new Clawd(seeded(4))
  clawd.resize(100)
  clawd.turnStart()
  clawd.toolStart('shell')
  let move: string | undefined
  for (let i = 0; i < 6 && move !== 'coffee'; i++) {
    move = nextPlay(clawd)
    runOut(clawd)
  }
  expect(move).toBe('coffee')
  // 34 frames, plus 4.5 seconds on the sip
  const coffee = new Clawd(seeded(5))
  coffee.request('coffee')
  coffee.step()
  let ticks = 0
  while (coffee.play && ticks < 1000) {
    coffee.step()
    ticks++
  }
  expect(ticks).toBe(ACTS.coffee!.frames + Math.round(4.5 * FPS))
})

test('quiet turns into chill: a think or a look, then the site picks, then a nap or the pool', () => {
  const clawd = new Clawd(seeded(6))
  clawd.resize(100)
  for (let t = 0; t < FPS * 19; t++) clawd.step()
  expect(clawd.mood).toBe('idle')
  expect(clawd.play).toBeNull()

  const first = nextPlay(clawd)!
  expect(clawd.mood).toBe('chill')
  expect(CHILL_FIRST as readonly string[]).toContain(first)
  expect(clawd.play?.mood).toBe('chill')

  while (clawd.quiet < FPS * 61) clawd.step()
  runOut(clawd)
  const later = nextPlay(clawd)!
  expect([...CHILL, 'walk'] as string[]).toContain(later)

  while (clawd.quiet < FPS * 181) clawd.step()
  runOut(clawd)
  const deep = nextPlay(clawd)!
  expect(CHILL_DEEP as readonly string[]).toContain(deep)
  // he stays there until something happens
  const nap = clawd.play
  for (let t = 0; t < FPS * 120; t++) clawd.step()
  expect(clawd.play).toBe(nap)

  // a tool call ends it, and he locks in
  clawd.turnStart()
  clawd.toolStart('web')
  runOut(clawd)
  expect(clawd.mood).toBe('lockin')
  expect([...RIDES, ...WORK_ACTS] as string[]).toContain(nextPlay(clawd)!)
})

test('a prompt ends a chill act at once so he can hop', () => {
  const clawd = new Clawd(seeded(7))
  clawd.resize(100)
  nextPlay(clawd)
  expect(clawd.play?.mood).toBe('chill')
  clawd.prompt()
  expect(clawd.play).toBeNull()
  expect(clawd.hop.left).toBe(1)
  expect(clawd.bubble?.text).toBe('!')
  clawd.prompt(isThanks('thanks, that works'))
  expect(clawd.hop.left).toBe(2)
  expect(clawd.bubble?.text).toBe('yay')
  expect(isThanks('Thank you!')).toBe(true)
  expect(isThanks('yay')).toBe(true)
  expect(isThanks('thanksgiving plans')).toBe(false)
  expect(isThanks('fix the bug')).toBe(false)
})

test('a long or busy turn ends in one celebration, then "yay"; a short one just hops', () => {
  const clawd = new Clawd(seeded(8))
  clawd.resize(100)
  clawd.turnStart()
  for (let i = 0; i < 6; i++) {
    clawd.toolStart('code')
    clawd.toolDone('code', false)
  }
  runOut(clawd)
  clawd.turnEnd()
  expect(clawd.mood).toBe('celebrate')
  // a ride still out finishes first; then the act
  let move = nextPlay(clawd)!
  while (clawd.play?.mood !== 'celebrate') {
    runOut(clawd)
    move = nextPlay(clawd)!
  }
  expect(CELEBRATE as readonly string[]).toContain(move)
  runOut(clawd, FPS * 30)
  clawd.step()
  expect(clawd.bubble?.text).toBe('yay')
  expect(clawd.mood).toBe('idle')
  // just the one act (a stroll back from the wall aside)
  for (let t = 0; t < FPS * 15; t++) clawd.step()
  expect(clawd.play?.mood).toBeUndefined()

  const quick = new Clawd(seeded(9))
  quick.resize(100)
  quick.turnStart()
  quick.toolStart('other')
  quick.toolDone('other', false)
  runOut(quick)
  quick.turnEnd()
  runOut(quick)
  quick.step()
  expect(quick.bubble?.text).toBe('yay')
  expect(quick.play?.mood).toBeUndefined()
  expect(quick.hop.y).toBeGreaterThan(0)
})

test('a failed tool call still shakes him, "?!"', async ($, on) => {
  on('tool.call', () => ({ ref: 1, result: {}, text: 'no such file', isError: true }))
  await $.tool.call({ tool: 'Bash', command: 'false' })
  const ui = await $.ui.mount({ plugin: 'clawd-buddy', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const raster = await ui.find({ key: 'clawd' })
  const words = decode(String(raster?.props.cells))
  const text = String.fromCharCode(...words.filter((_, i) => i % 3 === 0))
  expect(text).toContain('?!')

  const clawd = new Clawd(seeded(10))
  clawd.toolStart('shell')
  clawd.toolDone('shell', true)
  expect(clawd.bubble?.text).toBe('?!')
})

test('a tall act loses its top rows and never draws outside the band', () => {
  expect(tallest()).toBeGreaterThan(ROWS * 2)
  for (const name of ['heart', 'confetti', 'confettiHappy', 'fishing', 'bubble', 'rainbow']) {
    const clawd = new Clawd(seeded(11))
    clawd.resize(80)
    clawd.center = 40
    clawd.request(name)
    clawd.step()
    expect(clawd.play?.move).toBe(name)
    let ticks = 0
    let isGrounded = false
    while (clawd.play && ticks < 400) {
      const cells = clawd.paint(80, ROWS)
      expect(cells.length).toBe(80 * ROWS * 3)
      const svg = clawd.svg(80, ROWS * 2, 1)
      for (const m of svg.matchAll(/M(-?\d+) (-?\d+)h(\d+)/g)) {
        const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])]
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThan(ROWS * 2)
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x + w).toBeLessThanOrEqual(80)
      }
      isGrounded ||= svg.includes(` ${ROWS * 2 - 1}h`)
      clawd.step()
      ticks++
    }
    expect(clawd.play).toBeNull()
    // feet on the floor: the bottom pixel row is drawn
    expect(isGrounded).toBe(true)
  }
})

test("arcade's 17 colours decode from base 36, every one past the ninth", () => {
  const clawd = new Clawd(seeded(12))
  clawd.resize(80)
  clawd.center = 40
  clawd.request('arcade')
  clawd.step()
  const fills = new Set<string>()
  while (clawd.play) {
    for (const m of clawd.svg(80, ROWS * 2, 1).matchAll(/fill="#([0-9a-f]{6})"/g)) fills.add(m[1]!)
    clawd.step()
  }
  const palette = ACTS.arcade!.palette.map((h) => h.slice(1).toLowerCase())
  expect(palette.length).toBe(17)
  // indices 10 to 16, written a to g; the rest is the palette, nothing else
  for (const hex of palette.slice(10)) expect(fills.has(hex)).toBe(true)
  for (const hex of fills) expect(palette).toContain(hex)
})

test('an act faces the way he does, standing where he is', () => {
  const draw = (facing: 1 | -1) => {
    const clawd = new Clawd(seeded(13))
    clawd.resize(80)
    clawd.center = 40
    clawd.facing = facing
    clawd.request('laptop')
    clawd.step()
    for (let t = 0; t < 10; t++) clawd.step()
    expect(clawd.center).toBe(40)
    return clawd.svg(80, ROWS * 2, 1)
  }
  expect(draw(-1)).not.toBe(draw(1))
})

test('/clawd plays an act by name too', async ($) => {
  const run = (args: string) =>
    $.command.run({
      command: 'clawd',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
  expect((await run('dancing')).text).toBe('Clawd is off: dancing.')
  expect((await run('berrypicking')).text).toBe('Clawd is off: berryPicking.')
  expect((await run('laptopStation')).text).toBe('Clawd is off: laptop.')
  expect(ACTS.laptopStation).toBeUndefined()
})

test("a mood button plays one of that mood's picks and leaves the session's mood alone", () => {
  const clawd = new Clawd(seeded(14))
  clawd.resize(100)
  clawd.turnStart()
  clawd.toolStart('code')
  clawd.toolDone('code', false)
  runOut(clawd)
  const since = [clawd.idleSince, clawd.lastTool]
  const name = clawd.sample('celebrate')
  expect(CELEBRATE as readonly string[]).toContain(name)
  expect(nextPlay(clawd)).toBe(name)
  expect(clawd.play?.mood).toBeUndefined()
  expect(clawd.cheer).toBeNull()
  expect([clawd.idleSince, clawd.lastTool]).toEqual(since)
  expect(clawd.mood).toBe('lockin')
  // never the same pick twice in a row, and a float ends by itself
  let last = name
  for (let i = 0; i < 20; i++) {
    const next = clawd.sample('chill')
    expect(CHILL as readonly string[]).toContain(next)
    expect(next).not.toBe(last)
    last = next
    runOut(clawd, FPS * 5)
    for (let t = 0; t < FPS * 30 && clawd.play; t++) clawd.step()
    expect(clawd.play?.move).not.toBe(next)
  }
})

test('/multiply opens one by default and never more than three', () => {
  expect(count('')).toEqual({ count: 1, isCapped: false })
  expect(count('2')).toEqual({ count: 2, isCapped: false })
  expect(count('30')).toEqual({ count: 3, isCapped: true })
  expect(count('0')).toBe(null)
  expect(count('lots')).toBe(null)
})

test('each clone opens a PowerShell window in the same folder, its number set for claude', () => {
  expect(windowScript("D:\\Bob's stuff", 2)).toBe(
    "$env:CLAWD_CLONE = '2'; Start-Process powershell -WorkingDirectory 'D:\\Bob''s stuff' " +
      "-ArgumentList '-NoExit', '-Command', 'claude'",
  )
  // remote control only when the option is on
  expect(windowScript('C:\\work', 1, true)).toContain("'-Command', 'claude --remote-control'")
  // base64 of the UTF-16LE text, as -EncodedCommand reads it
  expect(encode('hi')).toBe('aABpAA==')
  expect(encode('a·')).toBe('YQC3AA==')
  expect(windowArgv('C:\\work', 1).slice(0, 4)).toEqual([
    'powershell',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
  ])
  expect(cloneNumber('2')).toBe(2)
  expect(cloneNumber(undefined)).toBe(null)
  expect(cloneNumber('7')).toBe(null)
})

test('/multiply opens nothing off Windows, and says why', async ($, on) => {
  const ran: string[][] = []
  on('env.get', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const said = await $.command.run({
    command: 'multiply',
    args: '2',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(said.text).toContain('only works on Windows')
  expect(ran.filter((argv) => argv[0] === 'powershell')).toEqual([])
})

test('/multiply on Windows opens a window per clone, plain claude unless the option is on', async ($, on) => {
  const ran: string[][] = []
  on('env.get', ($, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }))
  on('session.cwd', () => ({ value: 'C:\\work' }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const said = await $.command.run({
    command: 'multiply',
    args: '2',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(said.text).toBe('Opened 2 clones.')
  const windows = ran.filter((argv) => argv[0] === 'powershell')
  expect(windows.length).toBe(2)
  // the option is off by default: no --remote-control
  expect(windows[0]).toEqual(windowArgv('C:\\work', 1, false))
  expect(windows[1]).toEqual(windowArgv('C:\\work', 2, false))
})

test('the clone bit splits copies out of him, holds them, then pops them off', () => {
  const clawd = new Clawd(() => 0.5)
  clawd.resize(120)
  clawd.center = 60
  const before = clawd.paint(120, ROWS)
  const drawn = (cells: Uint32Array) => {
    let n = 0
    for (let i = 0; i < cells.length; i += 3) if (cells[i] !== 32) n++
    return n
  }
  clawd.clone(3)
  for (let t = 0; t < 12; t++) clawd.step()
  // the bubble adds a few cells; three more of him add far more
  expect(drawn(clawd.paint(120, ROWS))).toBeGreaterThan(drawn(before) * 3)
  for (let t = 12; t < CLONE_TICKS; t++) clawd.step()
  expect(clawd.cloneOffsets(20)).toEqual([])
})
