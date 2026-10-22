// Clawd's little world: one actor on a strip of terminal cells, stepped at
// 12 fps and painted with half blocks (two sprite pixels per cell, stacked).

import {
  CELEBRATE,
  CHILL,
  CHILL_AFTER,
  CHILL_DEEP,
  CHILL_DEEPER,
  CHILL_DEEPEST,
  CHILL_FIRST,
  HOLDS,
  lean,
  LONG_SHELL,
  LONG_TURN_SECONDS,
  MANY_TOOLS,
  pick,
  RIDES,
  siteWeight,
  WORK_ACTS,
} from './moods'
import type { Mood, Work } from './moods'
import { ACTS, SHEETS } from './sprites'
import type { Sheet as RawSheet } from './sprites'

export const FPS = 12
// the band's height: the tallest ride, two pixels a row. The few acts taller
// than that (heart, confetti, fishing: 36 or 37 pixels) lose their top rows,
// which only ever hold sky: the top of a rising heart, a fishing rod's tip,
// confetti in the air.
export const ROWS = 17
// the clone bit: about 2 s, the first 0.75 s splitting, the last 0.4 s popped
export const CLONE_TICKS = 24
const CLONE_SPLIT = 9
const CLONE_POP = 5

const CLEAR = 255
const DEFAULT = 0x01000000
const ORANGE = 0xd97757
const SPACE = 0x20
const UPPER = 0x2580
const LOWER = 0x2584
// on the acts' 55 by 37 grid, the column between Clawd's feet when he stands
const ACT_CENTER = 26

type Sheet = {
  w: number
  h: number
  colors: number[]
  frames: Uint8Array[]
  launch: number
  cruise: number[]
  outro: number
  speed: number
  // how far right of the sheet's left edge his middle is, facing right
  anchor: number
  isAct: boolean
  // a frame the act holds a while, and for how many ticks
  hold?: { frame: number; ticks: number }
}

// one palette index per character: 0-9, then a-z past ten colours
const index = (c: string) => (c === '.' ? CLEAR : parseInt(c, 36))

function decode(s: RawSheet, act?: { x: number; hold?: { at: number; seconds: number } }): Sheet {
  const cur = Uint8Array.from([...s.base].map(index))
  const frames = [cur.slice()]
  for (const d of s.deltas) {
    if (d) {
      for (const op of d.split(',')) {
        const end = op.length - 1
        cur[parseInt(op.slice(0, end), 36)] = index(op.charAt(end))
      }
    }
    frames.push(cur.slice())
  }

  return {
    w: s.w,
    h: s.h,
    colors: s.palette.map((hex) => parseInt(hex.slice(1), 16)),
    frames,
    launch: s.launch,
    cruise: s.cruise,
    outro: s.outro,
    speed: s.speed,
    anchor: act ? ACT_CENTER - act.x : s.w / 2,
    isAct: act !== undefined,
    hold: act?.hold && {
      frame: Math.floor(act.hold.at * frames.length),
      ticks: Math.round(act.hold.seconds * FPS),
    },
  }
}

export type Move = 'walk' | 'skate' | 'car' | 'scooter' | 'bike' | 'space' | 'pool' | 'kite'
export const MOVES: Move[] = ['walk', 'skate', 'car', 'scooter', 'bike', 'space', 'pool', 'kite']

// The Lottie acts from claude.dev; each plays once through, standing where he is.
export const ACT_NAMES = Object.keys(ACTS)
// the site's workstations are the laptop and desktop acts, pixel for pixel
const ALIASES: Record<string, string> = { laptopStation: 'laptop', desktopStation: 'desktop' }

const sheets: Record<string, Sheet> = {
  ...Object.fromEntries(MOVES.map((m) => [m, decode(SHEETS[m]!)])),
  ...Object.fromEntries(Object.entries(ACTS).map(([name, a]) => [name, decode(a, { x: a.x, hold: HOLDS[name] })])),
}

