# clawd-buddy-mod

> **Unofficial fan mod.** Clawd is Anthropic's mascot, and his name and sprites
> belong to Anthropic. This mod is not made, endorsed or supported by Anthropic.
> See [NOTICE](plugins/clawd-buddy/NOTICE).

Clawd moves in above your Claude Code prompt. He locks in while Claude works,
chills when it goes quiet, celebrates when a long turn ends and hops when you
talk to him. Under him, a line forecasts the context
window, counts down to the prompt cache going cold and shows what is left of
your 5-hour and weekly limits, and a context bar opens into a live `/context`
breakdown. One click moves all of it to a sidebar.

![Clawd hopping, at his laptop, skating, flying a kite, dancing in confetti and napping](docs/clawd.gif)

Runs in the terminal and in the desktop app's Code tab. Needs Claude Code 2.1.289 or later.

## Install

```
/plugin install clawd-buddy --marketplace lperezmo/clawd-buddy-mod
```

Or in two steps:

```
/plugin marketplace add lperezmo/clawd-buddy-mod
/plugin install clawd-buddy@clawd-buddy-mod
```

## What he does

On top of his eight rides he now has the 36 Lottie animations from claude.dev,
from coffee and a laptop to fishing, a nap and confetti. What he picks follows
the session's mood.

| Mood        | When                                                   | Clawd                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lock in     | Claude is calling tools                                | about every other pick a ride (walk, skate, car, scooter, bike, kite), the rest work: laptop, desktop, notebook, phone, thinking, coffee, lightbulb, watch, a turn about. Edits lean to the laptop and desktop (the notebook for docs), shell commands to the skateboard and a coffee once one runs a while, web fetches to the kite and the lightbulb, subagents to the car, MCP tools to the phone and the bike |
| Chill       | 20 seconds of quiet                                    | thinks or looks around; after a minute, picks the way claude.dev does: a nap, headphones, sunglasses, fishing, watering, the pool, space and more; after 3 minutes he naps or floats in the pool until something happens                                                                                                                                                                                          |
| Celebration | a turn of 30 seconds or more, or 5 tools or more, ends | one act (confetti, a dance, juggling, the arcade and others), then a double hop and "yay"                                                                                                                                                                                                                                                                                                                         |

And always:

- **You send a prompt:** hops, "!". With "thanks", "thank you" or "yay" in it, a double hop and "yay".
- **A tool call fails:** shakes, "?!".
- **A short turn ends:** double hop, "yay".
- **Otherwise:** blinks and hops now and then.

A ride always finishes before the next thing starts. Chill gives way at once to
anything that happens. He picks the same thing twice in a row only when there is
nothing else to pick.

## The line under him

Once Claude has answered once, a line under Clawd reads the session's figures,
the same ones the status line has:

```
☀  Clear  18% of ctx (36k/200k)  ▃▅█  ▲ +16k     cache 42m   5h ━━━━━━━━ 93% left ↻ 2h 10m   week ━━━━━━── 77% left ↻ 3d 4h
```

- **Left:** how full the context window is, as weather (Clear, Cloudy, Showers,
  Storm, Compact soon), the tokens, and a chart of the last 12 turns.
- **Cache:** how long until the prompt cache goes cold. Each of Claude's requests
  starts its time to live again, so it counts down from the last one. The TTL
  is what `CLAUDE_CODE_PROMPT_CACHE_TTL`, `FORCE_PROMPT_CACHING_5M` or
  `ENABLE_PROMPT_CACHING_1H` pins, else what the requests' timing proves (a
  cache read after more than 5.5 minutes idle means 1 hour), else Claude Code's
  own pick: 1 hour on a Pro or Max plan, 5 minutes on an API key. It reads `cold` once it
  has expired, when the next request pays to write the prompt to the cache again.
- **Right:** what is left of the 5-hour and weekly usage limits and when each
  resets. Green above 50%, yellow above 20%, red below. Only Claude's replies
  carry them, so between replies they hold the last figures, and a window whose
  reset has passed reads full.

The limits only show on a Claude subscription; on an API key there are none to
read. On a narrow terminal it gives way in this order: the chart, the reset
countdowns, `of ctx` (leaving `18% (36k/200k)`), the meters, the token counts
(leaving `18% ctx`), and last the forecast word.

