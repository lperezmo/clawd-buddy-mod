import type { EngineInterface, Register, ToolCallInput } from 'claude-code'

import { ACT_NAMES, Clawd, FPS, known, MOVES, ROWS, toBase64 } from './actor'
import { Cache, ttlFromEnv, ttlFromTiming } from './cache'
import { Compactor } from './compactor'
import { defaultEditor, EDITOR, Files, lineOf } from './files'
import { LABEL, Lens } from './lens'
import { isThanks, workFor } from './moods'
import { cloneNumber, count as cloneCount, MAX as CLONE_MAX, windowArgv } from './multiply'
import type { Mood } from './moods'
import { report } from './report'
import { SIDEBAR_ID, SIDEBAR_TITLE, sidebarView } from './sidebar'
import { Weather } from './weather'
import type { Piece } from './weather'

const KEY = 'clawd'
// the desktop draws the strip as an SVG: CSS pixels per sprite pixel, the
// desktopSize option; no half blocks there, so any size keeps full detail
const SCALE = 3
// the sizes the sidebar's slider offers there
const SIZES = [2, 2.5, 3, 3.5, 4] as const
// about how wide a band column draws on the desktop, in CSS pixels
const CELL = 14

// The band's buttons, in order, each with the letter that presses it while
// the band has focus (ctrl+x tab or a click).
// Each mood button plays one pick from that mood's pool.
const BUTTONS: { key: string; label: string; word: string; hotkey: string }[] = [
  { key: 'jump', label: 'jump', word: 'jump', hotkey: 'j' },
  { key: 'celebrate', label: 'Celebrate', word: 'celebrate', hotkey: 'c' },
  { key: 'lockin', label: 'Lock in', word: 'lock in', hotkey: 'k' },
  { key: 'chill', label: 'Chill', word: 'chill', hotkey: 'n' },
]

// /clawd's words for the moods
const MOODS: Record<string, Mood> = { celebrate: 'celebrate', 'lock in': 'lockin', lockin: 'lockin', chill: 'chill' }

// Compacts the conversation now, as /compact does; Claude must be between turns.
function compactNow($: EngineInterface, compactor: Compactor): void {
  if (compactor.isCompacting) {
    return
  }
  compactor.isCompacting = true
  compactor.isArmed = false
  $.ui.invalidate('ui.render')
  void $.session
    .compact()
    .catch(() => {
      $.ui.toast('clawd-buddy: Claude is mid-turn; compact once the turn ends.')
    })
    .finally(() => {
      compactor.isCompacting = false
      $.ui.invalidate('ui.render')
    })
}

// Whether this machine is Windows, where /multiply's PowerShell windows open.
async function isWindows($: EngineInterface): Promise<boolean> {
  try {
    return (await $.env.get('OS')) === 'Windows_NT'
  } catch {
    return false
  }
}

// Opens the clones' windows one after another; how many opened.
async function multiply($: EngineInterface, n: number, isRemote: boolean): Promise<number> {
  const cwd = await $.session.cwd()
  let opened = 0
  for (let k = 1; k <= n; k++) {
    try {
      const r = await $.process.run(windowArgv(cwd, k, isRemote), { timeoutMs: 15_000 })
      if (r.exitCode !== 0) {
        break
      }
      opened++
    } catch {
      break
    }
  }
  return opened
}

// A clone hops in and says its number.
async function arrive(clawd: Clawd, n: number): Promise<void> {
  clawd.jump(2)
  clawd.say(`clone ${n}`, 2)
}

// Clears the conversation, as /clear does, once the session is idle. The
// band asks for a second press first; /clawd clear asks in a dialog.
const clearing = { isArmed: false }

function clearNow($: EngineInterface): void {
  clearing.isArmed = false
  $.ui.invalidate('ui.render')
  void $.command.run({ command: 'clear' }).catch(() => {
    $.ui.toast('clawd-buddy: could not clear right now; try /clear.')
  })
}

const CLEAR_YES = 'Clear it'
const CLEAR_NO = 'Keep it'

