// The Lottie half of tools/extract-sprites.ts: Clawd's "acts" on claude.dev.
//
// The site also plays Clawd as Lottie JSON (lottie-web, canvas renderer): 33
// acts picked at random by weight, plus the walking, waving and looking moves
// and the laptop and desktop workstations. Each file is a 2750 by 1850 canvas
// at 12 fps holding only shape layers whose path vertices sit on a 50 unit
// grid, so every animation is pixel art on a 55 by 37 grid drawn as polygons.
// This reads the files as data (it never runs the site's code), rasterizes
// each frame by sampling every cell's centre against the polygons visible at
// that frame (fill rules, layer and group transforms, layer in and out points,
// hold and eased keyframes), and returns sheets in the same delta encoding as
// the pixel sheets.

const ACT_LIST = /\[\["Clawd-Thinking\.json",[\d.]+\](?:,\["[\w-]+\.json",[\d.]+\])*\]/
const ACTS_AT = '/shared/video/acts/'
const MOVES_AT = '/shared/video/'

// The moves and workstations that sit next to the acts, outside the random list.
const EXTRAS: [file: string, name: string][] = [
  ['clawd-walking.json', 'walking'],
  ['clawd-waving.json', 'waving'],
  ['clawd-looking.json', 'looking'],
  ['clawd-laptop.json', 'laptopStation'],
  ['clawd-desktop.json', 'desktopStation'],
]

// Workstations that are an act pixel for pixel: left out of sprites.ts while
// they match (hooks/actor.ts plays the act for either name).
export const SAME_AS: Record<string, string> = { laptopStation: 'laptop', desktopStation: 'desktop' }

// Clawd's own colours come first so their indices match across every act.
const FIXED = ['#141413', '#d97757', '#be684d']

const GRID = 50
const CLEAR = 255

export const isActChunk = (js: string) => js.includes('"Clawd-Thinking.json"')

export type ActSheet = {
  w: number
  h: number
  palette: string[]
  base: string
  deltas: string[]
  launch: number
  cruise: number[]
  outro: number
  speed: number
  frames: number
  weight: number
  x: number
  y: number
}

// [file, weight] pairs from the chunk's `[["Clawd-Thinking.json",10],...]`.
export function readActList(js: string): [string, number][] {
  const m = ACT_LIST.exec(js)
  if (!m) throw new Error('the act chunk no longer lists its acts as [["Clawd-Thinking.json",10],...]')
  // `.7` is not JSON
  return JSON.parse(m[0].replace(/,\./g, ',0.')) as [string, number][]
}

// Clawd-BerryPicking.json -> berryPicking
export const actName = (file: string) => {
  const stem = file.replace(/^Clawd-/, '').replace(/\.json$/, '')
  return stem[0]!.toLowerCase() + stem.slice(1)
}

// ---------------------------------------------------------------- Lottie data

type Vec = number[]
type Key = {
  t: number
  s?: Vec | Bez[]
  e?: Vec | Bez[]
  h?: number
  i?: { x: Vec | number; y: Vec | number }
  o?: { x: Vec | number; y: Vec | number }
}
type Prop = { a?: number; k: unknown; x?: unknown; s?: boolean }
type Bez = { i: number[][]; o: number[][]; v: number[][]; c: boolean }
type Item = { ty: string; hd?: boolean; it?: Item[]; [k: string]: unknown }
type Layer = {
  ty: number
  ind?: number
  parent?: number
  ip: number
  op: number
  st?: number
  sr?: number
  hd?: boolean
  ks: Record<string, Prop>
  shapes?: Item[]
  nm?: string
}
export type Lottie = { w: number; h: number; fr: number; ip: number; op: number; layers: Layer[]; assets?: unknown[] }

// Anything the rasterizer met that it does not draw exactly, by file.
export const notes = new Map<string, Set<string>>()
let current = ''
const note = (s: string) => {
  if (!notes.has(current)) notes.set(current, new Set())
  notes.get(current)!.add(s)
}