/** A move's or act's own name for any spelling of it, or undefined. */
export function known(word: string): string | undefined {
  const w = word.trim().toLowerCase()
  const name = [...MOVES, ...ACT_NAMES, ...Object.keys(ALIASES)].find((n) => n.toLowerCase() === w)
  return name && (ALIASES[name] ?? name)
}

/** The tallest sheet of all, in pixels (the band is ROWS * 2). */
export const tallest = () => Math.max(...Object.values(sheets).map((s) => s.h))

// A move in progress: intro frames, then the cruise frames on repeat, then the
// outro. An act has only the intro: its frames once through (or on repeat).
type Play = {
  move: string
  phase: 'intro' | 'cruise' | 'outro'
  frame: number
  step: number
  // cells left to travel (moving sheets) or ticks left to loop (the others);
  // Infinity loops until stopped; 0 plays an act once
  budget: number
  stopping: boolean
  // ticks spent on the act's held frame
  held: number
  // the mood that picked it; none when asked for
  mood?: Mood
}

type Bubble = { text: string; ticks: number }

export class Clawd {
  columns = 80
  center = 20
  facing: 1 | -1 = 1
  play: Play | null = null
  pending: { move: string; target?: number; budget?: number } | null = null
  hop = { y: 0, vy: 0, left: 0 }
  bubble: Bubble | null = null
  blink = 0
  tick = 0
  idleSince = 0
  lastTool = 0
  isWorking = false
  // the kind of work the last tool did, which leans the lock-in picks
  work: Work = 'none'
  // what the moods picked last, so nothing plays twice in a row
  lastPick = ''
  // what is left of the turn's end: a celebration act, then the hop
  cheer: 'act' | 'hop' | null = null
  private turnStarted = 0
  private toolsThisTurn = 0
  // tool calls still running, and since when a shell command has been
  private running = 0
  private shells = 0
  private shellSince = 0
  // rides (positive) or acts (negative) picked in a row while locked in
  private streak = 0
  private nextBlink = 40
  private nextStroll = 0
  private shake = 0
  // the clone bit: copies slide out of him, hold, and pop off to their panes
  private clones = { count: 0, left: 0 }

  /** `random` is Math.random in the band; tests pass a seeded one. */
  constructor(private random: () => number = Math.random) {}

  resize(columns: number) {
    this.columns = Math.max(16, columns)
    this.center = Math.min(Math.max(this.center, 6), this.columns - 6)
  }

  /** The mood his own picks come from now. */
  get mood(): Mood | 'idle' {
    if (this.cheer) return 'celebrate'
    if (this.quiet >= FPS * CHILL_AFTER) return 'chill'
    return this.isWorking ? 'lockin' : 'idle'
  }

  /** Ticks since anything happened; none while a tool is still running. */
  get quiet() {
    return this.running > 0 ? 0 : this.tick - Math.max(this.lastTool, this.idleSince)
  }

  // --- requests from the session -------------------------------------------

  /** Asks for a move or act; a ride or float already running finishes first. */
  request(move: string, target?: number) {
    if (this.play && (this.play.move === move || this.pending?.move === move)) {
      return
    }
    this.pending = { move, target }
    this.rouse()
    this.interrupt()
  }

  /**
   * One pick from a mood's pool, as that mood would pick it (the previous pick
   * left out), played without touching the session's mood or its timers:
   * when it ends he goes back to whatever the session is doing. Says what.
   */
  sample(mood: Mood): string {
    const name =
      mood === 'lockin'
        ? this.pickWork()
        : mood === 'chill'
          ? pick(CHILL, siteWeight, this.random, this.lastPick)
          : pick(CELEBRATE, siteWeight, this.random, this.lastPick)
    this.lastPick = name
    const sheet = sheets[name]!
    // a float gets the few seconds its mood gives it, not forever
    const budget =
      !sheet.isAct && sheet.speed === 0
        ? FPS * (mood === 'chill' ? 6 + this.random() * 6 : 4 + this.random() * 3)
        : undefined
    this.pending = { move: name, budget }
    this.rouse()
    this.interrupt()
    return name
  }

  /** Ends a stroll or an open-ended float at its next chance; rides run on. */
  interrupt() {
    if (this.play && (this.play.move === 'walk' || this.play.budget === Infinity)) {
      this.play.stopping = true
    }
  }

