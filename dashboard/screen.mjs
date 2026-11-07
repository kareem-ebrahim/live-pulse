// A cell buffer with a diffing truecolor flush, boxes, and an HTML export.
import { P, chars, len, clamp } from './common.mjs'

export const BOX = {
  single: { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘' },
  round: { h: '─', v: '│', tl: '╭', tr: '╮', bl: '╰', br: '╯' },
  bold: { h: '━', v: '┃', tl: '┏', tr: '┓', bl: '┗', br: '┛' },
  dashed: { h: '╌', v: '╎', tl: '┌', tr: '┐', bl: '└', br: '┘' },
}

export class Screen {
  constructor(w, h) {
    this.w = w
    this.h = h
    const n = w * h
    this.ch = new Array(n).fill(' ')
    this.fg = new Int32Array(n)
    this.bg = new Int32Array(n)
    this.b = new Uint8Array(n)
    this.pch = null
    this.hits = [] // clickable regions, rebuilt every frame
  }
  fill(bg) {
    this.ch.fill(' ')
    this.fg.fill(P.text)
    this.bg.fill(bg)
    this.b.fill(0)
    this.hits = []
  }
  /** Registers a region the mouse can act on; later ones win. */
  hit(x, y, w, h, on) {
    this.hits.push({ x, y, w, h, ...on })
  }
  hitAt(x, y) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const r = this.hits[i]
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r
    }
    return undefined
  }
  set(x, y, c, fg, bg, bold) {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = y * this.w + x
    this.ch[i] = c
    if (fg !== undefined && fg !== null) this.fg[i] = fg
    if (bg !== undefined && bg !== null) this.bg[i] = bg
    this.b[i] = bold ? 1 : 0
  }
  getBg(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return P.bg
    return this.bg[y * this.w + x]
  }
  text(x, y, s, fg, o = {}) {
    let i = 0
    for (const c of chars(s)) {
      if (o.max !== undefined && i >= o.max) break
      this.set(x + i, y, c, fg, o.bg, o.bold)
      i++
    }
    return x + i
  }
  segs(x, y, parts, o = {}) {
    for (const [s, c, b, bg] of parts) {
      if (o.max !== undefined) {
        const room = o.x0 + o.max - x
        if (room <= 0) break
        x = this.text(x, y, s, c, { bold: b, bg: bg ?? o.bg, max: room })
      } else x = this.text(x, y, s, c, { bold: b, bg: bg ?? o.bg })
    }
    return x
  }
  rect(x, y, w, h, bg) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, ' ', null, bg)
  }
  box(x, y, w, h, style, color, o = {}) {
    if (w < 2 || h < 2) return
    const S = BOX[style] || BOX.single
    if (o.fill !== undefined) this.rect(x, y, w, h, o.fill)
    const bg = o.fill
    for (let i = 1; i < w - 1; i++) {
      this.set(x + i, y, S.h, color, bg)
      this.set(x + i, y + h - 1, S.h, color, bg)
    }
    for (let j = 1; j < h - 1; j++) {
      this.set(x, y + j, S.v, color, bg)
      this.set(x + w - 1, y + j, S.v, color, bg)
    }
    this.set(x, y, S.tl, color, bg)
    this.set(x + w - 1, y, S.tr, color, bg)
    this.set(x, y + h - 1, S.bl, color, bg)
    this.set(x + w - 1, y + h - 1, S.br, color, bg)
    if (o.title) this.segs(x + 2, y, [[` ${o.title} `, o.titleColor ?? color, true]], { bg })
  }
  /** Copies another screen's cells (and clickable regions) in at row `y0`. */
  blit(src, y0) {
    for (let y = 0; y < src.h && y + y0 < this.h; y++) {
      const from = y * src.w
      const to = (y + y0) * this.w
      for (let x = 0; x < Math.min(src.w, this.w); x++) {
        this.ch[to + x] = src.ch[from + x]
        this.fg[to + x] = src.fg[from + x]
        this.bg[to + x] = src.bg[from + x]
        this.b[to + x] = src.b[from + x]
      }
    }
    for (const r of src.hits) this.hits.push({ ...r, y: r.y + y0 })
  }
  /** A vertical scrollbar: `first`/`shown` of `total` rows. */
  scrollbar(x, y, h, first, shown, total, color) {
    if (total <= shown || h < 2) return
    const size = Math.max(1, Math.round((shown / total) * h))
    const pos = Math.round((first / Math.max(1, total - shown)) * (h - size))
    for (let i = 0; i < h; i++) this.set(x, y + i, i >= pos && i < pos + size ? '┃' : '│', i >= pos && i < pos + size ? color : P.faint)
  }
  flush(out) {
    const { w, h } = this
    let s = ''
    let cx = -1
    let cy = -1
    let sgr = ''
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y === h - 1 && x === w - 1) continue
        const i = y * w + x
        if (
          this.pch &&
          this.pch.ch[i] === this.ch[i] &&
          this.pch.fg[i] === this.fg[i] &&
          this.pch.bg[i] === this.bg[i] &&
          this.pch.b[i] === this.b[i]
        )
          continue
        if (cx !== x || cy !== y) s += `\x1b[${y + 1};${x + 1}H`
        const f = this.fg[i]
        const b = this.bg[i]
        const want = `\x1b[0;${this.b[i] ? '1;' : ''}38;2;${(f >> 16) & 255};${(f >> 8) & 255};${f & 255};48;2;${(b >> 16) & 255};${(b >> 8) & 255};${b & 255}m`
        if (want !== sgr) {
          s += want
          sgr = want
        }
        s += this.ch[i]
        cx = x + 1
        cy = y
      }
    }
    this.pch = { ch: this.ch.slice(), fg: this.fg.slice(), bg: this.bg.slice(), b: this.b.slice() }
    if (s) out.write(s + '\x1b[0m')
  }
  toHtml() {
    const hex = n => '#' + n.toString(16).padStart(6, '0')
    let html = ''
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x
        const c = this.ch[i] === '<' ? '&lt;' : this.ch[i] === '&' ? '&amp;' : this.ch[i] === '>' ? '&gt;' : this.ch[i]
        html += `<span style="color:${hex(this.fg[i])};background:${hex(this.bg[i])}${this.b[i] ? ';font-weight:700' : ''}">${c}</span>`
      }
      html += '\n'
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:${hex(P.bg)}}
pre{margin:0;font:15px/1.2 "Cascadia Mono","Cascadia Code",Consolas,monospace}
span{display:inline-block;width:1ch;height:1.2em;vertical-align:top}
</style></head><body><pre>${html}</pre></body></html>`
  }
}

export function centerX(x, w, s) {
  return x + Math.max(0, Math.floor((w - len(s)) / 2))
}
export function segsLen(parts) {
  return parts.reduce((n, p) => n + len(p[0]), 0)
}
export function segsCenter(S, x, w, y, parts, o) {
  return S.segs(x + Math.max(0, Math.floor((w - segsLen(parts)) / 2)), y, parts, o)
}
export function bar(S, x, y, w, frac, color, o = {}) {
  const f = clamp(frac, 0, 1)
  const solid = Math.round(f * w)
  const hatch = o.hatch === false ? 0 : Math.min(w - solid, solid > 0 ? Math.max(1, Math.round(w * 0.2)) : 0)
  for (let i = 0; i < w; i++) {
    if (i < solid) S.set(x + i, y, '█', color, o.bg)
    else if (i < solid + hatch) S.set(x + i, y, '▒', color, o.bg)
    else S.set(x + i, y, '░', P.faint, o.bg)
  }
}
export function sweepBar(S, x, y, w, t, color, bg) {
  const band = Math.max(2, Math.round(w / 3.5))
  const pos = (t * w * 0.9) % (w + band)
  for (let i = 0; i < w; i++) {
    const on = i >= pos - band && i < pos
    S.set(x + i, y, on ? '█' : '░', on ? color : P.faint, bg)
  }
}
const SPARK = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
/** A sparkline of `values` (0..max) in `w` cells, newest on the right. */
export function sparkline(S, x, y, w, values, color, bg) {
  const max = Math.max(1, ...values)
  for (let i = 0; i < w; i++) {
    const v = values[values.length - w + i] ?? 0
    const k = v === 0 ? 0 : Math.max(1, Math.round((v / max) * 8))
    S.set(x + i, y, k === 0 ? '·' : SPARK[k], k === 0 ? P.faint : color, bg)
  }
}
