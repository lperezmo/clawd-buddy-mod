// /multiply: opens up to three more Claude sessions in new PowerShell windows
// (Windows only), with `--remote-control` when the multiplyRemoteControl option
// is on. A clone learns its number from CLAWD_CLONE.

export const MAX = 3
export const ENV = 'CLAWD_CLONE'

// "", "2", "9", "lots": how many to open, and whether the ask went over the cap
export function count(args: string): { count: number; isCapped: boolean } | null {
  const word = args.trim()
  if (!word) {
    return { count: 1, isCapped: false }
  }
  if (!/^\d+$/.test(word) || Number(word) < 1) {
    return null
  }
  const n = Number(word)
  return { count: Math.min(n, MAX), isCapped: n > MAX }
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`

// The script that opens one clone: a new PowerShell window in the session's
// folder, the clone's number set for the claude it runs.
export function windowScript(cwd: string, n: number, isRemote = false): string {
  const claude = isRemote ? 'claude --remote-control' : 'claude'
  return [
    `$env:${ENV} = '${n}'`,
    `Start-Process powershell -WorkingDirectory ${quote(cwd)} -ArgumentList '-NoExit', '-Command', '${claude}'`,
  ].join('; ')
}

// PowerShell's -EncodedCommand: the script as UTF-16LE in base64, so no
// folder name can break the quoting on its way through the command line.
export function encode(script: string): string {
  const bytes: number[] = []
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i)
    bytes.push(c & 0xff, c >> 8)
  }
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]]
    const word = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += abc[(word >> 18) & 63]! + abc[(word >> 12) & 63]!
    out += b === undefined ? '=' : abc[(word >> 6) & 63]!
    out += c === undefined ? '=' : abc[word & 63]!
  }
  return out
}

export function windowArgv(cwd: string, n: number, isRemote = false): string[] {
  return ['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encode(windowScript(cwd, n, isRemote))]
}

// CLAWD_CLONE as this session's clone number, or null for a session of its own
export function cloneNumber(value: string | undefined): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= MAX ? n : null
}