  jump(times = 1) {
    if (this.play && this.play.move !== 'walk') {
      return
    }
    this.hop.left = Math.max(this.hop.left, times)
  }

  clone(count: number) {
    this.clones = { count, left: CLONE_TICKS }
    this.say(`x${count + 1}`, CLONE_TICKS / FPS)
  }

  // Each copy's offset from him in sprite pixels: right, left, then further right.
  cloneOffsets(width: number): number[] {
    const { count, left } = this.clones
    if (!count || left <= 0) {
      return []
    }
    const age = CLONE_TICKS - left
    // popped off to their panes
    if (left <= CLONE_POP) {
      return []
    }
    const t = Math.min(1, age / CLONE_SPLIT)
    const eased = 1 - (1 - t) * (1 - t)
    const gap = width + 2
    return Array.from({ length: count }, (_, k) => {
      const slot = k === 1 ? -1 : k === 0 ? 1 : 2
      return Math.round(slot * gap * eased)
    })
  }

  say(text: string, seconds = 1.5) {
    this.bubble = { text, ticks: Math.round(seconds * FPS) }
  }

  stumble() {
    this.shake = 6
    this.say('?!')
  }

  /** Something happened: chill ends (an act at once, a float through its outro). */
  wake() {
    this.idleSince = this.tick
    this.rouse()
    this.interrupt()
  }

  /** A prompt went in: a hop and "!", or the happy double hop for a thanks. */
  prompt(isThanks = false) {
    this.wake()
    this.cheer = null
    if (isThanks) {
      this.jump(2)
      this.say('yay')
    } else {
      this.jump()
      this.say('!')
    }
  }

  turnStart() {
    this.isWorking = true
    this.lastTool = this.tick
    this.turnStarted = this.tick
    this.toolsThisTurn = 0
    this.work = 'none'
  }

  /** A tool call starts: lock in, leaning toward that kind of work. */
  toolStart(work: Work) {
    this.lastTool = this.tick
    this.work = work
    this.toolsThisTurn++
    this.running++
    if (work === 'shell' && this.shells++ === 0) {
      this.shellSince = this.tick
    }
    this.rouse()
    // standing between picks: get going
    this.nextStroll = Math.min(this.nextStroll, this.tick + FPS / 2)
  }

  /** A tool call is done; a failure shakes him. */
  toolDone(work: Work, isFailed: boolean) {
    this.lastTool = this.tick
    this.running = Math.max(0, this.running - 1)
    if (work === 'shell') {
      this.shells = Math.max(0, this.shells - 1)
    }
    if (isFailed) {
      this.stumble()
    }
  }

  /** The turn is over: a long or busy one earns a celebration, any one a "yay". */
  turnEnd() {
    const isBig = this.tick - this.turnStarted >= FPS * LONG_TURN_SECONDS || this.toolsThisTurn >= MANY_TOOLS
    this.isWorking = false
    this.running = 0
    this.shells = 0
    this.wake()
    this.cheer = isBig ? 'act' : 'hop'
  }

  // --- the clock -------------------------------------------------------------

  step() {
    this.tick++
    if (this.bubble && --this.bubble.ticks <= 0) {
      this.bubble = null
    }
    if (this.shake > 0) {
      this.shake--
    }
    if (this.clones.left > 0) {
      this.clones.left--
    }
    // the turn's "yay", as soon as he is standing or strolling
    if (this.cheer === 'hop' && (!this.play || this.play.move === 'walk')) {
      this.cheer = null
      this.jump(2)
      this.say('yay')
    }
    this.stepHop()
    this.stepBlink()

    if (this.play) {
      this.stepPlay(this.play)
    } else if (this.pending) {
      this.start(this.pending.move, { target: this.pending.target, budget: this.pending.budget })
      this.pending = null
    } else {
      this.stepIdle()
    }
  }

