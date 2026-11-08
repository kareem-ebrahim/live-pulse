// Activity: the selected session's events (or every session's), filtered by
// kind, agent or file, with the selected event's code beside them: diffs with
// context, commands, and their output. Everything here answers the mouse.
import { CAT_COLOR, P, SPIN, clamp, clock, fit, fitTail, hx, len, mix, padL, padR, projectName, secs } from '../common.mjs'
import { accentOf, allItems, bgOutput, itemsOf, store } from '../data.mjs'
import { codeLines, diffStat } from '../highlight.mjs'

export const logUi = {
  scope: 'session', // 'session' | 'all'
  kind: 'all',
  agent: '', // '' | 'main' | a subagent's key
  file: '',
  bg: '', // a background shell shown live in the code pane
  shellTop: -1, // -1 follows the newest output
  selKey: '', // '' follows the newest event
  listTop: 0,
  codeTop: 0,
  onExpand: () => {},
  expanded: false,
  reset() {
    this.selKey = ''
    this.listTop = 0
    this.codeTop = 0
  },
  setKind(k) {
    this.kind = k
    this.reset()
  },
  setAgent(k) {
    this.agent = k
    this.reset()
  },
  setFile(f) {
    this.file = f
    this.reset()
  },
  setBg(id) {
    this.bg = id
    this.shellTop = -1
  },
  setScope(s) {
    this.scope = s
    this.reset()
  },
}

const KINDS = [
  { id: 'all', label: 'ALL', color: P.text },
  { id: 'edit', label: 'EDITS', color: P.coral },
  { id: 'exec', label: 'COMMANDS', color: P.peach },
  { id: 'read', label: 'READS', color: P.blue },
  { id: 'agent', label: 'AGENTS', color: P.pink },
  { id: 'errors', label: 'ERRORS', color: P.err },
]
const BADGE = {
  edit: ['EDIT', P.coral],
  exec: ['EXEC', P.peach],
  read: ['READ', P.blue],
  agent: ['AGNT', P.pink],
  web: ['WEB ', P.grey],
  mcp: ['MCP ', P.green],
  turn: ['TURN', P.opus],
  'turn-done': ['DONE', P.ok],
  'agent-done': ['AGNT', P.haiku],
  note: ['NOTE', P.dim],
  attention: ['YOU!', P.warn],
  compact: ['CMPT', P.warn],
}
const HIDDEN = new Set(['turn-summary', 'attention-clear'])
const BG = hx('#0c1016')
const PANEL = hx('#0e1319')

function kindMatch(it, k) {
  if (k === 'all') return true
  if (k === 'errors') return it.ok === false
  if (k === 'agent') return it.cat === 'agent' || it.kind === 'agent' || it.kind === 'agent-done' || !!it.agent
  return it.cat === k
}
function agentMatch(it, a) {
  if (!a) return true
  if (a === 'main') return !it.agent && !String(it.src || '').startsWith('@')
  return it.agent === a
}
function fileMatch(it, f) {
  if (!f) return true
  return it.diff?.path === f || it.label === f || String(it.label || '').endsWith(f)
}

let cache = { key: '', items: [] }
function itemsFor(st, kind = logUi.kind) {
  const key = [store.version, store.sessions.length, logUi.scope, st.sessionId, kind, logUi.agent, logUi.file].join('|')
  if (cache.key !== key) {
    const base = logUi.scope === 'session' && st.sessionId ? itemsOf(st.sessionId) : allItems()
    cache = { key, items: base.filter(it => !HIDDEN.has(it.kind) && kindMatch(it, kind) && agentMatch(it, logUi.agent) && fileMatch(it, logUi.file)) }
  }
  return cache.items
}
function countFor(st, kind) {
  const base = logUi.scope === 'session' && st.sessionId ? itemsOf(st.sessionId) : allItems()
  return base.filter(it => !HIDDEN.has(it.kind) && kindMatch(it, kind) && agentMatch(it, logUi.agent) && fileMatch(it, logUi.file)).length
}

