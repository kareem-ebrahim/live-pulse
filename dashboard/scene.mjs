// The dashboard's frame: title bar, header, the page tabs with AUTO, the page
// itself, the alert stack and the status bar. The live window (pulse-dash.mjs)
// and the --html previews both draw through frame().
import { P, SPIN, clock, len, limitName, mix, pretty, projectName, usd } from './common.mjs'
import { accentOf, callsPerMinute, emptyState, focused, liveSessions, planLimits, stateOf, store, totalCost } from './data.mjs'
import { win } from './window.mjs'
import { centerX } from './screen.mjs'
import { logUi } from './views/log.mjs'
import { drawParticles, drawRings, drawWipe, startWipe } from './anim.mjs'
import { alerts, settings, toggleSound, toggleToast } from './alerts.mjs'
import { auto, autoActive, autoProgress, autoTick, pauseAuto, setAuto } from './director.mjs'
import { drawOverview, view as overviewView } from './pages/overview.mjs'
import { drawTimeline, timelineKey } from './pages/timeline.mjs'
import { drawNetwork } from './pages/network.mjs'
import { drawFiles } from './pages/files.mjs'
import { drawCost } from './pages/cost.mjs'
import { drawInspector, inspectorKey } from './pages/inspector.mjs'
import { drawTotals } from './pages/totals.mjs'

export const PAGES = [
  { id: 'overview', title: 'Overview', key: 'F1', draw: drawOverview },
  { id: 'timeline', title: 'Timeline', key: 'F2', draw: drawTimeline, onKey: timelineKey },
  { id: 'network', title: 'Network', key: 'F3', draw: drawNetwork },
  { id: 'files', title: 'Files', key: 'F4', draw: drawFiles },
  { id: 'cost', title: 'Cost', key: 'F5', draw: drawCost },
  { id: 'inspector', title: 'Inspector', key: 'F6', draw: drawInspector, onKey: inspectorKey },
  { id: 'totals', title: 'Totals', key: 'F7', draw: drawTotals },
]

export const ui = {
  page: 'overview',
  get fullLog() {
    return overviewView.fullLog
  },
}
export const actions = {
  quit: () => {},
  minimize: () => {},
  window: () => {},
  monitor: () => {},
}

/** Shows a page; `byPerson` pauses AUTO, as any touch does. */
export function setPage(id, byPerson = true) {
  if (byPerson) personActed()
  if (ui.page !== id) startWipe()
  ui.page = id
}
export function stepPage(step) {
  const i = PAGES.findIndex(p => p.id === ui.page)
  setPage(PAGES[(i + step + PAGES.length) % PAGES.length].id)
}
export function toggleAuto() {
  setAuto(!auto.on)
  if (!auto.on) store.pinned = ''
}
/** A key or a click: AUTO steps aside, leaving what it showed in place. */
export function personActed() {
  if (autoActive()) {
    if (auto.sid) store.pinned = auto.sid
    pauseAuto()
  }
}
/** Keys a page handles itself (returns true when it took the key). */
export function pageKey(key) {
  const p = PAGES.find(x => x.id === ui.page)
  return p?.onKey ? p.onKey(key) === true : false
}
alerts.onOpen = sid => {
  personActed()
  store.pinned = sid
  setPage('inspector', false)
}

// ════════════════════════════════════════════════════════════════════════════
// The top rows
// ════════════════════════════════════════════════════════════════════════════
export const CONTROLS_W = 12
function controls(S, x, y) {
  const items = [
    [' ─ ', P.mid, () => actions.minimize()],
    [' □ ', P.mid, () => actions.window()],
    [' ✕ ', P.text, () => actions.quit(), P.red],
  ]
  let cx = x - CONTROLS_W + 1
  for (const [label, fg, fn, hot] of items) {
    S.text(cx, y, label, hot ? P.bg : fg, { bold: true, bg: hot || P.faint })
    S.hit(cx, y, 3, 1, { onClick: fn })
    cx += 4
  }
}

function totals(now) {
  const live = liveSessions(now)
  const working = store.sessions.filter(s => stateOf(s, now) === 'working')
  const cpm = store.sessions.reduce((n, s) => n + callsPerMinute(s, now), 0)
  const agents = store.sessions.reduce((n, s) => n + (s.agents || []).filter(a => a.status === 'running').length, 0)
  const editing = store.sessions.reduce((n, s) => n + (s.files || []).filter(f => f.active).length, 0)
  const needs = live.filter(s => s.attention).length
  return { live, working, cpm, agents, editing, needs }
}