// Solve a CSS-style cubic bezier easing for progress x.
function ease(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (x1 === y1 && x2 === y2) return x
  let lo = 0
  let hi = 1
  let t = x
  for (let n = 0; n < 40; n++) {
    t = (lo + hi) / 2
    const bx = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t
    if (bx < x) lo = t
    else hi = t
  }
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t
}

const pick = (v: Vec | number | undefined, d: number) => (Array.isArray(v) ? (v[d] ?? v[0]!) : (v ?? 0))

function lerp<T>(a: T, b: T, f: number): T {
  if (typeof a === 'number') return (a + ((b as number) - a) * f) as T
  if (Array.isArray(a)) return a.map((v, i) => lerp(v, (b as unknown[])[i], f)) as T
  if (a && typeof a === 'object') {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(a)) o[k] = k === 'c' ? (a as Bez).c : lerp((a as never)[k], (b as never)[k], f)
    return o as T
  }
  return a
}

// A property's value at frame t: static, hold, or eased between keyframes.
// Lottie values are numbers or nested number arrays depending on the property.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function value(p: Prop | undefined, t: number): any {
  if (!p) return undefined
  if (p.s && 'x' in p) return [value(p.x as Prop, t), value((p as unknown as { y: Prop }).y, t)] // split position
  const k = p.k as Key[]
  if (!p.a || !Array.isArray(k) || typeof k[0] !== 'object' || !('t' in (k[0] as object))) return p.k
  let i = 0
  while (i + 1 < k.length && k[i + 1]!.t <= t) i++
  const a = k[i]!
  const b = k[i + 1]
  const start = a.s ?? k[i - 1]?.e
  if (t <= a.t || !b || a.h) return unwrap(start)
  const end = a.e ?? b.s ?? start
  const span = b.t - a.t
  const x = (t - a.t) / span
  if (!a.o || !a.i) return unwrap(lerp(start, end, x))
  const dims = Array.isArray(start) && typeof start[0] === 'number' ? start.length : 1
  const per = Array.from({ length: dims }, (_, d) =>
    ease(x, pick(a.o!.x, d), pick(a.o!.y, d), pick(a.i!.x, d), pick(a.i!.y, d)),
  )
  if (per.some((f) => f !== x)) note('eased keyframes')
  if (dims === 1 || !Array.isArray(start) || typeof start[0] !== 'number') return unwrap(lerp(start, end, per[0]!))
  return (start as number[]).map((v, d) => v + ((end as number[])[d]! - v) * per[d]!)
}
// shape keyframes hold the path as a one-element array; scalars as [n]
const unwrap = (v: unknown) => (Array.isArray(v) && v.length === 1 ? v[0] : v)

// 2D affine as [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
type M = number[]
const mul = (m: M, n: M): M => [
  m[0]! * n[0]! + m[2]! * n[1]!,
  m[1]! * n[0]! + m[3]! * n[1]!,
  m[0]! * n[2]! + m[2]! * n[3]!,
  m[1]! * n[2]! + m[3]! * n[3]!,
  m[0]! * n[4]! + m[2]! * n[5]! + m[4]!,
  m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
]
const apply = (m: M, x: number, y: number): [number, number] => [
  m[0]! * x + m[2]! * y + m[4]!,
  m[1]! * x + m[3]! * y + m[5]!,
]

