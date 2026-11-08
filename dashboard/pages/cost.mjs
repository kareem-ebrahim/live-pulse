// Cost: what the sessions spend and how fast. The total in big digits, the
// pace per minute and per hour, each session's cost with an hour of history,
// tokens split into input / output / cache read / cache write with the cache
// hit rate, the plan limits with a projection of when the 5-hour one runs out
// at this pace, the cost of each recent turn, and a warning when a session has
// sat idle long enough for its prompt cache to go cold.
import { P, ago, fit, kfmt, len, limitName, mix, resetIn, usd } from '../common.mjs'
import { accentOf, lastEventAt, liveSessions, planLimits, store, totalCost } from '../data.mjs'
import { roll } from '../anim.mjs'
import { bigText } from '../pixels.mjs'
import { sparkline } from '../screen.mjs'
import { emptyNote, gauge, nameOf, panel, smoothBar, stackChart } from './kit.mjs'

const CACHE_TTL = 5 * 60000
// the dashboard's own record of the plan limits, for the pace
const limitLog = [] // { t, pct }
function noteLimit(now) {
  const five = planLimits().find(l => l.kind === 'five_hour')
  if (!five) return undefined
  const last = limitLog[limitLog.length - 1]
  if (!last || now - last.t > 20000) limitLog.push({ t: now, pct: five.percentUsed })
  while (limitLog.length && now - limitLog[0].t > 3600000) limitLog.shift()
  return five
}
/** Percent of the 5-hour window used per minute, over the last half hour. */
function pace(now) {
  const recent = limitLog.filter(l => now - l.t < 30 * 60000)
  if (recent.length < 2) return undefined
  const a = recent[0]
  const b = recent[recent.length - 1]
  if (b.pct < a.pct) return undefined // the window reset
  const mins = (b.t - a.t) / 60000
  return mins >= 2 ? (b.pct - a.pct) / mins : undefined
}

/** Cost per minute over the last ten minutes, from every session's samples. */
function costRate(sessions, now) {
  let d = 0
  for (const st of sessions) {
    const h = (st.history || []).filter(x => now - x.t < 10 * 60000)
    if (h.length >= 2) d += Math.max(0, (st.costUsd || h[h.length - 1].cost) - h[0].cost)
  }
  return d / 10
}

function deltas(history, key, n) {
  const out = []
  for (let i = 1; i < history.length; i++) out.push(Math.max(0, history[i][key] - history[i - 1][key]))
  return out.slice(-n)
}