function headerParts(now, t) {
  const { live, working, cpm, agents, editing, needs } = totals(now)
  const blink = 0.5 + 0.5 * Math.sin(t * 6)
  return [
    [['CLAUDE CODE LIVE', P.text, true]],
    ...(needs ? [[[`! ${needs} NEED${needs === 1 ? 'S' : ''} YOU`, mix(P.warn, P.text, blink * 0.4), true]]] : []),
    [[`${live.length} SESSION${live.length === 1 ? '' : 'S'}`, P.opus, true]],
    [[`${usd(totalCost(live))} SPENT`, P.cream, true]],
    ...planLimits()
      .filter(l => l.kind === 'five_hour')
      .map(l => [[`${limitName(l.kind).toUpperCase()} ${Math.round(l.percentUsed)}%`, l.percentUsed >= 85 ? P.err : l.percentUsed >= 60 ? P.warn : P.haiku, true]]),
    [[`${working.length} WORKING`, working.length ? P.router : P.mid, true]],
    [[`${cpm} CALLS/MIN`, P.peach, true]],
    [[`${agents} SUBAGENTS`, P.haiku, true]],
    [[`${editing} FILES BEING EDITED`, editing ? P.coral : P.mid, true]],
  ]
}
const SEP = [['  ·  ', P.dim]]

/** The page tabs, AUTO first. */
function tabs(S, y, t, now) {
  const W = S.w
  S.rect(0, y, W, 1, P.panel)
  let x = 1
  // AUTO: its pill fills up as the current view runs out
  const on = auto.on
  const active = autoActive(now)
  const label = active ? ' ◉ AUTO ' : on ? ' ◎ AUTO ' : ' ○ AUTO '
  const fill = active ? Math.round(autoProgress(now) * len(label)) : 0
  ;[...label].forEach((c, i) => {
    const lit = active && i < fill
    const bg = active ? (lit ? P.router : mix(P.router, P.panel, 0.55)) : on ? mix(P.warn, P.panel, 0.6) : P.faint
    const fg = active ? P.bg : on ? P.text : P.mid
    S.set(x + i, y, c, i === 1 && active ? mix(P.bg, P.text, 0.5 + 0.5 * Math.sin(t * 5)) : fg, bg, true)
  })
  S.hit(x, y, len(label), 1, { onClick: () => toggleAuto() })
  x += len(label) + 1
  S.text(x, y, '│', P.faint, { bg: P.panel })
  x += 2
  const narrow = S.w < 150
  for (const p of PAGES) {
    const sel = ui.page === p.id
    const key = narrow ? '' : `${p.key} `
    const s = ` ${key}${p.title} `
    const ac = sel ? (active ? P.router : P.opus) : P.mid
    S.text(x, y, s, sel ? P.bg : ac, { bold: sel, bg: sel ? ac : P.panel })
    if (!sel && key) S.text(x + 1, y, key, P.dim, { bg: P.panel })
    S.hit(x, y, len(s), 1, { onClick: () => setPage(p.id) })
    x += len(s) + 1
  }
  // what AUTO is doing, at the right
  let cap
  let capColor = P.dim
  if (active) {
    const st = store.sessions.find(s => s.sessionId === auto.sid)
    const why = auto.reason && !auto.reason.startsWith('tour') ? auto.reason : st ? projectName(st.cwd) : ''
    cap = `AUTO · ${PAGES.find(p => p.id === auto.page)?.title ?? ''}${why ? ` · ${why}` : ''}`
    capColor = P.router
  } else if (on) {
    cap = `AUTO paused · back in ${Math.max(0, Math.ceil((auto.pausedUntil - now) / 1000))}s`
    capColor = P.warn
  } else cap = 'F12 or click AUTO to tour by itself'
  const room = W - x - 2
  if (room > 12) {
    const c = len(cap) > room ? [...cap].slice(0, room - 1).join('') + '…' : cap
    S.text(W - 1 - len(c), y, c, capColor, { bg: P.panel })
  }
}

