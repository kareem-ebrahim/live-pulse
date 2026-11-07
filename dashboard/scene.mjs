// The dashboard's drawing: everything one frame shows, from the state in
// data.mjs. The live window (pulse-dash.mjs) and the video tool both draw
// through frame(); neither needs the other.
import { CAT_COLOR, P, SPIN, clamp, clock, fit, kfmt, len, mix, pretty, projectName, secs } from './common.mjs'
import { accentOf, allItems, callsPerMinute, ctxPct, focused, liveSessions, stateOf, store } from './data.mjs'
import { win } from './window.mjs'
import { Screen, centerX } from './screen.mjs'
import { drawConstellation } from './views/constellation.mjs'
import { drawLog, logUi } from './views/log.mjs'
import { drawSession } from './views/session.mjs'
import { Wires, sparks } from './wires.mjs'

export const ui = { fullLog: false }
export const actions = {
  quit: () => {},
  minimize: () => {},
  window: () => {},
  monitor: () => {},
}

// ════════════════════════════════════════════════════════════════════════════
// The top rows
// ════════════════════════════════════════════════════════════════════════════

/** Window buttons, as on any window: minimise, maximise / restore, close. Ends at column x. */
export const CONTROLS_W = 12
function controls(S, x, y, bg) {
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
  void bg
}

function totals(now) {
  const live = liveSessions(now)
  const working = store.sessions.filter(s => stateOf(s, now) === 'working')
  const cpm = store.sessions.reduce((n, s) => n + callsPerMinute(s, now), 0)
  const agents = store.sessions.reduce((n, s) => n + (s.agents || []).filter(a => a.status === 'running').length, 0)
  const editing = store.sessions.reduce((n, s) => n + (s.files || []).filter(f => f.active).length, 0)
  return { live, working, cpm, agents, editing }
}

function headerParts(now) {
  const { live, working, cpm, agents, editing } = totals(now)
  return [
    [['CLAUDE CODE LIVE', P.text, true]],
    [[`${live.length} SESSION${live.length === 1 ? '' : 'S'}`, P.opus, true]],
    [[`${working.length} WORKING`, working.length ? P.router : P.mid, true]],
    [[`${cpm} CALLS/MIN`, P.peach, true]],
    [[`${agents} SUBAGENTS`, P.haiku, true]],
    [[`${editing} FILES BEING EDITED`, editing ? P.coral : P.mid, true]],
  ]
}
const SEP = [['  ·  ', P.dim]]
const partsLen = parts => parts.reduce((n, p) => n + len(p[0]), 0)




