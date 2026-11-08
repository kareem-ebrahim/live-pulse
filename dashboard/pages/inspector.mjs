// Inspector: one session in depth. Its turns as Gantt bars (thinking /
// writing / tools), the chosen turn opened up (its calls, kinds, tokens, cost),
// the tree of subagents with who started whom, the compactions, the MCP
// servers it used, and every time it waited for the person.
import { CATS, CAT_COLOR, CAT_LABEL, P, ago, clock, fit, fitTail, kfmt, len, mix, pretty, secs, usd } from '../common.mjs'
import { accentOf, itemsOf, stateOf } from '../data.mjs'
import { autoScroll } from '../director.mjs'
import { emptyNote, nameOf, panel, smoothBar } from './kit.mjs'

export const insp = { turn: -1 } // -1: the newest

export function inspectorKey(key) {
  if (key === 'up') insp.turn = insp.turn === -1 ? -2 : insp.turn - 1
  else if (key === 'down') insp.turn = insp.turn >= -1 ? -1 : insp.turn + 1
  else return false
  return true
}

const ATT_WORD = { permission: 'permission', question: 'question', plan: 'plan approval' }

export function drawInspector(S, st, y0, y1, t, now) {
  const W = S.w
  if (!st.sessionId) return emptyNote(S, y0, y1, 'no session to inspect', 'pick one with Tab or by clicking it on any page')
  const ac = accentOf(st.sessionId)
  const state = stateOf(st, now)

  // ── the head: who, and whether it waits for the person ──
  let y = y0 + 1
  S.text(2, y, '●', ac, { bold: true })
  S.text(4, y, nameOf(st), ac, { bold: true })
  const facts = [
    pretty(st.model),
    st.effort ? `effort ${st.effort}` : '',
    state === 'working' ? st.phase : state,
    `${st.turns} turns`,
    `${kfmt(st.toolCount)} calls`,
    usd(st.costUsd || 0),
    st.startedAt ? `since ${clock(st.startedAt)}` : '',
    st.repo?.remote ? String(st.repo.remote).replace(/^https?:\/\//, '') : '',
  ].filter(Boolean)
  S.text(5 + len(nameOf(st)), y, fit(`  ${facts.join('  ·  ')}`, W - 8 - len(nameOf(st))), P.mid)
  y++
  if (st.attention) {
    const a = st.attention
    const glow = 0.5 + 0.5 * Math.sin(t * 6)
    const bg = mix(P.bg, P.warn, 0.18 + glow * 0.12)
    S.rect(1, y, W - 2, 1, bg)
    const what = a.kind === 'permission' ? `wants to use ${a.tool}${a.label ? `: ${a.label}` : ''}` : a.kind === 'question' ? 'asks you a question' : 'has a plan for you to approve'
    S.text(2, y, ` ! NEEDS YOU `, P.bg, { bold: true, bg: mix(P.warn, P.text, glow * 0.3) })
    S.text(16, y, fit(`${what} · waiting ${ago(now - a.since)} · answer in its terminal`, W - 18), P.warn, { bold: true, bg })
  } else if (st.activity) S.text(2, y, fit(`▸ ${st.activity}`, W - 4), P.dim)
  y += 2

  const leftW = Math.round((W - 3) * 0.58)
  const rx = 1 + leftW + 1
  const rw = W - rx - 1
  const area = y1 - y

  // ── turns ──
  const turns = st.turnLog || []
  const listH = Math.max(6, Math.min(turns.length + 3, Math.floor(area * 0.45)))
  const tb = panel(S, 1, y, leftW, listH, 'TURNS', P.faint, { right: '▇ thinking  ▇ writing  ▇ tools · ↑↓ pick' })
  // colour the legend squares
  {
    const r = '▇ thinking  ▇ writing  ▇ tools · ↑↓ pick'
    const rxx = 1 + leftW - 2 - len(r) - 1 + 1
    S.set(rxx, y, '▇', P.opus, P.panel)
    S.set(rxx + 12, y, '▇', P.coral, P.panel)
    S.set(rxx + 23, y, '▇', P.peach, P.panel)
  }
  const pick = turns.length ? turns[Math.max(0, turns.length + insp.turn)] : undefined
  const rows = tb.h
  const first = autoScroll(turns.length, rows, now) ?? Math.max(0, Math.min(turns.length - rows, turns.length + insp.turn - rows + 1))
  const maxMs = Math.max(1, ...turns.map(x => x.ms ?? now - x.start))
  const gw = Math.max(10, tb.w - 44)
  turns.slice(first, first + rows).forEach((turn, i) => {
    const yy = tb.y + i
    const sel = turn === pick
    const bg = sel ? P.sel : P.panel
    S.rect(tb.x - 1, yy, tb.w + 2, 1, bg)
    const ms = turn.ms ?? now - turn.start
    const open = turn.end === undefined
    S.text(tb.x, yy, `#${turn.n}`.padStart(4), sel ? P.text : P.opus, { bold: sel, bg })
    S.text(tb.x + 5, yy, (open ? '…' : secs(ms)).padStart(7), open ? P.router : P.mid, { bg })
    // the Gantt bar: length by duration, split by where the time went
    const w = Math.max(1, Math.round((ms / maxMs) * gw))
    const sum = Math.max(1, turn.think + turn.write + turn.tools)
    const a = Math.round((turn.think / sum) * w)
    const b = Math.round((turn.write / sum) * w)
    for (let k = 0; k < w; k++) {
      const c = k < a ? P.opus : k < a + b ? P.coral : P.peach
      const pulse = open && k === w - 1 ? 0.5 + 0.5 * Math.sin(t * 8) : 0
      S.set(tb.x + 13 + k, yy, '▇', mix(turn.aborted ? mix(c, P.warn, 0.5) : c, P.text, pulse * 0.6), bg)
    }
    const tail = `${turn.calls} calls${turn.errors ? ` ${turn.errors}✗` : ''}${turn.files ? ` · ${turn.files}f` : ''}${turn.agents ? ` · ${turn.agents}@` : ''} · ${usd(turn.cost || 0)}`
    S.text(tb.x + tb.w - len(tail), yy, tail, turn.errors ? P.err : P.mid, { bg })
    S.hit(tb.x - 1, yy, tb.w + 2, 1, { onClick: () => (insp.turn = turns.indexOf(turn) - turns.length) })
  })
  if (!turns.length) S.text(tb.x, tb.y, 'no turn measured yet: they appear from the next prompt', P.dim, { bg: P.panel })

  // ── the chosen turn, opened ──
  const dy = y + listH
  const db = panel(S, 1, dy, leftW, y1 - dy, pick ? `TURN #${pick.n}${pick.aborted ? ' · interrupted' : ''}` : 'TURN', pick ? P.opus : P.faint, {
    right: pick ? `${clock(pick.start)} · ${pick.end ? secs(pick.ms) : 'running'}` : '',
  })
  if (pick) {
    let ly = db.y
    // kinds of calls
    const total = Math.max(1, ...CATS.map(c => pick.cats?.[c] ?? 0))
    let cx = db.x
    for (const c of CATS) {
      const n = pick.cats?.[c] ?? 0
      const lab = `${CAT_LABEL[c]} ${n}`
      S.text(cx, ly, lab, n ? CAT_COLOR[c] : P.faint, { bg: P.panel, bold: !!n })
      for (let k = 0; k < 6; k++) S.set(cx + k, ly + 1, k < Math.round((n / total) * 6) ? '▀' : ' ', CAT_COLOR[c], P.panel)
      cx += Math.max(len(lab), 6) + 2
    }
    ly += 2
    const tokLine = `in ${kfmt(pick.inTok)} · out ${kfmt(pick.outTok)} · cache read ${kfmt(pick.cacheRead)} · cache write ${kfmt(pick.cacheWrite)} · ${usd(pick.cost || 0)}`
    S.text(db.x, ly++, fit(tokLine, db.w), P.mid, { bg: P.panel })
    const time = `thinking ${secs(pick.think)} · writing ${secs(pick.write)} · tools ${secs(pick.tools)}`
    S.text(db.x, ly++, fit(time, db.w), P.dim, { bg: P.panel })
    ly++
    // its calls, in order
    const end = pick.end ?? now
    const calls = itemsOf(st.sessionId).filter(i => i.kind === 'call' && i.t >= pick.start - 50 && i.t <= end + 50)
    const room = db.y + db.h - ly
    const cfirst = autoScroll(calls.length, room, now) ?? Math.max(0, calls.length - room)
    for (const it of calls.slice(cfirst, cfirst + room)) {
      const col = CAT_COLOR[it.cat] ?? P.mid
      const mark = it.running ? '◌' : it.ok === false ? '✗' : '✓'
      S.text(db.x, ly, mark, it.running ? P.router : it.ok === false ? P.err : P.ok, { bg: P.panel, bold: true })
      S.text(db.x + 2, ly, fit(it.tool ?? '', 12), col, { bg: P.panel, bold: true })
      const src = it.agent ? '@' : ''
      S.text(db.x + 15, ly, fitTail(`${src}${it.label ?? ''}`, db.w - 26), P.mid, { bg: P.panel })
      S.text(db.x + db.w - 9, ly, (it.running ? secs(now - it.t) : secs(it.ms)).padStart(9), P.dim, { bg: P.panel })
      ly++
    }
    if (!calls.length) S.text(db.x, ly, 'no tool calls in this turn', P.dim, { bg: P.panel })
  }
  else S.text(db.x, db.y, 'each turn opens here: its calls, kinds of work, tokens and cost', P.dim, { bg: P.panel })

  // ── right: agent tree, compactions, MCP, waits ──
  const agents = st.agents || []
  const treeH = Math.max(5, Math.min(agents.length + 3, Math.floor(area * 0.4)))
  const ab = panel(S, rx, y, rw, treeH, 'SUBAGENT TREE', P.faint, { right: `${agents.filter(a => a.status === 'running').length} running · ${agents.length} total` })
  const lines = []
  const walk = (parent, prefix) => {
    const kids = agents.filter(a => (a.parent ?? '') === parent)
    kids.forEach((a, i) => {
      const last = i === kids.length - 1
      lines.push({ a, pre: prefix + (last ? '└─ ' : '├─ ') })
      walk(a.key, prefix + (last ? '   ' : '│  '))
    })
  }
  S.text(ab.x, ab.y, '◆ main', ac, { bold: true, bg: P.panel })
  walk('', '')
  for (const a of agents) if (!lines.some(l => l.a === a)) lines.push({ a, pre: '└─ ' })
  const af = autoScroll(lines.length, ab.h - 1, now) ?? Math.max(0, lines.length - (ab.h - 1))
  lines.slice(af, af + ab.h - 1).forEach((l, i) => {
    const yy = ab.y + 1 + i
    const a = l.a
    const live = a.status === 'running'
    const col = a.status === 'failed' ? P.err : live ? mix(ac, P.text, 0.15) : P.mid
    S.text(ab.x, yy, l.pre, P.faint, { bg: P.panel })
    const x = ab.x + len(l.pre)
    S.text(x, yy, `@${a.type}`, col, { bold: live, bg: P.panel })
    const ms = live ? now - a.started : a.ms ?? 0
    const right = `${live ? '◐◓◑◒'[Math.floor(t * 6) % 4] + ' ' : a.status === 'failed' ? '✗ ' : '✓ '}${secs(ms)} · ${a.tools} tools · ${kfmt(a.outTok)}`
    S.text(x + len(a.type) + 2, yy, fit(` ${a.desc}`, Math.max(0, ab.w - (x - ab.x) - len(a.type) - 3 - len(right))), P.dim, { bg: P.panel })
    S.text(ab.x + ab.w - len(right), yy, right, live ? P.router : P.dim, { bg: P.panel })
  })
  if (!agents.length) S.text(ab.x + 2, ab.y + 1, 'no subagents yet', P.dim, { bg: P.panel })

  let ry = y + treeH
  const rest = y1 - ry
  // compactions
  const comps = st.compacts || []
  const mcpN = Object.keys(st.mcp || {}).length
  const compH = Math.max(4, Math.min(comps.length + 2, Math.floor(rest / 3)))
  const mcpH = Math.max(4, Math.min(mcpN + 2, Math.floor(rest / 3)))
  const cb = panel(S, rx, ry, rw, compH, 'COMPACTIONS', comps.length ? P.warn : P.faint, { right: `${comps.length}` })
  comps.slice(-(cb.h)).forEach((c, i) => {
    const freed = c.after !== undefined ? `${kfmt(c.before)} → ${kfmt(c.after)} · freed ${kfmt(Math.max(0, c.before - c.after))}` : `${kfmt(c.before)} before`
    S.text(cb.x, cb.y + i, fit(`${clock(c.t)}  ${c.trigger.padEnd(7)} ${freed}`, cb.w), P.mid, { bg: P.panel })
  })
  if (!comps.length) S.text(cb.x, cb.y, 'the context has not been compacted', P.dim, { bg: P.panel })
  ry += compH
  // MCP servers
  const mcp = Object.entries(st.mcp || {}).sort((a, b) => b[1] - a[1])
  const mb = panel(S, rx, ry, rw, mcpH, 'MCP SERVERS', mcp.length ? P.green : P.faint, { right: `${mcp.length}` })
  const mmax = Math.max(1, ...mcp.map(m => m[1]))
  mcp.slice(0, mb.h).forEach(([name, n], i) => {
    S.text(mb.x, mb.y + i, fit(name, 18), CAT_COLOR.mcp, { bg: P.panel, bold: true })
    const w = Math.max(4, mb.w - 26)
    smoothBar(S, mb.x + 19, mb.y + i, w, n / mmax, mix(CAT_COLOR.mcp, P.bg, 0.45), CAT_COLOR.mcp, P.panel)
    S.text(mb.x + mb.w - 5, mb.y + i, String(n).padStart(5), P.mid, { bg: P.panel })
  })
  if (!mcp.length) S.text(mb.x, mb.y, 'no MCP calls in this session', P.dim, { bg: P.panel })
  ry += mcpH
  // the times it waited for the person
  const waits = []
  let open
  for (const it of itemsOf(st.sessionId)) {
    if (it.kind === 'attention') open = it
    if (it.kind === 'attention-clear' && open) {
      waits.push({ a: open.attention, t: open.t, ms: it.ms ?? it.t - open.t })
      open = undefined
    }
  }
  if (open) waits.push({ a: open.attention, t: open.t, open: true })
  const wb = panel(S, rx, ry, rw, y1 - ry, 'WAITED FOR YOU', open ? P.warn : P.faint, { right: `${waits.length}` })
  waits.slice(-wb.h).forEach((w, i) => {
    const what = `${ATT_WORD[w.a?.kind] ?? 'input'}${w.a?.tool && w.a.kind === 'permission' ? ` · ${w.a.tool}` : ''}`
    const dur = w.open ? `waiting ${ago(now - w.t)}` : secs(w.ms)
    S.text(wb.x, wb.y + i, `${clock(w.t)}  ${fit(what, wb.w - 22)}`, w.open ? P.warn : P.mid, { bg: P.panel, bold: !!w.open })
    S.text(wb.x + wb.w - len(dur), wb.y + i, dur, w.open ? P.warn : P.dim, { bg: P.panel })
  })
  if (!waits.length) S.text(wb.x, wb.y, 'it has not waited for you', P.dim, { bg: P.panel })
}
