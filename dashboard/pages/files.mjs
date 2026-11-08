// Files: every file the sessions touched, per repository, hottest first: how
// often, lines in and out, who edited it last, whether it is being edited now.
// Beside it each repository's git state (branch, ahead / behind, changed and
// untracked counts, read every 15 s) and the file leases: who holds which file
// and who waits for it.
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { P, ago, fit, fitTail, len, mix, projectName } from '../common.mjs'
import { CAT_COLOR } from '../common.mjs'
import { DIR, accentOf, itemsOf, liveSessions, store } from '../data.mjs'
import { diffStat } from '../highlight.mjs'
import { arrow } from '../anim.mjs'
import { autoScroll } from '../director.mjs'
import { emptyNote, nameOf, panel, smoothBar, stackChart } from './kit.mjs'

// ── git, read in the background ─────────────────────────────────────────────
const git = new Map() // root -> { at, branch, ahead, behind, changed, untracked, busy }
function gitOf(root, now) {
  let g = git.get(root)
  if (!g) {
    g = { at: 0 }
    git.set(root, g)
  }
  const parse = (err, out) => {
    g.busy = false
    g.at = Date.now()
    if (err) {
      g.none = true
      return
    }
    g.none = false
    const lines = String(out).split('\n').filter(Boolean)
    const head = lines.shift() ?? ''
    const m = head.match(/^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?/)
    g.branch = m?.[1] ?? '?'
    g.upstream = m?.[2]
    g.ahead = Number(m?.[3] ?? 0)
    g.behind = Number(m?.[4] ?? 0)
    g.untracked = lines.filter(l => l.startsWith('??')).length
    g.changed = lines.length - g.untracked
    g.dirty = new Set(lines.map(l => l.slice(3).trim().replace(/^"|"$/g, '')))
  }
  const args = ['-C', root, 'status', '-b', '--porcelain']
  if (!g.at && !g.busy) {
    try {
      parse(null, execFileSync('git', args, { timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }))
    } catch (err) {
      parse(err)
    }
  } else if (!g.busy && now - g.at > 15000) {
    g.busy = true
    execFile('git', args, { timeout: 5000, windowsHide: true }, parse)
  }
  return g
}

// ── leases, as the mod writes them ──────────────────────────────────────────
let leases = []
let leasesAt = 0
function readLeases(now) {
  if (now - leasesAt < 1000) return leases
  leasesAt = now
  const out = []
  try {
    const dir = path.join(DIR, 'locks')
    for (const f of fs.readdirSync(dir)) {
      try {
        const l = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        if (!l.released && now - l.at < 600000) out.push(l)
      } catch {
        // mid-write
      }
    }
  } catch {
    // no leases yet
  }
  leases = out
  return out
}

