// Motion for every page: easing, rolling numbers, particle bursts, arrows with
// marching dashes and heads, pulse rings. All of it runs on wall time, so it
// moves at the same speed whatever the frame rate.
import { P, chars, mix } from './common.mjs'
import { curveCells } from './wires.mjs'
import { Braille, bezierAt, ride } from './braille.mjs'

export const ease = {
  out: u => 1 - Math.pow(1 - u, 3),
  inOut: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  back: u => 1 + 2.7 * Math.pow(u - 1, 3) + 1.7 * Math.pow(u - 1, 2),
}

// ── rolling numbers ──────────────────────────────────────────────────────────
const rolls = new Map()
/** A number that glides to its new value instead of jumping. */
export function roll(key, value, rate = 0.18) {
  const cur = rolls.get(key)
  if (cur === undefined || !Number.isFinite(cur)) {
    rolls.set(key, value)
    return value
  }
  const next = Math.abs(value - cur) < 0.005 ? value : cur + (value - cur) * rate
  rolls.set(key, next)
  return next
}

// ── particles ────────────────────────────────────────────────────────────────
const particles = []
const GLYPHS = ['✦', '✧', '•', '·', '*', '+']

/** A burst of sparks from (x, y): a subagent born, a turn done, an alert. */
export function burst(x, y, color, n = 14, o = {}) {
  const now = Date.now()
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4
    const sp = (o.speed ?? 14) * (0.55 + Math.random() * 0.6)
    particles.push({ x, y, vx: Math.cos(a) * sp * 2, vy: Math.sin(a) * sp, born: now, life: (o.life ?? 900) * (0.7 + Math.random() * 0.5), color, g: o.glyph ?? GLYPHS[i % GLYPHS.length] })
  }
  if (particles.length > 600) particles.splice(0, particles.length - 600)
}

/** Confetti falling from a point: a long task finished. */
export function confetti(x, y, colors, n = 24) {
  const now = Date.now()
  for (let i = 0; i < n; i++) {
    particles.push({ x: x + (Math.random() - 0.5) * 6, y, vx: (Math.random() - 0.5) * 30, vy: -8 - Math.random() * 10, gravity: 26, born: now, life: 1400 + Math.random() * 800, color: colors[i % colors.length], g: ['▪', '▴', '◆', '●', '■'][i % 5] })
  }
}

export function drawParticles(S, now = Date.now()) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    const age = (now - p.born) / 1000
    if (age * 1000 > p.life) {
      particles.splice(i, 1)
      continue
    }
    const x = p.x + p.vx * age
    const y = p.y + p.vy * age + (p.gravity ? 0.5 * p.gravity * age * age : 0)
    const fade = (age * 1000) / p.life
    const bg = S.getBg(Math.round(x), Math.round(y))
    S.set(x, y, p.g, mix(p.color, bg, fade * fade), bg)
  }
}

// ── pulse rings ──────────────────────────────────────────────────────────────
const rings = []
/** An expanding ring around (x, y). */
export function ring(x, y, color, o = {}) {
  rings.push({ x, y, color, born: Date.now(), life: o.life ?? 900, max: o.max ?? 8 })
}
export function drawRings(S, now = Date.now()) {
  const br = new Braille(S)
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]
    const u = (now - r.born) / r.life
    if (u >= 1) {
      rings.splice(i, 1)
      continue
    }
    const rad = ease.out(u) * r.max
    br.ellipse(r.x, r.y, rad * 2, rad, mix(r.color, P.bg, u * u))
  }
  br.flush()
}

// ── arrows ───────────────────────────────────────────────────────────────────

/**
 * An arrow from a to b, curving through c when given: a fine braille line that
 * brightens toward the head, with particles flowing along it, so a reader sees
 * which way it goes.
 */
export function arrow(S, a, b, color, t, o = {}) {
  const c = o.via ?? [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2) - (o.bend ?? 0)]
  const pts = curveCells(a, c, b)
  if (pts.length < 2) return pts
  const fade = o.fade ?? 0.45
  const br = new Braille(S)
  br.bezier(a, c, b, color, { to: 0.97, colorAt: u => mix(mix(color, P.bg, fade), color, u * u * 0.6), dash: o.dashed ? 3 : 0 })
  br.flush()
  ride(S, a, c, b, color, t, { speed: o.speed ?? 14, gap: o.gap ?? 10, tail: 2, head: o.lead ?? '●' })
  // the head points along the last stretch
  const [px, py] = bezierAt(a, c, b, 0.9)
  const [hx, hy] = b
  const dx = hx - px
  const dy = (hy - py) * 2
  const ang = Math.atan2(dy, dx)
  const oct = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8
  const HEADS = ['▶', '◢', '▼', '◣', '◀', '◤', '▲', '◥']
  S.set(hx, hy, HEADS[oct], color, S.getBg(hx, hy), true)
  if (o.label) {
    const [lx, ly] = bezierAt(a, c, b, 0.5)
    const s = ` ${o.label} `
    S.text(Math.round(lx) - Math.floor(chars(s).length / 2), Math.round(ly) - 1, s, color, { bold: true, bg: o.labelBg ?? P.bg })
  }
  return pts
}

// ── page transitions ─────────────────────────────────────────────────────────
let wipeAt = 0
export const motion = { wipe: true, countUp: true }
export function startWipe() {
  wipeAt = Date.now()
}
/** A bright column sweeping left to right for 350 ms after a page change. */
export function drawWipe(S, y0, y1, now = Date.now()) {
  const u = (now - wipeAt) / 350
  if (!motion.wipe || u < 0 || u >= 1) return
  const x = Math.round(ease.inOut(u) * S.w)
  for (let y = y0; y < y1; y++)
    for (let k = 0; k < 6; k++) {
      const xx = x - k
      const bg = S.getBg(xx, y)
      S.set(xx, y, k === 0 ? '▌' : ' ', mix(P.router, bg, k / 6), mix(mix(P.router, bg, 0.75), bg, k / 6))
    }
}

/** A value that breathes between 0 and 1. */
export const breathe = (t, speed = 3, phase = 0) => 0.5 + 0.5 * Math.sin(t * speed + phase)