// translate(p) rotate(r) skew scale(s) translate(-a), Lottie's transform order
function transform(tr: Record<string, Prop | undefined>, t: number): M {
  const p = (value(tr.p, t) as Vec | undefined) ?? [0, 0]
  const a = (value(tr.a, t) as Vec | undefined) ?? [0, 0]
  const s = (value(tr.s, t) as Vec | undefined) ?? [100, 100]
  const r = num(value(tr.r ?? tr.rz, t))
  const sk = num(value(tr.sk, t))
  if (sk) note('skew ignored')
  const rad = (r * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  let m = [1, 0, 0, 1, p[0] ?? 0, p[1] ?? 0]
  m = mul(m, [cos, sin, -sin, cos, 0, 0])
  m = mul(m, [(s[0] ?? 100) / 100, 0, 0, (s[1] ?? 100) / 100, 0, 0])
  return mul(m, [1, 0, 0, 1, -(a[0] ?? 0), -(a[1] ?? 0)])
}
const num = (v: unknown) => (Array.isArray(v) ? (v[0] as number) : ((v as number) ?? 0))

// A closed path flattened to a polygon (curves split into 12 segments).
function polygon(b: Bez, m: M): number[][] {
  const pts: number[][] = []
  const n = b.v.length
  const segs = b.c ? n : n - 1
  for (let i = 0; i < n; i++) {
    if (i === 0 || pts.length === 0) pts.push(apply(m, b.v[0]![0]!, b.v[0]![1]!))
    if (i >= segs) break
    const j = (i + 1) % n
    const p0 = b.v[i]!
    const p3 = b.v[j]!
    const o = b.o[i] ?? [0, 0]
    const ii = b.i[j] ?? [0, 0]
    if (o[0] || o[1] || ii[0] || ii[1]) {
      note('curved paths flattened')
      const p1 = [p0[0]! + o[0]!, p0[1]! + o[1]!]
      const p2 = [p3[0]! + ii[0]!, p3[1]! + ii[1]!]
      for (let s = 1; s <= 12; s++) {
        const u = s / 12
        const w = [(1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u * u, u ** 3]
        pts.push(
          apply(
            m,
            w[0]! * p0[0]! + w[1]! * p1[0]! + w[2]! * p2[0]! + w[3]! * p3[0]!,
            w[0]! * p0[1]! + w[1]! * p1[1]! + w[2]! * p2[1]! + w[3]! * p3[1]!,
          ),
        )
      }
    } else if (j !== 0) pts.push(apply(m, p3[0]!, p3[1]!))
  }
  return pts
}

function rect(it: Item, m: M, t: number): number[][] {
  const [cx, cy] = value(it.p as Prop, t) as Vec
  const [w, h] = value(it.s as Prop, t) as Vec
  if (num(value(it.r as Prop, t))) note('rounded rectangle corners ignored')
  const x0 = cx! - w! / 2
  const y0 = cy! - h! / 2
  return [apply(m, x0, y0), apply(m, x0 + w!, y0), apply(m, x0 + w!, y0 + h!), apply(m, x0, y0 + h!)]
}

function ellipse(it: Item, m: M, t: number): number[][] {
  const [cx, cy] = value(it.p as Prop, t) as Vec
  const [w, h] = value(it.s as Prop, t) as Vec
  return Array.from({ length: 48 }, (_, i) =>
    apply(m, cx! + (Math.cos((i / 48) * 2 * Math.PI) * w!) / 2, cy! + (Math.sin((i / 48) * 2 * Math.PI) * h!) / 2),
  )
}

// One filled area: polygons, rule, palette colour; painted bottom first.
type Op = { polys: number[][][]; evenOdd: boolean; color: string }

const hex = (c: number[]) =>
  '#' +
  c
    .slice(0, 3)
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

// Every path in `items` (and the groups among them), in world coordinates.
function paths(items: Item[], m: M, t: number): number[][][] {
  const out: number[][][] = []
  for (const it of items) {
    if (it.hd) continue
    if (it.ty === 'sh') out.push(polygon(value(it.ks as Prop, t) as Bez, m))
    else if (it.ty === 'rc') out.push(rect(it, m, t))
    else if (it.ty === 'el') out.push(ellipse(it, m, t))
    else if (it.ty === 'gr') {
      const tr = it.it!.find((x) => x.ty === 'tr')
      out.push(...paths(it.it!, tr ? mul(m, transform(tr as never, t)) : m, t))
    }
  }
  return out
}

// A shape list's draw ops, bottom first: a fill paints the paths listed above
// it in the same list (groups included); later items sit underneath earlier ones.
function ops(items: Item[], m: M, opacity: number, t: number, out: Op[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!
    if (it.hd) continue
    if (it.ty === 'fl') {
      const o = (num(value(it.o as Prop, t)) / 100) * opacity
      const c = value(it.c as Prop, t) as number[]
      if (o > 0 && o < 1) note(`partial opacity ${Math.round(o * 100)}% drawn as ${o >= 0.5 ? 'solid' : 'clear'}`)
      if (c[3] !== undefined && c[3] < 1) note('fill colour alpha ignored')
      if (o >= 0.5) out.push({ polys: paths(items.slice(0, i), m, t), evenOdd: it.r === 2, color: hex(c) })
    } else if (it.ty === 'gr') {
      const tr = it.it!.find((x) => x.ty === 'tr')
      const gm = tr ? mul(m, transform(tr as never, t)) : m
      const go = tr ? num(value((tr as { o?: Prop }).o, t) ?? 100) / 100 : 1
      ops(it.it!, gm, opacity * go, t, out)
    } else if (!['sh', 'rc', 'el', 'tr'].includes(it.ty)) note(`shape item "${it.ty}" skipped`)
  }
}

function layerMatrix(layers: Layer[], l: Layer, t: number): M {
  let m = transform(l.ks as never, t)
  let p = l.parent
  for (let guard = 0; p !== undefined && guard < 32; guard++) {
    const parent = layers.find((x) => x.ind === p)
    if (!parent) break
    m = mul(transform(parent.ks as never, t), m)
    p = parent.parent
  }
  return m
}

const layerOpacity = (l: Layer, t: number) => num(value(l.ks.o, t) ?? 100) / 100

// Point in polygon set, nonzero or even-odd.
function inside(x: number, y: number, polys: number[][][], evenOdd: boolean): boolean {
  let wind = 0
  let cross = 0
  for (const poly of polys) {
    for (let i = 0, n = poly.length; i < n; i++) {
      const [x0, y0] = poly[i]!
      const [x1, y1] = poly[(i + 1) % n]!
      if (y0! <= y) {
        if (y1! > y && (x1! - x0!) * (y - y0!) - (x - x0!) * (y1! - y0!) > 0) {
          wind++
          cross++
        }
      } else if (y1! <= y && (x1! - x0!) * (y - y0!) - (x - x0!) * (y1! - y0!) < 0) {
        wind--
        cross++
      }
    }
  }
  return evenOdd ? cross % 2 === 1 : wind !== 0
}

export type Raster = { cols: number; rows: number; frames: Uint8Array[]; palette: string[] }

// Every frame of a Lottie file as palette indices on its 50 unit grid.
export function rasterize(file: string, lottie: Lottie): Raster {
  current = file
  if (lottie.assets?.length) note('assets ignored')
  const times: Op[][] = []
  for (let f = lottie.ip; f < lottie.op; f++) {
    const frame: Op[] = []
    // the first layer is on top, so paint from the last one up
    for (let li = lottie.layers.length - 1; li >= 0; li--) {
      const l = lottie.layers[li]!
      if (l.hd || f < l.ip || f >= l.op) continue
      if (l.ty === 3) continue // null layer: only a parent
      if (l.ty !== 4) {
        note(`layer type ${l.ty} skipped`)
        continue
      }
      const t = (f - (l.st ?? 0)) / (l.sr ?? 1)
      ops(l.shapes ?? [], layerMatrix(lottie.layers, l, t), layerOpacity(l, t), t, frame)
    }
    times.push(frame)
  }

  // the grid's origin: the commonest vertex offset, so cell edges are the art's edges
  const offset = (axis: 0 | 1) => {
    const count = new Map<number, number>()
    for (const frame of times)
      for (const op of frame)
        for (const poly of op.polys)
          for (const p of poly) {
            const r = ((Math.round(p[axis]!) % GRID) + GRID) % GRID
            count.set(r, (count.get(r) ?? 0) + 1)
          }
    let best = 0
    let most = -1
    for (const [r, n] of count) if (n > most) [best, most] = [r, n]
    return best
  }
  const ox = offset(0)
  const oy = offset(1)
  const cols = Math.ceil(lottie.w / GRID)
  const rows = Math.ceil(lottie.h / GRID)

  const palette = [...FIXED]
  const index = (c: string) => {
    let i = palette.indexOf(c)
    if (i < 0) i = palette.push(c) - 1
    return i
  }
  // order accents by where they first show up in the file, not by which frame paints them first
  for (const l of lottie.layers) walkFills(l.shapes ?? [], (c) => index(c))

  const frames = times.map((frame) => {
    const px = new Uint8Array(cols * rows).fill(CLEAR)
    for (const op of frame) {
      const id = index(op.color)
      // bounding box of the op, in cells
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const poly of op.polys)
        for (const [x, y] of poly) {
          x0 = Math.min(x0, x!)
          y0 = Math.min(y0, y!)
          x1 = Math.max(x1, x!)
          y1 = Math.max(y1, y!)
        }
      const cx0 = Math.max(0, Math.floor((x0 - ox) / GRID) - 1)
      const cx1 = Math.min(cols - 1, Math.ceil((x1 - ox) / GRID) + 1)
      const cy0 = Math.max(0, Math.floor((y0 - oy) / GRID) - 1)
      const cy1 = Math.min(rows - 1, Math.ceil((y1 - oy) / GRID) + 1)
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++)
          if (inside(ox + cx * GRID + GRID / 2, oy + cy * GRID + GRID / 2, op.polys, op.evenOdd))
            px[cy * cols + cx] = id
    }
    return px
  })
  return { cols, rows, frames, palette: compact(frames, palette) }
}

