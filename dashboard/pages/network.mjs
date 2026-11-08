// Network: who talks to what, in sections and cards.
//
//   KPI cards ─ sessions · subagents · tools · files · calls/min · conflicts
//   SESSIONS & AGENTS │ TOOLS & MCP │ FILES   (cards; links run only between
//                                             neighbouring sections)
//   BUSIEST LINKS     │ HEALTH
//
// A link runs bright and fast while calls flow along it and fades when quiet;
// a file two sessions touch turns its card and its links red. The selected
// session's cards and links are lit, the rest dimmed.
import { CAT_COLOR, P, ago, fit, kfmt, len, mix } from '../common.mjs'
import { accentOf, conflicts, itemsOf, liveSessions, store } from '../data.mjs'
import { arrow, breathe, burst } from '../anim.mjs'
import { sparkline } from '../screen.mjs'
import { emptyNote, nameOf, panel, thinBar } from './kit.mjs'

const WINDOW = 15 * 60000
const seen = new Set() // calls already greeted with a burst
const EDITORS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TOOL_ICON = { edit: '✎', exec: '›_', read: '◉', agent: '◆', web: '◍', mcp: '⬡' }

function toolKey(it) {
  if (it.cat === 'mcp' && String(it.tool).startsWith('mcp__')) return `mcp:${String(it.tool).split('__')[1]}`
  return it.tool || it.kind
}

/**
 * A card: an accent strip on the left, a title with a metric on the right, a
 * line of detail, and a share bar. Three rows. Returns its anchors.
 */
function card(S, x, y, w, c) {
  const lit = c.lit
  const dim = c.dim
  const color = dim ? mix(c.color, P.bg, 0.5) : c.color
  const bg = lit ? mix(P.panel, c.color, 0.13) : mix(P.panel, c.color, 0.045)
  S.rect(x, y, w, 3, bg)
  // the strip pulses while the card is busy
  const strip = c.busy ? mix(color, P.text, 0.35 * breathe(c.t, 6)) : color
  for (let r = 0; r < 3; r++) S.set(x, y + r, '▌', strip, bg)
  const indent = c.indent ?? 0
  if (indent) S.text(x + 1, y, '└', mix(P.faint, P.mid, 0.3), { bg })
  const tx = x + 2 + indent
  const icon = c.icon ? `${c.icon} ` : ''
  const metric = c.metric ?? ''
  S.text(tx, y, fit(`${icon}${c.title}`, w - 4 - indent - len(metric)), dim ? P.dim : mix(color, P.text, 0.15), { bold: true, bg })
  if (metric) S.text(x + w - 1 - len(metric), y, metric, c.metricColor ?? (dim ? P.dim : P.text), { bold: true, bg })
  if (c.sub) S.text(tx, y + 1, fit(c.sub, w - 3 - indent - (c.right ? len(c.right) + 1 : 0)), dim ? P.faint : P.mid, { bg })
  if (c.right) S.text(x + w - 1 - len(c.right), y + 1, c.right, c.rightColor ?? P.dim, { bg })
  thinBar(S, tx, y + 2, w - 3 - indent, c.share ?? 0, mix(color, P.bg, 0.45), color, bg)
  return { left: [x - 1, y + 1], right: [x + w, y + 1] }
}

/** A KPI card: a label, a big value, a note. */
function kpi(S, x, y, w, label, value, note, color) {
  panel(S, x, y, w, 4, label, P.faint, { accent: color })
  S.text(x + 2, y + 1, fit(value, w - 4), color, { bold: true, bg: P.panel })
  S.text(x + 2, y + 2, fit(note, w - 4), P.dim, { bg: P.panel })
}

