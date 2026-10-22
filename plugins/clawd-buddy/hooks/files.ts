// The files Claude touched this session, newest first, each with the line it
// was last at, so a press opens it there in an editor (VS Code by default).

export type Kind = 'edit' | 'write' | 'read'

export type Touch = {
  // as the tool had it, absolute
  path: string
  kind: Kind
  // 1-based, where the last edit landed or the read began
  line: number
  // how many times Claude changed it
  edits: number
}

const KEEP = 12

const slashes = (p: string) => p.replaceAll('\\', '/')
const GLYPH: Record<Kind, string> = { edit: '✎', write: '+', read: '·' }

// argv for an editor and a file at a line; `zed path:line` and `code -g path:line` both take this
export const EDITOR = ['code', '-g']

// Editors that open `path:line` from the command line, and the flag each needs for it.
const OPENS_AT_LINE: Record<string, string[]> = {
  code: ['-g'],
  'code-insiders': ['-g'],
  codium: ['-g'],
  cursor: ['-g'],
  windsurf: ['-g'],
  zed: [],
  zeditor: [],
  subl: [],
}

// The editor files open in when none was picked: $VISUAL, then $EDITOR, when
// it names one of the editors above; else VS Code. A terminal editor (vim,
// nano) would have no terminal to draw in, so it is passed over.
export function defaultEditor(...vars: (string | undefined)[]): string[] {
  for (const v of vars) {
    const command = v?.trim().split(/\s+/)[0]
    if (!command) continue
    const name = slashes(command)
      .split('/')
      .pop()!
      .toLowerCase()
      .replace(/\.(exe|cmd|bat)$/, '')
    const flags = OPENS_AT_LINE[name]
    if (flags) return [command, ...flags]
  }
  return [...EDITOR]
}

// The 1-based line `needle` starts on in `text`, or 1 when it is not there.
export function lineOf(text: string, needle: string): number {
  const at = needle ? text.indexOf(needle) : -1
  return at < 0 ? 1 : text.slice(0, at).split('\n').length
}

export class Files {
  touches: Touch[] = []
  // the working directory, to show paths under it short
  cwd = ''
  // open each file in the editor as Claude changes it; kept across sessions
  isFollowing = false
  // the repository's top folder, and git's word on each changed file under it
  root = ''
  git = new Map<string, string>()

  // Takes `git status --porcelain=v1` from `root`: M changed, A added, D deleted, U untracked.
  setStatus(porcelain: string): void {
    this.git.clear()
    const root = slashes(this.root).replace(/\/$/, '')
    for (const line of porcelain.split('\n')) {
      if (line.length < 4) continue
      const xy = line.slice(0, 2)
      const path = line.slice(3).split(' -> ').pop()!.replace(/^"|"$/g, '')
      const code = xy === '??' ? 'U' : xy[0] !== ' ' ? xy[0]! : xy[1]!
      this.git.set(`${root}/${slashes(path)}`.toLowerCase(), code === 'R' || code === 'C' ? 'A' : code)
    }
  }

  // git's letter for the file, or '' when it is clean or not in the repository
  mark(t: Touch): string {
    return this.root ? (this.git.get(slashes(t.path).toLowerCase()) ?? '') : ''
  }

  touch(path: string, kind: Kind, line = 1): void {
    const key = slashes(path).toLowerCase()
    const i = this.touches.findIndex((t) => slashes(t.path).toLowerCase() === key)
    const was = i >= 0 ? this.touches.splice(i, 1)[0]! : undefined
    // a read never demotes a file Claude changed, and keeps its line
    if (was && was.kind !== 'read' && kind === 'read') {
      this.touches.unshift(was)
      return
    }
    this.touches.unshift({
      path,
      kind: was?.kind === 'write' && kind === 'edit' ? 'write' : kind,
      line: Math.max(1, line),
      edits: (was?.edits ?? 0) + (kind === 'read' ? 0 : 1),
    })
    this.touches.length = Math.min(this.touches.length, KEEP)
  }

  // the newest file Claude changed, for the band's one button
  get lastChanged(): Touch | undefined {
    return this.touches.find((t) => t.kind !== 'read')
  }

  name(t: Touch): string {
    return slashes(t.path).split('/').pop() ?? t.path
  }

  // the folder, under the working directory when it is there
  folder(t: Touch): string {
    const path = slashes(t.path)
    const dir = path.slice(0, Math.max(0, path.lastIndexOf('/')))
    const cwd = slashes(this.cwd).replace(/\/$/, '')
    if (cwd && dir.toLowerCase() === cwd.toLowerCase()) return ''
    if (cwd && dir.toLowerCase().startsWith(`${cwd.toLowerCase()}/`)) return `${dir.slice(cwd.length + 1)}/`
    return `${dir}/`
  }

  // One row's words: `✎ register.tsx  hooks/  :329 ×3`, cut to `columns`.
  label(t: Touch, columns: number): string {
    const times = t.edits > 1 ? ` ×${t.edits}` : ''
    const tail = `  :${t.line}${times}`
    const head = `${GLYPH[t.kind]} ${this.name(t)}`
    const room = columns - head.length - tail.length - 2
    let folder = this.folder(t)
    if (folder.length > room) folder = room > 2 ? `…${folder.slice(folder.length - room + 1)}` : ''
    return `${head}${folder ? `  ${folder}` : ''}${tail}`
  }

  // the editor's argv to open `t` where Claude left it
  argv(t: Touch, editor: readonly string[] = EDITOR): string[] {
    return [...editor, `${t.path}:${t.line}`]
  }
}
