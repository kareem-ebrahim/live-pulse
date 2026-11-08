// Pixel art drawn as half blocks: the session creature and block digits.
import { P, hx, mix, chars } from './common.mjs'

const SPRITE = [
  '  ############  ',
  '  ############  ',
  '  ##EE####EE##  ',
  '  ##EE####EE##  ',
  '################',
  '################',
  '  ############  ',
  '  ############  ',
  '   # #    # #   ',
  '   # #    # #   ',
  '   # #    # #   ',
]

export function blitPixels(S, x0, y0, cols, rows, px) {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const top = px[r * 2 * cols + c]
      const bot = px[(r * 2 + 1) * cols + c]
      if (top === bot) S.set(x0 + c, y0 + r, ' ', top, top)
      else S.set(x0 + c, y0 + r, '▀', top, bot)
    }
}

/**
 * A session's creature. `tint` colors its body; it bobs and glows while the
 * session works and shuts its eyes when idle. The orbit is its context
 * window: filled clockwise from the top to `ctx` (0..1) in `ringColor`.
 * `satellites` small moons circle it, one per running subagent.
 * Returns where its centre and its orbit's right and left ends land.
 */
export function creature(S, x0, y0, cols, rows, t, o) {
  const W = cols
  const H = rows * 2
  const bg = o.bg ?? P.bg
  const px = new Int32Array(W * H)
  const cx = W / 2
  const cy = H / 2 - 1
  const tint = o.tint ?? P.coral
  const glowCore = mix(tint, bg, o.busy ? 0.72 - 0.06 * Math.sin(t * 3 + (o.phase ?? 0)) : 0.88)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / (W * 0.48)
      const dy = (y - cy) / (H * 0.62)
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy))
      px[y * W + x] = mix(glowCore, bg, Math.pow(d, 0.7))
    }

  const scale = W >= 44 && H >= 28 ? 2 : 1
  const sw = 16 * scale
  const sh = SPRITE.length * scale
  const bob = o.busy ? Math.round((Math.sin(t * 6 + (o.phase ?? 0)) + 1) / 2) : 0
  const sx = Math.round(cx - sw / 2)
  const sy = Math.round(cy - sh / 2) + bob

  // floor shadow
  const fy = Math.round(cy + sh / 2) + 2 - bob
  for (let y = fy - 1; y <= fy + 1; y++)
    for (let x = 0; x < W; x++) {
      const nx = (x - cx) / (sw * 0.7)
      const ny = (y - fy) / 1.6
      if (y >= 0 && y < H && nx * nx + ny * ny <= 1) px[y * W + x] = mix(px[y * W + x], hx('#05070a'), 0.6)
    }

  // the orbit doubles as the context gauge
  const rx = Math.min(W / 2 - 1.5, sw * 0.95)
  const ry = Math.max(2.5, sh * 0.34)
  const ringY = cy + sh * 0.12
  const ctx = Math.max(0, Math.min(1, o.ctx ?? 0))
  const ringColor = o.ringColor ?? P.haiku
  const track = mix(tint, bg, 0.7)
  const plot = front => {
    const steps = Math.round(rx * 9)
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 - Math.PI / 2 // 0 at the top, clockwise
      const isFront = Math.sin(a) > 0
      if (isFront !== front) continue
      const filled = i / steps <= ctx
      if (!filled && i % 3 !== 0) continue
      const x = Math.round(cx + Math.cos(a) * rx)
      const y = Math.round(ringY + Math.sin(a) * ry)
      if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = filled ? ringColor : mix(px[y * W + x], track, 0.8)
    }
  }
  plot(false)

  const body = o.dim ? mix(tint, bg, 0.6) : o.busy ? mix(tint, P.text, 0.12 + 0.1 * Math.sin(t * 4 + (o.phase ?? 0))) : mix(tint, bg, 0.15)
  const blink = o.busy && Math.floor(t * 10 + (o.phase ?? 0) * 7) % 37 === 0
  for (let r = 0; r < SPRITE.length; r++)
    for (let c = 0; c < 16; c++) {
      const ch = SPRITE[r][c]
      if (ch === ' ') continue
      const isEye = ch === 'E'
      const shut = (!o.busy || o.dim) && isEye && r === 2
      const color = isEye && !blink && !shut ? hx('#0b0708') : body
      for (let yy = 0; yy < scale; yy++)
        for (let xx = 0; xx < scale; xx++) {
          const x = sx + c * scale + xx
          const y = sy + r * scale + yy
          if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = color
        }
    }
  plot(true)

  const dot = (a, rxx, ryy, color, glow) => {
    const x = Math.round(cx + Math.cos(a) * rxx)
    const y = Math.round(ringY + Math.sin(a) * ryy)
    for (let yy = -1; yy <= 1; yy++)
      for (let xx = -1; xx <= 1; xx++) {
        const X = x + xx
        const Y = y + yy
        if (X >= 0 && X < W && Y >= 0 && Y < H) px[Y * W + X] = mix(px[Y * W + X], color, xx === 0 && yy === 0 ? 1 : glow)
      }
  }
  if (o.busy) dot(t * 2.2 + (o.phase ?? 0), rx, ry, hx('#ffe9df'), 0.35)
  for (let k = 0; k < (o.satellites ?? 0); k++) dot(-t * 1.6 + (k * Math.PI * 2) / o.satellites, rx * 0.72, ry * 1.25, o.satelliteColor ?? P.haiku, 0.3)

  blitPixels(S, x0, y0, cols, rows, px)
  return {
    cx: x0 + Math.round(cx),
    cy: y0 + Math.round(cy / 2),
    left: [x0 + Math.round(cx - rx), y0 + Math.round(ringY / 2)],
    right: [x0 + Math.round(cx + rx), y0 + Math.round(ringY / 2)],
  }
}

