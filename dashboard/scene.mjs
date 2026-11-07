// The dashboard's drawing: everything one frame shows, from the state in
// data.mjs. The live window (pulse-dash.mjs) and the video tool both draw
// through frame(); neither needs the other.
import { CAT_COLOR, P, SPIN, clamp, clock, fit, kfmt, len, mix, pretty, projectName, secs } from './common.mjs'
import { accentOf, allItems, callsPerMinute, ctxPct, focused, liveSessions, stateOf, store } from './data.mjs'
import { BAND, CAL, islands, notch } from './notch.mjs'
import { Screen, centerX } from './screen.mjs'
import { drawConstellation } from './views/constellation.mjs'
import { drawLog, logUi } from './views/log.mjs'
import { drawSession } from './views/session.mjs'
import { Wires, sparks } from './wires.mjs'

export const ui = { fullLog: false }
export const actions = {
  notch: () => {},
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

/** Free stretches of a top row, given the islands (with their border and a space). */
function freeSegments(isl, W, row) {
  const blocks = isl
    .filter(i => row <= i.d)
    .map(i => [i.a - 2, i.b + 2])
    .sort((a, b) => a[0] - b[0])
  const out = []
  let x = 1
  for (const [a, b] of blocks) {
    if (a - x >= 1) out.push({ a: x, b: a - 1 })
    x = Math.max(x, b + 1)
  }
  if (W - 2 - x >= 0) out.push({ a: x, b: W - 2 })
  return out.map(s => ({ ...s, w: s.b - s.a + 1, used: 0, right: 0 }))
}

/**
 * With the taskbar's islands over the top rows, those rows still carry live
 * content, laid into the stretches between the islands: the controls, the
 * title and the totals; one pill per session; then the newest events.
 * Returns the first row the rest of the dashboard may use.
 */
function drawTopFlow(S, isl, t, now) {
  const W = S.w
  const maxD = Math.max(...isl.map(i => i.d))
  const { live } = totals(now)

  // row 0: controls + title on the left, LIVE + clock on the right, totals in the widest gap
  const r0 = freeSegments(isl, W, 0)
  const first = r0.find(s => s.w >= 18)
  if (first) {
    S.text(first.a + 1, 0, 'Live Pulse', P.mid, { bold: true })
    first.used = 12
  }
  const tag = [['● ', live.length ? P.router : P.dim], [`${live.length} LIVE`, live.length ? P.router : P.dim, true], ['  ' + clock(now), P.dim]]
  const last = [...r0].reverse().find(s => s.w - s.used >= partsLen(tag) + CONTROLS_W + 3)
  if (last) {
    controls(S, last.b, 0, P.bg)
    S.segs(last.b - CONTROLS_W - 1 - partsLen(tag), 0, tag)
    last.right = partsLen(tag) + CONTROLS_W + 3
  }
  const head = headerParts(now)
  const widest = [...r0].sort((a, b) => b.w - b.used - b.right - (a.w - a.used - a.right))[0]
  if (widest) {
    const room = widest.w - widest.used - widest.right - 2
    let parts = head
    const join = ps => ps.flatMap((p, i) => (i ? [...SEP, ...p] : p))
    while (parts.length > 1 && partsLen(join(parts)) > room) parts = parts.slice(0, -1)
    const line = join(parts)
    if (partsLen(line) <= room) S.segs(widest.a + widest.used + Math.floor((room - partsLen(line)) / 2) + 1, 0, line)
  }

  // the rows below: one pill per session, then the newest events, newest first
  const queue = []
  for (const st of store.sessions) {
    const state = stateOf(st, now)
    const pct = ctxPct(st)
    queue.push([
      ['● ', accentOf(st.sessionId), true],
      [projectName(st.cwd), P.cream, true],
      [' ' + { working: 'WORKING ' + SPIN[Math.floor(t * 12) % 10], idle: 'IDLE', ended: 'ENDED', silent: 'NO SIGNAL' }[state], state === 'working' ? P.router : P.mid, true],
      [` ctx ${pct}%`, pct >= 85 ? P.err : pct >= 65 ? P.warn : P.haiku],
    ])
  }
  const items = allItems().slice(-12).reverse()
  for (const it of items) {
    const what = it.kind === 'call' ? `${it.tool} ${it.label || ''}` : it.msg || ''
    const chip = it.kind !== 'call' ? '' : it.running ? ` ${SPIN[Math.floor(t * 12) % 10]}` : ` ${secs(it.ms)} ${it.ok === false ? '✗' : '✓'}`
    queue.push([
      [clock(it.t) + ' ', P.dim],
      [projectName(store.sessions.find(s => s.sessionId === it.sid)?.cwd) + ' ', accentOf(it.sid), true],
      [what, it.running ? P.text : P.mid],
      [chip, it.running ? P.peach : it.ok === false ? P.err : P.ok, true],
    ])
  }
  let qi = 0
  for (let row = 1; row <= maxD; row++) {
    for (const seg of freeSegments(isl, W, row)) {
      let x = seg.a + 1
      const end = seg.b
      while (qi < queue.length) {
        const item = queue[qi]
        const sepW = x > seg.a + 1 ? 3 : 0
        const room = end - x - sepW
        const need = partsLen(item)
        if (need <= room) {
          if (sepW) x = S.segs(x, row, [[' │ ', P.faint]])
          x = S.segs(x, row, item)
          qi++
        } else if (x === seg.a + 1 && room >= 16) {
          S.segs(x, row, item, { max: room, x0: x })
          qi++
          break
        } else break
      }
    }
  }
  return maxD + 1
}

/** Cuts each island out exactly, with a rounded border hugging it. */
function carve(S, isl, t, now) {
  const W = S.w
  const wires = new Wires()
  const working = store.sessions.filter(s => stateOf(s, now) === 'working')
  const glow = working.length ? accentOf(working[0].sessionId) : P.opus
  const color = mix(glow, P.bg, working.length ? 0.25 : 0.5)
  const paths = []
  for (const is of isl) {
    const x0 = is.a - 1
    const x1 = is.b + 1
    S.rect(Math.max(0, x0), 0, Math.min(W - 1, x1) - Math.max(0, x0) + 1, is.d + 1, P.bg)
    const pts = x0 < 0 ? [[0, is.d], [x1, is.d], [x1, 0]] : x1 > W - 1 ? [[x0, 0], [x0, is.d], [W - 1, is.d]] : [[x0, 0], [x0, is.d], [x1, is.d], [x1, 0]]
    paths.push(wires.path(pts, color))
  }
  wires.draw(S)
  if (working.length) for (const p of paths) sparks(S, p, t, glow, { speed: 12, n: 2, tail: 4, gap: 10 })
}

// ════════════════════════════════════════════════════════════════════════════
// One frame
// ════════════════════════════════════════════════════════════════════════════
function draw(S, t, now) {
  const W = S.w
  const H = S.h
  S.fill(P.bg)
  const isl = islands(W)
  if (W < 100 || H < 33) {
    const msg = `widen this window to at least 100×33 (now ${W}×${H})`
    S.text(centerX(0, W, msg), Math.floor(H / 2), msg, P.coral, { bold: true })
    controls(S, W - 2, 0, P.bg)
    return
  }
  const st = focused(now)
  let cy
  if (isl.length) {
    cy = drawTopFlow(S, isl, t, now) + 1
  } else {
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
  if (notch.monitors > 1) btn('M', `screen ${notch.monitor + 1}/${notch.monitors}`, () => actions.monitor())
  btn('W', notch.cover ? 'window' : tight ? 'full' : 'full screen', () => actions.window())
  btn('N', 'notch', () => actions.notch())
  btn('Q', 'quit', () => actions.quit())
  if (notch.status.startsWith('failed')) S.text(bx, statusY, 'notch ' + notch.status, P.warn, { bold: true, bg: P.bar })
  const right = `${working.length ? spin + ' ' : ''}${clock(now)}`
  S.text(W - 2 - len(right), statusY, right, working.length ? P.router : P.dim, { bg: P.bar })
  void fit
  void kfmt
  void CAT_COLOR
}

export function frame(S, t, now) {
  if (notch.calibrating) {
    // the calibration frame: the top band and three markers in one colour
    draw(S, t, now)
    const band = Math.min(BAND, Math.floor(S.h / 4))
    S.rect(0, 0, S.w, band, CAL)
    for (const [x, y] of [[1, S.h - 2], [S.w - 2, S.h - 2], [1, S.h - 5]]) S.set(x, y, ' ', CAL, CAL)
    return
  }
  draw(S, t, now)
  const isl = islands(S.w)
  if (isl.length) carve(S, isl, t, now)
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

