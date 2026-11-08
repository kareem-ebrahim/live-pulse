// Timeline: a lane per session and an indented lane per subagent. Every tool
// call is a bar coloured by kind, from its start to its end; turns, waits for
// the person and compactions are marked; arrows run from an Agent call to the
// lane of the subagent it started, and from a waiting session to the one that
// holds its file. A NOW cursor sweeps the right edge.
import { CATS, CAT_COLOR, CAT_LABEL, P, fit, len, mix, secs } from '../common.mjs'
import { accentOf, itemsOf, liveSessions, store } from '../data.mjs'
import { arrow } from '../anim.mjs'
import { autoScroll } from '../director.mjs'
import { emptyNote, holderOf, nameOf, panel, smoothBar, spanLabel } from './kit.mjs'

const ZOOMS = [2 * 60000, 5 * 60000, 15 * 60000, 60 * 60000]
const TICKS = [4, 5, 5, 6]
export const tl = { zoom: 0, first: 0, sel: '' }

export function timelineKey(key) {
  if (key === '+' || key === '=') tl.zoom = Math.max(0, tl.zoom - 1)
  else if (key === '-' || key === '_') tl.zoom = Math.min(ZOOMS.length - 1, tl.zoom + 1)
  else if (key === 'up') tl.first = Math.max(0, tl.first - 1)
  else if (key === 'down') tl.first += 1
  else return false
  return true
}

function lanesOf(st, from, now) {
  const items = itemsOf(st.sessionId)
  const lanes = [{ kind: 'session', st, key: '', depth: 0 }]
  const agents = (st.agents || []).filter(a => a.status === 'running' || a.started + (a.ms ?? 0) >= from)
  // parents before children, children indented under them
  const add = (parent, depth) => {
    for (const a of agents.filter(x => (x.parent ?? '') === parent)) {
      lanes.push({ kind: 'agent', st, key: a.key, agent: a, depth })
      add(a.key, depth + 1)
    }
  }
  add('', 1)
  for (const a of agents) if (!lanes.some(l => l.key === a.key)) lanes.push({ kind: 'agent', st, key: a.key, agent: a, depth: 1 })
  void items
  void now
  return lanes
}

