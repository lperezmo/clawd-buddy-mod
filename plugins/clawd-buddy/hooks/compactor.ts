// Compaction on the person's terms: a button that compacts now, and an
// auto-compact of the mod's own at a threshold picked on a slider. The slider
// runs from 300k to 900k (or the window, if smaller) in steps of 100k, and no
// threshold is ever taken under 200k, so it cannot be set ridiculously low.

export const FLOOR = 200_000
export const STEP = 100_000
const FIRST = 300_000
const LAST = 900_000
const DEFAULT = 500_000

export class Compactor {
  isOn = false
  at = DEFAULT
  isCompacting = false
  // the compact button was pressed once and waits for the second press
  isArmed = false

  // The thresholds the slider offers for a window of `window` tokens.
  stops(window: number): number[] {
    const top = Math.min(LAST, window > 0 ? window : LAST)
    const out: number[] = []
    for (let v = FIRST; v <= top; v += STEP) out.push(v)
    return out
  }

  set(at: number): void {
    this.at = Math.max(FLOOR, Math.round(at / STEP) * STEP)
  }

  isDue(tokens: number): boolean {
    return this.isOn && !this.isCompacting && tokens >= this.at
  }

  saved(): { on: boolean; at: number } {
    return { on: this.isOn, at: this.at }
  }

  restore(kept: unknown): void {
    const k = kept as { on?: unknown; at?: unknown } | undefined
    if (typeof k?.on === 'boolean') this.isOn = k.on
    if (typeof k?.at === 'number') this.set(k.at)
  }
}