let lastSt = { sessionId: '' }
export function logKey(key) {
  const items = itemsFor(lastSt)
  const idx = logUi.selKey ? items.findIndex(i => i.key === logUi.selKey) : items.length - 1
  const select = i => {
    const k = clamp(i, 0, items.length - 1)
    logUi.selKey = k >= items.length - 1 ? '' : items[k]?.key ?? ''
    logUi.codeTop = 0
  }
  const ki = KINDS.findIndex(k => k.id === logUi.kind)
  switch (key) {
    case 'up':
      return select(idx - 1)
    case 'down':
      return select(idx + 1)
    case 'pgup':
      return select(idx - 10)
    case 'pgdn':
      return select(idx + 10)
    case 'home':
      return select(0)
    case 'end':
    case 'f':
      return logUi.reset()
    case 'left':
      return logUi.setKind(KINDS[(ki - 1 + KINDS.length) % KINDS.length].id)
    case 'right':
      return logUi.setKind(KINDS[(ki + 1) % KINDS.length].id)
    case 's':
      return logUi.setScope(logUi.scope === 'session' ? 'all' : 'session')
    case 'x':
      logUi.agent = ''
      logUi.file = ''
      return logUi.reset()
    default:
      if (/^[1-6]$/.test(key)) logUi.setKind(KINDS[Number(key) - 1].id)
  }
}

/** A clickable pill. Returns the x after it. */
function button(S, x, y, label, o, onClick) {
  const on = o.on
  const fg = on ? P.bg : o.color ?? P.mid
  const bg = on ? o.color ?? P.text : o.bg ?? hx('#161c24')
  S.text(x, y, ` ${label} `, fg, { bold: on || o.bold, bg })
  S.hit(x, y, len(label) + 2, 1, { onClick })
  return x + len(label) + 3
}