// Drop accents no frame shows (keeps Clawd's three fixed), renumbering the rest.
function compact(frames: Uint8Array[], palette: string[]): string[] {
  const keep = palette.map((_, i) => i < FIXED.length || frames.some((f) => f.includes(i)))
  const map = new Map<number, number>()
  const out: string[] = []
  palette.forEach((c, i) => {
    if (keep[i]) map.set(i, out.push(c) - 1)
  })
  for (const f of frames) for (let i = 0; i < f.length; i++) if (f[i] !== CLEAR) f[i] = map.get(f[i]!)!
  return out
}

function walkFills(items: Item[], see: (c: string) => void) {
  for (const it of items) {
    if (it.ty === 'fl') {
      const c = it.c as Prop
      if (c.a) for (const k of c.k as Key[]) k.s && see(hex(k.s as number[]))
      else see(hex(c.k as number[]))
    } else if (it.ty === 'gr') walkFills(it.it!, see)
  }
}

// ------------------------------------------------------------------ encoding

// Palette indices as one character each: 0-9, then a-z past ten colours.
const digit = (p: number) => (p === CLEAR ? '.' : p.toString(36))
const undigit = (c: string) => (c === '.' ? CLEAR : parseInt(c, 36))

export function encode(r: Raster, weight: number): ActSheet {
  // trim to the union bounding box of every frame, keeping the grid's bottom
  // row (the floor) the way the pixel sheets keep theirs
  let top = r.rows
  const bottom = r.rows - 1
  let left = r.cols
  let right = -1
  for (const f of r.frames)
    for (let y = 0; y < r.rows; y++)
      for (let x = 0; x < r.cols; x++)
        if (f[y * r.cols + x] !== CLEAR) {
          top = Math.min(top, y)
          left = Math.min(left, x)
          right = Math.max(right, x)
        }
  if (right < 0) throw new Error(`${current}: every frame is empty`)
  const w = right - left + 1
  const h = bottom - top + 1
  const cut = r.frames.map((f) => {
    const o: number[] = []
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) o.push(f[y * r.cols + x]!)
    return o
  })
  const deltas: string[] = []
  for (let i = 1; i < cut.length; i++) {
    const d: string[] = []
    cut[i]!.forEach((p, j) => {
      if (p !== cut[i - 1]![j]) d.push(j.toString(36) + digit(p))
    })
    deltas.push(d.join(','))
  }
  const sheet: ActSheet = {
    w,
    h,
    palette: r.palette,
    base: cut[0]!.map(digit).join(''),
    deltas,
    launch: 0,
    cruise: [],
    outro: cut.length,
    speed: 0,
    frames: cut.length,
    weight,
    x: left,
    y: top,
  }
  // the encoding has to give back exactly what was rasterized
  const back = decode(sheet)
  if (back.length !== cut.length || back.some((f, i) => f.some((p, j) => p !== cut[i]![j]))) {
    throw new Error(`${current}: the delta encoding does not round trip`)
  }
  return sheet
}