## The context view

Under the weather line, the context window as one bar, colored by category the
way `/context` colors them, with the compaction buffer and the free space after:

```
x: ▸ context ████▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 14% · 140.8k / 1M
```

Press `x: ▸ context` (click it, or `x` with the band focused) and it opens in
place into a row per category, the growth of the last turns, how many more fit
before auto-compaction, and the threshold:

```
140.8k of 1M used · 14% · claude-opus-5-5
system prompt       █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   4.2k   0%
system tools        █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  36.6k   4%
messages            ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   100k  10%
autocompact buffer  █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    33k   3%
free space          ██████████████████████████████░░░░░░ 826.2k  83%
growth              +6k last turn, +5k average over 3 turns
headroom            99+ turns at that rate, 826.2k left
limit               967k, where auto-compaction runs
counted             locally, as an estimate  r: count exactly
```

It updates after every turn from a local estimate that sends no requests.
`r: count exactly` counts each category with the token-count API, as `/context`
does; that is the only thing in the mod that sends anything, and only when you
press it.

## The sidebar

`d: sidebar` (or `/clawd sidebar`) moves the lines into a pane beside the
conversation, with room for each: the context fill and its forecast, the usage
limits with when they reset, the prompt cache with the time it goes cold, and
the context by category. `l: ↻ refresh` reads the limits again. Clawd keeps the band either way. Close it with
`d: close sidebar`, the pane's close mark or `ctrl+x x`, and the lines come back
under him. It stays on across sessions; on a terminal under 144 columns it
waits for room and the lines stay in the band.

## Compacting

- **`m: compact`** in the band, or **`c: compact now`** in the sidebar, compacts the
  conversation the way `/compact` does. It asks for a second press within four
  seconds first, so a stray click does nothing. Claude has to be between turns.
- **`y: clear`** in the band clears the conversation the way `/clear` does, after the
  same second press. `/clawd clear` asks in a dialog first instead.
- **Auto-compact**, in the sidebar: `u` turns it on, and a slider picks the
  threshold, from 300k to 900k tokens in steps of 100k (up to the window, if it
  is smaller), each stop labeled with its own little number. Click a dot or its
  number. After the turn that passes the threshold, Clawd compacts. No threshold under
  200k is ever taken. Claude Code's own auto-compaction near the end of the
  window still runs as before; this one comes first when you set it lower.
  The setting is kept across sessions.

## Files in your editor

Every file Claude edits, writes or reads this session is kept, newest first, with the
line Claude left it at (where the last edit landed, or where the read began).

Files open in VS Code (`code -g`) unless your `$VISUAL` or `$EDITOR` names an editor that
opens `path:line` from the command line (VS Code, Cursor, Windsurf, VSCodium, Zed or Sublime
Text); then they open there. `/clawd editor` picks any other.

- **`z: open <file>`** in the band opens the file Claude changed last in your editor, at that line.
- **Files**, in the sidebar, lists them all (`✎` edited, `+` written, `·` read, `×3` for
  three edits). Click one to open it there. `z: project in <editor>` opens the whole folder.
  In a git repository each file carries git's mark: `M` changed, `A` added, `D` deleted,
  `U` untracked.
- **`f: follow`** in the sidebar (or `/clawd follow`) opens each file in your editor the
  moment Claude changes it, at the changed line, so the editor follows along. It is kept
  across sessions.
- **`/clawd editor <command>`** picks another editor; the file goes after it as
  `path:line`. For Zed: `/clawd editor zed`. It is kept across sessions.

## Multiply (Windows)

`/multiply [1-3]` opens that many more Claude sessions (one if you give no number), each in
a new PowerShell window in the same folder, started with `claude`. Clawd splits into copies
while it happens. Three is the most; `/multiply 30` opens three. It is only offered on
Windows.