// ════════════════════════════════════════════════════════════════════════════
// One frame
// ════════════════════════════════════════════════════════════════════════════
function draw(S, t, now) {
  const W = S.w
  const H = S.h
  S.fill(P.bg)
  if (W < 100 || H < 34) {
    const msg = `widen this window to at least 100×34 (now ${W}×${H})`
    S.text(centerX(0, W, msg), Math.floor(H / 2), msg, P.coral, { bold: true })
    controls(S, W - 2, 0)
    return
  }
  // AUTO picks the page and the session
  const v = autoTick(now)
  if (v) {
    if (ui.page !== v.page) startWipe()
    ui.page = v.page
  }
  const st = (v && store.sessions.find(s => s.sessionId === v.sid)) || focused(now) || emptyState()

  // title bar and header
  const { live } = totals(now)
  S.rect(0, 0, W, 1, P.bar)
  controls(S, W - 1, 0)
  const ttl = 'Live Pulse · every Claude Code session on this machine'
  S.text(centerX(0, W, ttl), 0, ttl, P.mid, { bg: P.bar })
  const tag = `${live.length} LIVE`
  S.segs(W - len(tag) - 4 - CONTROLS_W - 1, 0, [['● ', live.length ? P.router : P.dim], [tag, live.length ? P.router : P.dim, true]], { bg: P.bar })
  const head = headerParts(now, t).flatMap((p, i) => (i ? [...SEP, ...p] : p))
  S.segs(centerX(0, W, head.map(h => h[0]).join('')), 1, head)
  tabs(S, 2, t, now)

  // the page
  const statusY = H - 1
  const page = PAGES.find(p => p.id === ui.page) ?? PAGES[0]
  page.draw(S, st, 3, statusY, t, now)
  drawRings(S, now)
  drawParticles(S, now)
  drawWipe(S, 3, statusY, now)

  statusBar(S, st, statusY, t, now)
}

function statusBar(S, st, y, t, now) {
  const W = S.w
  const working = store.sessions.filter(s => stateOf(s, now) === 'working')
  const spin = SPIN[Math.floor(t * 12) % 10]
  const sel = st.sessionId ? `${projectName(st.cwd)} · ${pretty(st.model)}` : 'no session'
  S.rect(0, y, W, 1, P.bar)
  let bx = 1
  S.text(bx, y, sel, st.sessionId ? accentOf(st.sessionId) : P.dim, { bold: true, bg: P.bar })
  bx += len(sel) + 1
  const mode = autoActive(now) ? 'auto' : store.pinned ? 'pinned' : 'following'
  S.text(bx, y, mode, P.dim, { bg: P.bar })
  bx += len(mode) + 2
  const btn = (key, label, fn, on) => {
    const k = ` ${key} `
    S.text(bx, y, k, on ? P.bg : P.text, { bold: true, bg: on ? P.router : P.faint })
    S.text(bx + len(k), y, ` ${label} `, on ? P.router : P.mid, { bg: P.bar })
    S.hit(bx, y, len(k) + len(label) + 2, 1, { onClick: fn })
    bx += len(k) + len(label) + 3
  }
  const tight = W < 185
  btn('◂', tight ? '' : 'prev', () => cycleSession(-1))
  btn('▸', tight ? 'next' : 'next session', () => cycleSession(1))
  btn('A', tight ? 'follow' : 'follow active', () => {
    personActed()
    store.pinned = ''
  }, !store.pinned && !autoActive(now))
  btn('[ ]', 'page', () => stepPage(1))
  if (ui.page === 'overview') {
    btn('L', overviewView.fullLog ? 'dashboard' : tight ? 'log' : 'full log', () => toggleFull(), overviewView.fullLog)
    if (!tight) btn('S', logUi.scope === 'all' ? 'this session' : 'all sessions', () => logUi.setScope(logUi.scope === 'all' ? 'session' : 'all'), logUi.scope === 'all')
  }
  btn('T', `toast ${settings.toast ? 'on' : 'off'}`, () => toggleToast(), settings.toast)
  btn('N', `sound ${settings.sound ? 'on' : 'off'}`, () => toggleSound(), settings.sound)
  if (win.monitors > 1) btn('M', `screen ${win.monitor + 1}/${win.monitors}`, () => actions.monitor())
  if (W >= 160) btn('W', win.cover ? 'window' : tight ? 'full' : 'full screen', () => actions.window())
  btn('Q', 'quit', () => actions.quit())
  const right = `${working.length ? spin + ' ' : ''}${clock(now)}`
  S.text(W - 2 - len(right), y, right, working.length ? P.router : P.dim, { bg: P.bar })
}

export function frame(S, t, now) {
  draw(S, t, now)
}

export function toggleFull() {
  personActed()
  if (ui.page !== 'overview') {
    setPage('overview')
    overviewView.fullLog = true
    return
  }
  overviewView.fullLog = !overviewView.fullLog
}
logUi.onExpand = () => toggleFull()

export function cycleSession(step) {
  personActed()
  const all = store.sessions
  if (!all.length) return
  const cur = focused(Date.now()).sessionId
  const i = Math.max(0, all.findIndex(s => s.sessionId === cur))
  store.pinned = all[(i + step + all.length) % all.length].sessionId
}