// /clawd clear: asks first, and a run with no one to ask leaves it alone.
async function askClear($: EngineInterface): Promise<{ text: string }> {
  let answer: string
  try {
    answer = await $.ui.ask('Clear the conversation? It starts over fresh, as /clear does.', {
      header: 'clawd-buddy',
      options: [CLEAR_YES, CLEAR_NO],
    })
  } catch {
    return { text: 'No one to ask here, so nothing was cleared.' }
  }
  if (answer !== CLEAR_YES) {
    return { text: 'Kept the conversation.' }
  }
  // after this command has finished, so /clear is not waiting on it
  $.clock.after(50, () => clearNow($))
  return { text: 'Clearing…' }
}

// Reads the session's figures again: the limits as the last reply left them
// (a window whose reset passed reads full), the context, the cache's plan.
// Local only, no requests.
async function readUsage($: EngineInterface, weather: Weather, cache: Cache, lens: Lens): Promise<void> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    weather.record(u.context, u.rateLimits)
    cache.limits = weather.limits
    lens.set(u.context.breakdown, false)
  } catch {
    // no figures yet; the first reply brings them
  }
  $.ui.invalidate('ui.render')
}

// Counts the context by category with the token-count API, as /context does:
// the one thing in the mod that sends requests, and only when pressed.
function countExactly($: EngineInterface, lens: Lens): void {
  lens.isCounting = true
  $.ui.invalidate('ui.render')
  void $.session
    .usage({ breakdown: 'full' })
    .then((u) => lens.set(u.context.breakdown, true))
    .catch(() => {})
    .finally(() => {
      lens.isCounting = false
      $.ui.invalidate('ui.render')
    })
}

// Opens a file (or the project) in the person's editor; says why when it cannot.
function openIn($: EngineInterface, argv: string[]): void {
  void $.process
    .run(argv, { timeoutMs: 15_000 })
    .then((r) => {
      if (r.exitCode !== 0) {
        const why = r.stderr.trim().split('\n')[0] ?? ''
        $.ui.toast(`clawd-buddy: ${argv[0]} said ${why || `exit ${r.exitCode}`}`)
      }
    })
    .catch(() => {
      $.ui.toast(`clawd-buddy: could not start ${argv[0]}; /clawd editor <command> picks another`)
    })
}

// Asks git which files under the repository are changed, for the marks by each file.
async function readGit($: EngineInterface, files: Files): Promise<void> {
  try {
    if (!files.root) {
      const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: files.cwd || undefined })
      if (top.exitCode !== 0) return
      files.root = top.stdout.trim()
    }
    const status = await $.process.run(['git', 'status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: files.root,
    })
    if (status.exitCode === 0) {
      files.setStatus(status.stdout)
      $.ui.invalidate('ui.render')
    }
  } catch {
    // no git here; the files go unmarked
  }
}

// Remembers the file a file tool touched, and the line it touched; says
// whether Claude changed it.
async function noteFile($: EngineInterface, files: Files, e: ToolCallInput): Promise<boolean> {
  try {
    if (e.tool === 'Edit') {
      files.touch(e.file_path, 'edit', lineOf(await $.fs.read(e.file_path), e.new_string))
    } else if (e.tool === 'Write') {
      files.touch(e.file_path, 'write')
    } else if (e.tool === 'Read') {
      files.touch(e.file_path, 'read', e.offset ?? 1)
    } else if (e.tool === 'NotebookEdit') {
      files.touch(e.notebook_path, 'edit')
    } else {
      return false
    }
    $.ui.invalidate('ui.render')
    return e.tool !== 'Read'
  } catch {
    // the file went away; nothing to open
    return false
  }
}

