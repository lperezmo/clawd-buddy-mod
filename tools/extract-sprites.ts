// Rebuilds plugins/clawd-buddy/hooks/sprites.ts from claude.dev.
//
// claude.dev ships Clawd in two families, and this reads both as data (it
// never runs the site's code):
//
// - Pixel sheets inside its JavaScript (SHEETS): each is { w, h, fps,
//   palette, base, deltas }, frame 0 as a string of palette digits ('.'
//   clear) and every later frame as base-36 "index+digit" changes. This finds
//   the chunk that holds them, reads the eight sheets, trims them and writes
//   them back out in the same encoding with the timing each move uses.
// - Lottie animations (ACTS): the 33 weighted acts listed in the chunk that
//   names "Clawd-Thinking.json", from /shared/video/acts/, plus the walking,
//   waving and looking moves from /shared/video/. The laptop and desktop
//   workstations there are checked against the laptop and desktop acts and
//   left out while they match pixel for pixel. tools/extract-acts.ts rasterizes every frame onto the
//   art's 55 by 37 pixel grid, trims it like the sheets (empty rows above,
//   empty columns either side, across all frames) and encodes it the same
//   way, with the site's weight and where the box sat on the grid.
//
//   bun tools/extract-sprites.ts [dir to keep the downloaded Lottie files in]

import { extractActs, isActChunk } from './extract-acts'

const SITE = 'https://claude.dev'
const OUT = new URL('../plugins/clawd-buddy/hooks/sprites.ts', import.meta.url)

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i)

// Where each sheet lives in the bundle, and how it plays here: the frame the
// move starts travelling on, the frames it loops while cruising, the first
// outro frame, and its speed in terminal cells per second.
type Pick = { prop: string } | { exported: string }
const MOVES: { name: string; pick: Pick; launch?: number; cruise: number[]; outro?: number; speed?: number }[] = [
  { name: 'walk', pick: { prop: 'walk' }, launch: 5, cruise: range(10, 25), speed: 12 },
  {
    name: 'skate',
    pick: { prop: 'skate' },
    launch: 6,
    cruise: [...range(23, 37), ...range(48, 56), ...range(31, 37), ...range(48, 56)],
    outro: 56,
    speed: 32,
  },
  { name: 'car', pick: { prop: 'car' }, launch: 13, cruise: range(29, 35), speed: 60 },
  { name: 'scooter', pick: { prop: 'scooter' }, launch: 14, cruise: range(26, 41), outro: 41, speed: 20 },
  { name: 'bike', pick: { prop: 'bike' }, launch: 12, cruise: range(20, 43), speed: 26 },
  { name: 'space', pick: { exported: 'CLAWD' }, launch: 30, cruise: range(30, 98) },
  { name: 'pool', pick: { exported: 'CLAWD_POOL' }, cruise: range(0, 44) },
  { name: 'kite', pick: { exported: 'CLAWD_KITE' }, cruise: [] },
]

type Raw = { w: number; h: number; palette: string[]; base: string; deltas: string[] }

