// Fine lines in braille: every cell is a 2×4 grid of dots, so curves, rings
// and charts are drawn at eight times the resolution of the cells. A canvas
// collects dots, then writes them into the cells that are still empty (text
// and boxes drawn before stay on top), or over everything with `over`.
import { P, mix } from './common.mjs'

const BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

const lum = c => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)
const DARK = lum(P.sel) + 40

export class Braille {
  constructor(S) {
    this.S = S
    this.cells = new Map() // cell index -> { bits, color, w }
  }
  /** A dot in sub-cell units: x in [0, 2·w), y in [0, 4·h). */
  dot(px, py, color, weight = 1) {
    const S = this.S
    px = Math.round(px)
    py = Math.round(py)
    if (px < 0 || py < 0 || px >= S.w * 2 || py >= S.h * 4) return
    const k = (py >> 2) * S.w + (px >> 1)
    const c = this.cells.get(k) ?? { bits: 0, color, w: 0 }
    c.bits |= BIT[py & 3][px & 1]
    if (weight >= c.w) {
      c.color = color
      c.w = weight
    }
    this.cells.set(k, c)
  }
  /** A quadratic curve in cell coordinates (a → b, bending toward c). `colorAt(u)` may shade it along. */
  bezier(a, c, b, color, o = {}) {
    const sub = p => [p[0] * 2 + 1, p[1] * 4 + 2]
    const [A, C, B] = [sub(a), sub(c), sub(b)]
    const len = Math.hypot(C[0] - A[0], C[1] - A[1]) + Math.hypot(B[0] - C[0], B[1] - C[1])
    const n = Math.max(8, Math.ceil(len * 1.4))
    const u0 = o.from ?? 0
    const u1 = o.to ?? 1
    for (let i = 0; i <= n; i++) {
      const u = u0 + ((u1 - u0) * i) / n
      const x = (1 - u) * (1 - u) * A[0] + 2 * (1 - u) * u * C[0] + u * u * B[0]
      const y = (1 - u) * (1 - u) * A[1] + 2 * (1 - u) * u * C[1] + u * u * B[1]
      if (o.dash && Math.floor(i / o.dash) % 2) continue
      this.dot(x, y, o.colorAt ? o.colorAt(u) : color, o.weight ?? 1)
    }
  }
  line(a, b, color, o = {}) {
    this.bezier(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b, color, o)
  }
  /** An ellipse (or an arc of it, angles in radians from 12 o'clock, clockwise), radii in cells. */
  ellipse(cx, cy, rx, ry, color, o = {}) {
    const a0 = o.from ?? 0
    const a1 = o.to ?? Math.PI * 2
    const n = Math.max(16, Math.ceil(Math.abs(a1 - a0) * (rx * 2 + ry * 4) * 1.2))
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      const x = (cx + Math.sin(a) * rx) * 2 + 1
      const y = (cy - Math.cos(a) * ry) * 4 + 2
      this.dot(x, y, o.colorAt ? o.colorAt(i / n) : color, o.weight ?? 1)
    }
  }
  /** Writes the dots into the screen. */
  flush(o = {}) {
    const S = this.S
    for (const [k, c] of this.cells) {
      const x = k % S.w
      const y = (k - x) / S.w
      const ch = S.ch[k]
      const isBraille = ch >= '⠀' && ch <= '⣿'
      if (!o.over && ch !== ' ' && !isBraille) continue
      // a lit cell (a creature's pixels, a filled bar) is not background: leave it
      if (!o.over && lum(S.getBg(x, y)) > DARK) continue
      const bits = isBraille && !o.over ? c.bits | (ch.charCodeAt(0) - 0x2800) : c.bits
      S.set(x, y, String.fromCharCode(0x2800 + bits), c.color, S.getBg(x, y), o.bold)
    }
    this.cells.clear()
  }
}

/** A point on a quadratic curve, in cell coordinates. */
export function bezierAt(a, c, b, u) {
  return [(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1]]
}

/** Rough length of a quadratic curve, in cells. */
export function bezierLen(a, c, b) {
  return Math.hypot(c[0] - a[0], (c[1] - a[1]) * 2) + Math.hypot(b[0] - c[0], (b[1] - c[1]) * 2)
}

/**
 * Particles riding a curve: `n` of them, moving at `speed` cells a second,
 * each a bright head with a short fading tail. `dir` -1 runs them backwards.
 */
export function ride(S, a, c, b, color, t, o = {}) {
  const L = Math.max(1, bezierLen(a, c, b))
  const n = o.n ?? Math.max(1, Math.round(L / (o.gap ?? 12)))
  const speed = o.speed ?? 10
  for (let k = 0; k < n; k++) {
    let u = ((t * speed) / L + k / n) % 1
    if (o.dir === -1) u = 1 - u
    for (let j = (o.tail ?? 2); j >= 0; j--) {
      const uu = u - (o.dir === -1 ? -1 : 1) * j * (0.9 / L)
      if (uu < 0 || uu > 1) continue
      const [x, y] = bezierAt(a, c, b, uu)
      const cx = Math.round(x)
      const cy = Math.round(y)
      const bg = S.getBg(cx, cy)
      const glyph = j === 0 ? o.head ?? '●' : j === 1 ? '•' : '·'
      S.set(cx, cy, glyph, j === 0 ? mix(color, P.text, o.glow ?? 0.25) : mix(color, bg, 0.25 + j * 0.2), bg, j === 0)
    }
  }
}