export const register: Register = (on, options) => {
  // the option is the default; the sidebar's slider picks one, kept across sessions
  let scale = Number(options.desktopSize) || SCALE
  const clawd = new Clawd()
  // /multiply's clones start with `claude --remote-control` when this option is on
  const isRemote = String(options.multiplyRemoteControl) === 'true'
  // the band as last drawn: where blits go and at what size
  let site: { requestId: string; columns: number; rows: number } | null = null
  let shown = ''
  let isBlitting = false
  // the desktop has no Raster or blit: the band redraws with each new picture
  let vector: { columns: number; height: number } | null = null
  let drawn = ''
  const weather = new Weather()
  // the clock, for the limits' reset countdowns
  let now = 0
  const lens = new Lens()
  // Clawd tucked away, the lines and buttons left; kept across sessions
  let isHidden = false
  const cache = new Cache()
  // the model the last request went to, and a compaction since: both rewrite the cache
  let model = ''
  let isRewritten = false
  const compactor = new Compactor()
  let sessionId = ''
  // the lines moved to a pane: asked for (kept across sessions), and on screen
  let isSidebar = false
  let isDocked = false
  const files = new Files()
  // the editor files open in, as an argv to put `path:line` after; kept across sessions
  let editor: string[] = [...EDITOR]

  function act(word: string): string {
    const mood = MOODS[word.replace(/s+/g, ' ')]
    if (mood) {
      // a sample of the mood; the session's own mood and timers stay as they are
      return `Clawd: ${clawd.sample(mood)}.`
    }
    clawd.wake()
    if (word === '' || word === 'jump') {
      clawd.jump(2)
      clawd.say('hi!')
      return 'Clawd hops.'
    }
    const move = known(word)
    if (!move) {
      return `Clawd knows the moods: celebrate, lock in, chill; the moves: ${MOVES.join(', ')}, jump; and the acts: ${ACT_NAMES.join(', ')}. /clawd context lists the context, cache and limits as text.`
    }
    clawd.request(move)
    return `Clawd is off: ${move}.`
  }

  on('session.start', async ($, e, next) => {
    // first, so nothing below can keep Clawd from moving
    $.clock.every(Math.round(1000 / FPS), () => {
      clawd.step()
      if (vector && clawd.svg(vector.columns, vector.height, scale) !== drawn) {
        $.ui.invalidate('ui.render')
      }
      if (!site || isBlitting) {
        return
      }
      const cells = toBase64(clawd.paint(site.columns, site.rows))
      if (cells === shown) {
        return
      }
      isBlitting = true
      const { requestId, columns, rows } = site
      void $.ui
        .blit({ requestId, key: KEY, cells, columns, rows })
        .then((r) => {
          shown = r.deny === undefined ? cells : ''
        })
        .finally(() => {
          isBlitting = false
        })
    })

    try {
      await $.command.register({
        name: 'clawd',
        description: `Send Clawd off: celebrate, lock in, chill, ${MOVES.join(', ')}, jump, or an act (dancing, coffee, ...); hide, show, sidebar, follow, editor <command>, clear`,
      })
    } catch {
      // another plugin holds /clawd; the band still works
    }
    // /multiply opens PowerShell windows, so it is offered on Windows only
    if (await isWindows($)) {
      try {
        await $.command.register({
          name: 'multiply',
          description: `Open 1 to ${CLONE_MAX} more Claude sessions${isRemote ? ' (--remote-control)' : ''} in new PowerShell windows`,
          argumentHint: `[1-${CLONE_MAX}]`,
        })
      } catch {
        // another plugin holds /multiply
      }
    }
    try {
      // $VISUAL or $EDITOR when it names an editor that opens path:line, else VS Code
      editor = defaultEditor(await $.env.get('VISUAL'), await $.env.get('EDITOR'))
    } catch {
      // no environment to read; VS Code it is
    }
    try {
      isHidden = (await $.store.get('hidden')) === true
      isSidebar = (await $.store.get('sidebar')) === true
      compactor.restore(await $.store.get('autocompact'))
      const kept = await $.store.get('editor')
      files.isFollowing = (await $.store.get('follow')) === true
      const size = await $.store.get('size')
      if (SIZES.some((s) => s === size)) {
        scale = Number(size)
      }
      if (Array.isArray(kept) && kept.length && kept.every((w) => typeof w === 'string')) {
        editor = kept
      }
    } catch {
      // nothing kept yet
    }
    try {
      cache.envTtl = ttlFromEnv(
        await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
        await $.env.get('FORCE_PROMPT_CACHING_5M'),
        await $.env.get('ENABLE_PROMPT_CACHING_1H'),
      )
    } catch {
      // Claude Code's own choice, by plan
    }
    try {
      const n = e.isInteractive ? cloneNumber(await $.env.get('CLAWD_CLONE')) : null
      if (n !== null) {
        void arrive(clawd, n).catch(() => {})
      }
    } catch {
      // a session of its own
    }

    // the countdowns move by the minute; checked often so they turn on time
    now = await $.clock.now()
    $.clock.every(15_000, () => {
      void $.clock.now().then((t) => {
        const isNewMinute = Math.floor(t / 60_000) !== Math.floor(now / 60_000)
        now = t
        if (isNewMinute && (!weather.isEmpty || cache.lastAt > 0)) {
          $.ui.invalidate('ui.render')
        }
      })
    })

    const started = await next(e)
    try {
      // a reload keeps the countdown: the last request is kept per session
      sessionId = await $.session.id()
      files.cwd = await $.session.cwd()
      void readGit($, files)
      const kept = (await $.store.get('cache')) as { session?: string; at?: number } | undefined
      if (kept?.session === sessionId && typeof kept.at === 'number') {
        cache.lastAt = kept.at
      }
    } catch {
      // it starts with the next request
    }
    if (isSidebar) {
      try {
        isDocked = (await $.ui.open({ id: SIDEBAR_ID, title: SIDEBAR_TITLE })).isPlaced
      } catch {
        isDocked = false
      }
    }
    await readUsage($, weather, cache, lens)
    return started
  })

  on('session.measure', ($, e, next) => {
    weather.record(e.context, e.rateLimits)
    cache.limits = weather.limits
    $.ui.invalidate('ui.render')
    // our own auto-compact, a moment after the turn that passed the threshold
    if (e.changed.includes('context') && compactor.isDue(e.context.tokens ?? 0)) {
      compactor.isCompacting = true
      $.clock.after(1000, () => {
        compactor.isCompacting = false
        compactNow($, compactor)
      })
    }
    // the categories, estimated locally: no requests
    if (e.changed.includes('context')) {
      void $.session
        .usage({ breakdown: 'summary' })
        .then((u) => {
          lens.set(u.context.breakdown, false)
          $.ui.invalidate('ui.render')
        })
        .catch(() => {})
    }
    return next(e)
  })

  // Each main-thread request reads the cached prompt and starts its TTL again.
  // How long the gap before it was, and whether it read or wrote the cache,
  // says which TTL it lives by.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }
    const t = await $.clock.now()
    const gap = cache.lastAt ? t - cache.lastAt : 0
    // a first request, a compaction or another model writes the cache whatever the TTL
    const isExempt = cache.lastAt === 0 || isRewritten || (model !== '' && model !== e.model)
    isRewritten = false
    model = e.model
    cache.lastAt = t
    now = t
    $.ui.invalidate('ui.render')
    if (sessionId) {
      void $.store.set('cache', { session: sessionId, at: t }).catch(() => {})
    }
    const result = yield* next(e)
    if (result.usage) {
      const ttl = ttlFromTiming(gap, result.usage, isExempt)
      if (ttl !== null) {
        cache.timedTtl = ttl
        $.ui.invalidate('ui.render')
      }
    }
    return result
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute') {
      isRewritten = true
    }
    return done
  })

  // The person closed the sidebar with its close mark: the lines come back.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === SIDEBAR_ID) {
      isDocked = false
      if (e.origin.kind === 'person') {
        isSidebar = false
        await $.store.set('sidebar', false)
      }
      $.ui.invalidate('ui.render')
    }
    return closed
  })

  on('ui.render', { component: 'Pane', requestId: SIDEBAR_ID }, ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    if (!isDocked) {
      // it was waiting for room and has it now: take the lines off the band
      isDocked = true
      try {
        $.ui.invalidate('ui.render')
      } catch {
        // the band catches up at its next draw
      }
    }
    return sidebarView(
      { Box, Button, Text },
      {
        weather,
        lens,
        cache,
        now,
        columns: e.props.bodyColumns,
        rows: e.props.scroll.bodyRows,
        compactor,
        files,
        editorName: editor[0] ?? 'editor',
        onOpen: (t) => openIn($, files.argv(t, editor)),
        onProject: () => openIn($, [...editor, files.cwd || '.']),
        onFollow: () => {
          files.isFollowing = !files.isFollowing
          void $.store.set('follow', files.isFollowing)
          $.ui.invalidate('ui.render')
        },
        onCount: () => countExactly($, lens),
        onRefresh: () => {
          void readUsage($, weather, cache, lens)
            .then(() => $.clock.now())
            .then((t) => {
              now = t
              $.ui.invalidate('ui.render')
            })
        },
        onCompact: () => {
          if (compactor.isArmed) {
            compactNow($, compactor)
            return
          }
          compactor.isArmed = true
          $.ui.invalidate('ui.render')
          $.clock.after(4000, () => {
            compactor.isArmed = false
            $.ui.invalidate('ui.render')
          })
        },
        onAuto: () => {
          compactor.isOn = !compactor.isOn
          void $.store.set('autocompact', compactor.saved())
          $.ui.invalidate('ui.render')
        },
        onSlide: (at) => {
          compactor.set(at)
          compactor.isOn = true
          void $.store.set('autocompact', compactor.saved())
          $.ui.invalidate('ui.render')
        },
        size:
          e.surface === 'desktop'
            ? {
                stops: SIZES,
                at: scale,
                onPick: (v) => {
                  scale = v
                  void $.store.set('size', v)
                  $.ui.invalidate('ui.render')
                },
              }
            : undefined,
      },
    )
  })

  on('command.run', { command: 'multiply' }, async ($, e) => {
    const ask = cloneCount(e.args)
    if (!ask) {
      return { text: `/multiply takes a number, 1 to ${CLONE_MAX}.` }
    }
    if (!(await isWindows($))) {
      return { text: '/multiply opens PowerShell windows, so it only works on Windows.' }
    }
    clawd.clone(ask.count)
    const opened = await multiply($, ask.count, isRemote)
    const capped = ask.isCapped ? ' Three is plenty.' : ''
    if (opened === 0) {
      return { text: 'Could not open a window: powershell did not start.' }
    }
    return { text: `Opened ${opened} clone${opened === 1 ? '' : 's'}.${capped}` }
  })

  on('command.run', { command: 'clawd' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'sidebar') {
      isSidebar = !isSidebar
      await $.store.set('sidebar', isSidebar)
      if (!isSidebar) {
        isDocked = false
        await $.ui.close({ id: SIDEBAR_ID })
        $.ui.invalidate('ui.render')
        return { text: 'Sidebar closed; the lines are back under Clawd.' }
      }
      const opened = await $.ui.open({ id: SIDEBAR_ID, title: SIDEBAR_TITLE })
      isDocked = opened.isPlaced
      $.ui.invalidate('ui.render')
      return { text: opened.isPlaced ? 'Sidebar open.' : `Sidebar waits for room: ${opened.reason}` }
    }
    if (word === 'follow') {
      files.isFollowing = !files.isFollowing
      await $.store.set('follow', files.isFollowing)
      $.ui.invalidate('ui.render')
      return {
        text: files.isFollowing ? `Following: each file Claude changes opens in ${editor[0]}.` : 'Not following.',
      }
    }
    if (word === 'editor' || word.startsWith('editor ')) {
      const argv = e.args.trim().split(/\s+/).slice(1)
      if (argv.length) {
        editor = argv
        await $.store.set('editor', editor)
      }
      return { text: `Files open with: ${editor.join(' ')} <path>:<line>` }
    }
    if (word === 'clear') {
      return askClear($)
    }
    if (word === 'context' || word === 'c' || word === 'status') {
      await readUsage($, weather, cache, lens)
      now = await $.clock.now()
      return { text: report({ weather, lens, cache, compactor, now }) }
    }
    if (word === 'hide' || word === 'show') {
      isHidden = word === 'hide'
      await $.store.set('hidden', isHidden)
      $.ui.invalidate('ui.render')
      return { text: isHidden ? 'Clawd is tucked away. /clawd show brings him back.' : 'Clawd is back.' }
    }
    return { text: act(word) }
  })

  on('prompt.submit', ($, e, next) => {
    // a plain keyword, never a reading of the prompt: thanks gets the happy hop
    clawd.prompt(isThanks(e.text))
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    clawd.turnStart()
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // the tool's name and, for a file tool, its path: what kind of work it is
    const { file_path: file, notebook_path: notebook } = e as { file_path?: unknown; notebook_path?: unknown }
    const path = typeof file === 'string' ? file : typeof notebook === 'string' ? notebook : ''
    const work = workFor(String(e.tool), path)
    clawd.toolStart(work)
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (err) {
      clawd.toolDone(work, false)
      throw err
    }
    clawd.toolDone(work, ran.deny === undefined && ran.isError === true)
    if (ran.deny === undefined && ran.isError !== true) {
      if (await noteFile($, files, e)) {
        void readGit($, files)
        const t = files.touches[0]
        if (files.isFollowing && t) {
          openIn($, files.argv(t, editor))
        }
      }
    }
    return ran
  })

  on('turn.complete', ($, e, next) => {
    // a commit or a checkout in the turn changes the marks
    void readGit($, files)
    clawd.turnEnd()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if ((e.surface !== 'terminal' && e.surface !== 'desktop') || e.props.hasSurvey) {
      return next(e)
    }
    // other mods' rows go above Clawd rather than vanish under him
    let below: Awaited<ReturnType<typeof next>> | null = null
    try {
      below = await next(e)
    } catch {
      // nothing beneath draws here
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = Math.max(16, e.props.bodyColumns)
    // with the sidebar on screen the lines live there, and Clawd keeps the band
    const isLined = !(isSidebar && isDocked)
    const lead = cache.pieces(now)
    const line = !isLined || (weather.isEmpty && !lead.length) ? null : weather.line(columns, now, lead)
    const isLens = isLined && lens.breakdown !== null
    const details = isLens && lens.isOpen ? lens.rows(columns, weather.growth()) : []
    // under Clawd: the weather, the context bar and its rows, the buttons
    const under = 1 + (below ? 1 : 0) + (line ? 1 : 0) + (isLens ? 1 : 0) + details.length
    const room = Math.min(ROWS, e.props.maxRows - under)
    const rows = isHidden ? 0 : e.surface === 'desktop' ? ROWS : room < 4 ? 0 : room
    let strip = null
    site = null
    shown = ''
    vector = null
    drawn = ''
    if (rows > 0) {
      if (e.surface === 'terminal') {
        clawd.resize(columns)
        const { Raster } = $.ui.resolve(e)
        site = { requestId: e.requestId, columns, rows }
        shown = toBase64(clawd.paint(columns, rows))
        strip = <Raster key={KEY} columns={columns} rows={rows} cells={shown} />
      } else if (e.surface === 'desktop') {
        // an image, not rows of cells: always tall enough for every ride
        // and sized in CSS pixels, so his world spans the band, not 60 pixels of it
        const { Svg } = $.ui.resolve(e)
        const wide = Math.round((columns * CELL) / scale)
        clawd.resize(wide)
        vector = { columns: wide, height: ROWS * 2 }
        drawn = clawd.svg(wide, ROWS * 2, scale)
        strip = <Svg key={KEY} source={drawn} alt="Clawd" width={wide * scale} height={ROWS * 2 * scale} />
      }
    }

    const draw = (key: string, pieces: Piece[]) =>
      pieces
        .filter((p) => p.text !== '')
        .map((p, i) => (
          <Text key={`${key}-${i}`} color={p.color} dimColor={p.dim} bold={p.bold}>
            {p.text}
          </Text>
        ))
    const lensLabel = `${lens.isOpen ? '▾' : '▸'} context`
    const summary = lens.summary()
    const toggle = (hide: boolean) => {
      isHidden = hide
      void $.store.set('hidden', hide)
      $.ui.invalidate('ui.render')
    }
    const sidebar = () => {
      isSidebar = !isSidebar
      void $.store.set('sidebar', isSidebar)
      if (isSidebar) {
        void $.ui.open({ id: SIDEBAR_ID, title: SIDEBAR_TITLE }).then((r) => {
          isDocked = r.isPlaced
          $.ui.invalidate('ui.render')
        })
      } else {
        isDocked = false
        void $.ui.close({ id: SIDEBAR_ID })
        $.ui.invalidate('ui.render')
      }
    }

    return (
      <Box flexDirection="column">
        {below}
        {e.surface === 'terminal' && strip}
        {line && (
          <Box key="weather" flexDirection="row" justifyContent="space-between" width={columns}>
            <Box flexDirection="row">{draw('forecast', line.left)}</Box>
            <Box flexDirection="row">{draw('limits', line.right)}</Box>
          </Box>
        )}
        {isLens && (
          <Box key="lens" flexDirection="row">
            <Button
              key="lens-toggle"
              label={lensLabel}
              hotkey="x"
              plain
              dimColor={!lens.isOpen}
              onPress={() => {
                lens.isOpen = !lens.isOpen
                $.ui.invalidate('ui.render')
              }}
            />
            <Text> </Text>
            {draw('bar', lens.bar(columns - lensLabel.length - summary.length - 4))}
            <Text dimColor>{summary}</Text>
          </Box>
        )}
        {details.map((row) => (
          <Box key={`lens-${row.key}`} flexDirection="row">
            {row.label !== '' && (
              <Box key="label" width={LABEL} flexShrink={0} overflow="hidden">
                <Text dimColor wrap="truncate">
                  {row.label}
                </Text>
              </Box>
            )}
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
            {row.key === 'counted' && !lens.isExact && !lens.isCounting && (
              <Box marginLeft={2}>
                <Button
                  key="lens-count"
                  label="count exactly"
                  hotkey="r"
                  plain
                  dimColor
                  onPress={() => countExactly($, lens)}
                />
              </Box>
            )}
          </Box>
        ))}
        {/* on desktop he stands on the buttons: a press scrolls the band to them */}
        {e.surface === 'desktop' && strip}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {!isHidden &&
            BUTTONS.map((b) => (
              <Button
                key={`do-${b.key}`}
                label={b.label}
                hotkey={b.hotkey}
                plain
                dimColor
                onPress={() => {
                  act(b.word)
                }}
              />
            ))}
          <Button
            key="clawd-toggle"
            label={isHidden ? 'show clawd' : 'hide clawd'}
            hotkey="h"
            plain
            dimColor
            onPress={() => toggle(!isHidden)}
          />
          <Button
            key="compact"
            label={compactor.isCompacting ? 'compacting…' : compactor.isArmed ? 'press again to compact' : 'compact'}
            hotkey="m"
            plain
            dimColor={!compactor.isArmed}
            onPress={() => {
              if (compactor.isArmed) {
                compactNow($, compactor)
                return
              }
              compactor.isArmed = true
              $.ui.invalidate('ui.render')
              $.clock.after(4000, () => {
                compactor.isArmed = false
                $.ui.invalidate('ui.render')
              })
            }}
          />
          <Button
            key="clear"
            label={clearing.isArmed ? 'press again to clear' : 'clear'}
            hotkey="y"
            plain
            dimColor={!clearing.isArmed}
            onPress={() => {
              if (clearing.isArmed) {
                clearNow($)
                return
              }
              clearing.isArmed = true
              $.ui.invalidate('ui.render')
              $.clock.after(4000, () => {
                clearing.isArmed = false
                $.ui.invalidate('ui.render')
              })
            }}
          />
          {files.lastChanged && (
            <Button
              key="open-last"
              label={`open ${files.name(files.lastChanged)}`}
              hotkey="z"
              plain
              dimColor
              onPress={() => {
                const t = files.lastChanged
                if (t) openIn($, files.argv(t, editor))
              }}
            />
          )}
          <Button
            key="sidebar-toggle"
            label={isSidebar ? 'close sidebar' : 'sidebar'}
            hotkey="d"
            plain
            dimColor
            onPress={sidebar}
          />
          <Button
            key="reload-plugins"
            label="reload plugins"
            hotkey="l"
            plain
            dimColor
            onPress={() => {
              // reloads this mod too, so nothing waits on it
              void $.command.run({ command: 'reload-plugins' }).catch(() => {})
            }}
          />
        </Box>
      </Box>
    )
  })
}