// ════════════════════════════════════════════════════════════════════════════
// One frame
// ════════════════════════════════════════════════════════════════════════════
function draw(S, t, now) {
  const W = S.w
  const H = S.h
  S.fill(P.bg)
  if (W < 100 || H < 33) {
    const msg = `widen this window to at least 100×33 (now ${W}×${H})`
    S.text(centerX(0, W, msg), Math.floor(H / 2), msg, P.coral, { bold: true })
    controls(S, W - 2, 0, P.bg)
    return
  }
  const st = focused(now)
  let cy
  {
    // a plain title bar and header
    const { live } = totals(now)
    S.rect(0, 0, W, 1, P.bar)
    controls(S, W - 1, 0, P.bar)
    const ttl = 'Live Pulse · every Claude Code session on this machine'
    S.text(centerX(0, W, ttl), 0, ttl, P.mid, { bg: P.bar })
    const tag = `${live.length} LIVE`
    S.segs(W - len(tag) - 4 - CONTROLS_W - 1, 0, [['● ', live.length ? P.router : P.dim], [tag, live.length ? P.router : P.dim, true]], { bg: P.bar })
    const head = headerParts(now).flatMap((p, i) => (i ? [...SEP, ...p] : p))
    S.segs(centerX(0, W, head.map(h => h[0]).join('')), 1, head)
    cy = 3
  }

  // creatures, one per session
  const constH = H >= 60 ? 12 : H >= 48 ? 10 : 9
  const slots = drawConstellation(S, 1, cy, W - 2, constH, t, now, st.sessionId)
  const afterConst = cy + constH + 1

  // the selected session, then the log
  const statusY = H - 1
  // running subagents each need four more rows in the agents map; the log gives way
  const subs = (st.agents || []).filter(a => a.status === 'running' || now - (a.started + (a.ms || 0)) < 5 * 60000).length + (st.bg || []).filter(b => b.kind !== 'agent' && (b.status === 'running' || now - (b.ended ?? 0) < 4000)).length
  const needs = 26 + 4 * Math.min(3, subs)
  const logH = ui.fullLog ? statusY - afterConst : clamp(statusY - (afterConst + 1) - needs - 1, 9, 22)
  const logY = statusY - logH
  if (!ui.fullLog) {
    const slot = slots.get(st.sessionId)
    drawSession(S, st, afterConst + 1, logY - 2, t, now, slot ? { x: slot.cx, y: slot.bottom + 1 } : undefined)
  }
  logUi.expanded = ui.fullLog
  drawLog(S, st, 1, logY, W - 2, logH, t, now)

  // status bar: every action is a button
  const working = store.sessions.filter(s => stateOf(s, now) === 'working')
  const spin = SPIN[Math.floor(t * 12) % 10]
  const sel = st.sessionId ? `${projectName(st.cwd)} · ${pretty(st.model)}` : 'no session'
  S.rect(0, statusY, W, 1, P.bar)
  let bx = 1
  S.text(bx, statusY, sel, st.sessionId ? accentOf(st.sessionId) : P.dim, { bold: true, bg: P.bar })
  bx += len(sel) + 1
  S.text(bx, statusY, store.pinned ? 'pinned' : 'following', P.dim, { bg: P.bar })
  bx += (store.pinned ? 6 : 9) + 2
  const btn = (key, label, fn, on) => {
    const k = ` ${key} `
    S.text(bx, statusY, k, on ? P.bg : P.text, { bold: true, bg: on ? P.router : P.faint })
    S.text(bx + len(k), statusY, ` ${label} `, on ? P.router : P.mid, { bg: P.bar })
    S.hit(bx, statusY, len(k) + len(label) + 2, 1, { onClick: fn })
    bx += len(k) + len(label) + 3
  }
  const tight = W < 185
  btn('◂', tight ? '' : 'prev', () => cycleSession(-1))
  btn('▸', tight ? 'next' : 'next session', () => cycleSession(1))
  btn('A', tight ? 'follow' : 'follow active', () => (store.pinned = ''), !store.pinned)
  btn('L', ui.fullLog ? 'dashboard' : tight ? 'log' : 'full log', () => toggleFull(), ui.fullLog)
  btn('S', logUi.scope === 'all' ? (tight ? 'this' : 'this session') : tight ? 'all' : 'all sessions', () => logUi.setScope(logUi.scope === 'all' ? 'session' : 'all'), logUi.scope === 'all')
  if (win.monitors > 1) btn('M', `screen ${win.monitor + 1}/${win.monitors}`, () => actions.monitor())
  btn('W', win.cover ? 'window' : tight ? 'full' : 'full screen', () => actions.window())
  btn('Q', 'quit', () => actions.quit())
  const right = `${working.length ? spin + ' ' : ''}${clock(now)}`
  S.text(W - 2 - len(right), statusY, right, working.length ? P.router : P.dim, { bg: P.bar })
  void fit
  void kfmt
  void CAT_COLOR
}

export function frame(S, t, now) {
  draw(S, t, now)
}

export function toggleFull() {
  ui.fullLog = !ui.fullLog
}
logUi.onExpand = () => toggleFull()

export function cycleSession(step) {
  const all = store.sessions
  if (!all.length) return
  const cur = focused(Date.now()).sessionId
  const i = Math.max(0, all.findIndex(s => s.sessionId === cur))
  store.pinned = all[(i + step + all.length) % all.length].sessionId
}

