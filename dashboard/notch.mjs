// The window and the taskbar's islands over its top rows. The islands are
// found from the screen itself: the window paints its top rows in a
// calibration colour for a moment, a helper takes a screenshot, and every cell
// that does not show that colour is covered. The dashboard then cuts exactly
// those cells out, with a border hugging them, and fills the rest.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const CAL = 0xff00ff // the calibration colour
export const BAND = 6 // how many top rows are checked

export const notch = {
  rows: [], // per checked row, '0'/'1' per column ('1' = covered)
  cols: 0,
  calibrating: false,
  status: 'off',
  sig: '',
  rect: '',
  pending: false,
  cover: true, // fill the monitor (true) or stay a normal window (false)
  monitor: 0,
  monitors: 1,
}

let ps
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

export function startNotch() {
  if (process.platform !== 'win32') return false
  ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'notch-helper.ps1')], {
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

export function stopNotch() {
  try {
    ps?.stdin.end()
    ps?.kill()
  } catch {
    // already gone
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const rectKey = r => `${r.x},${r.y},${r.w},${r.h}`
const covers = r => Math.abs(r.x - r.mx) <= 12 && Math.abs(r.y - r.my) <= 12 && Math.abs(r.w - r.mw) <= 24 && Math.abs(r.h - r.mh) <= 24

/**
 * Moves the window: `cur` fills its monitor, `next`/`prev` fill another,
 * `win` makes it a normal window. Re-measures afterwards.
 */
export async function place(mode, getSize) {
  if (!ps) return
  if (mode === 'win') notch.cover = false
  else notch.cover = true
  const res = await send(`place ${mode}`)
  if (res?.ok) {
    notch.monitor = res.monitor
    notch.monitors = res.monitors
  }
  if (getSize) {
    await sleep(700)
    await calibrate(getSize)
  }
  return res
}

/** Paints the calibration frame (drawn by the caller while `calibrating`), then reads the screen. */
export async function calibrate(getSize) {
  if (!ps || notch.calibrating) return
  const r = await send('rect', 3000)
  if (!r?.ok || !r.front || r.min) {
    notch.pending = true // only a window in front can be read off the screen
    return
  }
  notch.pending = false
  notch.rect = rectKey(r)
  notch.monitor = r.monitor
  notch.monitors = r.monitors
  notch.calibrating = true
  notch.status = 'calibrating'
  await sleep(180)
  const { w, h } = getSize()
  const res = await send(`cal ${w} ${h} ${Math.min(BAND, Math.floor(h / 4))}`)
  notch.calibrating = false
  try {
    const dir = process.env.LIVE_PULSE_DIR || path.join(os.homedir(), '.claude', 'live-pulse')
    fs.writeFileSync(path.join(dir, 'notch.json'), JSON.stringify({ at: new Date().toISOString(), cols: w, rows: h, rect: r, res }, null, 1))
  } catch {
    // diagnostics only
  }
  if (!res || !res.ok) {
    notch.status = `failed: ${res?.why ?? 'no answer'}`
    return
  }
  const rows = res.rows.filter(row => row.includes('1'))
  if (rows.some(row => !row.includes('0'))) {
    notch.status = 'failed: window not in front'
    return
  }
  notch.rows = rows
  notch.cols = w
  notch.status = rows.length ? 'ready' : 'none'
}

/**
 * Every few seconds: if the window was moved (to another monitor, say) while
 * it should fill one, it fills the monitor it is on now; if the taskbar
 * changed or the window moved, it measures again.
 */
export async function watch(getSize) {
  if (!ps || notch.calibrating) return
  const s = await send('sig', 5000)
  const r = await send('rect', 3000)
  if (!r?.ok) return
  notch.monitors = r.monitors
  if (notch.cover && !r.min && !covers(r)) {
    await place('cur', getSize)
    return
  }
  const changed = (s?.sig && notch.sig && s.sig !== notch.sig) || (notch.rect && rectKey(r) !== notch.rect)
  if (s?.sig) notch.sig = s.sig
  if (!changed && !notch.pending) return
  if (r.front && !r.min) await calibrate(getSize)
  else notch.pending = true
}

/** The islands: runs of covered columns and how many rows deep each reaches. */
export function islands(cols) {
  if (!notch.rows.length || notch.cols !== cols) return []
  const depth = new Array(cols).fill(0)
  notch.rows.forEach((row, r) => {
    for (let c = 0; c < cols; c++) if (row[c] === '1') depth[c] = r + 1
  })
  const out = []
  let c = 0
  while (c < cols) {
    if (!depth[c]) {
      c++
      continue
    }
    const a = c
    let d = 0
    while (c < cols && depth[c]) d = Math.max(d, depth[c++])
    out.push({ a, b: c - 1, d })
  }
  const merged = []
  for (const is of out) {
    const last = merged[merged.length - 1]
    if (last && is.a - last.b <= 3) {
      last.b = is.b
      last.d = Math.max(last.d, is.d)
    } else merged.push({ ...is })
  }
  return merged
}

/** For previews: `--notch "a-b:d,..."`. */
export function fakeIslands(spec, cols) {
  notch.cols = cols
  const rows = Array.from({ length: BAND }, () => new Array(cols).fill('0'))
  for (const part of spec.split(',')) {
    const m = part.match(/^(\d+)-(\d+):(\d+)$/)
    if (!m) continue
    for (let r = 0; r < Number(m[3]); r++) for (let c = Number(m[1]); c <= Number(m[2]); c++) rows[r][c] = '1'
  }
  notch.rows = rows.map(r => r.join('')).filter(r => r.includes('1'))
  notch.status = 'ready'
}
