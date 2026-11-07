// One creature per session, side by side. Each orbit is that session's
// context window; wires join neighbours and carry sparks when a session acts;
// a red arc joins two sessions editing the same file; a beam crosses when one
// session messages another.
import { P, SPIN, clamp, fit, fitTail, kfmt, len, mix, projectName, usd } from '../common.mjs'
import { accentOf, conflicts, ctxPct, lastEventAt, messages, stateOf, store, visibleBg } from '../data.mjs'
import { creature } from '../pixels.mjs'
import { Wires, curve, sparks } from '../wires.mjs'

const STATE_WORD = { working: 'WORKING', idle: 'IDLE', ended: 'ENDED', silent: 'NO SIGNAL' }
const STATE_COLOR = { working: P.router, idle: P.mid, ended: P.dim, silent: P.warn }

/** Draws the row; returns each shown session's slot, keyed by session id. */
export function drawConstellation(S, x, y, w, h, t, now, focusId) {
  const slots = new Map()
  const all = store.sessions
  if (!all.length) {
    const cols = 30
    creature(S, x + Math.floor((w - cols) / 2), y, cols, h - 3, t, { tint: P.dim, busy: false, dim: true, ctx: 0 })
    const a = 'no Claude Code session is running'
    const b = 'start `claude` in any project folder and it appears here'
    S.text(x + Math.floor((w - len(a)) / 2), y + h - 2, a, P.mid, { bold: true })
    S.text(x + Math.floor((w - len(b)) / 2), y + h - 1, b, P.dim)
    return slots
  }
  const fits = Math.max(1, Math.floor(w / 24))
  const shown = all.slice(0, fits)
  const n = shown.length
  const slotW = Math.min(46, Math.floor(w / n))
  const x0 = x + Math.floor((w - slotW * n) / 2)
  const cRows = h - 4
  const wires = new Wires()
  const flows = []
  const geo = []

  shown.forEach((st, i) => {
    const sx = x0 + i * slotW
    const sid = st.sessionId
    const ac = accentOf(sid)
    const state = stateOf(st, now)
    const busy = state === 'working'
    const isF = sid === focusId
    const pct = ctxPct(st)
    const ringColor = pct >= 85 ? P.err : pct >= 65 ? P.warn : P.haiku
    if (isF) S.box(sx, y - 1, slotW - 1, h + 1, 'round', ac, { fill: P.sel })
    const bg = isF ? P.sel : P.bg
    const cols = Math.min(slotW - 4, 34)
    const running = (st.agents || []).filter(a => a.status === 'running').length
    const bgRunning = visibleBg(st, now).filter(b => b.status === 'running' && b.kind !== 'agent').length
    const g = creature(S, sx + Math.floor((slotW - 1 - cols) / 2), y, cols, cRows, t, {
      tint: ac,
      busy,
      dim: state === 'ended' || state === 'silent',
      ctx: pct / 100,
      ringColor,
      satellites: running + bgRunning,
      satelliteColor: P.haiku,
      phase: i * 1.7,
      bg,
    })
    geo.push({ sid, g, busy, ac })
    slots.set(sid, { x: sx, w: slotW - 1, cx: sx + Math.floor((slotW - 1) / 2), bottom: y + h - 1 })

    // the three lines under it
    const tx = sx + 2
    const tw = slotW - 5
    const sw = STATE_WORD[state] + (busy ? ' ' + SPIN[Math.floor(t * 12 + i) % 10] : '')
    S.segs(tx, y + cRows, [['● ', ac, true, bg], [fit(projectName(st.cwd), tw - len(sw) - 3), isF ? P.cream : P.text, true, bg]])
    S.text(tx + tw - len(sw), y + cRows, sw, STATE_COLOR[state] ?? P.mid, { bold: true, bg })
    const cost = st.costUsd ? ` · ${usd(st.costUsd)}` : ''
    const ctxTxt = (st.ctxWindow ? `${pct}% · ${kfmt(st.context)}` : st.context ? kfmt(st.context) : '—') + cost
    const cells = clamp(tw - len(ctxTxt) - 5, 4, 12)
    S.text(tx, y + cRows + 1, 'ctx ', P.dim, { bg })
    for (let k = 0; k < cells; k++) S.set(tx + 4 + k, y + cRows + 1, k < Math.round((pct / 100) * cells) ? '▰' : '▱', k < Math.round((pct / 100) * cells) ? ringColor : P.faint, bg)
    S.text(tx + 5 + cells, y + cRows + 1, ctxTxt, P.text, { bold: true, bg })
    const editing = (st.files || []).find(f => f.active)
    const runTool = [...(st.tools || [])].reverse().find(r => r.ms === undefined)
    const line3 = st.waiting
      ? [['◷ ', P.warn, true, bg], [fitTail(`${st.waiting.file} · ${st.waiting.owner} has it`, tw - 2), P.warn, true, bg]]
      : editing
      ? [['✎ ', P.coral, true, bg], [fitTail(editing.path, tw - 2), P.coral, false, bg]]
      : runTool
        ? [[SPIN[Math.floor(t * 12) % 10] + ' ', P.peach, true, bg], [fit(`${runTool.tool} · ${runTool.label || ''}`, tw - 2), P.text, false, bg]]
        : [[fit(`turn ${st.turns} · ${st.toolCount} tools${running ? ` · ${running} agents` : ''}${bgRunning ? ` · ${bgRunning} bg` : ''}`, tw), P.dim, false, bg]]
    S.segs(tx, y + cRows + 2, line3)
    S.hit(sx, y - 1, slotW - 1, h + 1, { onClick: () => (store.pinned = sid) })
  })

  // neighbours joined; a spark leaves a creature whenever its session acts
  for (let i = 0; i < geo.length - 1; i++) {
    const a = geo[i]
    const b = geo[i + 1]
    const cells = wires.path([[a.g.right[0] + 1, a.g.cy], [b.g.left[0] - 1, b.g.cy]], mix(P.faint, P.mid, a.busy || b.busy ? 0.4 : 0), true)
    const fa = now - lastEventAt(store.sessions.find(s => s.sessionId === a.sid)) < 1500
    const fb = now - lastEventAt(store.sessions.find(s => s.sessionId === b.sid)) < 1500
    if (fa || a.busy) flows.push([cells, a.ac, { speed: fa ? 30 : 12, tail: 3, gap: fa ? 4 : 18 }])
    if (fb || b.busy) flows.push([cells, b.ac, { speed: fb ? 30 : 12, tail: 3, gap: fb ? 4 : 18, dir: -1 }])
  }
  wires.draw(S)
  for (const [cells, color, o] of flows) sparks(S, cells, t, color, o)

  // two sessions editing the same file: a red arc over both
  for (const c of conflicts(now)) {
    const a = geo.find(g => g.sid === c.a)
    const b = geo.find(g => g.sid === c.b)
    if (!a || !b) continue
    const pulse = 0.5 + 0.5 * Math.sin(t * 6)
    const color = mix(P.err, P.warn, pulse * 0.3)
    curve(S, [a.g.cx, y], [Math.round((a.g.cx + b.g.cx) / 2), y - 3], [b.g.cx, y], color, t, { spark: P.err, speed: 20, end: false, fade: 0.1 })
    const sa = store.sessions.find(s => s.sessionId === c.a)
    const sb = store.sessions.find(s => s.sessionId === c.b)
    const waiter = sa?.waiting ? sa : sb?.waiting ? sb : undefined
    const label = waiter
      ? ` ◷ ${projectName(waiter.cwd)} waits for ${waiter.waiting.owner} · ${fitTail(c.path, 30)} `
      : ` ⚠ both editing ${fitTail(c.path, 40)} `
    S.text(Math.round((a.g.cx + b.g.cx) / 2) - Math.floor(len(label) / 2), y - 1, label, P.err, { bold: true, bg: P.bg })
  }

  // a session messaging another: a bright beam between their creatures
  for (const m of messages(now)) {
    const a = geo.find(g => g.sid === m.from)
    if (!a) continue
    const b = m.to ? geo.find(g => g.sid === m.to) : undefined
    const end = b ? [b.g.cx, b.g.cy + 1] : [x + w - 2, a.g.cy]
    curve(S, [a.g.cx, a.g.cy + 1], [Math.round((a.g.cx + end[0]) / 2), y + cRows + 1], end, P.cream, t, { spark: P.text, speed: 40, n: 3, gap: 6, fade: 0.2 })
    if (!b) S.text(x + w - 2 - len(`→ ${m.label}`), a.g.cy - 1, `→ ${m.label}`, P.cream, { bold: true })
  }

  if (all.length > shown.length) S.text(x + w - 14, y + h - 1, `+${all.length - shown.length} more`, P.warn, { bold: true })
  return slots
}
