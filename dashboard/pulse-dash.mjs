#!/usr/bin/env node
// live-pulse dashboard: every Claude Code session on this machine, live, in a
// window of its own. Reads what the live-pulse mod writes from each session.
// No dependencies.
//
//   node pulse-dash.mjs                                the live window
//   node pulse-dash.mjs --html out.html --size 200x56
//
// Keys: Tab / Shift+Tab session · a follow active · l full log · ←→ 1-9 log tabs
//       ↑↓ PgUp PgDn Home End log · f follow newest · m / M next / previous monitor
//       w window / full screen · q quit
// Mouse: the three dots (quit · window · next monitor), creatures, tabs, rows; wheel scrolls.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALIVE, SESS, focused, poll, store } from './data.mjs'
import { MOUSE_OFF, MOUSE_ON, parseInput } from './input.mjs'
import { minimize, place, startWindow, stopWindow, watch, win } from './window.mjs'
import { actions, cycleSession, frame, toggleFull, ui } from './scene.mjs'
import { Screen } from './screen.mjs'
import { logKey, logUi } from './views/log.mjs'

const argv = process.argv.slice(2)
const opt = name => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

// ════════════════════════════════════════════════════════════════════════════
if (opt('--html')) {
  const [w, h] = (opt('--size') || '200x56').split('x').map(Number)
  const S = new Screen(w, h)
  if (opt('--pick')) store.pinned = opt('--pick')
  if (argv.includes('--full-log')) ui.fullLog = true
  if (opt('--shell')) logUi.bg = opt('--shell')
  poll(Date.now(), true)
  for (let i = 0; i < 40; i++) frame(S, Number(opt('--t') || 3.3), Date.now())
  fs.writeFileSync(opt('--html'), S.toHtml())
  process.exit(0)
}

const out = process.stdout
let S = new Screen(out.columns || 160, out.rows || 48)
out.write('\x1b[?1049h\x1b[?25l\x1b[2J' + MOUSE_ON)
out.write('\x1b]0;Live Pulse · Claude Code\x07')

function heartbeat() {
  try {
    fs.mkdirSync(SESS, { recursive: true })
    fs.writeFileSync(ALIVE, String(Date.now()))
  } catch {
    // a session may open a second window: harmless
  }
}
heartbeat()
const hb = setInterval(heartbeat, 1000)

function quit() {
  clearInterval(hb)
  clearInterval(loop)
  try {
    fs.unlinkSync(ALIVE)
  } catch {
    // already gone
  }
  stopWindow()
  out.write(MOUSE_OFF + '\x1b[0m\x1b[?25h\x1b[?1049l')
  process.exit(0)
}
process.on('SIGINT', quit)
process.on('SIGTERM', quit)

const size = () => ({ w: S.w, h: S.h })
actions.quit = quit
actions.minimize = minimize
actions.window = () => void place(win.cover ? 'win' : 'cur')
actions.monitor = () => void place('next')

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', d => {
    for (const ev of parseInput(d.toString())) {
      if (ev.type === 'mouse') {
        const r = S.hitAt(ev.x, ev.y)
        if (ev.b === 64 || ev.b === 65) r?.onWheel?.(ev.b === 64 ? -1 : 1)
        else if (ev.b === 0 && ev.down) r?.onClick?.(ev)
        continue
      }
      switch (ev.key) {
        case 'q':
        case 'ctrl-c':
          return quit()
        case 'tab':
          cycleSession(1)
          break
        case 'shift-tab':
          cycleSession(-1)
          break
        case 'a':
          store.pinned = ''
          break
        case 'l':
        case 'enter':
          toggleFull()
          break
        case 'm':
          void place('next')
          break
        case 'M':
          void place('prev')
          break
        case 'w':
          actions.window()
          break
        default:
          logKey(ev.key)
      }
    }
  })
}

out.on('resize', () => {
  S = new Screen(out.columns, out.rows)
  out.write('\x1b[2J')
})

// Fill the monitor's free area (never under the taskbar); keep watching for moves.
if (startWindow()) {
  void (async () => {
    await place('cur')
    setInterval(() => void watch(), 2500)
  })()
}

// Every update restarts the window: when a file of the dashboard changes,
// this process exits with 75 and run.mjs starts the new code in its place.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const stamp = () => {
  let n = 0
  for (const dir of [HERE, path.join(HERE, 'views')]) {
    try {
      for (const f of fs.readdirSync(dir)) if (/\.(mjs|ps1)$/.test(f)) n += fs.statSync(path.join(dir, f)).mtimeMs
    } catch {
      // a folder caught mid-copy
    }
  }
  return n
}
let codeStamp = stamp()
setInterval(() => {
  const n = stamp()
  if (n === codeStamp) return
  codeStamp = n
  setTimeout(() => {
    clearInterval(hb)
    clearInterval(loop)
    stopWindow()
    out.write(MOUSE_OFF + '\x1b[0m\x1b[?25h\x1b[?1049l')
    process.exit(75)
  }, 400) // let a copy in progress finish
}, 1000)

const t0 = Date.now()
const loop = setInterval(() => {
  const now = Date.now()
  poll(now)
  try {
    frame(S, (now - t0) / 1000, now)
    S.flush(out)
  } catch (err) {
    out.write(`\x1b[H\x1b[0mrender error: ${err && err.stack}`)
  }
}, 33)
