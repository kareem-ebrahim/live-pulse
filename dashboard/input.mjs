// Keyboard and SGR mouse input, parsed into small events.
const ESC = String.fromCharCode(27)
const MOUSE = new RegExp('^' + ESC + '\\[<(\\d+);(\\d+);(\\d+)([Mm])')
const KEYS = [
  [ESC + '[A', 'up'],
  [ESC + '[B', 'down'],
  [ESC + '[C', 'right'],
  [ESC + '[D', 'left'],
  [ESC + '[5~', 'pgup'],
  [ESC + '[6~', 'pgdn'],
  [ESC + '[H', 'home'],
  [ESC + '[1~', 'home'],
  [ESC + 'OH', 'home'],
  [ESC + '[F', 'end'],
  [ESC + '[4~', 'end'],
  [ESC + 'OF', 'end'],
  [ESC + '[Z', 'shift-tab'],
  [ESC + 'OP', 'f1'],
  [ESC + 'OQ', 'f2'],
  [ESC + 'OR', 'f3'],
  [ESC + 'OS', 'f4'],
  [ESC + '[11~', 'f1'],
  [ESC + '[12~', 'f2'],
  [ESC + '[13~', 'f3'],
  [ESC + '[14~', 'f4'],
  [ESC + '[15~', 'f5'],
  [ESC + '[17~', 'f6'],
  [ESC + '[18~', 'f7'],
  [ESC + '[24~', 'f12'],
]

export const MOUSE_ON = ESC + '[?1000h' + ESC + '[?1006h'
export const MOUSE_OFF = ESC + '[?1000l' + ESC + '[?1006l'

/** Splits raw input into { type: 'key', key } and { type: 'mouse', b, x, y, down } events. */
export function parseInput(s) {
  const out = []
  let i = 0
  while (i < s.length) {
    const rest = s.slice(i)
    const m = rest.match(MOUSE)
    if (m) {
      out.push({ type: 'mouse', b: Number(m[1]), x: Number(m[2]) - 1, y: Number(m[3]) - 1, down: m[4] === 'M' })
      i += m[0].length
      continue
    }
    const k = KEYS.find(([seq]) => rest.startsWith(seq))
    if (k) {
      out.push({ type: 'key', key: k[1] })
      i += k[0].length
      continue
    }
    const ch = s[i]
    if (ch === ESC) {
      // an unknown sequence: skip it whole
      const end = rest.slice(1).search(/[A-Za-z~]/)
      i += end >= 0 ? end + 2 : 1
      continue
    }
    out.push({ type: 'key', key: ch === '\t' ? 'tab' : ch === '\r' ? 'enter' : ch === '\u0003' ? 'ctrl-c' : ch })
    i++
  }
  return out
}
