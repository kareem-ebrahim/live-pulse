// Agents & files: the session's main agent and each of its subagents as a
// creature of its own, with what it is doing now, wired to the exact files it
// edits. A wire lights up and carries sparks while its file is being edited.
// Click an agent or a file to filter the activity log to it.
import { P, SPIN, ago, clamp, famColor, fit, fitTail, len, mix, pretty, secs } from '../common.mjs'
import { accentOf, bgOutput, stateOf, visibleBg } from '../data.mjs'

const BG_COLOR = { shell: P.peach, monitor: P.green, workflow: P.pink, task: P.grey }
import { microCreature, miniCreature } from '../pixels.mjs'
import { Wires, sparks } from '../wires.mjs'
import { logUi } from './log.mjs'

export function drawAgentMap(S, st, x, y, w, h, t, now) {
  const accent = accentOf(st.sessionId)
  const state = stateOf(st, now)
  const busy = state === 'working'
  const MC = st.model ? famColor(st.model) : P.mid
  S.box(x, y, w, h, 'round', mix(accent, P.bg, 0.55), { fill: P.bg })
  S.text(x + 2, y, ' AGENTS & FILES ', P.text, { bold: true, bg: P.bg })
  const spin = SPIN[Math.floor(t * 12) % 10]
  const tools = st.tools || []

  // the agents: main first, then subagents running or recently finished
  const mainRunning = [...tools].reverse().find(r => r.ms === undefined && !r.agentId)
  const subs = (st.agents || [])
    .filter(a => a.status === 'running' || now - (a.started + (a.ms || 0)) < 5 * 60000)
    .sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || a.started - b.started)
  const agents = [
    {
      key: 'main',
      name: 'main agent',
      model: pretty(st.model),
      color: MC,
      busy,
      done: false,
      doing: !st.sessionId
        ? 'no session'
        : mainRunning
          ? `${mainRunning.tool} · ${mainRunning.label || ''}`
          : busy
            ? st.activity || 'thinking'
            : st.turns
              ? 'waiting for you'
              : 'no turn yet',
      meta: `${tools.filter(r => !r.agentId).length} recent calls · turn ${st.turns}`,
    },
    ...subs.map(a => ({
      key: a.key,
      name: '@' + a.type,
      model: pretty(a.model || 'haiku'),
      color: famColor(a.model || 'haiku'),
      busy: a.status === 'running',
      done: a.status === 'done',
      failed: a.status === 'failed',
      doing: a.status === 'running' ? a.current || 'working' : a.status === 'done' ? `finished · ${a.desc}` : `failed · ${a.desc}`,
      meta: `${a.tools} tools · ${secs(a.ms ?? now - a.started)}`,
      bg: (st.bg || []).some(b => b.agentKey === a.key),
    })),
    // background shells and monitors: here while they run, gone 4 s after they end
    ...visibleBg(st, now)
      .filter(b => b.kind !== 'agent')
      .map(b => {
        const o = bgOutput(b, now)
        const last = o?.lines.filter(l => l.trim()).pop()
        const quiet = o ? now - o.mtime : 0
        const kb = o ? (o.bytes >= 1024 ? `${(o.bytes / 1024).toFixed(1)} KB` : `${o.bytes} B`) : ''
        const exitTxt = b.exit === undefined ? '' : ` · exit ${b.exit}`
        return {
        key: 'bg:' + b.id,
        bgId: b.id,
        name: { shell: 'shell', monitor: 'monitor', workflow: 'workflow', task: 'task' }[b.kind] ?? 'background',
        model: b.id,
        color: BG_COLOR[b.kind] ?? P.peach,
        busy: b.status === 'running',
        done: b.status === 'done',
        failed: b.status === 'failed' || b.status === 'killed',
        doing: last ? `› ${last.trim()}` : b.label,
        meta: [o ? `${o.total} lines · ${kb}` : '', b.status === 'running' ? `running ${secs(now - b.started)}${o && quiet > 5000 ? ` · quiet ${secs(quiet)}` : ''}` : `${b.status} after ${secs((b.ended ?? now) - b.started)}${exitTxt}`].filter(Boolean).join(' · '),
        bg: true,
      }}),
  ]

  const zoneW = clamp(Math.floor(w * 0.52), 36, 60)
  const ax = x + 2
  const inner = h - 2
  const nodes = []
  let yy = y + 1
  const tree = new Wires()
  let mainBottom = 0
  // crowded: everything after the main agent shrinks to two rows
  const compact = 4 + 4 * (agents.length - 1) - 1 > inner
  const step = compact ? 3 : 4
  // how many fit, keeping the last row for "+N more" when not all do
  const fitCount = 1 + Math.max(0, Math.floor((inner - 4) / step))
  const shownCount = fitCount >= agents.length ? agents.length : Math.max(1, Math.floor((inner - 5) / step) + 1)
  agents.forEach((ag, i) => {
    const big = i === 0
    const small = compact && !big
    const nodeH = small ? 2 : 3
    if (i >= shownCount) return
    const indent = big ? 0 : 4
    const isSel = logUi.agent === ag.key || (ag.bgId && logUi.bg === ag.bgId)
    if (isSel) S.rect(ax - 1 + indent, yy, zoneW - indent, nodeH, P.sel)
    const bg = isSel ? P.sel : P.bg
    const draw = small ? (S2, x, y, _s, tt, o) => microCreature(S2, x, y, tt, o) : miniCreature
    const c = draw(S, ax + indent, yy, 1, t, { tint: ag.color, busy: ag.busy, dim: !ag.busy && !big, done: ag.done, phase: i * 1.3, bg })
    // subagents hang off the main agent like branches
    if (big) mainBottom = yy + nodeH
    else tree.path([[ax + 1, mainBottom], [ax + 1, yy + (small ? 0 : 1)], [ax + indent - 1, yy + (small ? 0 : 1)]], ag.busy ? mix(ag.color, P.bg, 0.3) : P.faint)
    const tx = ax + indent + c.cols + 1
    const tw = zoneW - indent - c.cols - 3
    const badge = ag.bgId && !ag.busy ? (ag.failed ? '✗ FAILED' : '✓ DONE') : ag.busy ? `${ag.bg ? '◌ BG' : '● LIVE'} ${spin}` : ag.failed ? '✗ FAILED' : ag.done ? '✓ DONE' : 'IDLE'
    const bc = ag.busy ? P.router : ag.failed ? P.err : ag.done ? P.ok : P.mid
    const ty = yy
    S.segs(tx, ty, [[fit(ag.name, tw - len(badge) - 1), ag.color, true, bg]])
    S.text(tx + tw - len(badge), ty, badge, bc, { bold: true, bg })
    S.text(tx, ty + 1, fit(ag.doing, tw), ag.busy ? P.text : P.mid, { bold: ag.busy, bg })
    if (!small) S.text(tx, ty + 2, fit(`${ag.model} · ${ag.meta}`, tw), P.dim, { bg })
    else S.text(tx + tw - Math.min(tw, len(ag.meta)) , ty + 1, '', P.dim, { bg })
    nodes.push({ ...ag, ax: ax + zoneW - 1, ay: small ? ty : ty + 1 })
    const key = ag.key
    const bgId = ag.bgId
    S.hit(ax - 1 + indent, yy, zoneW - indent, nodeH, { onClick: () => (bgId ? logUi.setBg(logUi.bg === bgId ? '' : bgId) : logUi.setAgent(logUi.agent === key ? '' : key)) })
    yy += nodeH + 1
  })
  tree.draw(S)
  if (nodes.length < agents.length) S.text(ax, y + h - 2, `+${agents.length - nodes.length} more agents`, P.warn, { bold: true })

  // the files, owned by the agent that last edited them
  const fx = x + zoneW + 3 + Math.min(10, nodes.length * 2 + 2)
  const fw = x + w - 2 - fx
  const files = (st.files || [])
    .filter(f => f.active || now - f.last < 30 * 60000)
    .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.last - a.last)
    .slice(0, inner)
  const wires = new Wires()
  const flows = []
  if (!files.length) S.text(fx, y + 1 + Math.floor(inner / 2), 'no file edited yet in this session', P.dim)
  files.forEach((f, i) => {
    const ry = y + 1 + i
    const owner = nodes.find(n => n.key === (f.agentKey || 'main')) ?? nodes.find(n => f.agent && n.name === f.agent) ?? nodes[0]
    const color = owner?.color ?? P.mid
    const hot = f.active || now - f.last < 4000
    const isSel = logUi.file === f.path
    const bg = isSel ? P.sel : P.bg
    if (isSel) S.rect(fx, ry, fw, 1, bg)
    const icon = f.active ? (Math.floor(t * 4) % 2 ? '✎' : '•') : f.ok ? '✓' : '✗'
    const right = `×${f.edits}  ${f.active ? 'now' : ago(now - f.last)}`
    S.text(fx, ry, icon, f.active ? P.coral : f.ok ? P.ok : P.err, { bold: true, bg })
    S.text(fx + 2, ry, fitTail(f.path, fw - len(right) - 4), hot ? P.text : P.mid, { bold: hot, bg })
    S.text(fx + fw - len(right), ry, right, f.active ? P.coral : P.dim, { bg })
    if (owner) {
      const idx = nodes.indexOf(owner)
      const busX = owner.ax + 2 + idx * 2
      const cells = wires.path([[owner.ax, owner.ay], [busX, owner.ay], [busX, ry], [fx - 2, ry]], hot ? mix(color, P.bg, 0.2) : mix(color, P.bg, 0.72))
      if (hot) flows.push([cells, color, { speed: 22, tail: 4, gap: 5 }])
    }
    const path = f.path
    S.hit(fx, ry, fw, 1, { onClick: () => logUi.setFile(logUi.file === path ? '' : path) })
  })
  // an agent with no file yet still shows its live wire stub while it works
  for (const n of nodes) if (n.busy && !files.some(f => (f.agentKey || 'main') === n.key)) flows.push([wires.path([[n.ax, n.ay], [n.ax + 3, n.ay]], mix(n.color, P.bg, 0.4)), n.color, { speed: 8, tail: 1, gap: 2 }])
  wires.draw(S)
  for (const [cells, color, o] of flows) sparks(S, cells, t, color, o)
}
