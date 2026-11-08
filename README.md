<div align="center">

# Live Pulse

**A live mission-control screen for Claude Code.**

Put it on a second monitor and watch every Claude Code session on your computer work in real time:
what each one is doing, which files it is changing, what it costs, and the moment one of them needs you.

<img src="media/demo.gif" alt="Live Pulse: every Claude Code session as a creature, wired to the agents and files it works on" width="800">

**[▶ Watch the full demo (1080p)](https://github.com/kareem-ebrahim/live-pulse/releases/latest)**

</div>

---

## What is this?

When you use [Claude Code](https://claude.com/claude-code), the AI works inside your terminal: it reads
files, runs commands, edits code and starts helper agents. Most of that scrolls past in a chat. With two
or three sessions open at once, it is hard to know which one is busy, which one is stuck, which one is
waiting for your *yes*, and how much all of it costs.

**Live Pulse is a separate, full-screen window that shows all of it at a glance**, made to sit on a
second screen (or half of your screen) while you work. It is two parts:

1. **A Claude Code mod** that watches each session from the inside (turns, tool calls, subagents, files,
   cost) and writes small status files on your computer.
2. **A dashboard** that reads those files 10 times a second and draws them as an animated, colourful
   terminal display: one pixel creature per session, glowing wires, flowing particles, charts and alerts.

It is built to be **useful and nice to look at**: you see what your AI is doing without reading a
log, and you can leave it running like a status board.

Nothing leaves your computer. Live Pulse never records what you type (see [Privacy](#privacy)).

## What happens on screen, step by step

| When this happens in Claude Code… | …you see this in Live Pulse |
|---|---|
| You open a Claude Code session in any folder | A new **pixel creature** appears, in its own colour, named after the project. Its orbit shows how full the context window is (blue → amber → red). |
| Claude thinks or writes | The creature animates and the **router** lights up; the session's status reads THINKING / WRITING. |
| Claude calls a tool (reads a file, runs a command, edits code) | A **spark** runs down a wire, the call appears in the activity list with its diff or command output, and a bar appears on the **Timeline**. |
| Claude starts a subagent | Sparks **burst** from the creature, a **new small creature** is born for the subagent, and an arrow joins it to its parent on the Timeline and the Network. |
| A background shell runs (a server, a build, tests) | It gets its own creature with its **live output** streaming. |
| Claude edits a file | The file lights up in **Files**, with lines added / removed and who changed it. |
| Two sessions want the same file | The second one **waits** for the first to finish (so their edits never clash), and an arrow shows who is waiting for whom. |
| A session **needs you** (a permission prompt, a question, a plan to approve) | A **"! ALLOW?" bubble** pops over its creature, the header says *1 NEEDS YOU*, and you get a **Windows notification with a sound**, even if the window is behind others. In auto mode, when the session approves by itself, nothing pops up: Live Pulse only tells you when a session really waits for you, and the alert goes away once you answer. |
| A long turn finishes | A ring pulses around the creature (confetti after a long clean turn), and if you were in another window you get a short "done" notification. |
| The conversation gets compacted | A ◆ mark on the Timeline and an entry in the Inspector: how much context was freed. |
| You close the session | Its creature leaves the screen. |

## The pages

The window has seven pages. Switch with the tabs at the top, `F1`–`F7`, `[` and `]`, or let **AUTO**
switch for you.

### ◉ AUTO: the screen runs itself

Press **AUTO** (or `F12`) and Live Pulse becomes a self-driving show. It watches what happens and moves
to where the action is: a session that needs you comes first (straight to the Inspector), a subagent being
born jumps to the Network, a burst of edits to Files, a plan limit running high to Cost. When nothing in
particular happens it tours every page and every session, about 20 seconds each, and scrolls long lists
down and back up. The AUTO button fills up like a progress bar while each view runs, and a caption on the
right says what it is showing and why. Touch any key or click anything and AUTO steps aside for a minute.

<img src="media/page-auto.png" alt="AUTO mode showing a session that needs the person" width="800">

### F1 · Overview

Every session as a creature, side by side. Under the selected one: its router (tool calls by kind in the
last minute), its main agent and subagents wired to the files they edit, the live scan of its calls, and the
activity log with real diffs and command output. Creatures have moods: they sleep (*z Z z*) when idle,
sweat when a call fails, sing after a clean turn, and raise a bubble when they need you.

<img src="media/page-overview.png" alt="Overview page" width="800">

### F2 · Timeline

A lane per session and an indented lane per subagent. Every tool call is a bar from its start to its end,
coloured by kind; ✗ marks failures, ▌ marks turns, `!` shows how long a session waited for you, ◆ marks
compactions. Curved arrows go from an Agent call to the lane of the subagent it started, and from a waiting
session to the one holding its file. A busy-ness strip under each session, a moving NOW line, and a stream
of the latest events below. Zoom with the wheel or `+` / `-` (2, 5, 15 or 60 minutes); click a bar to see it.

<img src="media/page-timeline.png" alt="Timeline page" width="800">

### F3 · Network

Who talks to what, in sections of cards. Across the top, KPI cards: sessions, subagents running, tools and
MCP servers in use, files being edited, calls per minute and conflicts. Below, three sections side by side:
**Sessions & Agents** (each session with its subagents as a tree under it), **Tools & MCP** and **Files**. Each
card shows what it is doing, its count and a share bar; links run between neighbouring sections with particles
flowing along them, bright and fast while calls flow, faint when quiet, red for a file two sessions touch. At the
bottom, the **busiest links** of the last 15 minutes and a **health** panel (calls per minute, success rate,
failed calls, conflicts). The selected session is lit, the rest dimmed.

<img src="media/page-network.png" alt="Network page" width="800">

### F4 · Files

Every file the sessions touched, per repository, hottest first: edits, a heat bar, lines added and removed,
which sessions edited it, and a pulse while it is being edited. Beside it, each repository's git state
(branch, ahead / behind, changed and untracked files, refreshed every 15 seconds), the file leases (who holds
which file, who waits for it, with arrows), and the latest changes.

<img src="media/page-files.png" alt="Files page" width="800">

### F5 · Cost

What the open sessions spend and how fast: the total in big digits, cost per minute and per hour at this
pace, each session's cost with its trend, tokens split into input / output / cache read / cache write, the
cache hit rate, a stacked chart of spend per minute over the last hour, your plan's 5-hour and weekly limits
with **a projection of when the 5-hour limit runs out at this pace**, the cost of each recent turn, and a
warning when a session sat idle long enough for its prompt cache to go cold (its next turn costs more).

<img src="media/page-cost.png" alt="Cost page" width="800">

### F6 · Inspector

One session in depth: its turns as Gantt bars (time spent thinking, writing, and in tools), the chosen turn
opened up (every call, kinds of work, tokens and cost), the tree of subagents with who started whom, the
compactions, the MCP servers it used, and every time it waited for you and for how long.

<img src="media/page-inspector.png" alt="Inspector page" width="800">

### F7 · Totals: the whole machine

Everything Claude Code has used **on this computer, across every project and every session**, not only
the ones open now. Total tokens and total money count up when the page opens. In the middle, a core holds the
total and every project orbits it with its share in percent; lines between them carry tokens in and cost out,
faster for projects that are busy right now. Around it: the share of each model, the token mix with the cache
hit ring, today / last 7 days / last 30 days, and a chart of the last 30 days.

The numbers come from the usage Claude Code already stores with each reply in `~/.claude/projects`. Money is
shown at API list prices: on a Pro or Max subscription it is what the same use would cost through the API.

<img src="media/page-totals.png" alt="Totals page, from sample data" width="800">

## Set it up as a second screen

Live Pulse opens in its own Windows Terminal window and fills the screen it is on (never under the taskbar).
Drag it to your second monitor, or press `M` to send it there, and keep working in your normal terminal on the
main one. It remembers where you put it, and when you update it the window restarts itself with the new
version.

## Install

### 1. Requirements

- **Windows 10 or 11**
- **Windows Terminal**: built into Windows 11; on Windows 10 get it from the Microsoft Store.
- **Node.js 18 or newer**. Check with `node -v` in PowerShell. If it is missing:
  ```
  winget install OpenJS.NodeJS.LTS
  ```
  then **restart the computer** so Windows can find it.
- **Claude Code 2.1.275 or newer**. Update with `claude update`.

### 2. Install the plugin

In Claude Code, type:

```
/plugin install live-pulse --marketplace kareem-ebrahim/live-pulse
```

When it asks where to install, choose the first option, **Install for you (user scope)**, so it
works in every Claude Code session, in any folder.

### 3. Start it

**Close Claude Code and open it again** (or type `/reload-plugins`). The Live Pulse window opens by
itself. If it does not, type `/pulse`.

From now on every Claude Code session you open appears in the same window.

### Update

Close Claude Code, then in PowerShell (outside Claude Code):

```
claude plugin marketplace update live-pulse
claude plugin update live-pulse@live-pulse
```

Open Claude Code again. `claude plugin list` shows the version you have.

### If the window does not open

| You see | Fix |
|---|---|
| `error 2147942402 … node`, or a message that Node.js is missing | Install Node.js (step 1), **restart the computer**, then type `/pulse`. |
| `/plugin install` is not a command | Your Claude Code is too old: run `claude update`. |
| Nothing happens after installing | Close Claude Code and open it again, then type `/pulse`. |
| No Windows notifications | Windows Settings → System → Notifications: allow notifications for **Windows PowerShell**. |

### From source (for developers)

```
git clone https://github.com/kareem-ebrahim/live-pulse
```

Then add this to `~/.claude/settings.json`, with the path of your clone:

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\live-pulse" }
```

## Use

| Command | |
|---|---|
| `/pulse` | open the window |
| `/pulse auto` | open it by itself when a session starts (on by default) |
| `/pulse reset` | clear this session's counters |

In the window (mouse or keys):

| | |
|---|---|
| tabs · `F1`–`F7` · `[` `]` | change page |
| **AUTO** · `F12` or `G` | let the screen tour pages and sessions by itself |
| click a creature · `Tab` / `Shift+Tab` | choose a session · `A` follows the active one |
| `T` · `N` | Windows notifications on / off · sound on / off |
| click a filter · `←` `→` · `1`–`6` | activity by kind (Overview) · click an agent or file to filter to it |
| wheel · `↑` `↓` `PgUp` `PgDn` | scroll events and code · zoom the Timeline · pick a turn in the Inspector |
| `L` | full-height activity |
| `─` `□` `✕` (top right) | minimise · window / full screen · close |
| `M` · `W` | next monitor · window / full screen |
| `Q` | quit |

Alert settings are kept in `~/.claude/live-pulse/settings.json`:
`{ "toast": true, "sound": true, "alerts": { "attention": true, "done": true, "error": true } }`.
"Needs you" alerts always reach you; "done" and "error" only when the window is not in front.

## How it works

```
Claude Code session ──(mod hooks: turns, tool calls, permission prompts, subagents, usage)──▶ live-pulse mod
                                                                                                │
                         ~/.claude/live-pulse/sessions/<id>.json    (a snapshot, 4 times a second)
                         ~/.claude/live-pulse/events/<id>/<n>.json  (one small file per event)
                                                                                                │
Windows Terminal window ◀─────────────────── dashboard/pulse-dash.mjs (30 fps, no dependencies)
                                                  └─ a worker thread reads ~/.claude/projects for Totals
```

- **`hooks/register.tsx`**: the mod. It hooks `turn.start`, `turn.step`, `tool.call`, `tool.check`,
  `agent.spawn`, `turn.complete`, `session.compact`, `session.end` and the permission-prompt events, and
  reads cost, context and plan limits from `$.session.usage()`.
- **`dashboard/`**: the renderer. A diffing true-colour cell buffer, pixel creatures in half blocks, wires,
  arrows and particles, a page per view (`dashboard/pages/`), the AUTO director (`director.mjs`) and the
  alerts (`alerts.mjs`, which shows Windows notifications and plays short chimes through PowerShell). Plain
  Node, no packages.

### Privacy

Live Pulse **never records what you type**. It records what the session *does*: tool calls with their inputs
(file paths, diffs, commands) and the first 20 lines of command output. The Totals page reads only the
numbers Claude Code stores with each reply (tokens, model, time, project folder), never the text. Everything
stays on your machine under `~/.claude/live-pulse`; the dashboard keeps the newest 600 events per session and
deletes sessions older than a day.

## Develop

Edit the files, then `node sync.mjs` copies them to `~/.claude/live-pulse-mod`; the open window restarts with
the new code, and sessions reload the mod by themselves. `node dashboard/pulse-dash.mjs --html out.html --size
200x56 --page timeline` renders any page to an HTML file.

## License

MIT
