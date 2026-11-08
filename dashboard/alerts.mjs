// Alerts: when a session needs the person (a permission, a question, a plan to
// approve), finishes a long turn, or ends one with failed calls. Each shows in
// a stack on every page; out of the window, a Windows toast and a short chime
// tell the person too. Settings live in ~/.claude/live-pulse/settings.json.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { P, ago, chars, fit, len, mix, projectName, secs, usd } from './common.mjs'
import { DIR, accentOf, listeners, store } from './data.mjs'
import { burst, ring } from './anim.mjs'
import { win } from './window.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SETTINGS = path.join(DIR, 'settings.json')
const SOUNDS = path.join(DIR, 'sounds')
const BOOT = Date.now()

export const settings = { toast: true, sound: true, alerts: { attention: true, done: true, error: true } }
export const alerts = {
  list: [], // newest last: { id, sid, kind, title, body, t, color }
  log: [], // every alert since the window opened
  onOpen: sid => void sid, // the scene sets this: show that session
}

function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
    if (typeof s.toast === 'boolean') settings.toast = s.toast
    if (typeof s.sound === 'boolean') settings.sound = s.sound
    if (s.alerts && typeof s.alerts === 'object') Object.assign(settings.alerts, s.alerts)
  } catch {
    // none yet: the defaults
  }
}
export function saveSettings() {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2))
  } catch {
    // read-only: the toggle holds until the window closes
  }
}
export function toggleToast() {
  settings.toast = !settings.toast
  saveSettings()
}
export function toggleSound() {
  settings.sound = !settings.sound
  saveSettings()
}

// ── chimes, written once as small WAV files ─────────────────────────────────
const NOTES = {
  attention: [[880, 0, 0.16], [1318.5, 0.14, 0.22], [880, 0.42, 0.16], [1318.5, 0.56, 0.3]],
  done: [[1046.5, 0, 0.35], [1318.5, 0.1, 0.35], [1568, 0.2, 0.5]],
  error: [[523.3, 0, 0.22], [392, 0.18, 0.4]],
}
function wav(notes) {
  const rate = 22050
  const len = Math.ceil(rate * Math.max(...notes.map(([, at, d]) => at + d)) + rate * 0.05)
  const pcm = new Float32Array(len)
  for (const [f, at, d] of notes) {
    const s0 = Math.floor(at * rate)
    const n = Math.floor(d * rate)
    for (let i = 0; i < n && s0 + i < len; i++) {
      const u = i / n
      const env = Math.min(1, i / (rate * 0.006)) * Math.pow(1 - u, 2.2)
      pcm[s0 + i] += env * (Math.sin((2 * Math.PI * f * i) / rate) * 0.7 + Math.sin((4 * Math.PI * f * i) / rate) * 0.18)
    }
  }
  const buf = Buffer.alloc(44 + len * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + len * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(len * 2, 40)
  for (let i = 0; i < len; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i] * 0.55)) * 32767), 44 + i * 2)
  return buf
}
function writeSounds() {
  try {
    fs.mkdirSync(SOUNDS, { recursive: true })
    for (const [k, notes] of Object.entries(NOTES)) {
      const f = path.join(SOUNDS, `${k}.wav`)
      if (!fs.existsSync(f)) fs.writeFileSync(f, wav(notes))
    }
  } catch {
    // no sounds then
  }
}

// ── the helper that shows toasts and plays sounds ───────────────────────────
let ps
export function startAlerts() {
  loadSettings()
  setInterval(loadSettings, 5000)
  if (process.platform !== 'win32') return
  writeSounds()
  try {
    ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'alerts.ps1')], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    ps.on('exit', () => (ps = undefined))
    ps.stdin.on('error', () => (ps = undefined))
  } catch {
    ps = undefined
  }
}
export function stopAlerts() {
  try {
    ps?.stdin.end()
    ps?.kill()
  } catch {
    // already gone
  }
}
function outside(kind, title, body) {
  if (!ps) return
  if (settings.toast) ps.stdin.write(`toast ${Buffer.from(JSON.stringify({ title, body }), 'utf8').toString('base64')}\n`)
  if (settings.sound) ps.stdin.write(`sound ${path.join(SOUNDS, `${kind}.wav`)}\n`)
}

// ── turning events into alerts ──────────────────────────────────────────────
const lastOut = new Map() // sid:kind -> time of the last toast
let nextId = 1
const sessionOf = sid => store.sessions.find(s => s.sessionId === sid)

export function raise(sid, kind, title, body, o = {}) {
  const a = { id: nextId++, sid, kind, title, body, t: Date.now(), color: o.color ?? accentOf(sid) }
  alerts.list.push(a)
  alerts.log.push(a)
  if (alerts.list.length > 12) alerts.list.shift()
  if (alerts.log.length > 200) alerts.log.shift()
  if (o.outside === false || !settings.alerts[kind]) return a
  // needs-you always reaches the person; the rest only when they are looking elsewhere
  if (kind !== 'attention' && win.front) return a
  const key = `${sid}:${kind}`
  if (Date.now() - (lastOut.get(key) ?? 0) < 15000) return a
  lastOut.set(key, Date.now())
  outside(kind === 'attention' ? 'attention' : kind === 'error' ? 'error' : 'done', title, body)
  return a
}

