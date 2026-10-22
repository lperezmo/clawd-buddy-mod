// Renders docs/clawd.gif: the plugin's own actor run through a short script,
// each frame painted the way the band paints it and scaled up for the README.
//
//   bun tools/render-preview.ts        (needs ffmpeg on PATH)

import { Clawd, FPS, ROWS } from '../plugins/clawd-buddy/hooks/actor'

const COLUMNS = 96
const SCALE = 4
const BACKGROUND = 0x262624
const OUT = new URL('../docs/clawd.gif', import.meta.url)

// the same walk every time
let seed = 7
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

type Step = { wait: number; run: (c: Clawd) => void }
// a ride or an act by name: one of each mood, locked in, celebrating, chilling
const ride = (move: string): Step => ({ wait: 6, run: (c) => c.request(move) })
const SCRIPT: Step[] = [
  { wait: 14, run: (c) => (c.jump(2), c.say('hi!')) },
  ride('laptop'),
  ride('skate'),
  ride('kite'),
  ride('car'),
  ride('confetti'),
  ride('snooze'),
]

const clawd = new Clawd()
clawd.resize(COLUMNS)
clawd.center = 24

const width = COLUMNS * SCALE
const height = ROWS * 2 * SCALE
const frames: Uint8Array[] = []

function capture() {
  const cells = clawd.paint(COLUMNS, ROWS)
  const header = new TextEncoder().encode(`P6 ${width} ${height} 255\n`)
  const img = new Uint8Array(header.length + width * height * 3)
  img.set(header)
  const put = (x: number, y: number, rgb: number) => {
    for (let dy = 0; dy < SCALE; dy++) {
      let i = header.length + ((y * SCALE + dy) * width + x * SCALE) * 3
      for (let dx = 0; dx < SCALE; dx++) {
        img[i++] = rgb >> 16
        img[i++] = (rgb >> 8) & 0xff
        img[i++] = rgb & 0xff
      }
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLUMNS; c++) {
      const i = (r * COLUMNS + c) * 3
      const [cp, fg, bg] = [cells[i]!, cells[i + 1]!, cells[i + 2]!]
      const solid = (v: number) => (v & 0x01000000 ? BACKGROUND : v)
      // half blocks only; the speech bubble's letters are left out
      const top = cp === 0x2580 ? solid(fg) : cp === 0x2584 ? solid(bg) : BACKGROUND
      const bottom = cp === 0x2580 ? solid(bg) : cp === 0x2584 ? solid(fg) : BACKGROUND
      put(c, 2 * r, top)
      put(c, 2 * r + 1, bottom)
    }
  }
  frames.push(img)
}

for (const step of SCRIPT) {
  for (let t = 0; t < step.wait; t++) {
    clawd.step()
    capture()
  }
  step.run(clawd)
  // let the move play out (the float in space is cut short after two seconds)
  let t = 0
  do {
    clawd.step()
    capture()
    if (clawd.play?.move === 'space' && ++t === FPS * 2) clawd.wake()
  } while (clawd.play || clawd.pending)
}
clawd.jump(2)
for (let t = 0; t < FPS * 2; t++) {
  clawd.step()
  capture()
}

const ffmpeg = Bun.spawn(
  [
    'ffmpeg',
    '-y',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-c:v',
    'ppm',
    '-framerate',
    String(FPS),
    '-i',
    '-',
    '-vf',
    'split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=none',
    '-loop',
    '0',
    Bun.fileURLToPath(OUT),
  ],
  { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' },
)
for (const f of frames) ffmpeg.stdin.write(f)
await ffmpeg.stdin.end()
if ((await ffmpeg.exited) !== 0) throw new Error('ffmpeg failed')
console.log(`${frames.length} frames (${(frames.length / FPS).toFixed(1)}s) -> ${Bun.fileURLToPath(OUT)}`)
