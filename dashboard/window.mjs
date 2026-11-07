// The dashboard's own window: fill the screen's free area (never under the
// taskbar), become a normal window, move to another monitor, minimise. A small
// PowerShell helper does the Windows calls.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const win = {
  cover: true, // fill the monitor's free area (true) or stay a normal window (false)
  monitor: 0,
  monitors: 1,
}

let ps
let placedAt = 0
const waiting = []

function send(cmd, timeoutMs = 8000) {
  if (!ps) return Promise.resolve(undefined)
  return new Promise(resolve => {
    const entry = { resolve, timer: setTimeout(() => finish(entry, undefined), timeoutMs) }
    waiting.push(entry)
    ps.stdin.write(cmd + '\n')
  })
}
function finish(entry, value) {
  const i = waiting.indexOf(entry)
  if (i >= 0) waiting.splice(i, 1)
  clearTimeout(entry.timer)
  entry.resolve(value)
}

export function startWindow() {
  if (process.platform !== 'win32') return false
  ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'window-helper.ps1')], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  })
  let buf = ''
  ps.stdout.on('data', d => {
    buf += d.toString()
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      const entry = waiting[0]
      if (!entry) continue
      let value
      try {
        value = JSON.parse(line)
      } catch {
        value = undefined
      }
      finish(entry, value)
    }
  })
  ps.on('exit', () => {
    ps = undefined
  })
  return true
}

export function stopWindow() {
  try {
    ps?.stdin.end()
    ps?.kill()
  } catch {
    // already gone
  }
}

/** `cur` fills its monitor, `next`/`prev` fill another, `win` makes it a normal window. */
export async function place(mode) {
  if (!ps) return
  win.cover = mode !== 'win'
  const res = await send(`place ${mode}`)
  placedAt = Date.now()
  if (res?.ok) {
    win.monitor = res.monitor
    win.monitors = res.monitors
  }
  return res
}

/** Minimises the window to the taskbar. */
export function minimize() {
  void send('min', 3000)
}

const covers = r => Math.abs(r.x - r.mx) <= 12 && Math.abs(r.y - r.my) <= 12 && Math.abs(r.w - r.mw) <= 24 && Math.abs(r.h - r.mh) <= 24

/** Every few seconds: a window the person moved or resized stays where they put it. */
export async function watch() {
  if (!ps) return
  const r = await send('rect', 3000)
  if (!r?.ok) return
  win.monitors = r.monitors
  win.monitor = r.monitor
  if (win.cover && !r.min && !covers(r) && Date.now() - placedAt > 3000) win.cover = false
}
