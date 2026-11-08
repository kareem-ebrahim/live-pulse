// Totals: everything Claude Code has used on this machine, across every
// project and session (not only the ones open now). The tokens and the money
// count up when the page opens; a core in the middle holds the total, each
// project orbits it with its share, and lines between them carry tokens in and
// cost out, faster for the projects that are busy now. Models, the token mix
// and the last 30 days sit around it.
import { P, ago, fit, kfmt as kfmt0, len, mix, usd } from '../common.mjs'
const kfmt = n => (n >= 1e9 ? (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B' : kfmt0(n))
import { ease, breathe, motion } from '../anim.mjs'
import { Braille, ride } from '../braille.mjs'
import { bigText } from '../pixels.mjs'
import { totals } from '../totals.mjs'
import { panel, smoothBar, stackChart } from './kit.mjs'

const PROJECT_COLORS = [P.coral, P.haiku, P.opus, P.router, P.sonnet, P.pink, P.peach, P.blue, P.green, P.cream]
const MODEL_COLORS = { opus: P.opus, sonnet: P.sonnet, haiku: P.haiku, fable: P.fable, mythos: P.fable }
const modelColor = name => MODEL_COLORS[name.split(' ')[0]] ?? P.mid
const tokensOf = b => b.in + b.out + b.read + b.write

let lastDraw = 0
let openedAt = 0

/**
 * A ring around (cx, cy) in fine braille: the track faint, the filled part in
 * colour shading brighter toward its end, and a spark running round it.
 */
function ringGauge(S, cx, cy, r, frac, color, t, o = {}) {
  const br = new Braille(S)
  const end = Math.PI * 2 * Math.max(0, Math.min(1, frac))
  br.ellipse(cx, cy, r * 2, r, mix(P.faint, P.bg, 0.1), { from: end, to: Math.PI * 2 })
  if (end > 0) br.ellipse(cx, cy, r * 2, r, color, { to: end, colorAt: u => mix(mix(color, P.bg, 0.45), color, u), weight: 2 })
  if (o.thick && end > 0) br.ellipse(cx, cy, r * 2 - 0.4, r - 0.2, color, { to: end, colorAt: u => mix(mix(color, P.bg, 0.55), color, u), weight: 2 })
  br.flush()
  if (end > 0) {
    const a = ((t * (o.speed ?? 1.2)) % 1) * end
    const x = Math.round(cx + Math.sin(a) * r * 2)
    const y = Math.round(cy - Math.cos(a) * r)
    S.set(x, y, '●', mix(color, P.text, 0.5), S.getBg(x, y), true)
  }
}

/** A fine line between two points with particles running both ways: tokens in, cost out. */
function twoWay(S, a, c, b, t, inColor, outColor, o = {}) {
  const br = new Braille(S)
  br.bezier(a, c, b, o.line ?? P.faint, { colorAt: u => mix(mix(o.line ?? P.faint, P.bg, 0.55), mix(o.line ?? P.faint, P.bg, 0.2), u) })
  br.flush()
  ride(S, a, c, b, inColor, t, { speed: o.speed ?? 8, gap: o.gap ?? 9, tail: 2 })
  ride(S, a, c, b, outColor, t + 0.37, { speed: (o.speed ?? 8) * 0.8, gap: (o.gap ?? 9) * 1.4, tail: 1, dir: -1, head: '◆' })
}

export function drawTotals(S, focus, y0, y1, t, now) {
  const W = S.w
  if (now - lastDraw > 800) openedAt = now // the page just came into view: count up again
  lastDraw = now
  const T = totals.T
  if (!T) {
    const [d, n] = totals.progress
    const msg = totals.error ? `could not read the transcripts: ${totals.error}` : `reading every Claude Code transcript on this machine… ${n ? `${d} of ${n} files` : ''}`
    S.text(Math.floor((W - len(msg)) / 2), Math.floor((y0 + y1) / 2), msg, P.mid, { bold: true })
    const bw = 40
    for (let i = 0; i < bw; i++) {
      const on = Math.abs(i - ((t * 30) % (bw + 10)) + 5) < 5
      S.set(Math.floor((W - bw) / 2) + i, Math.floor((y0 + y1) / 2) + 2, on ? '█' : '░', on ? P.router : P.faint)
    }
    return
  }
  const grow = motion.countUp ? ease.out(Math.min(1, (now - openedAt) / 1600)) : 1
  const all = T.all
  const allTok = tokensOf(all)

  // ── the hero strip: tokens and money, counting up ──
  const hero = panel(S, 1, y0, W - 2, 6, 'THIS MACHINE · ALL PROJECTS · ALL TIME', P.cream, { right: `${Object.keys(T.projects).length} projects · ${T.fileCount} transcripts · ${kfmt(all.msgs)} replies` })
  S.text(hero.x, hero.y, 'TOKENS', P.dim, { bold: true, bg: P.panel })
  const tw = bigText(S, hero.x, hero.y + 1, kfmt(allTok * grow), P.haiku, P.panel)
  S.text(hero.x + tw + 3, hero.y, 'SPENT (API PRICES)', P.dim, { bold: true, bg: P.panel })
  S.text(hero.x + tw + 3, hero.y + 2, '$', P.cream, { bold: true, bg: P.panel })
  const cw = bigText(S, hero.x + tw + 5, hero.y + 1, (all.cost * grow).toFixed(2), P.cream, P.panel)
  // today, this week, this month: each with its share of the total
  const day = k => {
    const d = new Date(now - k * 86400000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const sumDays = k => Array.from({ length: k }, (_, i) => T.days[day(i)]?.cost ?? 0).reduce((a, b) => a + b, 0)
  const today = sumDays(1)
  const week = sumDays(7)
  const month = sumDays(30)
  const avg7 = week / 7
  const stats = [
    ['TODAY', usd(today * grow), avg7 ? `${today >= avg7 ? '▲' : '▼'} ${Math.round(Math.abs(today / avg7 - 1) * 100)}% vs 7-day avg` : '', today >= avg7 ? P.warn : P.ok],
    ['LAST 7 DAYS', usd(week * grow), `${all.cost ? Math.round((week / all.cost) * 100) : 0}% of all`, P.mid],
    ['LAST 30 DAYS', usd(month * grow), `${all.cost ? Math.round((month / all.cost) * 100) : 0}% of all`, P.mid],
    ['CACHE HIT', `${allTok ? Math.round(((all.read / Math.max(1, all.in + all.read + all.write)) * 100 * grow)) : 0}%`, 'of input read from cache', P.router],
  ]
  let sx = hero.x + tw + cw + 12
  for (const [label, value, sub, sc] of stats) {
    const wcol = Math.max(len(label), len(value), len(sub)) + 3
    if (sx + wcol > hero.x + hero.w) break
    S.text(sx, hero.y, label, P.dim, { bold: true, bg: P.panel })
    S.text(sx, hero.y + 1, value, P.text, { bold: true, bg: P.panel })
    S.text(sx, hero.y + 2, sub, sc, { bg: P.panel })
    sx += wcol
  }
  S.text(hero.x, hero.y + 3, fit(`last reply ${ago(now - all.last)} ago · ${kfmt(all.in + all.read + all.write)} in · ${kfmt(all.out)} out · refreshed ${ago(now - T.at)} ago`, hero.w), P.dim, { bg: P.panel })

  // ── layout of the rest ──
  const midY = y0 + 6
  const chartH = Math.max(8, Math.min(13, Math.floor((y1 - midY) * 0.3)))
  const midH = y1 - midY - chartH
  const sideW = Math.max(30, Math.min(44, Math.floor(W * 0.22)))

  // ── left: models ──
  const models = Object.entries(T.models).sort((a, b) => b[1].cost - a[1].cost)
  const mb = panel(S, 1, midY, sideW, midH, 'MODELS', P.faint, { right: 'share of cost' })
  let my = mb.y
  for (const [name, b] of models) {
    if (my + 3 > mb.y + mb.h) break
    const share = all.cost ? b.cost / all.cost : 0
    const col = modelColor(name)
    S.text(mb.x, my, fit(name, mb.w - 10), col, { bold: true, bg: P.panel })
    const pct = `${(share * 100 * grow).toFixed(share < 0.1 ? 1 : 0)}%`
    S.text(mb.x + mb.w - len(pct), my, pct, P.text, { bold: true, bg: P.panel })
    smoothBar(S, mb.x, my + 1, mb.w, Math.max(share > 0 ? 0.01 : 0, share * grow), mix(col, P.bg, 0.4), col, P.panel, { shine: (t * 14) % (mb.w + 12) })
    S.text(mb.x, my + 2, fit(`${usd(b.cost)} · ${kfmt(tokensOf(b))} tokens · ${kfmt(b.msgs)} replies`, mb.w), P.dim, { bg: P.panel })
    my += 4
  }

  // ── right: the token mix ──
  const rx = W - 1 - sideW
  const rb = panel(S, rx, midY, sideW, midH, 'TOKEN MIX', P.faint, { right: 'share of tokens' })
  const kinds = [
    ['cache read', all.read, P.router, 'context re-read from cache'],
    ['cache write', all.write, P.peach, 'context written to cache'],
    ['output', all.out, P.coral, 'what Claude wrote'],
    ['input', all.in, P.blue, 'new input, uncached'],
  ]
  let ky = rb.y
  for (const [name, v, col, what] of kinds) {
    if (ky + 3 > rb.y + rb.h) break
    const share = allTok ? v / allTok : 0
    S.text(rb.x, ky, name.toUpperCase(), col, { bold: true, bg: P.panel })
    const pct = `${(share * 100 * grow).toFixed(share < 0.1 ? 2 : 1)}%`
    S.text(rb.x + rb.w - len(pct), ky, pct, P.text, { bold: true, bg: P.panel })
    // tiny shares still show a sliver
    smoothBar(S, rb.x, ky + 1, rb.w, Math.max(share > 0 ? 0.01 : 0, share * grow), mix(col, P.bg, 0.4), col, P.panel)
    S.text(rb.x, ky + 2, fit(`${kfmt(v)} · ${what}`, rb.w), P.dim, { bg: P.panel })
    ky += 4
  }
  // the cache-hit ring under the bars
  const ringR = Math.min(4, Math.floor((rb.y + rb.h - ky - 2) / 2))
  if (ringR >= 2) {
    const cx = rb.x + Math.floor(rb.w / 2)
    const cy = ky + ringR + 1
    const hit = all.read / Math.max(1, all.in + all.read + all.write)
    ringGauge(S, cx, cy, ringR, hit * grow, P.router, t)
    const s = `${Math.round(hit * 100 * grow)}%`
    S.text(cx - Math.floor(len(s) / 2), cy, s, P.router, { bold: true, bg: P.panel })
    S.text(cx - 4, cy + 1, 'cache hit', P.dim, { bg: P.panel })
  }

  // ── centre: the core and the projects around it ──
  const ax0 = 1 + sideW + 1
  const ax1 = rx - 1
  const cx = Math.round((ax0 + ax1) / 2)
  const cy = midY + Math.floor(midH / 2)
  const Ry = Math.max(4, Math.floor(midH / 2) - 3)
  const Rx = Math.max(16, Math.floor((ax1 - ax0) / 2) - 12)
  const projects = Object.entries(T.projects).sort((a, b) => b[1].cost - a[1].cost)
  const shown = projects.slice(0, Math.min(10, Math.max(4, Math.floor((Rx * 2 + Ry * 4) / 14))))
  const rest = projects.slice(shown.length)
  // two fine orbits, with a glow running round the outer one
  {
    const br = new Braille(S)
    const head = (t * 0.08) % 1
    br.ellipse(cx, cy, Rx, Ry, P.faint, {
      colorAt: u => {
        const d = Math.min(Math.abs(u - head), 1 - Math.abs(u - head))
        return mix(mix(P.faint, P.bg, 0.3), P.opus, Math.max(0, 1 - d * 9) * 0.9)
      },
    })
    br.ellipse(cx, cy, Rx * 0.62, Ry * 0.62, mix(P.faint, P.bg, 0.5), { dash: 0 })
    br.flush()
  }
  const nodes = shown.map(([name, b], i) => {
    const a = -Math.PI / 2 + (i / shown.length) * Math.PI * 2
    return { name, b, x: Math.round(cx + Math.cos(a) * Rx), y: Math.round(cy + Math.sin(a) * Ry), color: PROJECT_COLORS[i % PROJECT_COLORS.length], share: all.cost ? b.cost / all.cost : 0 }
  })
  // lines: tokens flow into the core, cost flows back out
  const coreR = Math.max(2, Math.min(4, Math.floor(Ry / 2)))
  for (const n of nodes) {
    const dx = n.x - cx
    const dy = n.y - cy
    const d = Math.hypot(dx / 2, dy) || 1
    const from = [Math.round(cx + (dx / d) * coreR * 1.15), Math.round(cy + (dy / d) * coreR * 0.6)]
    const mid = [Math.round((from[0] + n.x) / 2 - dy * 0.6), Math.round((from[1] + n.y) / 2 + dx * 0.08)]
    const busy = now - n.b.last < 120000
    twoWay(S, [n.x, n.y], mid, from, t, mix(P.haiku, P.text, busy ? 0.3 : 0), mix(P.cream, n.color, 0.4), { speed: busy ? 18 : 4 + n.share * 14, gap: busy ? 6 : 10, line: n.color })
  }
  // neighbours on the orbit pass a light between them
  for (let i = 0; i < nodes.length && nodes.length > 2; i++) {
    const a = nodes[i]
    const b = nodes[(i + 1) % nodes.length]
    const via = [(a.x + b.x) / 2 + (a.x + b.x - 2 * cx) * 0.12, (a.y + b.y) / 2 + (a.y + b.y - 2 * cy) * 0.12]
    ride(S, [a.x, a.y], via, [b.x, b.y], mix(a.color, P.bg, 0.2), t + i * 0.7, { speed: 5, n: 1, tail: 2, head: '•', glow: 0 })
  }
  // the core: the total, a ring of the last 30 days' share, breathing
  const b = breathe(t, 2)
  for (let yy = -coreR; yy <= coreR; yy++)
    for (let xx = -coreR * 2; xx <= coreR * 2; xx++) {
      const r = Math.hypot(xx / 2, yy)
      if (r <= coreR - 0.4) S.set(cx + xx, cy + yy, ' ', null, mix(P.bg, P.cream, 0.05 + 0.04 * b))
    }
  ringGauge(S, cx, cy, coreR + 0.6, all.cost ? (month / all.cost) * grow : 0, P.cream, t, { speed: 0.5, thick: true })
  const coreTxt = usd(all.cost * grow)
  const coreBg = mix(P.bg, P.cream, 0.05 + 0.04 * b)
  S.text(cx - Math.floor(len(coreTxt) / 2), cy - 1, coreTxt, P.cream, { bold: true, bg: coreBg })
  const coreSub = `${kfmt(allTok * grow)} tok`
  S.text(cx - Math.floor(len(coreSub) / 2), cy, coreSub, P.haiku, { bg: coreBg })
  if (coreR >= 3) S.text(cx - 3, cy + 1, '30d ring', P.dim, { bg: coreBg })
  // the project cards, on top of everything
  for (const n of nodes) {
    const pct = `${(n.share * 100 * grow).toFixed(n.share < 0.1 ? 1 : 0)}%`
    const name = fit(n.name, 18)
    const wcard = Math.max(len(name), 12) + 4
    const x = Math.max(ax0, Math.min(ax1 - wcard, n.x - Math.floor(wcard / 2)))
    const y = n.y - 1
    const busy = now - n.b.last < 120000
    const edge = busy ? mix(n.color, P.text, 0.3 * breathe(t, 5)) : n.color
    S.box(x, y, wcard, 4, busy ? 'bold' : 'round', edge, { fill: P.panel })
    S.text(x + 2, y + 1, name, n.color, { bold: true, bg: P.panel })
    S.text(x + 2, y + 2, usd(n.b.cost), P.cream, { bg: P.panel })
    S.text(x + wcard - 2 - len(pct), y + 2, pct, P.text, { bold: true, bg: P.panel })
    // a share bar along the bottom edge
    const fw = Math.round(n.share * grow * (wcard - 2))
    for (let i = 0; i < wcard - 2; i++) if (i < fw) S.set(x + 1 + i, y + 3, '━', n.color, P.panel, true)
    if (busy) S.text(x + wcard - 3, y + 1, '●', mix(n.color, P.text, breathe(t, 6)), { bg: P.panel })
  }
  if (rest.length) {
    const s = `+${rest.length} more · ${usd(rest.reduce((a, [, v]) => a + v.cost, 0))}`
    S.text(cx - Math.floor(len(s) / 2), midY + midH - 1, s, P.dim)
  }
  const legend = [['●', P.haiku, ' tokens in  '], ['◆', P.cream, ' cost out  '], ['━', P.mid, ' share of all']]
  let lx = ax0 + 1
  for (const [g, c, w] of legend) {
    S.text(lx, midY, g, c, { bold: true })
    S.text(lx + 1, midY, w, P.dim)
    lx += len(w) + 1
  }

  // ── bottom: the last 30 days ──
  const cb = panel(S, 1, y1 - chartH, W - 2, chartH, 'LAST 30 DAYS', P.faint, { right: 'cost per day · each model its colour' })
  const days = Array.from({ length: 30 }, (_, i) => day(29 - i))
  const colW = Math.max(1, Math.floor((cb.w - 8) / 30))
  const width = colW * 30
  // per-day cost by model is not kept, so split each day by the models' overall shares
  const series = models.slice(0, 5).map(([name, mb2]) => ({
    color: modelColor(name),
    values: Array.from({ length: width }, (_, x) => {
      const d = T.days[days[Math.floor(x / colW)]]
      if (!d || (x % colW === colW - 1 && colW > 1)) return 0
      const cutoff = Math.floor(grow * width)
      return x <= cutoff ? d.cost * (all.cost ? mb2.cost / all.cost : 0) : 0
    }),
  }))
  const max = stackChart(S, cb.x + 7, cb.y, width, cb.h - 1, series)
  S.text(cb.x, cb.y, usd(max).padStart(6), P.dim, { bg: P.panel })
  S.text(cb.x + 2, cb.y + cb.h - 2, '$0', P.dim, { bg: P.panel })
  for (let i = 0; i < 30; i += 5) S.text(cb.x + 7 + i * colW, cb.y + cb.h - 1, days[i].slice(5), P.dim, { bg: P.panel })
  S.text(cb.x + 7 + width - 5, cb.y + cb.h - 1, 'today', P.router, { bg: P.panel, bold: true })
}