  private stepHop() {
    const hop = this.hop
    if (hop.y === 0 && hop.vy === 0 && hop.left > 0) {
      hop.left--
      hop.vy = 4.8
    }
    if (hop.vy !== 0 || hop.y > 0) {
      hop.y += hop.vy
      hop.vy -= 1.2
      if (hop.y <= 0) {
        hop.y = 0
        hop.vy = 0
      }
    }
  }

  private stepBlink() {
    if (this.blink > 0) {
      this.blink--
    } else if (this.tick >= this.nextBlink) {
      this.blink = 2
      this.nextBlink = this.tick + FPS * (2 + this.random() * 4)
    }
  }

  // Free to do something: the turn's celebration first, then whatever the mood picks.
  private stepIdle() {
    if (this.cheer === 'act') {
      this.cheer = 'hop'
      this.begin(pick(CELEBRATE, siteWeight, this.random, this.lastPick), 'celebrate')
      return
    }

    const mood = this.mood
    if (mood === 'chill') {
      const quiet = this.quiet
      // long quiet: a nap or the pool, until something happens
      if (quiet >= FPS * CHILL_DEEPEST) {
        this.begin(pick(CHILL_DEEP, siteWeight, this.random, this.lastPick), 'chill', Infinity)
        return
      }
      if (this.tick < this.nextStroll) {
        return
      }
      if (quiet < FPS * CHILL_DEEPER) {
        this.begin(
          pick(CHILL_FIRST, () => 1, this.random, this.lastPick),
          'chill',
        )
      } else {
        this.begin(pick(CHILL, siteWeight, this.random, this.lastPick), 'chill')
      }
      return
    }
    if (mood === 'lockin') {
      if (this.tick >= this.nextStroll) {
        this.begin(this.pickWork(), 'lockin')
      }
      return
    }
    if (this.tick >= this.nextStroll && this.random() < 0.004) {
      this.jump()
    }
  }

  // Lock in: about every other pick a ride, so he reads as busy; the work
  // leans which one, and a long shell command gets a coffee.
  private pickWork(): string {
    if (this.shells > 0 && this.tick - this.shellSince >= FPS * LONG_SHELL && this.lastPick !== 'coffee') {
      return 'coffee'
    }
    const isRide = this.streak >= 2 ? false : this.streak <= -2 ? true : this.random() < 0.5
    return pick(isRide ? RIDES : WORK_ACTS, lean(this.work), this.random, this.lastPick)
  }

  // Starts a mood's pick. Floats that would run until stopped get a few
  // seconds instead, unless `budget` says otherwise.
  private begin(name: string, mood: Mood, budget?: number) {
    this.lastPick = name
    if (mood === 'lockin') {
      const isRide = (RIDES as readonly string[]).includes(name)
      this.streak = isRide ? Math.max(this.streak, 0) + 1 : Math.min(this.streak, 0) - 1
    }
    const sheet = sheets[name]!
    let ticks = budget
    if (ticks === undefined && !sheet.isAct && sheet.speed === 0) {
      ticks = FPS * (mood === 'chill' ? 6 + this.random() * 6 : 4 + this.random() * 3)
    }
    this.start(name, { budget: ticks, mood })
  }

  private start(move: string, opts: { target?: number; budget?: number; mood?: Mood } = {}) {
    const sheet = sheets[move]
    if (!sheet) {
      return
    }
    let budget = opts.budget ?? (sheet.isAct ? 0 : Infinity)
    if (sheet.speed > 0) {
      if (move === 'walk') {
        const half = sheet.w / 2
        const spot = opts.target ?? half + this.random() * (this.columns - 2 * half)
        budget = Math.abs(spot - this.center)
        this.facing = spot >= this.center ? 1 : -1
        if (budget < 6) {
          this.nextStroll = this.tick + FPS
          return
        }
      } else {
        // rides cross most of the strip and wrap at the edges; from near a
        // wall they set off away from it
        budget = this.columns * (0.6 + this.random() * 0.4)
        const side = this.center / this.columns
        this.facing = side < 0.3 ? 1 : side > 0.7 ? -1 : this.random() < 0.5 ? 1 : -1
      }
    }
    this.play = { move, phase: 'intro', frame: 0, step: 0, budget, stopping: false, held: 0, mood: opts.mood }
  }

