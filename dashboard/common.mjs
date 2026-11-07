// Palette (sampled from the two reference videos) and text helpers.

export const hx = s => parseInt(s.slice(1), 16)

export const P = {
  bg: hx('#0b0f14'),
  bar: hx('#151a21'),
  panel: hx('#0e1319'),
  card: hx('#0e1319'),
  lavBg: hx('#1b1930'),
  sel: hx('#18202c'),
  text: hx('#eff5fa'),
  mid: hx('#9aa5b1'),
  dim: hx('#5b6570'),
  faint: hx('#262e37'),
  opus: hx('#bbb3f1'),
  sonnet: hx('#eca06e'),
  haiku: hx('#6dc0ff'),
  router: hx('#82edab'),
  fable: hx('#f28fb5'),
  ok: hx('#7cc79d'),
  err: hx('#ff7b72'),
  warn: hx('#e3b341'),
  coral: hx('#d06d58'),
  peach: hx('#e8b48a'),
  blue: hx('#7d9cc9'),
  green: hx('#9cb86f'),
  pink: hx('#d0679a'),
  grey: hx('#c9c9c9'),
  cream: hx('#f2ece4'),
  ember: hx('#16100e'),
  emberHi: hx('#3a1d17'),
  red: hx('#ff5f57'),
  yellow: hx('#febc2e'),
  greenDot: hx('#28c840'),
  addBg: hx('#10261a'),
  delBg: hx('#2d1316'),
}

/** One accent per session, in the order sessions appear. */
export const ACCENTS = [P.coral, P.haiku, P.opus, P.router, P.sonnet, P.pink, P.peach, P.blue]

export function mix(a, b, t) {
  t = Math.max(0, Math.min(1, t))
  const c = s => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return (c(16) << 16) | (c(8) << 8) | c(0)
}

export const CATS = ['edit', 'exec', 'read', 'agent', 'web', 'mcp']
export const CAT_COLOR = { edit: P.coral, exec: P.peach, read: P.blue, mcp: P.green, agent: P.pink, web: P.grey }
export const CAT_LABEL = { edit: 'EDIT', exec: 'EXEC', read: 'READ', mcp: 'MCP', agent: 'AGENT', web: 'WEB' }
export const CAT_WORDS = {
  edit: 'edit files',
  exec: 'run commands',
  read: 'read & search',
  mcp: 'mcp & skills',
  agent: 'subagents',
  web: 'web',
}

export function family(m = '') {
  m = m.toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('fable')) return 'fable'
  return 'opus'
}
export const famColor = m => P[family(m)]
export function pretty(m) {
  if (!m) return 'Claude'
  const s = m.toLowerCase().replace(/\[.*\]$/, '')
  const f = family(s)
  if (!s.includes(f)) return m
  const v = s.match(/(\d+)[-.](\d+)/)
  return f[0].toUpperCase() + f.slice(1) + (v ? ` ${v[1]}.${v[2]}` : '')
}
export const TONE = {
  opus: P.opus,
  sonnet: P.sonnet,
  haiku: P.haiku,
  fable: P.fable,
  router: P.router,
  user: P.cream,
  text: P.text,
  dim: P.dim,
  ok: P.ok,
  err: P.err,
  warn: P.warn,
}

export const chars = s => Array.from(String(s ?? ''))
export const len = s => chars(s).length
export function fit(s, w) {
  const c = chars(s)
  if (w <= 0) return ''
  return c.length <= w ? c.join('') : c.slice(0, Math.max(0, w - 1)).join('') + '…'
}
/** Keeps the end, the telling part of a path. */
export function fitTail(s, w) {
  const c = chars(s)
  if (w <= 0) return ''
  return c.length <= w ? c.join('') : '…' + c.slice(c.length - w + 1).join('')
}
export const padR = (s, w) => fit(s, w) + ' '.repeat(Math.max(0, w - len(fit(s, w))))
export const padL = (s, w) => ' '.repeat(Math.max(0, w - len(fit(s, w)))) + fit(s, w)
export const two = n => String(n).padStart(2, '0')
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export function clock(t) {
  const d = new Date(t)
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
export function kfmt(n) {
  n = Math.round(n || 0)
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (n >= 1e4) return Math.round(n / 1000) + 'k'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
export function secs(ms) {
  if (ms === undefined || ms === null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m${two(Math.floor((ms % 60000) / 1000))}s`
  return `${Math.floor(ms / 3600000)}h${two(Math.floor((ms % 3600000) / 60000))}m`
}
export function ago(ms) {
  if (ms < 5000) return 'now'
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`
  return `${Math.floor(ms / 3600000)}h`
}
export const comma = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
export const winPath = p => String(p || '').split('/').join('\\')
export function projectName(cwd) {
  const parts = String(cwd || '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || 'no project'
}

// Numbers that glide toward their target, for bars.
const tweens = new Map()
export function tw(key, target, k = 0.2) {
  const cur = tweens.get(key)
  const v = cur === undefined ? target : cur + (target - cur) * k
  const snapped = Math.abs(v - target) < 0.01 ? target : v
  tweens.set(key, snapped)
  return snapped
}