export function drawCost(S, focus, y0, y1, t, now) {
  const W = S.w
  const sessions = liveSessions(now).length ? liveSessions(now) : store.sessions
  if (!sessions.length) return emptyNote(S, y0, y1, 'nothing spent yet', 'the cost of every live session shows here as it grows')
  const five = noteLimit(now)

  // ── top: the total and the pace ──
  const total = roll('cost:total', totalCost(sessions))
  const top = panel(S, 1, y0, W - 2, 7, 'SPENT', P.cream, { right: `${sessions.length} live session${sessions.length === 1 ? '' : 's'}` })
  S.text(top.x, top.y + 1, '$', P.cream, { bold: true, bg: P.panel })
  const bw = 2 + bigText(S, top.x + 2, top.y + 1, usd(total).slice(1), P.cream, P.panel)
  const perMin = costRate(sessions, now)
  let x = top.x + bw + 5
  const stat = (label, value, color) => {
    S.text(x, top.y + 1, label, P.dim, { bg: P.panel })
    S.text(x, top.y + 2, value, color, { bold: true, bg: P.panel })
    x += Math.max(len(label), len(value)) + 4
  }
  stat('PER MINUTE', perMin ? usd(perMin) : '—', P.peach)
  stat('PER HOUR AT THIS PACE', perMin ? usd(perMin * 60) : '—', P.peach)
  const tok = sessions.reduce((a, s) => ({ in: a.in + (s.inTok || 0), out: a.out + (s.outTok || 0), cr: a.cr + (s.cacheRead || 0), cw: a.cw + (s.cacheWrite || 0) }), { in: 0, out: 0, cr: 0, cw: 0 })
  const allIn = tok.in + tok.cr + tok.cw
  stat('TOKENS IN / OUT', `${kfmt(allIn)} / ${kfmt(tok.out)}`, P.haiku)
  stat('CACHE HIT', allIn ? `${Math.round((tok.cr / allIn) * 100)}%` : '—', P.router)
  // the pace of every session together, last 10 minutes
  const sum = []
  for (const st of sessions) deltas(st.history || [], 'cost', 60).forEach((v, i, arr) => (sum[60 - arr.length + i] = (sum[60 - arr.length + i] ?? 0) + v))
  S.text(top.x + bw + 5, top.y + 4, 'last 10 min', P.dim, { bg: P.panel })
  sparkline(S, top.x + bw + 17, top.y + 4, Math.min(60, top.w - bw - 20), Array.from({ length: 60 }, (_, i) => (sum[i] ?? 0) * 1e4), P.cream, P.panel)

  // ── left: per session ──
  const midY = y0 + 7
  const leftW = Math.round((W - 3) * 0.55)
  const bottomH = Math.max(9, Math.floor((y1 - midY) * 0.4))
  const topH = y1 - midY - bottomH
  const lb = panel(S, 1, midY, leftW, topH, 'PER SESSION', P.faint, { right: 'cost · trend · tokens' })
  const maxCost = Math.max(0.01, ...sessions.map(s => s.costUsd || 0))
  let y = lb.y
  for (const st of sessions) {
    if (y + 4 > lb.y + lb.h) break
    const ac = accentOf(st.sessionId)
    const isF = st.sessionId === focus.sessionId
    const bg = isF ? P.sel : P.panel
    S.rect(lb.x - 1, y, lb.w + 2, 4, bg)
    S.text(lb.x, y, '●', ac, { bg })
    S.text(lb.x + 2, y, fit(nameOf(st), 22), ac, { bold: true, bg })
    const c = roll(`cost:${st.sessionId}`, st.costUsd || 0)
    const cw = Math.max(10, lb.w - 40)
    const fill = Math.round((c / maxCost) * cw)
    void fill
    smoothBar(S, lb.x + 25, y, cw, c / maxCost, mix(ac, P.bg, 0.45), ac, bg, { shine: (t * 12) % (cw + 10) })
    S.text(lb.x + 26 + cw, y, usd(c).padStart(8), P.cream, { bold: true, bg })
    // an hour of cost, ten seconds a cell
    S.text(lb.x + 2, y + 1, 'trend', P.dim, { bg })
    sparkline(S, lb.x + 25, y + 1, cw, deltas(st.history || [], 'cost', cw).map(v => v * 1e4), mix(ac, P.cream, 0.3), bg)
    // tokens, stacked
    const parts = [
      ['in', st.inTok || 0, P.blue],
      ['out', st.outTok || 0, P.coral],
      ['cache read', st.cacheRead || 0, P.router],
      ['cache write', st.cacheWrite || 0, P.peach],
    ]
    const sumT = Math.max(1, parts.reduce((n, p) => n + p[1], 0))
    let px = lb.x + 25
    for (const [, v, col] of parts) {
      const w = Math.round((v / sumT) * cw)
      for (let i = 0; i < w && px < lb.x + 25 + cw; i++) S.set(px++, y + 2, '▬', col, bg)
    }
    S.text(lb.x + 2, y + 2, 'tokens', P.dim, { bg })
    const legend = parts.map(([n, v]) => `${n} ${kfmt(v)}`).join(' · ')
    S.text(lb.x + 2, y + 3, fit(legend, lb.w - 4), P.mid, { bg })
    // a cold cache: the next turn re-reads the whole context at full price
    const idle = now - Math.max(lastEventAt(st), st.updatedAt && st.phase !== 'idle' ? st.updatedAt : 0)
    if (st.phase === 'idle' && idle > CACHE_TTL && st.context > 20000) {
      const warn = `cache likely cold (idle ${ago(idle)}): next turn re-reads ~${kfmt(st.context)} tokens`
      S.text(lb.x + lb.w - Math.min(lb.w - 30, len(warn)), y + 1, fit(warn, lb.w - 30), P.warn, { bg })
    }
    S.hit(lb.x - 1, y, lb.w + 2, 4, { onClick: () => (store.pinned = st.sessionId) })
    y += 5
  }

  // the bottom band, full width: an hour of spend, every session stacked
  const cbox = panel(S, 1, midY + topH, W - 2, bottomH, 'SPEND PER MINUTE · LAST HOUR', P.cream, { right: 'every session stacked in its colour' })
  const chartH = cbox.h - 1
  y = cbox.y - 1
  {
    const lbx = cbox.x
    const cw = cbox.w - 9
    const lb = { x: lbx }
    const series = sessions.map(st => {
      const h = st.history || []
      const values = new Array(cw).fill(0)
      for (let i = 1; i < h.length; i++) {
        const age = now - h[i].t
        if (age > 3600000) continue
        const col = cw - 1 - Math.floor((age / 3600000) * cw)
        values[Math.max(0, col)] += Math.max(0, h[i].cost - h[i - 1].cost)
      }
      // a column between two samples borrows from its neighbours, so the chart has no holes
      for (let i = 1; i < cw - 1; i++) if (!values[i] && values[i - 1] && values[i + 1]) values[i] = (values[i - 1] + values[i + 1]) / 2
      return { color: accentOf(st.sessionId), values }
    })
    const max = stackChart(S, lb.x + 8, y + 1, cw, chartH, series)
    const perCol = 60 / cw
    S.text(lb.x, y + 1, usd(max / perCol).padStart(6), P.dim, { bg: P.panel })
    S.text(lb.x + 2, y + 1 + chartH - 1, '$0/m', P.dim, { bg: P.panel })
    S.text(lb.x + 8, y + 1 + chartH, '−60m', P.dim, { bg: P.panel })
    S.text(lb.x + 8 + Math.floor(cw / 2) - 2, y + 1 + chartH, '−30m', P.dim, { bg: P.panel })
    S.text(lb.x + 8 + cw - 3, y + 1 + chartH, 'now', P.router, { bg: P.panel })
  }

  // ── right: plan limits and the turns of the selected session ──
  const rx = 1 + leftW + 1
  const rw = W - rx - 1
  const lims = planLimits()
  const limH = Math.min(topH - 4, Math.max(6, 3 + lims.length * 3))
  const rb = panel(S, rx, midY, rw, limH, 'PLAN LIMITS', five && five.percentUsed >= 60 ? P.warn : P.faint)
  let ry = rb.y
  if (!lims.length) S.text(rb.x, ry, 'the plan limits appear after the first reply', P.dim, { bg: P.panel })
  for (const l of lims) {
    const pct = Math.round(l.percentUsed)
    gauge(S, rb.x, ry, rb.w - 14, l.percentUsed / 100, `${limitName(l.kind)} ${pct}%`)
    S.text(rb.x + rb.w - 12, ry, `resets ${resetIn(l.resetsAt, now)}`.padStart(12), P.dim, { bg: P.panel })
    if (l.kind === 'five_hour') {
      const p = pace(now)
      let msg = 'measuring the pace…'
      let col = P.dim
      if (p !== undefined) {
        if (p <= 0.001) msg = 'not moving right now'
        else {
          const mins = (100 - l.percentUsed) / p
          const reset = l.resetsAt ? (new Date(l.resetsAt).getTime() - now) / 60000 : Infinity
          const at = mins >= 60 ? `${Math.floor(mins / 60)}h${String(Math.round(mins % 60)).padStart(2, '0')}m` : `${Math.round(mins)}m`
          msg = mins < reset ? `at this pace the limit is reached in ${at}` : `at this pace it resets before the limit`
          col = mins < reset ? (mins < 60 ? P.err : P.warn) : P.router
        }
      }
      S.text(rb.x + 1, ry + 1, fit(msg, rb.w - 2), col, { bg: P.panel, bold: col !== P.dim })
    }
    ry += 3
  }

  const tb = panel(S, rx, midY + limH, rw, topH - limH, `TURNS · ${nameOf(focus) || '—'}`, P.faint, { right: 'cost per turn' })
  const turns = (focus.turnLog || []).filter(x => x.end).slice(-Math.max(1, tb.h - 1))
  const maxT = Math.max(0.001, ...turns.map(x => x.cost || 0))
  let ty = tb.y
  if (!turns.length) S.text(tb.x, ty, 'no finished turn yet', P.dim, { bg: P.panel })
  for (const turn of turns.slice(-(tb.h - 1))) {
    const bw2 = Math.max(6, tb.w - 30)
    const f = Math.round(((turn.cost || 0) / maxT) * bw2)
    S.text(tb.x, ty, `#${turn.n}`.padStart(4), P.opus, { bg: P.panel })
    void f
    const tc = turn.aborted ? P.warn : accentOf(focus.sessionId)
    smoothBar(S, tb.x + 5, ty, bw2, (turn.cost || 0) / maxT, mix(tc, P.bg, 0.5), tc, P.panel)
    S.text(tb.x + 6 + bw2, ty, `${usd(turn.cost || 0)} · ${kfmt(turn.outTok)} out`.padEnd(22), P.mid, { bg: P.panel })
    ty++
  }
  void x
}
