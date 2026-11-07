// The selected session in full: its stages and files (left), the flow
// session → router → subagents → turn result (centre), and the live scan of
// its tool calls (right). Every figure comes from the session itself.
import {
  CATS,
  CAT_COLOR,
  CAT_LABEL,
  CAT_WORDS,
  P,
  SPIN,
  ago,
  clamp,
  comma,
  famColor,
  fit,
  fitTail,
  hx,
  kfmt,
  len,
  mix,
  padL,
  padR,
  pretty,
  projectName,
  secs,
  tw,
  two,
  usd,
  limitName,
  resetIn,
  winPath,
} from '../common.mjs'
import { accentOf, callsPerMinute, ctxLabel, ctxPct, kindStats, stateOf } from '../data.mjs'
import { bigText } from '../pixels.mjs'
import { bar, centerX, segsCenter, sparkline, sweepBar } from '../screen.mjs'
import { Wires, sparks } from '../wires.mjs'
import { drawAgentMap } from './agents.mjs'
import { logUi } from './log.mjs'

export function drawSession(S, st, top, bot, t, now, anchor) {
  const W = S.w
  const state = stateOf(st, now)
  const main = st.model || ''
  const MC = main ? famColor(main) : P.mid
  const MODEL = main ? pretty(main) : 'Claude'
  const busy = state === 'working'
  const spin = SPIN[Math.floor(t * 12) % SPIN.length]
  const agents = st.agents || []
  const running = agents.filter(a => a.status === 'running')
  const agentModel = agents.find(a => a.model)?.model || ''
  const tools = st.tools || []
  const lastTool = tools[tools.length - 1]
  const activeTool = [...tools].reverse().find(x => x.ms === undefined)
  const justReturned = lastTool && lastTool.ms !== undefined && now - (lastTool.started + lastTool.ms) < 1500
  const proj = projectName(st.cwd)
  const accent = accentOf(st.sessionId)
  const kinds = kindStats(st, now)

  const showL = W >= 132
  const Lw = showL ? clamp(Math.round(W * 0.19), 30, 38) : 0
  const Rw = clamp(Math.round(W * 0.24), 34, 46)
  const Lx = 1
  const Rx = W - 1 - Rw
  const Cx = showL ? Lx + Lw + 5 : 2
  const Cr = Rx - 5
  const Cw = Cr - Cx
  const ccx = Cx + Math.floor(Cw / 2)
  const wires = new Wires()
  const flows = []

  // ── centre stack: session, router, agents & files, turn ──────────────
  // On a short screen the session box gives way: the main agent's node in
  // the agents map, the left panel and the creature row say the same.
  const avail = bot - top + 1
  const compact = avail < 36
  const headH = compact ? 0 : 7
  let nc = 6
  const subs = (st.agents || []).filter(a => a.status === 'running' || now - (a.started + (a.ms || 0)) < 5 * 60000).length + (st.bg || []).filter(b => b.kind !== 'agent' && (b.status === 'running' || now - (b.ended ?? 0) < 4000)).length
  const minMap = Math.min(22, 6 + 4 * (1 + Math.min(3, subs)))
  while (nc > 2 && avail - (headH + nc + 4 + 1 + 4 + 1) < minMap) nc--
  const yMain = top
  const routerH = nc + 4
  const yRouter = top + headH
  const yMap = yRouter + routerH + 1
  // with three or more agents and background tasks, the turn box gives its rows to the map
  const crowded = (st.agents || []).filter(a => a.status === 'running' || now - (a.started + (a.ms || 0)) < 5 * 60000).length + (st.bg || []).filter(b => b.kind !== 'agent' && (b.status === 'running' || now - (b.ended ?? 0) < 4000)).length >= 3
  const ySign = crowded ? bot + 2 : bot - 3
  const mapH = Math.max(5, (crowded ? bot + 1 : ySign - 1) - yMap)
  const rw = Math.min(Cw, Math.max(50, Math.round(Cw * 0.8)))
  const rx = ccx - Math.floor(rw / 2)
  let mx = Cx
  let mcx = ccx

  if (!compact) {
    // ── main session box + context window ────────────────────────────────
    const mbW = Cw >= 72 ? 26 : 0
    const mw = Math.min(58, Cw - (mbW ? mbW + 5 : 0))
    mx = mbW ? ccx - Math.floor(mw / 2) - Math.floor((mbW + 5) / 2) + 2 : ccx - Math.floor(mw / 2)
    mcx = mx + Math.floor(mw / 2)
    const breathe = busy ? mix(MC, P.text, 0.15 + 0.15 * Math.sin(t * 4)) : mix(MC, P.bg, 0.25)
    S.box(mx, yMain, mw, 6, 'dashed', breathe, { fill: P.bg })
    const mi = mw - 4
    segsCenter(S, mx + 2, mi, yMain + 1, [[`${MODEL} · main session`, MC, true]])
    segsCenter(S, mx + 2, mi, yMain + 2, [[fitTail(winPath(st.cwd) || '—', mi), P.text, true]])
    const rank = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }[st.effort] ?? 0
    segsCenter(S, mx + 2, mi, yMain + 3, [
      ['effort ', P.sonnet],
      ['■'.repeat(rank), P.sonnet],
      ['□'.repeat(5 - rank), P.dim],
      [' ' + (st.effort ? st.effort.toUpperCase() : '—'), P.sonnet, true],
    ])
    const doing =
      state === 'ended'
        ? 'session ended'
        : state === 'silent'
          ? `no update for ${secs(now - st.updatedAt)}`
          : activeTool && !activeTool.agentId
            ? `${activeTool.tool} · ${activeTool.label || ''}`
            : running.length
              ? `waiting on ${running.length} subagent${running.length > 1 ? 's' : ''}`
              : busy
                ? st.activity || 'thinking'
                : st.turns
                  ? 'waiting for you'
                  : 'no turn yet'
    segsCenter(S, mx + 2, mi, yMain + 4, [[fit(`[${doing}${busy ? ' ' + spin : ''}]`, mi), P.mid]])
    if (mbW) {
      const bx = mx + mw + 5
      S.box(bx, yMain, mbW, 6, 'dashed', mix(P.haiku, P.bg, 0.15), { fill: P.bg })
      segsCenter(S, bx + 1, mbW - 2, yMain + 1, [['CONTEXT WINDOW', P.haiku, true]])
      const used = ctxPct(st)
      const pct = tw('ctxpct' + st.sessionId, used / 100, 0.1)
      const pc = used >= 85 ? P.err : used >= 65 ? P.warn : P.haiku
      bar(S, bx + 2, yMain + 2, mbW - 9, pct, pc)
      S.text(bx + mbW - 6, yMain + 2, padL(`${Math.round(pct * 100)}%`, 4), P.text, { bold: true })
      S.segs(bx + 2, yMain + 3, [[ctxLabel(st), P.text, true], [' used', P.dim]])
      const tot = st.cacheRead + st.cacheWrite + st.inTok
      S.segs(bx + 2, yMain + 4, [['cache hit ', P.dim], [`${tot ? Math.round((st.cacheRead / tot) * 100) : 0}%`, P.router, true]])
      const c = wires.path([[mx + mw, yMain + 3], [bx - 1, yMain + 3]], P.faint, true)
      if (busy) flows.push([c, P.haiku, { speed: 10, gap: 4, tail: 2 }])
    }
    // main → router: calls go down, results come back up
    const c1 = wires.path([[mcx, yMain + 6], [ccx, yMain + 6], [ccx, yRouter - 1]], busy ? mix(P.sonnet, P.bg, 0.3) : P.faint)
    if (activeTool && !justReturned) flows.push([c1, P.sonnet, { speed: 14, tail: 3, gap: 3 }])
    if (justReturned) flows.push([c1, lastTool.ok === false ? P.err : P.router, { speed: 16, dir: -1, tail: 3, gap: 3 }])
  }

  // the selected creature plugs into the top of the flow
  if (anchor) {
    const c = wires.path([[anchor.x, anchor.y], [anchor.x, top - 1], [mcx, top - 1], [mcx, yMain - 1]], mix(accent, P.bg, busy ? 0.3 : 0.6))
    if (busy) flows.push([c, accent, { speed: 16, tail: 3, gap: 6 }])
  }

  // ── router: tool calls by kind, live ───────────────────────────────────
  S.box(rx, yRouter, rw, routerH, 'single', mix(P.router, P.bg, busy ? 0 : 0.3), { fill: P.bg })
  const ri = rw - 4
  const cpm = callsPerMinute(st, now)
  const head = `${cpm}/min · ${comma(st.toolCount)} total`
  const sub = ri - len(head) - 8 >= 32 ? ' · tool calls by kind · last 60s' : ' · last 60s'
  S.segs(rx + 2, yRouter + 1, [['ROUTER', P.router, true], [sub, P.mid]])
  S.text(rx + rw - 2 - len(head), yRouter + 1, head, P.text, { bold: true })
  const order = [...CATS].sort((a, b) => kinds[b].running - kinds[a].running || kinds[b].lastStart - kinds[a].lastStart || (st.cats[b] || 0) - (st.cats[a] || 0))
  const shownKinds = order.slice(0, nc)
  const labW = 14
  const rightW = 14
  const spW = Math.max(8, ri - labW - rightW - 1)
  shownKinds.forEach((c, k) => {
    const y = yRouter + 2 + k
    const ks = kinds[c]
    const color = CAT_COLOR[c]
    const flash = now - ks.lastStart < 450
    const ended = now - ks.lastEnd < 700
    const labBg = flash ? mix(color, P.bg, 0.55) : P.bg
    S.text(rx + 2, y, padR(CAT_WORDS[c], labW), flash ? P.text : ks.running ? color : P.mid, { bold: flash || ks.running > 0, bg: labBg })
    sparkline(S, rx + 2 + labW, y, spW, ks.buckets, color, P.bg)
    const dots = ks.running ? '●'.repeat(Math.min(3, ks.running)) + (ks.running > 3 ? '+' : '') : ended ? (ks.lastOk ? '✓' : '✗') : ''
    const dc = ks.running ? mix(color, P.text, 0.3 + 0.3 * Math.sin(t * 8)) : ks.lastOk ? P.ok : P.err
    S.text(rx + 3 + labW + spW, y, padR(dots, 5), dc, { bold: true })
    S.text(rx + rw - 2 - 7, y, padL(String(st.cats[c] || 0), 7), P.text, { bold: true })
    if (logUi.kind === c) S.set(rx + 1, y, '▸', color, P.bg, true)
    S.hit(rx + 1, y, rw - 2, 1, { onClick: () => logUi.setKind(logUi.kind === c ? 'all' : c) })
  })
  const pushTxt = activeTool ? `${activeTool.tool} ${secs(now - activeTool.started)} ${spin}` : lastTool ? `${lastTool.tool} ${secs(lastTool.ms)}` : 'no calls yet'
  S.segs(rx + 2, yRouter + routerH - 2, [[activeTool ? 'running → ' : 'last → ', P.router], [fit(pushTxt, Math.floor(ri / 2)), P.router, true]])
  S.segs(rx + rw - 2 - len(`✓ ${st.okCount}  ✗ ${st.errCount}`), yRouter + routerH - 2, [[`✓ ${st.okCount}`, P.ok, true], ['  ', P.dim], [`✗ ${st.errCount}`, st.errCount ? P.err : P.dim, true]])

  // ── agents & files: who is editing what, live ──────────────────────────
  const sw = Math.min(54, Cw - 30)
  const sx = ccx - Math.floor(sw / 2) - 6
  const scx = sx + Math.floor(sw / 2)
  {
    const c2 = wires.path([[ccx, yRouter + routerH], [ccx, yMap - 1]], running.length || activeTool ? mix(P.haiku, P.bg, 0.3) : P.faint)
    if (running.length || activeTool) flows.push([c2, running.length ? P.haiku : P.sonnet, { speed: 10, tail: 2, gap: 2 }])
    drawAgentMap(S, st, Cx, yMap, Cw, mapH, t, now)
    const c3 = crowded ? [] : wires.path([[scx, yMap + mapH], [scx, ySign - 1]], justReturned ? mix(P.router, P.bg, 0.3) : P.faint)
    if (justReturned) flows.push([c3, P.router, { speed: 14, tail: 2, gap: 4 }])
  }

  const signed = state === 'idle' && st.turns > 0
  if (!crowded) {
  // ── turn result + tool results ─────────────────────────────────────────
  S.box(sx, ySign, sw, 4, 'dashed', signed ? P.opus : mix(P.opus, P.bg, 0.3), { fill: P.bg })
  segsCenter(S, sx + 2, sw - 4, ySign + 1, [[`${MODEL} · turn ${st.turns || '—'}`, P.opus, true]])
  const elapsedTurn = st.turnStarted ? now - st.turnStarted : 0
  segsCenter(
    S,
    sx + 2,
    sw - 4,
    ySign + 2,
    signed
      ? [[`✓ done in ${secs(st.lastTurnMs)} · ${ago(now - (st.turnStarted + st.lastTurnMs))} ago`, P.ok, true]]
      : busy
        ? [[`running for ${secs(elapsedTurn)} `, P.text, true], [spin, P.opus]]
        : [['no turn yet', P.dim]],
  )
  const obW = 24
  const obx = sx + sw + 5
  if (obx + obW <= Cr + 3) {
    const okColor = st.errCount ? P.warn : P.ok
    S.box(obx, ySign, obW, 4, 'dashed', signed ? okColor : P.faint, { fill: P.bg })
    segsCenter(S, obx + 1, obW - 2, ySign + 1, [['TOOL RESULTS', P.haiku, true]])
    segsCenter(S, obx + 1, obW - 2, ySign + 2, [[`✓ ${st.okCount}`, P.ok, true], ['   ', P.dim], [`✗ ${st.errCount}`, st.errCount ? P.err : P.dim, true]])
    const c = wires.path([[sx + sw, ySign + 2], [obx - 1, ySign + 2]], signed ? mix(P.ok, P.bg, 0.3) : P.faint, true)
    if (signed && now - (st.turnStarted + st.lastTurnMs) < 6000) flows.push([c, P.ok, { speed: 8, gap: 3, tail: 2 }])
  }

  }

  // ── left: stages, figures and the files this session edits ─────────────
  if (showL) {
    const ph = bot - top + 1
    S.box(Lx, top, Lw, ph, 'single', mix(accent, P.bg, 0.15), { fill: P.panel })
    const li = Lw - 4
    let y = top + 1
    segsCenter(S, Lx + 2, li, y++, [[MODEL.toUpperCase(), MC, true]])
    segsCenter(S, Lx + 2, li, y++, [[fit(proj, li), P.cream, true]])
    y++
    const lastRow = top + ph - 2
    const section = (label, isOn, targetY, targetX) => {
      if (y > lastRow) return
      const lineBg = isOn ? P.lavBg : P.panel
      S.rect(Lx + 1, y, Lw - 2, 1, lineBg)
      S.segs(Lx + 2, y, [[isOn ? '◆ ' : '◇ ', isOn ? P.opus : P.mid, true, lineBg], [label, isOn ? P.text : P.mid, true, lineBg]])
      if (isOn) {
        S.text(Lx + Lw - 3, y, spin, P.opus, { bg: lineBg })
        const midX = Lx + Lw + 2
        const pts = targetY === y ? [[Lx + Lw, y], [targetX - 1, y]] : [[Lx + Lw, y], [midX, y], [midX, targetY], [targetX - 1, targetY]]
        const cells = wires.path(pts, mix(P.opus, P.bg, 0.45), true)
        flows.push([cells, P.opus, { speed: 18, tail: 3, gap: 6, n: 2 }])
        S.set(targetX - 1, targetY, '▶', P.opus, P.bg)
      }
      y++
    }
    const planOn = busy && (st.phase === 'thinking' || st.phase === 'writing')
    section('Think & write', planOn, compact ? yMap + 2 : yMain + 3, compact ? Cx : mx)
    S.text(Lx + 4, y++, fit(planOn ? (st.phase === 'thinking' ? 'thinking…' : 'writing a reply…') : busy ? 'between steps' : 'idle', li - 2), P.mid)
    y++
    const stat = (k, v, c = P.text) => {
      S.text(Lx + 4, y, padR(k, li - 12), P.mid)
      S.text(Lx + Lw - 3 - len(v), y, v, c, { bold: true })
      y++
    }
    stat('turns', String(st.turns))
    stat('context', ctxLabel(st))
    stat('window used', `${ctxPct(st)}%`, ctxPct(st) >= 85 ? P.err : ctxPct(st) >= 65 ? P.warn : P.haiku)
    const tot = st.cacheRead + st.cacheWrite + st.inTok
    stat('cache hit', `${tot ? Math.round((st.cacheRead / tot) * 100) : 0}%`, P.router)
    stat('tokens out', kfmt(st.outTok))
    stat('cost', usd(st.costUsd), P.cream)
    for (const l of st.limits || []) {
      const c = l.percentUsed >= 85 ? P.err : l.percentUsed >= 60 ? P.warn : P.haiku
      stat(`${limitName(l.kind)} limit`, `${Math.round(l.percentUsed)}%${l.resetsAt ? ' · ' + resetIn(l.resetsAt) : ''}`, c)
    }
    if (st.waiting) {
      S.segs(Lx + 4, y++, [['◷ waiting ', P.warn, true], [fitTail(`${st.waiting.file} (${st.waiting.owner})`, li - 12), P.warn]])
    }
    y++
    const files = st.files || []
    const editing = files.filter(f => f.active).length
    const toolSecRows = 4
    const fileRows = clamp(top + ph - 1 - y - 3 - toolSecRows - 3, 1, 12)
    S.segs(Lx + 2, y++, [[editing ? `✎ EDITING NOW (${editing})` : `FILES EDITED (${files.length})`, editing ? P.coral : P.mid, true]])
    if (!files.length) S.text(Lx + 4, y++, 'none yet', P.dim)
    for (const f of files.slice(0, fileRows)) {
      if (y > lastRow - 6) break
      const icon = f.active ? (Math.floor(t * 4) % 2 ? '✎' : '•') : f.ok ? '✓' : '✗'
      const right = `×${f.edits} ${padL(ago(now - f.last), 3)}`
      S.text(Lx + 2, y, icon, f.active ? P.coral : f.ok ? P.ok : P.err, { bold: true })
      S.text(Lx + 4, y, fitTail(f.path, li - 3 - len(right)), f.active ? P.text : P.mid, { bold: f.active })
      S.text(Lx + Lw - 2 - len(right), y, right, f.active ? P.coral : P.dim)
      y++
    }
    y = Math.max(y + 1, top + ph - 1 - toolSecRows - 3)
    section('Tool calls', !!activeTool || st.phase === 'agents', yRouter + Math.floor(routerH / 2), rx)
    for (const tr of tools.slice(-(toolSecRows - 1))) {
      if (y >= lastRow) break
      S.segs(Lx + 4, y++, [
        [tr.ms === undefined ? '▸ ' : tr.ok ? '✓ ' : '✗ ', tr.ms === undefined ? CAT_COLOR[tr.cat] : tr.ok ? P.ok : P.err],
        [fit(`${tr.tool} ${tr.label}`, li - 4), P.mid],
      ])
    }
    y = lastRow
    section('Turn done', signed && now - (st.turnStarted + st.lastTurnMs) < 15000, ySign + 1, sx)
  }

  // ── right: live scan of this session's tool calls ──────────────────────
  {
    const ph = bot - top + 1
    S.box(Rx, top, Rw, ph, 'round', mix(accent, P.bg, 0.45), { fill: P.ember })
    const ri2 = Rw - 4
    let y = top + 1
    const activeN = activeTool?.n ?? lastTool?.n ?? 0
    S.text(Rx + 2, y, 'LIVE SCAN', P.cream, { bold: true, bg: P.ember })
    const scan = `${two(activeN)} OF ${st.toolCount}`
    S.text(Rx + Rw - 2 - len(scan), y++, scan, P.coral, { bold: true, bg: P.ember })
    const segN = Math.floor((ri2 + 1) / 3)
    const segTools = tools.slice(-segN)
    for (let k = 0; k < segN; k++) {
      const tr = segTools[k]
      const c = tr ? (tr.ms === undefined ? mix(CAT_COLOR[tr.cat], P.text, 0.3 + 0.3 * Math.sin(t * 8)) : CAT_COLOR[tr.cat]) : P.faint
      S.text(Rx + 2 + k * 3, y, '━━', c, { bg: P.ember })
    }
    y += 2
    const bwid = bigText(S, Rx + 2, y, String(st.toolCount), P.cream, P.ember)
    S.text(Rx + 3 + bwid, y, 'TOOL CALLS', P.cream, { bold: true, bg: P.ember })
    S.text(Rx + 3 + bwid, y + 1, fit(proj.toUpperCase(), Rw - bwid - 6), accent, { bold: true, bg: P.ember })
    S.text(Rx + 3 + bwid, y + 2, fit(`${st.okCount} ok · ${st.errCount} failed`, Rw - bwid - 6), st.errCount ? P.warn : P.mid, { bg: P.ember })
    y += 4

    const nlH = 6
    const counterH = ph >= 36 ? 4 : 3
    const show = activeTool || lastTool
    const owner = show?.agentId ? agents.find(a => a.agentId === show.agentId) : undefined
    const nx = Rx + 2
    const nw = Rw - 4
    const nbg = hx('#1d1513')
    S.box(nx, y, nw, nlH, 'round', show && show.ms === undefined ? P.coral : mix(P.coral, P.ember, 0.4), { fill: nbg })
    S.text(nx + 2, y + 1, show && show.ms === undefined ? 'NOW RUNNING' : 'LAST CALL', P.coral, { bold: true, bg: nbg })
    const nn = `${two(show?.n ?? 0)} / ${st.toolCount}`
    S.text(nx + nw - 2 - len(nn), y + 1, nn, P.cream, { bg: nbg })
    S.text(nx + 2, y + 2, fit(`${owner ? '@' + owner.type : 'main session'} /`, nw - 4), P.mid, { bg: nbg })
    S.text(nx + 2, y + 3, fit(show ? `${show.tool} · ${show.label || ''}` : 'no tool call yet', nw - 4), P.text, { bold: true, bg: nbg })
    const result = show ? (show.ms === undefined ? `running ${secs(now - show.started)} ${spin}` : `${show.ok ? 'ok' : 'failed'} in ${secs(show.ms)}${show.out ? ' · ' + show.out : ''}`) : '—'
    S.segs(nx + 2, y + 4, [['result > ', P.coral, true, nbg], [fit(result, nw - 13), show && show.ms !== undefined && !show.ok ? P.err : P.text, true, nbg]])
    const nowY = y + 2
    y += nlH

    const cardsRows = top + ph - 1 - y - counterH
    const k = Math.max(0, Math.floor(cardsRows / 3))
    const list = k > 0 ? tools.slice(-k).reverse() : []
    const gx = Rx + 5
    const gw = Rw - 7
    const rail = []
    list.forEach((tr, i) => {
      const yy = y + i * 3
      const color = CAT_COLOR[tr.cat]
      const isOn = tr.ms === undefined
      const bg = isOn ? hx('#2a1a16') : P.ember
      S.box(gx, yy, gw, 3, isOn ? 'round' : 'single', isOn ? color : mix(color, P.ember, 0.55), { fill: bg })
      S.text(gx + 1, yy + 1, ' ' + two(tr.n % 100) + ' ', hx('#120b0a'), { bold: true, bg: isOn ? color : mix(color, P.ember, 0.25) })
      S.text(gx + 6, yy + 1, fit(`${tr.tool}  ${tr.label}`, gw - 18), P.text, { bold: true, bg })
      const mark = isOn ? 'ON' : tr.ok ? '✓' : '✗'
      S.segs(gx + gw - 11, yy + 1, [[padL(CAT_LABEL[tr.cat], 5), color, true, bg], ['  ', null, false, bg], [padR(mark, 2), isOn ? color : tr.ok ? P.ok : P.err, true, isOn ? hx('#4a2a22') : bg]])
      if (isOn) rail.push(yy + 1)
    })
    // a rail from NOW RUNNING down to each card still running
    for (const ry of rail) {
      const cells = wires.path([[nx, nowY], [Rx + 2, nowY], [Rx + 2, ry], [gx - 1, ry]], mix(P.coral, P.ember, 0.4))
      flows.push([cells, P.coral, { speed: 14, tail: 3, gap: 5 }])
    }

    const cy0 = top + ph - 1 - counterH
    const cbw = Math.floor((Rw - 4 - 5) / 6)
    CATS.forEach((c, i) => {
      const x = Rx + 2 + i * (cbw + 1)
      const on = kinds[c].running > 0
      const flash = now - kinds[c].lastStart < 450
      const cbg = flash ? mix(CAT_COLOR[c], P.ember, 0.6) : on ? hx('#2a1a16') : P.ember
      S.box(x, cy0, cbw, counterH, on ? 'round' : 'single', on || flash ? CAT_COLOR[c] : mix(CAT_COLOR[c], P.ember, 0.5), { fill: cbg })
      const num = String(st.cats[c] || 0)
      if (counterH === 4) {
        S.text(x + 1, cy0 + 1, fit(CAT_LABEL[c], cbw - 2), CAT_COLOR[c], { bold: true, bg: cbg })
        S.text(x + 1, cy0 + 2, fit(num, cbw - 2), P.text, { bold: true, bg: cbg })
      } else {
        S.text(x + 1, cy0 + 1, fit(CAT_LABEL[c].slice(0, Math.max(1, cbw - 3 - num.length)), cbw - 2 - num.length), CAT_COLOR[c], { bold: true, bg: cbg })
        S.text(x + cbw - 1 - num.length, cy0 + 1, num, P.text, { bold: true, bg: cbg })
      }
    })
  }

  wires.draw(S)
  for (const [cells, color, o] of flows) sparks(S, cells, t, color, o)
  S.set(ccx, yRouter - 1, '▼', busy ? P.sonnet : P.dim, P.bg)
  S.set(ccx, yMap - 1, '▼', running.length || activeTool ? P.haiku : P.dim, P.bg)
  if (!crowded) S.set(scx, ySign - 1, '▼', signed ? P.opus : P.dim, P.bg)
  void centerX
}
