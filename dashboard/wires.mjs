// Wires that join into ┬ ┴ ├ ┤ ┼ where they meet, sparks that run along
// them in either direction, and dotted curves.
import { P, mix } from './common.mjs'
import { Braille } from './braille.mjs'

const U = 1
const D = 2
const L = 4
const R = 8
const GLYPH = {
  [U | D]: '│',
  [L | R]: '─',
  [D | R]: '╭',
  [D | L]: '╮',
  [U | R]: '╰',
  [U | L]: '╯',
  [U | D | R]: '├',
  [U | D | L]: '┤',
  [D | L | R]: '┬',
  [U | L | R]: '┴',
  [U | D | L | R]: '┼',
  [U]: '│',
  [D]: '│',
  [L]: '─',
  [R]: '─',
}
const lum = c => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)

export class Wires {
  constructor() {
    this.cells = new Map()
  }
  path(points, color, dashed = false) {
    const seq = []
    for (let k = 0; k < points.length - 1; k++) {
      let [x, y] = points[k]
      const [x2, y2] = points[k + 1]
      const dx = Math.sign(x2 - x)
      const dy = Math.sign(y2 - y)
      while (x !== x2 || y !== y2) {
        const last = seq[seq.length - 1]
        if (!last || last[0] !== x || last[1] !== y) seq.push([x, y])
        x += dx
        y += dy
      }
      seq.push([x, y])
    }
    const out = []
    for (const p of seq) {
      const last = out[out.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
    }
    out.forEach(([x, y], i) => {
      let m = 0
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= out.length) continue
        const [ox, oy] = out[j]
        if (ox < x) m |= L
        if (ox > x) m |= R
        if (oy < y) m |= U
        if (oy > y) m |= D
      }
      const key = x + ',' + y
      const cur = this.cells.get(key)
      this.cells.set(key, {
        x,
        y,
        m: (cur?.m ?? 0) | m,
        color: cur && lum(cur.color) > lum(color) ? cur.color : color,
        dashed: cur ? cur.dashed && dashed : dashed,
      })
    })
    return out
  }
  draw(S) {
    for (const c of this.cells.values()) {
      let g = GLYPH[c.m] || '·'
      if (c.dashed) g = g === '─' ? '╌' : g === '│' ? '╎' : g
      S.set(c.x, c.y, g, c.color, S.getBg(c.x, c.y))
    }
  }
}

/** Sparks along a wire's cells; `dir` -1 runs from the last cell to the first. */
export function sparks(S, cells, t, color, o = {}) {
  if (!cells || cells.length < 2) return
  const speed = o.speed ?? 22
  const n = o.n ?? 1
  const tail = o.tail ?? 4
  const loop = cells.length + (o.gap ?? 8)
  for (let k = 0; k < n; k++) {
    const head = Math.floor(t * speed + (k * loop) / n) % loop
    for (let j = 0; j <= tail; j++) {
      let idx = head - j
      if (idx < 0 || idx >= cells.length) continue
      if (o.dir === -1) idx = cells.length - 1 - idx
      const [x, y] = cells[idx]
      const bg = S.getBg(x, y)
      S.set(x, y, j === 0 ? '●' : j === 1 ? '•' : '·', mix(color, bg, j / (tail + 1)), bg, j === 0)
    }
  }
}

/** The cells of a quadratic curve a → b bending toward c. */
export function curveCells(a, c, b) {
  const pts = []
  for (let i = 0; i <= 200; i++) {
    const u = i / 200
    const x = Math.round((1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0])
    const y = Math.round((1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1])
    const last = pts[pts.length - 1]
    if (!last || last[0] !== x || last[1] !== y) pts.push([x, y])
  }
  return pts
}

/** A dotted curve with sparks riding it. */
export function curve(S, a, c, b, color, t, o = {}) {
  const pts = curveCells(a, c, b)
  const br = new Braille(S)
  br.bezier(a, c, b, mix(color, P.bg, o.fade ?? 0.35))
  br.flush()
  if (o.end !== false) S.set(b[0], b[1], '●', color, S.getBg(b[0], b[1]), true)
  sparks(S, pts, t, o.spark ?? P.cream, { speed: o.speed ?? 26, tail: 5, gap: o.gap ?? 14, dir: o.dir, n: o.n })
  return pts
}