// The same decoding as hooks/actor.ts, with indices past 9 read as base 36.
export function decode(s: { base: string; deltas: string[] }): number[][] {
  const cur = [...s.base].map(undigit)
  const out = [cur.slice()]
  for (const d of s.deltas) {
    if (d) {
      for (const op of d.split(',')) {
        const end = op.length - 1
        cur[parseInt(op.slice(0, end), 36)] = undigit(op[end]!)
      }
    }
    out.push(cur.slice())
  }
  return out
}

// ---------------------------------------------------------------- the family

async function json(url: string, save?: string): Promise<Lottie> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const body = await res.text()
  // acts/Clawd-Laptop.json and clawd-laptop.json only differ by case, so keep the site's folders
  if (save) await Bun.write(`${save}/${new URL(url).pathname.replace(/^\/shared\//, '')}`, body)
  return JSON.parse(body) as Lottie
}

// All 33 acts (with the site's weights) and the three moves, rasterized and
// encoded; the two workstations only when they stop matching their acts.
// `save` keeps a copy of each downloaded file there.
export async function extractActs(site: string, chunk: string, save?: string): Promise<Record<string, ActSheet>> {
  const list = readActList(chunk)
  const jobs: [url: string, name: string, weight: number][] = [
    ...list.map(([file, weight]) => [site + ACTS_AT + file, actName(file), weight] as [string, string, number]),
    ...EXTRAS.map(([file, name]) => [site + MOVES_AT + file, name, 0] as [string, string, number]),
  ]
  const out: Record<string, ActSheet> = {}
  for (const [url, name, weight] of jobs) {
    const lottie = await json(url, save)
    const file = url.split('/').pop()!
    if (lottie.w / GRID !== 55 || lottie.h / GRID !== 37) note(`canvas ${lottie.w}x${lottie.h}, not 2750x1850`)
    const sheet = encode(rasterize(file, lottie), weight)
    const twin = SAME_AS[name] && out[SAME_AS[name]]
    if (twin && JSON.stringify({ ...sheet, weight: twin.weight }) === JSON.stringify(twin)) {
      console.log(`${name.padEnd(15)} same as ${SAME_AS[name]}, left out`)
      continue
    }
    if (twin) note(`differs from ${SAME_AS[name]} now, so it is kept`)
    out[name] = sheet
    const p = sheet.palette.length
    if (p > 10) note(`${p} colours: indices past 9 are written as a-z`)
    console.log(
      `${name.padEnd(15)} ${String(sheet.w).padStart(2)}x${String(sheet.h).padEnd(2)} at ${sheet.x},${sheet.y}  ${String(sheet.frames).padStart(3)} frames  ${p} colours  weight ${weight}`,
    )
  }
  for (const [file, set] of notes) console.log(`note ${file}: ${[...set].join('; ')}`)
  return out
}