async function text(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

const isSpriteChunk = (js: string) => js.includes('RIDE_SPRITES') && js.includes('clawdActor')

// Walk the page's chunks (and the chunks they name) until one passes each test.
async function findChunks<K extends string>(tests: Record<K, (js: string) => boolean>): Promise<Record<K, string>> {
  const found: Partial<Record<K, string>> = {}
  const want = Object.keys(tests) as K[]
  const page = await text(`${SITE}/`)
  const queue = [...new Set([...page.matchAll(/\/_next\/static\/chunks\/[\w.-]+\.js/g)].map((m) => m[0]))]
  const seen = new Set(queue)
  while (queue.length) {
    const path = queue.shift()!
    const js = await text(SITE + path)
    for (const k of want) if (!found[k] && tests[k](js)) found[k] = js
    if (want.every((k) => found[k])) return found as Record<K, string>
    for (const m of js.matchAll(/static\/chunks\/[\w.-]+\.js/g)) {
      const next = `/_next/${m[0]}`
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  const missing = want.filter((k) => !found[k])
  throw new Error(`no chunk on claude.dev holds the Clawd ${missing.join(' or ')} any more`)
}

// The object literal starting at `from` ('{'), up to its matching brace.
function literalAt(js: string, from: number): string {
  let depth = 0
  let quote = ''
  for (let i = from; i < js.length; i++) {
    const c = js[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      if (--depth === 0) return js.slice(from, i + 1)
    }
  }
  throw new Error(`unbalanced literal at ${from}`)
}

// Minified `{w:24,h:18,fps:12,palette:[...],base:"...",deltas:[...]}` as JSON.
function parseSheet(literal: string): Raw {
  const json = literal.replace(/([{,])(w|h|fps|palette|base|deltas):/g, '$1"$2":')
  const raw = JSON.parse(json) as Raw
  if (!raw.w || !raw.h || typeof raw.base !== 'string' || raw.base.length !== raw.w * raw.h) {
    throw new Error('a sheet did not read as { w, h, palette, base, deltas }')
  }
  return raw
}

function sheetFor(js: string, pick: Pick): Raw {
  let at: number
  if ('prop' in pick) {
    // walk:Object.assign(n({w:...}), { ...timing })
    const m = new RegExp(`[{,]${pick.prop}:Object\\.assign\\(\\w+\\(\\{w:`).exec(js)
    if (!m) throw new Error(`no ${pick.prop} sheet`)
    at = m.index + m[0].length - 3
  } else {
    // "CLAWD",0,w in the module's export list, then w=n({w:...}) or w=((e=n({w:...
    const name = new RegExp(`"${pick.exported}",0,(\\w+)`).exec(js)?.[1]
    if (!name) throw new Error(`no export ${pick.exported}`)
    const m = new RegExp(`[,;\\s]${name}=\\(*(?:\\w+=)?\\w+\\(\\{w:`).exec(js)
    if (!m) throw new Error(`no sheet behind ${pick.exported}`)
    at = m.index + m[0].length - 3
  }
  return parseSheet(literalAt(js, at))
}

function frames(raw: Raw): number[][] {
  const cur = [...raw.base].map((c) => (c === '.' ? 255 : +c))
  const out = [cur.slice()]
  for (const d of raw.deltas) {
    if (d) {
      for (const op of d.split(',')) {
        const end = op.length - 1
        cur[parseInt(op.slice(0, end), 36)] = op[end] === '.' ? 255 : +op[end]!
      }
    }
    out.push(cur.slice())
  }
  return out
}

// Drop the empty rows above and the empty columns either side, across all frames.
function trim(all: number[][], W: number, H: number) {
  let top = H
  let left = W
  let right = -1
  for (const f of all)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (f[y * W + x] !== 255) {
          top = Math.min(top, y)
          left = Math.min(left, x)
          right = Math.max(right, x)
        }
  const w = right - left + 1
  const h = H - top
  const cut = all.map((f) => {
    const o: number[] = []
    for (let y = top; y < H; y++) for (let x = left; x <= right; x++) o.push(f[y * W + x]!)
    return o
  })
  return { w, h, frames: cut }
}

const digit = (p: number) => (p === 255 ? '.' : String(p))

const chunks = await findChunks({ sprites: isSpriteChunk, acts: isActChunk })
const js = chunks.sprites
const sheets: Record<string, unknown> = {}
for (const move of MOVES) {
  const raw = sheetFor(js, move.pick)
  const t = trim(frames(raw), raw.w, raw.h)
  const deltas: string[] = []
  for (let i = 1; i < t.frames.length; i++) {
    const d: string[] = []
    t.frames[i]!.forEach((p, j) => {
      if (p !== t.frames[i - 1]![j]) d.push(j.toString(36) + digit(p))
    })
    deltas.push(d.join(','))
  }
  const last = move.cruise.at(-1)
  sheets[move.name] = {
    w: t.w,
    h: t.h,
    palette: raw.palette,
    base: t.frames[0]!.map(digit).join(''),
    deltas,
    launch: move.launch ?? 0,
    cruise: move.cruise,
    outro: move.outro ?? (last === undefined ? t.frames.length : last + 1),
    speed: move.speed ?? 0,
  }
  console.log(`${move.name.padEnd(8)} ${t.w}x${t.h}  ${t.frames.length} frames`)
}

const acts = await extractActs(SITE, chunks.acts, process.argv[2])

await Bun.write(
  OUT,
  `// Clawd sprite sheets from claude.dev (Anthropic): its pixel sheets
// delta-encoded the way the site ships them, and its Lottie acts rasterized
// into the same encoding. Generated by tools/extract-sprites.ts; do not edit
// by hand.

export type Sheet = {
  w: number
  h: number
  palette: string[]
  base: string
  deltas: string[]
  launch: number
  cruise: number[]
  outro: number
  speed: number
}

export const SHEETS: Record<string, Sheet> = ${JSON.stringify(sheets)}

// The Lottie acts, rasterized onto their 55 by 37 pixel grid at 12 fps. Same
// encoding, except a palette past ten colours writes indices 10+ as a-z.
// frames: how many; weight: the site's odds in its random pick of acts (0 for
// the walking, waving and looking moves, which are not in it); x, y: the
// trimmed box's top-left cell on the grid (every act keeps the grid's bottom
// row, the floor). The site's laptop and desktop workstations are the laptop
// and desktop acts pixel for pixel, so they are left out.
export type Act = Sheet & { frames: number; weight: number; x: number; y: number }

export const ACTS: Record<string, Act> = ${JSON.stringify(acts)}
`,
)
console.log(`wrote ${OUT.pathname}`)