  // Chill gives way: an act ends now, a float heads into its outro.
  private rouse() {
    const play = this.play
    if (!play || play.mood !== 'chill') {
      return
    }
    if (sheets[play.move]!.isAct) {
      this.finish()
    } else {
      play.stopping = true
    }
  }

  private stepPlay(play: Play) {
    const sheet = sheets[play.move]!
    if (sheet.isAct) {
      return this.stepAct(play, sheet)
    }
    const introEnd = sheet.cruise[0] ?? sheet.frames.length
    const moving =
      sheet.speed > 0 && ((play.phase === 'intro' && play.frame >= sheet.launch) || play.phase === 'cruise')

    if (moving) {
      const dx = Math.min(sheet.speed / FPS, play.budget)
      this.center += dx * this.facing
      play.budget -= dx
      this.wrap(sheet, play.move === 'walk')
    } else if (sheet.speed === 0 && play.phase === 'cruise' && play.budget !== Infinity) {
      play.budget--
    }

    if (play.phase === 'intro') {
      if (play.frame + 1 < introEnd) {
        play.frame++
        return
      }
      if (!sheet.cruise.length) {
        return this.finish()
      }
      play.phase = 'cruise'
      play.step = 0
      play.frame = sheet.cruise[0] ?? 0
      return
    }

    if (play.phase === 'cruise') {
      const done = play.stopping || play.budget <= 0
      if (!done) {
        play.step = (play.step + 1) % sheet.cruise.length
        play.frame = sheet.cruise[play.step] ?? 0
        return
      }
      if (sheet.outro >= sheet.frames.length) {
        return this.finish()
      }
      play.phase = 'outro'
      play.frame = sheet.outro
      return
    }

    if (play.frame + 1 < sheet.frames.length) {
      play.frame++
    } else {
      this.finish()
    }
  }

  // An act: its frames once through, holding where the site holds, or on
  // repeat (budget Infinity) until something stops it.
  private stepAct(play: Play, sheet: Sheet) {
    if (play.stopping) {
      return this.finish()
    }
    if (sheet.hold && play.frame === sheet.hold.frame && play.held < sheet.hold.ticks) {
      play.held++
      return
    }
    if (play.frame + 1 < sheet.frames.length) {
      play.frame++
      return
    }
    if (play.budget === Infinity) {
      play.frame = 0
      play.held = 0
      return
    }
    this.finish()
  }

  private finish() {
    const mood = this.play?.mood
    this.play = null
    // chill takes its time between picks
    this.nextStroll = this.tick + FPS * (mood === 'chill' ? 3 + this.random() * 5 : 0.5 + this.random() * 2.5)
    // left against a wall: stroll back out toward the middle
    const reach = sheets.walk!.w * 1.5
    if (!this.pending && (this.center < reach || this.center > this.columns - reach)) {
      this.pending = { move: 'walk', target: this.columns * (0.3 + this.random() * 0.4) }
    }
  }

  private wrap(sheet: Sheet, isWalk: boolean) {
    const half = sheet.w / 2
    if (isWalk) {
      this.center = Math.min(Math.max(this.center, half), this.columns - half)
    } else if (this.center - half > this.columns) {
      this.center = -half
    } else if (this.center + half < 0) {
      this.center = this.columns + half
    }
  }

  // --- painting --------------------------------------------------------------