// A small creature for an agent: 12×6 pixels, three rows tall at scale 1.
const MINI = [
  '  ########  ',
  '  #EE##EE#  ',
  '############',
  '  ########  ',
  '  # #  # #  ',
  '  # #  # #  ',
]

/**
 * An agent's creature: `scale` 1 is 12×3 cells, 2 is 24×6. Bobs and glows
 * while the agent works; dims, eyes shut, when it is done.
 */
export function miniCreature(S, x0, y0, scale, t, o) {
  const cols = 12 * scale + 2
  const rows = 3 * scale + (scale > 1 ? 1 : 0)
  const W = cols
  const H = rows * 2
  const bg = o.bg ?? P.bg
  const tint = o.tint ?? P.coral
  const px = new Int32Array(W * H).fill(bg)
  const cx = W / 2
  const cy = H / 2
  if (o.busy)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.min(1, Math.hypot((x - cx) / (W * 0.55), (y - cy) / (H * 0.7)))
        px[y * W + x] = mix(mix(tint, bg, 0.75 - 0.08 * Math.sin(t * 4 + (o.phase ?? 0))), bg, Math.pow(d, 0.6))
      }
  const bob = o.busy && Math.sin(t * 6 + (o.phase ?? 0)) > 0 ? 1 : 0
  const body = o.dim ? mix(tint, bg, 0.55) : o.busy ? mix(tint, P.text, 0.1 + 0.1 * Math.sin(t * 4 + (o.phase ?? 0))) : mix(tint, bg, 0.2)
  const blink = o.busy && Math.floor(t * 10 + (o.phase ?? 0) * 5) % 31 === 0
  const sx = 1
  const sy = H - MINI.length * scale - (scale > 1 ? 1 + bob : 0)
  for (let r = 0; r < MINI.length; r++)
    for (let c = 0; c < 12; c++) {
      const ch = MINI[r][c]
      if (ch === ' ') continue
      const isEye = ch === 'E'
      const color = isEye ? (blink || !o.busy || o.dim ? (o.done ? P.ok : body) : hx('#0b0708')) : body
      for (let yy = 0; yy < scale; yy++)
        for (let xx = 0; xx < scale; xx++) {
          const x = sx + c * scale + xx
          const y = sy + r * scale + yy
          if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = color
        }
    }
  blitPixels(S, x0, y0, cols, rows, px)
  return { cols, rows }
}

const FONT = {
  0: ['###', '# #', '# #', '# #', '###'],
  1: [' # ', '## ', ' # ', ' # ', '###'],
  2: ['###', '  #', '###', '#  ', '###'],
  3: ['###', '  #', '###', '  #', '###'],
  4: ['# #', '# #', '###', '  #', '  #'],
  5: ['###', '#  ', '###', '  #', '###'],
  6: ['###', '#  ', '###', '# #', '###'],
  7: ['###', '  #', '  #', '  #', '  #'],
  8: ['###', '# #', '###', '# #', '###'],
  9: ['###', '# #', '###', '  #', '###'],
  '.': ['   ', '   ', '   ', '   ', ' # '],
  $: [' ##', '## ', ' # ', ' ##', '## '],
  '%': ['# #', '  #', ' # ', '#  ', '# #'],
  ' ': ['   ', '   ', '   ', '   ', '   '],
  k: ['#  ', '# #', '## ', '# #', '# #'],
  M: ['# #', '###', '###', '# #', '# #'],
  B: ['## ', '# #', '## ', '# #', '## '],
}
/** Block digits three rows tall; returns their width. */
export function bigText(S, x, y, s, color, bg) {
  const glyphs = chars(s).map(c => FONT[c] || FONT[0])
  const cols = glyphs.length * 4 - 1
  const px = new Int32Array(cols * 6).fill(bg)
  glyphs.forEach((g, k) => {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === '#') px[r * cols + k * 4 + c] = color
  })
  blitPixels(S, x, y, cols, 3, px)
  return cols
}

// The smallest creature: 8×4 pixels, two rows, for crowded agent lists.
const MICRO = [' ###### ', ' #E##E# ', '########', ' # ## # ']
export function microCreature(S, x0, y0, t, o) {
  const cols = 8
  const bg = o.bg ?? P.bg
  const tint = o.tint ?? P.coral
  const body = o.busy ? mix(tint, P.text, 0.08 + 0.1 * Math.sin(t * 5 + (o.phase ?? 0))) : mix(tint, bg, 0.45)
  const px = new Int32Array(cols * 4).fill(bg)
  const blink = o.busy && Math.floor(t * 10 + (o.phase ?? 0) * 5) % 29 === 0
  MICRO.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === ' ') return
    px[r * cols + c] = ch === 'E' ? (blink || !o.busy ? (o.done ? P.ok : body) : hx('#0b0708')) : body
  }))
  blitPixels(S, x0, y0, cols, 2, px)
  return { cols, rows: 2 }
}