export function drawTimeline(S, focus, y0, y1, t, now) {
  const W = S.w
  const sessions = liveSessions(now).length ? liveSessions(now) : store.sessions
  if (!sessions.length) return emptyNote(S, y0, y1, 'nothing on the timeline yet', 'start a Claude Code session and its calls appear here, live')
  const span = ZOOMS[tl.zoom]
  const from = now - span
  const LW = 26 // label column
  const box = panel(S, 1, y0, W - 2, y1 - y0, 'TIMELINE', P.faint, { right: `last ${spanLabel(span)} · wheel or +/- to zoom · click a bar` })
  const gx = box.x + LW
  const gw = box.w - LW - 1
  const xOf = ts => gx + Math.round(((ts - from) / span) * (gw - 1))
  S.hit(box.x, box.y, box.w, box.h, {
    onWheel: d => {
      if (d < 0) tl.zoom = Math.max(0, tl.zoom - 1)
      else tl.zoom = Math.min(ZOOMS.length - 1, tl.zoom + 1)
    },
  })

  // the time axis
  const ax = box.y
  const nt = TICKS[tl.zoom]
  for (let k = 0; k <= nt; k++) {
    const x = gx + Math.round((k / nt) * (gw - 1))
    const lab = k === nt ? 'now' : `-${spanLabel(span - (k / nt) * span)}`
    S.text(Math.min(x - Math.floor(len(lab) / 2), gx + gw - len(lab)), ax, lab, k === nt ? P.router : P.dim, { bg: P.panel })
    for (let y = ax + 1; y < box.y + box.h - 3; y++) if (S.ch[y * W + x] === ' ') S.set(x, y, '┊', P.faint, P.panel)
  }

  // every lane, sessions with their subagents under them
  const lanes = []
  for (const st of sessions) {
    lanes.push(...lanesOf(st, from, now))
    lanes.push({ kind: 'gap' })
  }
  lanes.pop()
  const area = box.h - 4
  // the lanes breathe when there is room: wider gaps between sessions, and the
  // event stream below keeps at most a dozen rows
  const gaps = lanes.filter(l => l.kind === 'gap').length
  const base = lanes.reduce((n, l) => n + (l.kind === 'session' ? 3 : 1), 0)
  const spare = area - base - 15
  const gapRows = spare > 0 ? 1 + Math.min(6, Math.floor(spare / Math.max(1, gaps))) : 1
  const rowsFor = l => (l.kind === 'session' ? 3 : l.kind === 'gap' ? gapRows : 1)
  const total = lanes.reduce((n, l) => n + rowsFor(l), 0)
  const autoFirst = autoScroll(total, area, now)
  // with AUTO on, scroll to the selected session's lanes
  const maxFirst = Math.max(0, total - area)
  tl.first = Math.min(tl.first, maxFirst)
  let first = autoFirst ?? tl.first
  let y = ax + 1 - first
  const laneY = new Map() // sid|key -> row
  const bottom = box.y + box.h - 3
  for (const l of lanes) {
    const h = rowsFor(l)
    if (l.kind === 'gap') {
      // a faint rule between sessions
      const ry = y + Math.floor(gapRows / 2)
      if (gapRows > 1 && ry >= ax + 1 && ry < bottom) for (let x = box.x; x < box.x + box.w; x += 2) if (S.ch[ry * W + x] === ' ') S.set(x, ry, '·', mix(P.faint, P.panel, 0.4), P.panel)
      y += gapRows
      continue
    }
    const visible = y >= ax + 1 && y + h - 1 < bottom
    laneY.set(`${l.st.sessionId}|${l.key}`, y)
    if (visible) drawLane(S, l, y, box.x, LW, gx, gw, xOf, from, span, t, now, focus)
    y += h
  }
  if (total > area) S.scrollbar(box.x + box.w, ax + 1, area, first, area, total, P.opus)

  // the event stream, in the room the lanes leave
  const lanesEnd = Math.max(...[...laneY.values()], ax) + 3
  const streamRows = Math.min(14, bottom - lanesEnd - 1)
  // the stream sits at the bottom of the panel
  const streamTop = bottom - 1 - streamRows
  if (streamRows >= 5) {
    S.text(box.x, streamTop, 'LATEST EVENTS', P.dim, { bold: true, bg: P.panel })
    for (let x = box.x + 14; x < box.x + box.w; x++) S.set(x, streamTop, '─', P.faint, P.panel)
    const all = sessions.flatMap(st => itemsOf(st.sessionId).map(it => ({ it, st }))).filter(x => x.it.kind !== 'turn-done' && x.it.kind !== 'attention-clear').sort((a, b) => a.it.t - b.it.t).slice(-streamRows)
    all.forEach(({ it, st }, i) => {
      const yy = streamTop + 1 + i
      const ac = accentOf(st.sessionId)
      const fresh = now - it.t < 2500
      const bg = fresh ? mix(P.panel, ac, 0.12) : P.panel
      S.rect(box.x - 1, yy, box.w + 2, 1, bg)
      S.text(box.x, yy, new Date(it.t).toTimeString().slice(0, 8), P.dim, { bg })
      S.text(box.x + 10, yy, '●', ac, { bg })
      S.text(box.x + 12, yy, fit(nameOf(st), 16), ac, { bg, bold: true })
      const what = it.kind === 'call' ? it.tool : it.kind === 'attention' ? 'NEEDS YOU' : it.kind === 'turn-summary' ? 'TURN DONE' : it.kind.toUpperCase()
      const col = it.kind === 'call' ? CAT_COLOR[it.cat] ?? P.mid : it.kind === 'attention' ? P.warn : it.kind.startsWith('agent') ? P.pink : P.opus
      // the kind as a chip on a wash of its colour, a thin bar for how long it took
      S.text(box.x + 30, yy, ` ${fit(what ?? '', 12)} `.padEnd(14), mix(col, P.text, 0.15), { bg: mix(bg, col, 0.18), bold: true })
      if (it.ms) smoothBar(S, box.x + box.w - 22, yy, 10, Math.min(1, Math.log10(1 + it.ms / 100) / 3), mix(col, P.bg, 0.5), col, bg)
      const detail = it.kind === 'turn-summary' && it.turn ? `#${it.turn.n} · ${secs(it.turn.ms ?? 0)} · ${it.turn.calls} calls` : it.kind === 'call' ? it.label ?? '' : it.msg ?? it.label ?? ''
      S.text(box.x + 46, yy, fit(`${it.agent && it.kind === 'call' ? '@ ' : ''}${detail}`, box.w - 60), P.mid, { bg })
      const tail = it.running ? 'running' : it.ok === false ? 'failed' : it.ms !== undefined ? secs(it.ms) : ''
      S.text(box.x + box.w - 10, yy, tail.padStart(10), it.ok === false ? P.err : it.running ? P.router : P.dim, { bg })
    })
  }

  // arrows: an Agent call to its subagent's lane; a waiting session to the holder
  for (const st of sessions) {
    const mainY = laneY.get(`${st.sessionId}|`)
    for (const it of itemsOf(st.sessionId)) {
      if (it.kind !== 'agent' || !it.agent || it.t < from) continue
      const childY = laneY.get(`${st.sessionId}|${it.agent}`)
      const parentY = laneY.get(`${st.sessionId}|${it.label ?? ''}`) ?? mainY
      if (childY === undefined || parentY === undefined) continue
      if (childY < ax + 1 || childY >= bottom || parentY < ax + 1 || parentY >= bottom) continue
      const x = xOf(it.t)
      arrow(S, [x, parentY], [x + 3, childY], accentOf(st.sessionId), t, { via: [x - 1, Math.round((parentY + childY) / 2)], speed: 8 })
    }
    const holder = holderOf(st)
    if (holder && mainY !== undefined) {
      const hy = laneY.get(`${holder.sessionId}|`)
      if (hy !== undefined && hy >= ax + 1 && hy < bottom && mainY >= ax + 1 && mainY < bottom) {
        const x = gx + gw - 4
        arrow(S, [x, mainY], [x, hy], P.warn, t, { via: [x - 6, Math.round((mainY + hy) / 2)], label: `waits for ${nameOf(holder)}` })
      }
    }
  }

  // NOW: a bright cursor at the right edge
  const nx = gx + gw - 1
  const glow = 0.5 + 0.5 * Math.sin(t * 4)
  const laneEnd = Math.min(bottom, Math.max(ax + 1, ...[...laneY.values()].map(v => v + 3)))
  for (let yy = ax + 1; yy < laneEnd; yy++) S.set(nx, yy, '│', mix(P.router, P.panel, 0.35 - glow * 0.3), S.getBg(nx, yy))

  // legend and the selected call
  const ly = box.y + box.h - 2
  let lx = box.x
  for (const c of CATS) {
    S.text(lx, ly, '━━', CAT_COLOR[c], { bg: P.panel })
    S.text(lx + 3, ly, CAT_LABEL[c].toLowerCase(), P.mid, { bg: P.panel })
    lx += len(CAT_LABEL[c]) + 5
  }
  for (const [g, c, w] of [['✗', P.err, 'failed'], ['▌', P.opus, 'turn'], ['!', P.warn, 'needs you'], ['◆', P.warn, 'compacted'], ['▶', P.text, 'subagent / wait']]) {
    S.text(lx, ly, g, c, { bg: P.panel, bold: true })
    S.text(lx + 2, ly, w, P.mid, { bg: P.panel })
    lx += len(w) + 4
  }
  const sel = tl.sel && store.sessions.flatMap(s => itemsOf(s.sessionId)).find(i => i.key === tl.sel)
  if (sel) {
    const d = `${sel.tool ?? sel.kind} · ${sel.label ?? sel.msg ?? ''} · ${sel.running ? 'running' : sel.ok === false ? 'failed' : 'ok'}${sel.ms !== undefined ? ` · ${secs(sel.ms)}` : ''}`
    const room = box.w - (lx - box.x) - 2
    if (room > 20) S.text(box.x + box.w - Math.min(room, len(d)), ly, fit(d, room), CAT_COLOR[sel.cat] ?? P.text, { bg: P.panel, bold: true })
  }
}