export function drawNetwork(S, focus, y0, y1, t, now) {
  const W = S.w
  const sessions = liveSessions(now).length ? liveSessions(now) : store.sessions
  if (!sessions.length) return emptyNote(S, y0, y1, 'no sessions to connect yet', 'sessions, subagents, tools and files appear here as a graph')

  // ── gather: tools, files and the links between them ──
  const tools = new Map() // key -> { key, calls, last, cat, sessions:Set, running, failed }
  const links = new Map() // from>to -> { from, to, n, last, color, sid }
  const link = (from, to, sid, ts, color) => {
    const k = `${from}>${to}`
    const e = links.get(k) ?? { from, to, n: 0, last: 0, sid, color }
    e.n += 1
    e.last = Math.max(e.last, ts)
    links.set(k, e)
  }
  const minutes = new Array(15).fill(0)
  let calls = 0
  let failed = 0
  for (const st of sessions) {
    const sid = st.sessionId
    for (const it of itemsOf(sid)) {
      if (it.kind !== 'call' || now - it.t > WINDOW) continue
      calls++
      minutes[14 - Math.min(14, Math.floor((now - it.t) / 60000))]++
      const k = toolKey(it)
      const tool = tools.get(k) ?? { key: k, calls: 0, last: 0, cat: it.cat, sessions: new Set(), running: 0, failed: 0 }
      tool.calls++
      tool.last = Math.max(tool.last, it.t)
      tool.sessions.add(sid)
      if (it.running) tool.running++
      if (it.ok === false) {
        tool.failed++
        failed++
      }
      tools.set(k, tool)
      link(it.agent ? `a:${sid}:${it.agent}` : `s:${sid}`, `t:${k}`, sid, it.t, CAT_COLOR[it.cat] ?? P.mid)
      if (now - it.t < 1500 && !seen.has(it.key)) {
        seen.add(it.key)
        tool.fresh = true
      }
    }
  }
  if (seen.size > 5000) seen.clear()
  const clash = conflicts(now)
  const red = new Set(clash.map(c => c.path))
  const fileMap = new Map()
  for (const st of sessions)
    for (const f of (st.files || []).filter(f => now - f.last < WINDOW)) {
      const id = `f:${f.abs || f.path}`
      const row = fileMap.get(id) ?? { id, f, sids: new Set(), edits: 0, added: 0, removed: 0, last: 0, active: false }
      row.sids.add(st.sessionId)
      row.edits += f.edits
      row.added += f.added ?? 0
      row.removed += f.removed ?? 0
      row.active = row.active || f.active
      if (f.last > row.last) {
        row.last = f.last
        row.f = f
      }
      fileMap.set(id, row)
      const tk = EDITORS.has(f.tool) ? f.tool : 'Edit'
      link(`t:${tk}`, id, st.sessionId, f.last, CAT_COLOR.edit)
      if (!tools.has(tk)) tools.set(tk, { key: tk, calls: f.edits, last: f.last, cat: 'edit', sessions: new Set([st.sessionId]), running: 0, failed: 0 })
    }
  const files = [...fileMap.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.last - a.last)
  for (const x of files) x.red = x.sids.size > 1 || red.has(x.f.path)
  const toolList = [...tools.values()].sort((a, b) => b.running - a.running || b.calls - a.calls)
  const agentCount = sessions.reduce((n, s) => n + (s.agents || []).length, 0)
  const agentRunning = sessions.reduce((n, s) => n + (s.agents || []).filter(a => a.status === 'running').length, 0)

  // ── KPI cards ──
  const kpis = [
    ['SESSIONS', String(sessions.length), `${sessions.filter(s => s.phase !== 'idle').length} working`, P.opus],
    ['SUBAGENTS', `${agentRunning} / ${agentCount}`, 'running / started', P.haiku],
    ['TOOLS', String(toolList.length), `${toolList.filter(x => x.key.startsWith('mcp:')).length} MCP servers`, P.peach],
    ['FILES', String(files.length), `${files.filter(f => f.active).length} being edited`, P.coral],
    ['CALLS', `${minutes[14]}/min`, `${kfmt(calls)} in 15 min`, P.router],
    ['CONFLICTS', String(clash.length), clash.length ? 'two sessions, one file' : 'none', clash.length ? P.err : P.ok],
  ]
  const kw = Math.floor((W - 2) / kpis.length)
  kpis.forEach(([l, v, n, c], i) => kpi(S, 1 + i * kw, y0, i === kpis.length - 1 ? W - 2 - i * kw : kw - 1, l, v, n, c))

  // ── the three sections ──
  const top = y0 + 4
  const bottomH = Math.max(8, Math.min(11, Math.floor((y1 - y0) * 0.22)))
  const midH = y1 - top - bottomH
  const gutter = Math.max(10, Math.floor(W * 0.09))
  const colW = [Math.floor((W - 2 - gutter * 2) * 0.36), Math.floor((W - 2 - gutter * 2) * 0.3), 0]
  colW[2] = W - 2 - gutter * 2 - colW[0] - colW[1]
  const colX = [1, 1 + colW[0] + gutter, 1 + colW[0] + gutter + colW[1] + gutter]
  const fsid = focus.sessionId
  const p0 = panel(S, colX[0], top, colW[0], midH, 'SESSIONS & AGENTS', P.faint, { accent: P.opus, right: `${sessions.length + agentCount}` })
  const p1 = panel(S, colX[1], top, colW[1], midH, 'TOOLS & MCP', P.faint, { accent: P.peach, right: `${toolList.length}` })
  const p2 = panel(S, colX[2], top, colW[2], midH, 'FILES', P.faint, { accent: P.coral, right: `${files.length}` })
  const slots = Math.floor((p0.h + 1) / 4)
  const pos = new Map()

  // sessions, each followed by its subagents as a tree
  const rows0 = []
  for (const st of sessions) {
    rows0.push({ st })
    const agents = (st.agents || []).filter(a => a.status === 'running' || now - (a.started + (a.ms ?? 0)) < WINDOW)
    const depthOf = a => {
      let d = 1
      let p = a.parent
      while (p && d < 4) {
        p = agents.find(x => x.key === p)?.parent
        d++
      }
      return d
    }
    for (const a of agents.sort((x, y) => Number(y.status === 'running') - Number(x.status === 'running') || y.started - x.started)) rows0.push({ st, a, depth: depthOf(a) })
  }
  const totalCalls = Math.max(1, ...sessions.map(s => s.toolCount || 0))
  rows0.slice(0, slots).forEach((r, i) => {
    const y = p0.y + i * 4
    const sid = r.st.sessionId
    const ac = accentOf(sid)
    const mine = !fsid || sid === fsid
    if (!r.a) {
      const st = r.st
      const g = card(S, p0.x - 1, y, p0.w + 2, {
        title: nameOf(st),
        icon: '●',
        metric: st.attention ? '! NEEDS YOU' : `${kfmt(st.toolCount)} calls`,
        metricColor: st.attention ? P.warn : undefined,
        sub: st.phase === 'idle' ? 'idle' : st.activity || st.phase,
        right: `${(st.agents || []).filter(a => a.status === 'running').length} agents`,
        share: (st.toolCount || 0) / totalCalls,
        color: ac,
        lit: sid === fsid,
        dim: !mine,
        busy: st.phase !== 'idle',
        t,
      })
      pos.set(`s:${sid}`, g)
      S.hit(p0.x - 1, y, p0.w + 2, 3, { onClick: () => (store.pinned = sid) })
    } else {
      const a = r.a
      const live = a.status === 'running'
      const indent = Math.min(6, r.depth * 2)
      const g = card(S, p0.x - 1, y, p0.w + 2, {
        title: `@${a.type}`,
        metric: live ? 'running' : a.status === 'failed' ? 'failed' : 'done',
        metricColor: live ? P.router : a.status === 'failed' ? P.err : P.dim,
        sub: live ? a.current : a.desc,
        right: `${a.tools} tools`,
        share: Math.min(1, (a.tools || 0) / 30),
        color: a.status === 'failed' ? P.err : mix(ac, P.haiku, 0.35),
        indent,
        lit: live && sid === fsid,
        dim: !mine || !live,
        busy: live,
        t,
      })
      pos.set(`a:${sid}:${a.key}`, g)
    }
  })
  if (rows0.length > slots) S.text(p0.x, p0.y + p0.h - 1, `+${rows0.length - slots} more`, P.dim, { bg: P.panel })

  // tools and MCP servers
  const maxCalls = Math.max(1, ...toolList.map(x => x.calls))
  toolList.slice(0, slots).forEach((x, i) => {
    const y = p1.y + i * 4
    const color = x.key.startsWith('mcp:') ? CAT_COLOR.mcp : CAT_COLOR[x.cat] ?? P.mid
    const mine = !fsid || x.sessions.has(fsid)
    const g = card(S, p1.x - 1, y, p1.w + 2, {
      title: x.key.replace(/^mcp:/, ''),
      icon: x.key.startsWith('mcp:') ? TOOL_ICON.mcp : TOOL_ICON[x.cat] ?? '•',
      metric: `${x.calls}×`,
      sub: x.running ? `${x.running} running` : `last ${ago(now - x.last)}`,
      right: x.failed ? `${x.failed} failed` : x.sessions.size > 1 ? `${x.sessions.size} sessions` : '',
      rightColor: x.failed ? P.err : P.dim,
      share: x.calls / maxCalls,
      color,
      dim: !mine || now - x.last > 300000,
      lit: x.running > 0,
      busy: x.running > 0,
      t,
    })
    pos.set(`t:${x.key}`, g)
    if (x.fresh) {
      x.fresh = false
      burst(g.left[0] + 2, g.left[1], color, 8, { speed: 8, life: 600 })
    }
  })
  if (toolList.length > slots) S.text(p1.x, p1.y + p1.h - 1, `+${toolList.length - slots} more`, P.dim, { bg: P.panel })

  // files
  const maxEdits = Math.max(1, ...files.map(f => f.edits))
  files.slice(0, slots).forEach((x, i) => {
    const y = p2.y + i * 4
    const name = String(x.f.path).split(/[\\/]/).pop()
    const dir = String(x.f.path).split(/[\\/]/).slice(0, -1).join('/')
    const mine = !fsid || x.sids.has(fsid)
    const g = card(S, p2.x - 1, y, p2.w + 2, {
      title: name,
      icon: x.red ? '◆' : x.active ? '✎' : '·',
      metric: `${x.edits} edit${x.edits === 1 ? '' : 's'}`,
      sub: dir || '.',
      right: x.red ? `${x.sids.size} sessions!` : `+${x.added} −${x.removed}`,
      rightColor: x.red ? P.err : P.mid,
      share: x.edits / maxEdits,
      color: x.red ? P.err : x.active ? P.coral : mix(P.coral, P.mid, 0.5),
      dim: !mine,
      lit: x.active || x.red,
      busy: x.active,
      t,
    })
    pos.set(x.id, g)
  })
  if (!files.length) S.text(p2.x, p2.y, 'no files edited in the last 15 min', P.faint, { bg: P.panel })
  if (files.length > slots) S.text(p2.x, p2.y + p2.h - 1, `+${files.length - slots} more`, P.dim, { bg: P.panel })

  // ── links, only between neighbouring sections, through the gutters ──
  for (const e of links.values()) {
    const a = pos.get(e.from)
    const b = pos.get(e.to)
    if (!a || !b) continue
    const fresh = now - e.last < 3000
    const mine = !fsid || e.sid === fsid
    let color = e.to.startsWith('f:') && files.find(f => f.id === e.to)?.red ? P.err : e.color
    if (!mine) color = mix(color, P.bg, 0.6)
    const from = [a.right[0], a.right[1]]
    const to = [b.left[0] - 1, b.left[1]]
    const heavy = e.n >= 10 ? 0.35 : e.n >= 3 ? 0.5 : 0.65
    arrow(S, from, to, color, t, { via: [Math.round((from[0] + to[0]) / 2), from[1]], speed: fresh ? 20 : 5, fade: fresh ? 0.15 : heavy, gap: fresh ? 6 : 14 })
  }

  // ── bottom: the busiest links, and health ──
  const by = y1 - bottomH
  const lw = Math.floor((W - 3) * 0.6)
  const lb = panel(S, 1, by, lw, bottomH, 'BUSIEST LINKS', P.faint, { accent: P.router, right: 'last 15 min' })
  const label = id => {
    if (id.startsWith('s:')) return nameOf(store.sessions.find(s => s.sessionId === id.slice(2)))
    if (id.startsWith('a:')) return `@${(store.sessions.find(s => s.sessionId === id.split(':')[1])?.agents || []).find(a => a.key === id.split(':')[2])?.type ?? 'agent'}`
    if (id.startsWith('t:')) return id.slice(2).replace(/^mcp:/, '')
    return String(id).split(/[\\/]/).pop()
  }
  const busiest = [...links.values()].sort((a, b) => b.n - a.n).slice(0, lb.h)
  const maxN = Math.max(1, ...busiest.map(e => e.n))
  busiest.forEach((e, i) => {
    const y = lb.y + i
    const ac = accentOf(e.sid)
    S.text(lb.x, y, '●', ac, { bg: P.panel })
    const path = `${label(e.from)} → ${label(e.to)}`
    S.text(lb.x + 2, y, fit(path, 34), P.text, { bg: P.panel })
    const bw = Math.max(6, lb.w - 52)
    thinBar(S, lb.x + 37, y, bw, e.n / maxN, mix(e.color, P.bg, 0.45), e.color, P.panel)
    S.text(lb.x + 38 + bw, y, `${e.n}×`.padStart(5), P.text, { bold: true, bg: P.panel })
    S.text(lb.x + lb.w - 6, y, ago(now - e.last).padStart(6), now - e.last < 3000 ? P.router : P.dim, { bg: P.panel })
  })
  if (!busiest.length) S.text(lb.x, lb.y, 'no calls in the last 15 minutes', P.faint, { bg: P.panel })

  const hb = panel(S, 1 + lw + 1, by, W - 3 - lw, bottomH, 'HEALTH', P.faint, { accent: failed || clash.length ? P.err : P.ok })
  let hy = hb.y
  S.text(hb.x, hy, 'calls / min', P.dim, { bg: P.panel })
  sparkline(S, hb.x + 13, hy, Math.min(30, hb.w - 13), minutes.flatMap(v => [v, v]), P.router, P.panel)
  hy++
  const ok = calls - failed
  S.text(hb.x, hy, 'succeeded', P.dim, { bg: P.panel })
  thinBar(S, hb.x + 13, hy, Math.max(6, hb.w - 22), calls ? ok / calls : 1, mix(P.ok, P.bg, 0.4), P.ok, P.panel)
  S.text(hb.x + hb.w - 8, hy, `${calls ? Math.round((ok / calls) * 100) : 100}%`.padStart(8), P.ok, { bold: true, bg: P.panel })
  hy++
  S.text(hb.x, hy++, fit(`${failed} failed call${failed === 1 ? '' : 's'}${failed ? ` · ${toolList.filter(x => x.failed).map(x => x.key).slice(0, 3).join(', ')}` : ''}`, hb.w), failed ? P.err : P.dim, { bg: P.panel })
  for (const c of clash.slice(0, Math.max(0, hb.y + hb.h - hy))) {
    const a = store.sessions.find(s => s.sessionId === c.a)
    const b = store.sessions.find(s => s.sessionId === c.b)
    S.text(hb.x, hy++, fit(`◆ ${nameOf(a)} & ${nameOf(b)} · ${String(c.path).split(/[\\/]/).pop()}`, hb.w), P.err, { bold: true, bg: P.panel })
  }
  if (!clash.length && hy < hb.y + hb.h) S.text(hb.x, hy, 'no two sessions on one file', P.dim, { bg: P.panel })
}