export function drawLog(S, st, x, y, w, h, t, now) {
  lastSt = st
  const items = itemsFor(st)
  const ac = st.sessionId ? accentOf(st.sessionId) : P.mid
  const proj = st.sessionId ? projectName(st.cwd) : 'no session'

  // frame and title
  S.box(x, y, w, h, 'round', mix(ac, P.bg, 0.5), { fill: BG })
  S.segs(x + 2, y, [
    [' ACTIVITY ', P.text, true, BG],
    [logUi.scope === 'session' ? ` ${proj} ` : ' every session ', logUi.scope === 'session' ? ac : P.opus, true, BG],
  ])
  // right-hand controls on the top border
  let bx = x + w - 2
  const ctrls = [
    [logUi.expanded ? '⤡ dashboard' : '⤢ expand', { color: P.mid }, () => logUi.onExpand()],
    [logUi.selKey ? '● follow' : '● following', { on: !logUi.selKey, color: P.router }, () => logUi.reset()],
    ['all sessions', { on: logUi.scope === 'all', color: P.opus }, () => logUi.setScope('all')],
    ['this session', { on: logUi.scope === 'session', color: ac }, () => logUi.setScope('session')],
  ]
  for (const [label, o, fn] of ctrls) {
    bx -= len(label) + 3
    button(S, bx, y, label, o, fn)
  }

  // filter chips
  let cx = x + 2
  const cy = y + 1
  for (const k of KINDS) {
    const n = countFor(st, k.id)
    cx = button(S, cx, cy, `${k.label} ${n}`, { on: logUi.kind === k.id, color: k.color }, () => logUi.setKind(k.id))
  }
  if (logUi.agent) {
    const name = logUi.agent === 'main' ? 'main agent' : '@' + ((st.agents || []).find(a => a.key === logUi.agent)?.type ?? 'agent')
    cx = button(S, cx + 1, cy, `${name} ✕`, { on: true, color: P.haiku }, () => logUi.setAgent(''))
  }
  if (logUi.bg) cx = button(S, cx + 1, cy, `shell ${logUi.bg} ✕`, { on: true, color: P.peach }, () => logUi.setBg(''))
  if (logUi.file) cx = button(S, cx + 1, cy, `${fitTail(logUi.file, 28)} ✕`, { on: true, color: P.coral }, () => logUi.setFile(''))

  // body: list | code
  const by = y + 2
  const bh = h - 3
  const lw = clamp(Math.floor(w * 0.44), 44, 90)
  const lx = x + 1
  S.rect(lx, by, lw, bh, BG)
  for (let r = 0; r < bh; r++) S.set(x + lw + 1, by + r, '│', mix(ac, P.bg, 0.7), BG)

  const rows = bh
  const follow = !logUi.selKey
  let sel = follow ? items.length - 1 : items.findIndex(i => i.key === logUi.selKey)
  if (sel < 0) {
    logUi.selKey = ''
    sel = items.length - 1
  }
  if (follow) logUi.listTop = Math.max(0, items.length - rows)
  if (sel < logUi.listTop) logUi.listTop = sel
  if (sel >= logUi.listTop + rows) logUi.listTop = sel - rows + 1
  logUi.listTop = clamp(logUi.listTop, 0, Math.max(0, items.length - rows))
  if (!items.length) S.text(lx + 2, by + 1, logUi.kind === 'all' && !logUi.agent && !logUi.file ? 'nothing yet' : 'nothing matches these filters', P.dim, { bg: BG })
  const showProj = logUi.scope === 'all'
  for (let r = 0; r < rows; r++) {
    const it = items[logUi.listTop + r]
    if (!it) break
    const yy = by + r
    const isSel = logUi.listTop + r === sel
    const bg = isSel ? P.sel : BG
    const iac = accentOf(it.sid)
    S.rect(lx, yy, lw, 1, bg)
    const [bl, bc] = it.kind === 'call' ? BADGE[it.cat] ?? BADGE.mcp : BADGE[it.kind] ?? BADGE.note
    const who = showProj ? projectName(store.sessions.find(s => s.sessionId === it.sid)?.cwd) : it.src || 'main'
    const chip =
      it.kind !== 'call' ? (it.ms ? secs(it.ms) : '') : it.running ? `${secs(now - it.t)} ${SPIN[Math.floor(t * 12) % 10]}` : `${secs(it.ms)} ${it.ok === false ? '✗' : '✓'}`
    const chipC = it.kind !== 'call' ? P.dim : it.running ? P.peach : it.ok === false ? P.err : P.ok
    const what = it.kind === 'call' ? `${it.tool}  ${it.label || ''}` : it.msg || ''
    const fresh = clamp(1 - (now - it.t) / 2500, 0, 1)
    S.set(lx, yy, isSel ? '▌' : ' ', iac, bg, true)
    S.text(lx + 1, yy, clock(it.t), isSel ? P.text : P.dim, { bg })
    S.text(lx + 10, yy, padR(who, 11), showProj ? iac : who === 'main' ? P.mid : P.haiku, { bold: showProj, bg })
    S.text(lx + 22, yy, bl, P.bg, { bold: true, bg: it.running ? mix(bc, P.text, 0.25 + 0.25 * Math.sin(t * 8)) : mix(bc, BG, isSel ? 0 : 0.15) })
    const tw = lw - 28 - len(chip) - 1
    S.text(lx + 27, yy, fit(what, tw), isSel ? P.text : mix(P.mid, P.text, fresh), { bold: isSel || it.running, bg })
    S.text(lx + lw - 1 - len(chip), yy, chip, chipC, { bold: true, bg })
    const key = it.key
    const isLast = logUi.listTop + r === items.length - 1
    S.hit(lx, yy, lw, 1, {
      onClick: () => {
        logUi.selKey = isLast ? '' : key
        logUi.codeTop = 0
      },
    })
  }
  S.hit(lx, by, lw, rows, {
    onWheel: dir => {
      const idx = logUi.selKey ? items.findIndex(i => i.key === logUi.selKey) : items.length - 1
      const k = clamp(idx + dir * 3, 0, items.length - 1)
      logUi.selKey = k >= items.length - 1 ? '' : items[k]?.key ?? ''
      logUi.codeTop = 0
    },
  })
  // re-add row hits on top so clicks still select rows
  for (let r = 0; r < rows; r++) {
    const it = items[logUi.listTop + r]
    if (!it) break
    const key = it.key
    const isLast = logUi.listTop + r === items.length - 1
    S.hit(lx, by + r, lw, 1, {
      onClick: () => {
        logUi.selKey = isLast ? '' : key
        logUi.codeTop = 0
      },
      onWheel: dir => {
        const idx = logUi.selKey ? items.findIndex(i => i.key === logUi.selKey) : items.length - 1
        const k = clamp(idx + dir * 3, 0, items.length - 1)
        logUi.selKey = k >= items.length - 1 ? '' : items[k]?.key ?? ''
        logUi.codeTop = 0
      },
    })
  }

  // bottom border: follow state and newer events
  const newer = follow ? 0 : items.length - 1 - sel
  S.text(x + 2, y + h - 1, follow ? ' ● live ' : ' ❚❚ paused ', follow ? P.router : P.warn, { bold: true, bg: BG })
  if (!follow) S.hit(x + 2, y + h - 1, 12, 1, { onClick: () => logUi.reset() })
  if (newer > 0) {
    const label = ` ↓ ${newer} newer `
    S.text(x + lw - len(label), y + h - 1, label, P.bg, { bold: true, bg: P.haiku })
    S.hit(x + lw - len(label), y + h - 1, len(label), 1, { onClick: () => logUi.reset() })
  }

  // the code view
  const dx = x + lw + 3
  const dw = x + w - 2 - dx - 1
  if (logUi.bg) {
    const b = (st.bg || []).find(z => z.id === logUi.bg)
    if (b) return drawShell(S, b, dx, by, dw, bh, x + w - 2, t, now)
    logUi.bg = ''
  }
  const it = items[sel]
  if (!it) return
  const iac = accentOf(it.sid)
  const title = it.kind === 'call' ? it.tool : (BADGE[it.kind] ?? BADGE.note)[0].trim()
  const target = it.kind === 'call' ? it.label || '' : it.msg || ''
  S.segs(dx, by, [[title + '  ', iac, true, BG], [fitTail(target, dw - len(title) - 2), P.cream, true, BG]])
  // meta pills
  let mx = dx
  const pill = (label, color, filled) => {
    S.text(mx, by + 1, ` ${label} `, filled ? P.bg : color, { bold: true, bg: filled ? color : hx('#161c24') })
    mx += len(label) + 3
  }
  pill(projectName(store.sessions.find(s => s.sessionId === it.sid)?.cwd), iac)
  pill(it.src || 'main', it.src && it.src !== 'main' ? P.haiku : P.mid)
  if (it.kind === 'call') {
    const [bl, bc] = BADGE[it.cat] ?? BADGE.mcp
    pill(bl.trim(), bc, true)
    pill(it.running ? `running ${secs(now - it.t)}` : `${it.ok === false ? '✗ failed' : '✓ ok'} · ${secs(it.ms)}`, it.running ? P.peach : it.ok === false ? P.err : P.ok)
  }
  const ds = diffStat(it)
  if (ds) {
    S.text(mx, by + 1, ` +${ds.add} `, P.ok, { bold: true, bg: P.addBg })
    mx += len(`+${ds.add}`) + 2
    S.text(mx, by + 1, ` −${ds.del} `, P.err, { bold: true, bg: P.delBg })
    mx += len(`−${ds.del}`) + 3
  }
  S.text(mx, by + 1, clock(it.t), P.dim, { bg: BG })
  for (let i = 0; i < dw + 1; i++) S.set(dx + i, by + 2, '─', P.faint, BG)

  const lines = codeLines(it)
  const crow = bh - 3
  logUi.codeTop = clamp(logUi.codeTop, 0, Math.max(0, lines.length - crow))
  for (let r = 0; r < crow; r++) {
    const ln = lines[logUi.codeTop + r]
    if (!ln) break
    const yy = by + 3 + r
    const bg = ln.bg ?? PANEL
    S.rect(dx, yy, dw, 1, bg)
    if (ln.head) {
      S.segs(dx + 1, yy, ln.runs.map(([s, c]) => [s, c, true, ln.section ? hx('#161c24') : bg]), { max: dw - 1, x0: dx + 1 })
      continue
    }
    const gut = ln.n !== undefined ? padL(String(ln.n), 4) : '    '
    S.text(dx, yy, gut, ln.ctx ? P.faint : P.dim, { bg })
    S.text(dx + 4, yy, ` ${ln.mark ?? ' '} `, ln.markColor ?? P.dim, { bold: true, bg })
    S.segs(dx + 7, yy, ln.runs.map(([s, c]) => [s, ln.ctx ? mix(c, PANEL, 0.35) : c, false, bg]), { max: dw - 7, x0: dx + 7 })
  }
  // the code view's scrollbar answers clicks too
  const sbx = x + w - 2
  S.scrollbar(sbx, by + 3, crow, logUi.codeTop, crow, lines.length, iac)
  const page = Math.max(1, crow - 2)
  S.hit(dx, by, dw + 2, bh, { onWheel: dir => (logUi.codeTop = Math.max(0, logUi.codeTop + dir * 3)) })
  S.hit(sbx, by + 3, 1, crow, {
    onClick: ev => {
      const rel = (ev?.y ?? by + 3) - (by + 3)
      logUi.codeTop = Math.max(0, logUi.codeTop + (rel < crow / 2 ? -page : page))
    },
    onWheel: dir => (logUi.codeTop = Math.max(0, logUi.codeTop + dir * 3)),
  })
  void CAT_COLOR
  void projectName
}