function drawLane(S, l, y, x0, LW, gx, gw, xOf, from, span, t, now, focus) {
  const st = l.st
  const ac = accentOf(st.sessionId)
  const isF = st.sessionId === focus.sessionId
  if (l.kind === 'session') {
    if (isF) S.rect(x0 - 1, y, LW - 1, 3, P.sel)
    const bg = isF ? P.sel : P.panel
    S.text(x0, y, '●', ac, { bg, bold: true })
    S.text(x0 + 2, y, fit(nameOf(st), LW - 5), ac, { bold: true, bg })
    const ph = st.attention ? 'needs you' : st.phase === 'idle' ? 'idle' : st.phase
    S.text(x0 + 2, y + 1, fit(`${ph} · ${st.turns} turns`, LW - 5), st.attention ? P.warn : P.dim, { bg })
    S.hit(x0, y, LW - 2, 2, { onClick: () => (store.pinned = st.sessionId) })
    // row 2: the turns, as spans with their numbers
    for (const turn of st.turnLog || []) {
      const end = turn.end ?? now
      if (end < from) continue
      const a = Math.max(gx, xOf(turn.start))
      const b = Math.min(gx + gw - 1, xOf(end))
      for (let x = a; x <= b; x++) S.set(x, y + 1, x === a ? '▌' : '▁', x === a ? P.opus : mix(turn.aborted ? P.warn : P.opus, P.panel, 0.55), P.panel)
      const lab = `#${turn.n}${turn.end ? ` ${secs(turn.ms ?? 0)}` : ''}`
      if (b - a > len(lab) + 2) S.text(a + 1, y + 1, lab, P.opus, { bg: P.panel })
    }
    // compactions
    for (const c of st.compacts || []) if (c.t >= from) S.set(xOf(c.t), y + 1, '◆', P.warn, P.panel, true)
    // row 3: how busy, column by column
    const cols = new Array(gw).fill(0)
    for (const it of itemsOf(st.sessionId)) if (it.kind === 'call' && it.t >= from) cols[Math.min(gw - 1, Math.max(0, xOf(it.t) - gx))]++
    const peak = Math.max(1, ...cols)
    const SP = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
    cols.forEach((n, i) => {
      if (n) S.set(gx + i, y + 2, SP[Math.max(1, Math.round((n / peak) * 8))], mix(ac, P.panel, 0.35), P.panel)
    })
    S.text(x0 + 2, y + 2, 'calls', P.faint, { bg: isF ? P.sel : P.panel })
  } else {
    const a = l.agent
    const lab = `${'  '.repeat(l.depth - 1)}└ @${a.type}`
    const live = a.status === 'running'
    S.text(x0, y, fit(lab, LW - 3), live ? mix(ac, P.text, 0.2) : P.dim, { bg: P.panel })
    if (live) S.text(x0 + LW - 4, y, '◐◓◑◒'[Math.floor(t * 6) % 4], ac, { bg: P.panel })
  }
  // the calls on this lane
  const items = itemsOf(st.sessionId)
  let needFrom = 0
  for (const it of items) {
    if (it.kind === 'attention') needFrom = it.t
    if (it.kind === 'attention-clear' && needFrom && l.kind === 'session') {
      for (let x = Math.max(gx, xOf(needFrom)); x <= xOf(it.t); x++) S.set(x, y, '!', P.warn, mix(P.warn, P.panel, 0.8), true)
      needFrom = 0
    }
    if (it.kind !== 'call') continue
    if ((it.agent ?? '') !== l.key) continue
    const end = it.running ? now : it.endT ?? it.t
    if (end < from) continue
    const a = Math.max(gx, xOf(it.t))
    const b = Math.max(a, Math.min(gx + gw - 1, xOf(end)))
    const color = CAT_COLOR[it.cat] ?? P.mid
    const selIt = tl.sel === it.key
    for (let x = a; x <= b; x++) {
      const pulse = it.running ? 0.3 + 0.3 * Math.sin(t * 8 + x * 0.6) : 0
      S.set(x, y, '━', selIt ? P.text : mix(color, P.text, pulse), P.panel, true)
    }
    if (it.cat === 'edit' && b - a >= 1) S.set(a, y, '✎', color, P.panel, true)
    if (it.ok === false) S.set(b, y, '✗', P.err, P.panel, true)
    S.hit(a, y, b - a + 1, 1, { onClick: () => (tl.sel = it.key) })
  }
  if (needFrom && l.kind === 'session') for (let x = Math.max(gx, xOf(needFrom)); x < gx + gw - 1; x++) S.set(x, y, '!', mix(P.warn, P.text, 0.5 + 0.5 * Math.sin(t * 6)), mix(P.warn, P.panel, 0.8), true)
  void span
}
