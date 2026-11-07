<div align="center">

# Live Pulse

**Every Claude Code session on your machine — live, in one window.**

A Claude Code mod plus a full-screen terminal dashboard for Windows Terminal: one creature per
session, every subagent wired to the files it edits, live diffs, commands and their output, and
tool calls by kind — all from real hook events.

<!-- Drop video/out/live-pulse.mp4 here in the GitHub editor to embed the demo -->

</div>

---

## What you see

| | |
|---|---|
| **One creature per session** | Each running Claude Code session gets its own pixel creature. Its orbit fills with the session's context window (blue → amber at 65% → red at 85%). It bobs while the session works and sleeps when it idles. Moons circle it for running subagents. |
| **Agents & files** | The selected session's main agent and every subagent, each as a creature with what it is doing right now — wired to the exact files it edits. A wire lights up and carries sparks while its file is being written. |
| **Tool calls by kind, live** | Calls running now, a 60-second sparkline per kind, and totals. A kind flashes when a call starts and turns green or red when it ends. |
| **Activity** | The selected session's events (or every session's): real diffs with context, commands and the first lines of their output, filtered by kind, agent or file. |
| **Two sessions, one file** | When two sessions edit the same file, a red arc joins their creatures. A message from one session to another crosses the screen as a beam. |
| **Notch-aware** | On a floating top taskbar, the window measures the islands over its top rows and flows its content around them, like a phone's notch. |

Everything is controlled with the mouse as well as the keyboard, and the window restarts itself
whenever its code is updated.

## How it works

```
Claude Code session ──(function hooks: turns, tool calls, subagents, usage)──▶ live-pulse mod
                                                                                 │
                         ~/.claude/live-pulse/sessions/<id>.json   (snapshot, 4×/s)
                         ~/.claude/live-pulse/events/<id>/<seq>.json (one file per event)
                                                                                 │
Windows Terminal window ◀────────────── dashboard/pulse-dash.mjs (30 fps, no dependencies)
```

- **`hooks/register.tsx`** — the mod. It hooks `turn.start`, `turn.step`, `tool.call`,
  `agent.spawn` and `turn.complete`, and reads the context window from `$.session.usage()`.
- **`dashboard/`** — the renderer: a diffing true-colour cell buffer, wires with sparks, pixel
  creatures in half blocks, a small syntax highlighter and an LCS diff. Plain Node, no packages.
- **`video/`** — renders the demo video from the dashboard's own drawing code.

### Privacy

Live Pulse **never records what you type**. It records what the session *does*: tool calls with
their inputs (file paths, diffs, commands) and the first 20 lines of command output. Everything
stays on your machine under `~/.claude/live-pulse`; the dashboard keeps the newest 600 events per
session and deletes sessions older than a day.

## Install

Requirements: **Windows 10/11**, **Windows Terminal**, **Node.js 18+**, and a Claude Code version
with mods (function hooks).

At the prompt of a Claude Code session:

```
/plugin install live-pulse --marketplace <owner>/live-pulse
```

The dashboard opens by itself when a session starts. Or load it from a clone for every session by
adding this to `~/.claude/settings.json`:

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\live-pulse" }
```

### If the window does not open

- **`error 2147942402 … node`** or a toast saying Node.js is missing: install Node.js
  (`winget install OpenJS.NodeJS.LTS`), **restart the computer**, then run `/pulse`.
- **`/plugin install` is not a command**: update Claude Code with `claude update`.
- After installing, run `/reload-plugins` or restart Claude Code.
- Update to the newest version with `/plugin update live-pulse`.

## Use

| Command | |
|---|---|
| `/pulse` | open the window |
| `/pulse auto` | open it by itself when a session starts (on by default) |
| `/pulse reset` | clear this session's counters |

In the window — mouse or keys:

| | |
|---|---|
| click a creature · `Tab` / `Shift+Tab` | choose a session · `A` follows the active one |
| click a filter · `←` `→` · `1`–`6` | activity by kind · click an agent or file to filter to it |
| wheel · `↑` `↓` `PgUp` `PgDn` | scroll events and code · `F` follows the newest |
| `L` | full-height activity |
| `M` · `W` · `N` | next monitor · window / full screen · measure the notch again |
| `Q` | quit |

## Render the video

```
cd video
npm install
npm run video            # → video/out/live-pulse.mp4 (1920×1080, 30 fps)
node make-video.mjs --stills 10,21,33    # single frames, for checking
```

It uses Microsoft Edge (or Chrome) to paint frames and `ffmpeg-static` to encode them.

## Develop

Edit the files, then `node sync.mjs` copies them to `~/.claude/live-pulse-mod`; the open window
restarts with the new code, and sessions reload the mod by themselves.

## License

MIT