/** A background shell, live: its command, state, and output as it arrives. */
function drawShell(S, b, dx, by, dw, bh, sbx, t, now) {
  const o = bgOutput(b, now)
  const running = b.status === 'running'
  const color = b.status === 'failed' || b.status === 'killed' ? P.err : running ? P.peach : P.ok
  S.segs(dx, by, [[(b.kind === 'monitor' ? 'MONITOR' : 'SHELL') + '  ', P.peach, true, BG], [fit(b.label, dw - 8), P.cream, true, BG]])
  let mx = dx
  const pill = (label, c, filled) => {
    S.text(mx, by + 1, ` ${label} `, filled ? P.bg : c, { bold: true, bg: filled ? c : hx('#161c24') })
    mx += len(label) + 3
  }
  pill(b.id, P.mid)
  pill(running ? `running ${secs(now - b.started)} ${SPIN[Math.floor(t * 12) % 10]}` : `${b.status} · ${secs((b.ended ?? now) - b.started)}`, color, !running)
  if (b.exit !== undefined) pill(`exit ${b.exit}`, b.exit === 0 ? P.ok : P.err)
  if (o) {
    pill(`${o.total} lines`, P.mid)
    pill(o.bytes >= 1024 ? `${(o.bytes / 1024).toFixed(1)} KB` : `${o.bytes} B`, P.mid)
    if (running && now - o.mtime > 5000) pill(`quiet ${secs(now - o.mtime)}`, P.warn)
  }
  for (let i = 0; i < dw + 1; i++) S.set(dx + i, by + 2, '─', P.faint, BG)
  const rows = bh - 3
  const lines = o?.lines ?? []
  if (!o) S.text(dx + 1, by + 3, b.out ? 'waiting for output…' : 'this task writes no output file', P.dim, { bg: BG })
  const maxTop = Math.max(0, lines.length - rows)
  const top = logUi.shellTop < 0 ? maxTop : clamp(logUi.shellTop, 0, maxTop)
  for (let r = 0; r < rows; r++) {
    const ln = lines[top + r]
    if (ln === undefined) break
    const yy = by + 3 + r
    const isNew = top + r === lines.length - 1 && running
    S.rect(dx, yy, dw, 1, PANEL)
    S.text(dx, yy, padL(String(Math.max(1, o.total - lines.length + top + r + 1)), 5), P.faint, { bg: PANEL })
    S.text(dx + 6, yy, fit(ln, dw - 6), /error|fail|✗|exception/i.test(ln) ? P.err : /pass|ok|✓|done|success/i.test(ln) ? P.ok : isNew ? P.text : hx('#b8c1ca'), { bold: isNew, bg: PANEL })
  }
  S.scrollbar(sbx, by + 3, rows, top, rows, lines.length, P.peach)
  if (logUi.shellTop >= 0 && top < maxTop) {
    const label = ` ↓ follow output `
    S.text(dx + dw - len(label), by + bh - 1, label, P.bg, { bold: true, bg: P.peach })
    S.hit(dx + dw - len(label), by + bh - 1, len(label), 1, { onClick: () => (logUi.shellTop = -1) })
  }
  S.hit(dx, by, dw + 2, bh, {
    onWheel: dir => {
      const cur = logUi.shellTop < 0 ? maxTop : logUi.shellTop
      const next = clamp(cur + dir * 3, 0, maxTop)
      logUi.shellTop = next >= maxTop ? -1 : next
    },
  })
}
