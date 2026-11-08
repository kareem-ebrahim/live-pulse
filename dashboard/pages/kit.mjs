// Small pieces the pages share: panels with titles, smooth bars and gauges,
// stacked charts, session lookups, the session a waiting one waits for.
import { P, fit, len, mix, projectName } from '../common.mjs'
import { accentOf, store } from '../data.mjs'

/**
 * A panel: a rounded frame whose top edge glows in the accent colour at the
 * title and fades along, a title chip with an accent mark, a note on the
 * right. Returns the inner rect.
 */
export function panel(S, x, y, w, h, title, color = P.faint, o = {}) {
  const fill = o.fill ?? P.panel
  const accent = o.accent ?? (color === P.faint ? P.opus : color)
  const edge = color === P.faint ? mix(P.faint, P.mid, 0.12) : color
  S.box(x, y, w, h, 'round', mix(edge, fill, 0.35), { fill })
  for (let i = 1; i < w - 1; i++) {
    const u = i / (w - 1)
    S.set(x + i, y, '─', mix(mix(accent, edge, Math.min(1, u * 1.6)), fill, 0.15 + u * 0.4), fill)
  }
  S.set(x, y, '╭', mix(accent, fill, 0.2), fill)
  if (title) {
    // a chip: the title on a wash of the accent, with a bright dot
    const chip = mix(fill, accent, 0.2)
    S.text(x + 2, y, ' ● ', accent, { bold: true, bg: chip })
    S.text(x + 5, y, `${title} `, o.titleColor ?? P.text, { bold: true, bg: chip })
  }
  if (o.right) S.text(x + w - 2 - len(o.right) - 1, y, ` ${o.right} `, o.rightColor ?? P.dim, { bg: fill })
  return { x: x + 2, y: y + 1, w: w - 4, h: h - 2 }
}

const EIGHTH = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
/**
 * A smooth bar: filled to `frac` in eighths of a cell, the fill shading from
 * `c1` to `c2` along its length, over a dim track of the same hue.
 */
export function smoothBar(S, x, y, w, frac, c1, c2 = c1, bg = P.panel, o = {}) {
  const f = Math.max(0, Math.min(1, frac)) * w
  const full = Math.floor(f)
  const part = Math.round((f - full) * 8)
  const track = o.track ?? mix(bg, c1, 0.12)
  for (let i = 0; i < w; i++) {
    const col = mix(c1, c2, w > 1 ? i / (w - 1) : 0)
    const shine = o.shine !== undefined && i < full && Math.abs(i - o.shine) < 1.5 ? 0.35 : 0
    if (i < full) S.set(x + i, y, '█', mix(col, P.text, shine), track)
    else if (i === full && part > 0) S.set(x + i, y, EIGHTH[part], col, track)
    else S.set(x + i, y, ' ', null, track)
  }
  return full
}

export const nameOf = st => (st?.cwd ? projectName(st.cwd) : st?.sessionId?.slice(0, 8) ?? '')
export const sessionById = sid => store.sessions.find(s => s.sessionId === sid)

/** The session a waiting session waits for (its lease holder), when it is one on screen. */
export function holderOf(st) {
  const w = st?.waiting
  if (!w) return undefined
  const o = String(w.owner || '').toLowerCase()
  return store.sessions.find(s => s.sessionId !== st.sessionId && (s.sessionId.startsWith(o) || nameOf(s).toLowerCase() === o))
}

/** A short label for a time span. */
export function spanLabel(ms) {
  const m = Math.round(ms / 60000)
  if (m < 1) return `${Math.round(ms / 1000)}s`
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`
}

/** A dot and name in a session's colour. */
export function sessionTag(S, x, y, st, w, o = {}) {
  const ac = accentOf(st.sessionId)
  S.text(x, y, '●', ac, { bg: o.bg })
  S.text(x + 2, y, fit(nameOf(st), w - 2), o.dim ? mix(ac, P.bg, 0.4) : ac, { bold: true, bg: o.bg })
}

/** An empty page's message, centred. */
export function emptyNote(S, y0, y1, a, b) {
  const y = Math.floor((y0 + y1) / 2) - 1
  S.text(Math.floor((S.w - len(a)) / 2), y, a, P.mid, { bold: true })
  if (b) S.text(Math.floor((S.w - len(b)) / 2), y + 1, b, P.dim)
}

/** A horizontal gauge with its label inside, coloured by how full it is. */
export function gauge(S, x, y, w, frac, label, o = {}) {
  const f = Math.max(0, Math.min(1, frac))
  const color = o.color ?? (f >= 0.85 ? P.err : f >= 0.6 ? P.warn : P.router)
  const c1 = mix(color, P.bg, 0.3)
  smoothBar(S, x, y, w, f, c1, color, o.bg ?? P.panel)
  const fill = f * w
  ;[...` ${label}`].slice(0, w).forEach((c, i) => {
    const on = i + 1 <= fill
    S.set(x + i, y, c, on ? P.bg : P.text, on ? mix(c1, color, i / Math.max(1, w - 1)) : null, true)
  })
}

const EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
/**
 * Stacked columns: `series` is [{ color, values }] with one value per column;
 * each column stacks the series bottom-up, in eighths of a cell, over faint
 * guide lines; the top of each column is lit a little.
 */
export function stackChart(S, x, y, w, h, series, bg = P.panel) {
  const totals = Array.from({ length: w }, (_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0))
  const max = Math.max(1e-9, ...totals)
  for (const q of [0.25, 0.5, 0.75]) {
    const yy = y + h - 1 - Math.floor(q * h)
    for (let i = 0; i < w; i += 2) S.set(x + i, yy, '·', mix(P.faint, bg, 0.3), bg)
  }
  for (let i = 0; i < w; i++) {
    const scale = (h * 8) / max
    let acc = 0
    const bands = series.map(s => {
      const a = acc
      acc += (s.values[i] ?? 0) * scale
      return { a, b: acc, color: s.color }
    })
    for (let r = 0; r < h; r++) {
      const lo = r * 8
      const hi = lo + 8
      const yy = y + h - 1 - r
      if (acc <= lo) {
        if (r === 0) S.set(x + i, yy, '▁', mix(P.faint, bg, 0.2), bg)
        continue
      }
      const mid = Math.min(acc, hi) - 0.01
      const band = bands.find(b => mid >= b.a && mid < b.b) ?? bands[bands.length - 1]
      const fill = Math.round(Math.min(8, acc - lo))
      const top = acc <= hi
      S.set(x + i, yy, EIGHTHS[Math.max(1, fill)], top ? mix(band.color, P.text, 0.25) : band.color, bg)
    }
  }
  return max
}

/** A thin bar: a bright line for the filled part over a faint one, half cells included. */
export function thinBar(S, x, y, w, frac, c1, c2 = c1, bg = P.panel) {
  const f = Math.max(0, Math.min(1, frac)) * w
  for (let i = 0; i < w; i++) {
    const col = mix(c1, c2, w > 1 ? i / (w - 1) : 0)
    if (i + 1 <= f) S.set(x + i, y, '━', col, bg, true)
    else if (i + 0.5 <= f) S.set(x + i, y, '╸', col, bg, true)
    else S.set(x + i, y, '─', mix(P.faint, bg, 0.35), bg)
  }
}