Turn on the `multiplyRemoteControl` option (`/plugin`, then the mod's options) to start each
clone with `claude --remote-control` instead, so you can reach it from claude.ai or your phone.

Each clone hops in saying which clone it is. It learns its number from `CLAWD_CLONE`, which
its window sets for it.

## Controls

- **Buttons** under Clawd: jump, Celebrate, Lock in, Chill. Each mood button plays one pick
  from that mood, then he goes back to what the session is doing. Click them, or focus the
  band (`ctrl+x tab`) and press j, c, k or n.
- **`/clawd <mood>`** does the same (`celebrate`, `lock in`, `chill`); **`/clawd <ride>`**
  sends him on one (walk, skate, scooter, bike, car, kite, space, pool), and **`/clawd <act>`**
  plays an act by name (`/clawd dancing`, `/clawd coffee`). `/clawd` alone makes him hop.
- **`/clawd context`** (or `/clawd c`, quick to type on the phone, or `/clawd status`) reads the figures again and answers with the band's figures as plain text:
  the context by category, growth and headroom, the cache countdown, the 5h and week
  limits, and the auto-compact setting. Handy on the phone, where remote control shows a
  command's answer but not the band.
- **Hide just Clawd:** `h: hide clawd` (or `/clawd hide`) keeps the lines and tucks him
  away; `h: show clawd` or `/clawd show` brings him back. It sticks across sessions.
- **`d: sidebar`** moves the lines into a sidebar; see above.
- **`l: reload plugins`** runs `/reload-plugins` for you.
- **Hide everything:** collapse the band with `[-]` or `ctrl+x ctrl+a`.

The band is 17 rows tall plus the line and the button row, and shrinks on short terminals.
The few acts taller than that (the heart, confetti, fishing) lose a row or two of sky at the top.

In the desktop app Clawd is the same pixels drawn as an SVG, three CSS pixels each by
default, so he stays sharp at any size. The sidebar there has a **Clawd size** slider from
2 to 4 that resizes him at once and remembers it; the `desktopSize` option sets the
starting size. He stands on the button row
there, so he stays in view when a press scrolls the band, and walks its whole width.

## What it does on your machine

- **Commands it runs:** `/reload-plugins` when you press `l`, `/clear` when you press `y`
  twice or say yes to `/clawd clear`.
- **Compaction:** compacts the conversation when you press compact twice, or after a turn
  that passes the auto-compact threshold you turned on. That and clearing are the only
  things that change the conversation.
- **Programs it starts:** your editor (see above), when you press a
  file or the project button, or as Claude changes files while follow is on; PowerShell, to
  open a window per clone on `/multiply`; and
  `git rev-parse` and `git status`, read only, for the marks by each file.
- **Hooks:** the `/clawd` command (and `/multiply` on Windows), the band above the prompt,
  prompt, turn and tool-call events to pick his moods, and the session's usage figures for
  the line. It never changes a prompt, a tool call or its result.
- **What it reads:** whether a prompt has "thanks", "thank you" or "yay" in it (nothing else
  of what you or Claude write), each tool's name and whether it failed, the path a file tool used
  (and, after an edit, the file itself, to find the edited line), the context window's fill and
  token counts per category, the usage limits' percentages, when each request goes out,
  three settings, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `ENABLE_PROMPT_CACHING_1H` and `FORCE_PROMPT_CACHING_5M`,
  `VISUAL` and `EDITOR` to pick your editor, and `OS` and `CLAWD_CLONE` for `/multiply`. No
  other tool input, and no tool output.
- **What it stores:** whether Clawd is hidden, whether the sidebar is on, the auto-compact
  setting, your editor command, whether follow is on, and when the session's last request went out (so a reload keeps the cache
  countdown), in the plugin's own store.
- **What it sends:** nothing, unless you press `count exactly`, which asks the token-count
  API for each category the way `/context` does.

## Credits

Clawd and his sprites are Anthropic's, from [claude.dev](https://claude.dev). This is an
unofficial fan mod; Anthropic did not make it and does not support it.
`bun tools/extract-sprites.ts` rebuilds them from the site (its pixel sheets and its Lottie acts) and
`bun tools/render-preview.ts` redraws the GIF above. The forecast follows Anthropic's
[token-weather](https://github.com/anthropics/claude-code-playground) mod (Apache-2.0), and
the context view is modeled on
[context-lens](https://github.com/Arunjay4213/claude-mods/tree/main/plugins/context-lens).

## License

The code is MIT, see [LICENSE](plugins/clawd-buddy/LICENSE). Clawd's sprites are not
covered by it, and the token-weather parts stay Apache-2.0; [NOTICE](plugins/clawd-buddy/NOTICE)
has the details.