export function drawFiles(S, focus, y0, y1, t, now) {
  const W = S.w
  const sessions = liveSessions(now).length ? liveSessions(now) : store.sessions
  const everyEditor = new Map() // abs -> Set of sessions
  for (const st of sessions) for (const f of st.files || []) {
    const k = f.abs || f.path
    everyEditor.set(k, (everyEditor.get(k) ?? new Set()).add(st.sessionId))
  }
  // files grouped by repository (or project folder)
  const groups = new Map()
  for (const st of sessions) {
    const root = st.repo?.root || st.cwd || '?'
    const g = groups.get(root) ?? { root, remote: st.repo?.remote, sessions: [], files: new Map() }
    g.sessions.push(st)
    for (const f of st.files || []) {
      const k = f.abs || f.path
      const prev = g.files.get(k)
      const row = prev ?? { ...f, editors: new Set(), added: 0, removed: 0, edits: 0, last: 0 }
      row.edits += f.edits
      row.added += f.added ?? 0
      row.removed += f.removed ?? 0
      row.active = row.active || f.active
      if (f.last >= row.last) {
        row.last = f.last
        row.lastBy = st.sessionId
        row.agent = f.agent
      }
      for (const sid of everyEditor.get(k) ?? []) row.editors.add(sid)
      g.files.set(k, row)
    }
    groups.set(root, g)
  }
  if (!groups.size) return emptyNote(S, y0, y1, 'no files touched yet', 'files the sessions edit show here with their changes and git state')

  const leftW = Math.round((W - 3) * 0.62)
  const rightX = 1 + leftW + 1
  const rightW = W - rightX - 1
  const box = panel(S, 1, y0, leftW, y1 - y0, 'FILES TOUCHED', P.faint, { right: 'hottest first' })

  // rows: a header per repository, then its files
  const rows = []
  for (const g of groups.values()) {
    rows.push({ head: g })
    const files = [...g.files.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.edits - a.edits || b.last - a.last)
    for (const f of files) rows.push({ f, g })
    rows.push({ gap: true })
  }
  const shown = box.h
  const first = autoScroll(rows.length, shown, now) ?? 0
  const maxEdits = Math.max(1, ...rows.filter(r => r.f).map(r => r.f.edits))
  const lease = readLeases(now)
  const rowY = new Map()
  let y = box.y
  for (const r of rows.slice(first, first + shown)) {
    if (r.gap) {
      y++
      continue
    }
    if (r.head) {
      const g = r.head
      const gs = gitOf(g.root, now)
      S.text(box.x, y, '▸ ', P.opus, { bg: P.panel, bold: true })
      S.text(box.x + 2, y, fit(projectName(g.root), 28), P.opus, { bg: P.panel, bold: true })
      const info = gs.none ? 'not a git repository' : gs.branch ? `⎇ ${gs.branch}${gs.ahead ? ` ↑${gs.ahead}` : ''}${gs.behind ? ` ↓${gs.behind}` : ''} · ${gs.changed} changed · ${gs.untracked} untracked` : 'reading git…'
      S.text(box.x + 32, y, fit(info, box.w - 33), P.mid, { bg: P.panel })
      y++
      continue
    }
    const f = r.f
    const lastAc = accentOf(f.lastBy)
    const nameW = Math.max(20, box.w - 62)
    const heat = f.edits / maxEdits
    const hot = mix(P.coral, P.warn, 1 - heat)
    // pulse while it is being edited
    const pulse = f.active ? 0.5 + 0.5 * Math.sin(t * 7) : 0
    const rowBg = f.active ? mix(P.panel, P.coral, 0.08 + pulse * 0.06) : P.panel
    S.rect(box.x - 1, y, box.w + 2, 1, rowBg)
    S.text(box.x, y, f.active ? '✎' : '·', f.active ? mix(P.coral, P.text, pulse) : P.dim, { bg: rowBg, bold: true })
    S.text(box.x + 2, y, fitTail(f.path, nameW), f.active ? P.text : P.mid, { bg: rowBg, bold: f.active })
    let x = box.x + 3 + nameW
    // heat bar
    const bw = 10
    smoothBar(S, x, y, bw, Math.max(0.06, heat), P.warn, hot, rowBg)
    x += bw + 1
    S.text(x, y, `${f.edits}×`.padStart(4), P.text, { bg: rowBg })
    x += 5
    S.text(x, y, `+${f.added}`.padStart(6), P.ok, { bg: rowBg })
    S.text(x + 6, y, ` −${f.removed}`.padEnd(7), P.err, { bg: rowBg })
    x += 14
    // who: a dot per session that edited it, the last one named
    let dx = x
    for (const sid of f.editors) {
      S.text(dx, y, '●', accentOf(sid), { bg: rowBg })
      dx += 1
    }
    const who = f.agent ? `@${f.agent}` : nameOf(store.sessions.find(s => s.sessionId === f.lastBy))
    S.text(dx + 1, y, fit(who, 12), lastAc, { bg: rowBg })
    S.text(box.x + box.w - 7, y, ago(now - f.last).padStart(7), P.dim, { bg: rowBg })
    const held = lease.find(l => l.file && (l.file === f.abs || l.file === f.path))
    if (held) S.text(box.x + 1, y, '⚿', accentOf(held.session), { bg: rowBg, bold: true })
    if (f.editors.size > 1) S.text(box.x + box.w - 9, y, '◆', P.err, { bg: rowBg, bold: true })
    rowY.set(f.abs || f.path, y)
    y++
  }
  if (rows.length > shown) S.scrollbar(box.x + box.w + 1, box.y, box.h, first, shown, rows.length, P.coral)
  const feedTop = y + 1
  const room = box.y + box.h - feedTop - 1
  // with room to spare, the bottom holds a chart of edits per minute
  const chartH = room >= 22 ? Math.min(12, room - 12) : 0
  const feedRows = Math.min(room - chartH - (chartH ? 2 : 0), 12)
  if (chartH) {
    const cy = box.y + box.h - chartH - 1
    S.text(box.x, cy - 1, 'EDITS PER MINUTE · LAST 30 MIN · EACH SESSION ITS COLOUR', P.dim, { bold: true, bg: P.panel })
    // thirty one-minute columns, each a few cells wide with a gap
    const colW = Math.max(1, Math.floor((box.w - 8) / 30))
    const cw = colW * 30
    const series = sessions.map(st => {
      const mins = new Array(30).fill(0)
      for (const it of itemsOf(st.sessionId)) {
        if (it.kind !== 'call' || it.cat !== 'edit' || now - it.t >= 1800000) continue
        mins[29 - Math.floor((now - it.t) / 60000)] += 1
      }
      const values = Array.from({ length: cw }, (_, x) => (colW > 1 && x % colW === colW - 1 ? 0 : mins[Math.floor(x / colW)]))
      return { color: accentOf(st.sessionId), values }
    })
    const max = stackChart(S, box.x + 6, cy, cw, chartH, series)
    S.text(box.x, cy, String(Math.round(max)).padStart(4), P.dim, { bg: P.panel })
    S.text(box.x + 3, cy + chartH - 1, '0', P.dim, { bg: P.panel })
    S.text(box.x + 6, cy + chartH, '−30m', P.dim, { bg: P.panel })
    S.text(box.x + 6 + cw - 3, cy + chartH, 'now', P.router, { bg: P.panel })
  }
  if (feedRows >= 4) {
    S.text(box.x, feedTop, 'LATEST CHANGES', P.dim, { bold: true, bg: P.panel })
    for (let x = box.x + 15; x < box.x + box.w; x++) S.set(x, feedTop, '─', P.faint, P.panel)
    const edits = sessions
      .flatMap(st => itemsOf(st.sessionId).filter(i => i.kind === 'call' && i.cat === 'edit').map(it => ({ it, st })))
      .sort((a, b) => a.it.t - b.it.t)
      .slice(-feedRows)
    if (!edits.length) S.text(box.x, feedTop + 1, 'no edits yet', P.faint, { bg: P.panel })
    edits.forEach(({ it, st }, i) => {
      const yy = feedTop + 1 + i
      const fresh = now - it.t < 3000
      const bg = fresh ? mix(P.panel, P.coral, 0.12) : P.panel
      S.rect(box.x - 1, yy, box.w + 2, 1, bg)
      S.text(box.x, yy, new Date(it.t).toTimeString().slice(0, 8), P.dim, { bg })
      S.text(box.x + 10, yy, '●', accentOf(st.sessionId), { bg })
      S.text(box.x + 12, yy, fit(it.tool ?? '', 10), CAT_COLOR.edit, { bg, bold: true })
      S.text(box.x + 23, yy, fitTail(it.label ?? '', box.w - 46), fresh ? P.text : P.mid, { bg, bold: fresh })
      const d = diffStat(it)
      if (d) {
        S.text(box.x + box.w - 20, yy, `+${d.add}`.padStart(6), P.ok, { bg })
        S.text(box.x + box.w - 13, yy, `−${d.del}`.padEnd(6), P.err, { bg })
      }
      const tail = it.running ? 'now' : it.ok === false ? 'failed' : ago(now - it.t)
      S.text(box.x + box.w - 6, yy, tail.padStart(6), it.ok === false ? P.err : P.dim, { bg })
    })
  }

  // ── right: leases and who waits ──
  const lh = Math.max(8, Math.floor((y1 - y0) * 0.4))
  const lb = panel(S, rightX, y0, rightW, lh, 'FILE LEASES', lease.length ? P.warn : P.faint, { right: `${lease.length} held` })
  let ly = lb.y
  if (!lease.length) {
    S.text(lb.x, ly++, 'no file is held right now', P.dim, { bg: P.panel })
    S.text(lb.x, ly++, fit('a session holds a file while it edits it; another', lb.w), P.faint, { bg: P.panel })
    S.text(lb.x, ly++, fit('one that wants the same file waits here for it', lb.w), P.faint, { bg: P.panel })
  }
  for (const l of lease.slice(0, Math.floor((lb.h - 1) / 2))) {
    const ac = accentOf(l.session)
    S.text(lb.x, ly, '⚿ ', ac, { bg: P.panel, bold: true })
    S.text(lb.x + 2, ly, fitTail(l.file ? path.basename(l.file) : '?', lb.w - 14), P.text, { bg: P.panel, bold: true })
    S.text(lb.x + lb.w - 10, ly, ago(now - l.at).padStart(10), P.dim, { bg: P.panel })
    const waiters = sessions.filter(s => s.waiting && l.file && path.basename(l.file) === path.basename(s.waiting.file))
    S.text(lb.x + 2, ly + 1, fit(`held by ${l.project || l.session.slice(0, 8)}${waiters.length ? ` · ${waiters.length} waiting` : ''}`, lb.w - 2), waiters.length ? P.warn : P.mid, { bg: P.panel })
    // an arrow from each waiter's file row to the lease
    for (const w of waiters) {
      const wy = [...rowY.entries()].find(([k]) => path.basename(k) === path.basename(w.waiting.file))?.[1]
      if (wy !== undefined) arrow(S, [box.x + box.w - 10, wy], [lb.x - 3, ly], P.warn, t, { via: [rightX - 4, Math.round((wy + ly) / 2)], label: `${nameOf(w)} waits` })
    }
    ly += 2
  }

  // ── right, below: the sessions per repository ──
  const rb = panel(S, rightX, y0 + lh, rightW, y1 - y0 - lh, 'REPOSITORIES', P.faint)
  let ry = rb.y
  for (const g of groups.values()) {
    if (ry >= rb.y + rb.h - 1) break
    const gs = gitOf(g.root, now)
    S.text(rb.x, ry, fit(projectName(g.root), rb.w - 2), P.opus, { bold: true, bg: P.panel })
    ry++
    if (g.remote) S.text(rb.x + 2, ry++, fitTail(String(g.remote).replace(/^https?:\/\//, ''), rb.w - 4), P.dim, { bg: P.panel })
    if (!gs.none && gs.branch) {
      S.segs(rb.x + 2, ry++, [['⎇ ', P.router], [gs.branch, P.router, true], [gs.upstream ? `  → ${gs.upstream}` : '  no upstream', P.dim]], { bg: P.panel, max: rb.w - 2, x0: rb.x + 2 })
      S.segs(rb.x + 2, ry++, [[`↑${gs.ahead} `, gs.ahead ? P.warn : P.dim], [`↓${gs.behind} `, gs.behind ? P.warn : P.dim], [` ${gs.changed} changed `, gs.changed ? P.coral : P.dim], [` ${gs.untracked} untracked`, gs.untracked ? P.peach : P.dim]], { bg: P.panel })
    }
    let sx = rb.x + 2
    for (const st of g.sessions) {
      const n = `● ${nameOf(st)} `
      if (sx + len(n) > rb.x + rb.w) break
      S.text(sx, ry, n, accentOf(st.sessionId), { bg: P.panel })
      sx += len(n)
    }
    ry += 2
  }
}