  /** The strip as sprite pixels, one RGB per pixel (-1 clear), row-major. */
  private canvas(columns: number, height: number) {
    const px = new Int32Array(columns * height).fill(-1)

    const move = this.play?.move ?? 'walk'
    const sheet = sheets[move]!
    const frame = sheet.frames[this.play?.frame ?? 0]!
    const isFront = !this.play
    // facing left mirrors the sheet, and its middle with it
    const flip = this.facing < 0 && !isFront
    const anchor = flip ? sheet.w - sheet.anchor : sheet.anchor
    const left = Math.round(this.center - anchor) + (this.shake > 0 ? (this.shake % 2 ? 1 : -1) : 0)
    // a sheet taller than the strip loses its top rows
    const top = height - sheet.h - Math.round(this.hop.y)

    // the copies first, so he stays on top where they overlap
    for (const at of [...this.cloneOffsets(sheet.w), 0]) {
      for (let y = 0; y < sheet.h; y++) {
        const py = top + y
        if (py < 0 || py >= height) {
          continue
        }
        for (let x = 0; x < sheet.w; x++) {
          const px_ = left + at + x
          if (px_ < 0 || px_ >= columns) {
            continue
          }
          let p = frame[y * sheet.w + (flip ? sheet.w - 1 - x : x)] ?? CLEAR
          if (p === CLEAR) {
            continue
          }
          // a blink closes the eyes (palette 0) into the body colour
          if (isFront && this.blink > 0 && p === 0) {
            p = 2
          }
          px[py * columns + px_] = sheet.colors[p] ?? ORANGE
        }
      }
    }
    return { px, top: Math.max(0, top), left, w: sheet.w }
  }

  /** The strip as Raster cells: [codePoint, fg, bg] per cell, row-major. */
  paint(columns: number, rows: number): Uint32Array {
    const { px, top, left, w } = this.canvas(columns, rows * 2)

    const cells = new Uint32Array(columns * rows * 3)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const a = px[2 * r * columns + c] ?? -1
        const b = px[(2 * r + 1) * columns + c] ?? -1
        const i = (r * columns + c) * 3
        if (a < 0 && b < 0) {
          cells[i] = SPACE
          cells[i + 1] = DEFAULT
          cells[i + 2] = DEFAULT
        } else if (b < 0) {
          cells[i] = UPPER
          cells[i + 1] = a
          cells[i + 2] = DEFAULT
        } else if (a < 0) {
          cells[i] = LOWER
          cells[i + 1] = b
          cells[i + 2] = DEFAULT
        } else {
          cells[i] = UPPER
          cells[i + 1] = a
          cells[i + 2] = b
        }
      }
    }

    if (this.bubble) {
      const text = this.bubble.text
      const row = Math.max(0, Math.floor(top / 2) - 1)
      const start = Math.min(Math.max(0, left + w), columns - text.length)
      for (let k = 0; k < text.length; k++) {
        const i = (row * columns + start + k) * 3
        cells[i] = text.charCodeAt(k)
        cells[i + 1] = ORANGE
        cells[i + 2] = DEFAULT
      }
    }

    return cells
  }

  /**
   * The strip as an SVG document, for surfaces without Raster (the desktop):
   * the same pixels, square, each colour one path of its runs, `scale` CSS
   * pixels a sprite pixel.
   */
  svg(columns: number, height: number, scale: number): string {
    const { px, top, left, w } = this.canvas(columns, height)

    const runs = new Map<number, string>()
    for (let y = 0; y < height; y++) {
      let x = 0
      while (x < columns) {
        const c = px[y * columns + x] ?? -1
        let end = x + 1
        while (end < columns && px[y * columns + end] === c) end++
        if (c >= 0) {
          runs.set(c, `${runs.get(c) ?? ''}M${x} ${y}h${end - x}v1h${x - end}z`)
        }
        x = end
      }
    }

    let body = ''
    for (const [c, d] of runs) {
      body += `<path fill="#${c.toString(16).padStart(6, '0')}" d="${d}"/>`
    }
    if (this.bubble) {
      const text = this.bubble.text.replace(/[<>&"]/g, (ch) => `&#${ch.charCodeAt(0)};`)
      const x = Math.min(Math.max(0, left + w + 1), columns - 4 * text.length)
      const y = Math.max(5, top - 1)
      body +=
        `<text x="${x}" y="${y}" font-family="ui-monospace, monospace" font-size="6" ` +
        `font-weight="bold" fill="#${ORANGE.toString(16)}">${text}</text>`
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${columns} ${height}" ` +
      `width="${columns * scale}" height="${height * scale}" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges">${body}</svg>`
    )
  }
}

export function toBase64(cells: Uint32Array): string {
  const bytes = new Uint8Array(cells.buffer)
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}