listeners.push((sid, e) => {
  if ((e.t ?? 0) < BOOT - 1500) return // history read at start-up is not news
  const st = sessionOf(sid)
  const name = st ? projectName(st.cwd) : sid.slice(0, 8)
  if (e.kind === 'attention' && e.attention) {
    const a = e.attention
    const what = a.kind === 'permission' ? `wants to use ${a.tool}${a.label ? `: ${a.label}` : ''}` : a.kind === 'question' ? 'has a question for you' : 'has a plan for you to approve'
    raise(sid, 'attention', `${name} needs you`, what, { color: P.warn })
  } else if (e.kind === 'attention-clear') {
    alerts.list = alerts.list.filter(a => !(a.sid === sid && a.kind === 'attention'))
    // answered: the toast is no longer news
    if (ps && !store.sessions.some(x => x.sessionId !== sid && x.attention)) ps.stdin.write('clear x\n')
  } else if (e.kind === 'turn-summary' && e.turn) {
    const t = e.turn
    if (t.aborted) return
    const detail = `${secs(t.ms ?? 0)} · ${t.calls} calls${t.files ? ` · ${t.files} files` : ''}${t.cost ? ` · ${usd(t.cost)}` : ''}`
    if (t.errors >= 3 || (t.errors > 0 && (t.ms ?? 0) >= 20000)) raise(sid, 'error', `${name}: done with ${t.errors} failed call${t.errors === 1 ? '' : 's'}`, detail, { color: P.err })
    else if ((t.ms ?? 0) >= 20000) raise(sid, 'done', `${name} finished`, detail, { color: P.ok })
  } else if (e.kind === 'compact') {
    raise(sid, 'compact', `${name}: context compacted`, e.msg ?? '', { color: P.warn, outside: false })
  }
})

// ── the stack on screen ─────────────────────────────────────────────────────
const SHOW_MS = 9000
/** The alerts still on screen: needs-you ones stay while the session waits. */
export function liveAlerts(now = Date.now()) {
  alerts.list = alerts.list.filter(a => {
    if (a.kind === 'attention') {
      const st = sessionOf(a.sid)
      return !!st?.attention || now - a.t < 4000
    }
    return now - a.t < SHOW_MS
  })
  return alerts.list
}

/** Draws the stack in the top-right corner of the area below y. */
export function drawAlerts(S, right, y, t, now = Date.now()) {
  const list = liveAlerts(now).slice(-4).reverse()
  const w = Math.min(54, Math.max(36, Math.floor(S.w * 0.3)))
  const x = right - w
  let yy = y
  for (const a of list) {
    const age = now - a.t
    const slide = age < 250 ? Math.round((1 - age / 250) * (w + 2)) : 0
    const fadeOut = a.kind !== 'attention' && age > SHOW_MS - 600 ? (age - (SHOW_MS - 600)) / 600 : 0
    const urgent = a.kind === 'attention'
    const glow = urgent ? 0.5 + 0.5 * Math.sin(t * 6) : 0
    const edge = mix(mix(a.color, P.text, glow * 0.35), P.bg, fadeOut)
    const fill = mix(P.panel, a.color, urgent ? 0.1 + glow * 0.08 : 0.06)
    const bx = x + slide
    S.box(bx, yy, w, 4, urgent ? 'bold' : 'round', edge, { fill })
    const icon = urgent ? '!' : a.kind === 'done' ? '✓' : a.kind === 'error' ? '✗' : '◆'
    S.text(bx + 2, yy + 1, ` ${icon} `, P.bg, { bold: true, bg: edge })
    S.text(bx + 6, yy + 1, fit(a.title, w - 8), mix(P.text, P.bg, fadeOut), { bold: true, bg: fill })
    const tail = urgent ? `waiting ${ago(now - a.t)}` : ago(now - a.t)
    S.text(bx + 2, yy + 2, fit(a.body, w - 5 - len(tail)), mix(P.mid, P.bg, fadeOut), { bg: fill })
    S.text(bx + w - 2 - len(tail), yy + 2, tail, mix(urgent ? P.warn : P.dim, P.bg, fadeOut), { bg: fill })
    S.hit(bx, yy, w, 4, { onClick: () => alerts.onOpen(a.sid, a) })
    if (age < 60 && !a.burst) {
      a.burst = true
      burst(bx + 3, yy + 1, a.color, 10)
      ring(bx + 3, yy + 1, a.color, { max: 4 })
    }
    yy += 4
  }
  void chars
}
