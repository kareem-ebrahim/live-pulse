// Reads what the live-pulse mod writes for every session:
//   sessions/<id>.json        a snapshot, rewritten several times a second
//   events/<id>/<seq>.json    one file per event (calls with their code, turns, agents)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ACCENTS, CATS, P, projectName } from './common.mjs'

export const DIR = process.env.LIVE_PULSE_DIR || path.join(os.homedir(), '.claude', 'live-pulse')
export const SESS = path.join(DIR, 'sessions')
export const EVENTS = path.join(DIR, 'events')
export const ALIVE = path.join(DIR, 'dash.alive')

const KEEP_EVENTS = 600
const STALE_MS = 12000
export const opts = { keepEnded: false }

export function emptyState() {
  return {
    model: '',
    effort: '',
    phase: 'idle',
    activity: '',
    turns: 0,
    turnStarted: 0,
    lastTurnMs: 0,
    inTok: 0,
    outTok: 0,
    cacheRead: 0,
    cacheWrite: 0,
    context: 0,
    rate: 0,
    tools: [],
    toolCount: 0,
    okCount: 0,
    errCount: 0,
    toolMs: 0,
    cats: { edit: 0, exec: 0, read: 0, mcp: 0, agent: 0, web: 0 },
    agents: [],
    files: [],
    log: [],
    startedAt: 0,
    cwd: '',
    sessionId: '',
    updatedAt: 0,
    ctxWindow: 0,
    ctxPct: 0,
  }
}

export const store = {
  sessions: [],
  accent: new Map(),
  pinned: '', // the session the person picked; '' follows the most active
  version: 0, // bumps whenever events arrive
}

const snapCache = new Map()
const evState = new Map() // sid -> { last: seq, items: [], byId: Map }
let lastPoll = 0
let lastTidy = 0

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function poll(now, force = false) {
  if (!force && now - lastPoll < 100) return
  lastPoll = now
  let files = []
  try {
    files = fs.readdirSync(SESS).filter(f => f.endsWith('.json'))
  } catch {
    files = []
  }
  const keep = []
  for (const f of files) {
    let st
    try {
      st = readJson(path.join(SESS, f))
      snapCache.set(f, st)
    } catch {
      st = snapCache.get(f) // caught mid-write: its last whole reading
    }
    if (!st) continue
    const age = now - (st.updatedAt || 0)
    // A closed session leaves the screen at once: one that ended says so, and
    // its files go; one whose window was closed outright stops its heartbeat
    // (written every 2 s, even when idle) and is hidden after 12 s. Opened
    // again (resumed), it writes under the same id and comes back.
    if (st.ended && !opts.keepEnded) {
      tidySession(f.replace(/\.json$/, ''))
      snapCache.delete(f)
      continue
    }
    if (age > STALE_MS) {
      if (age > 24 * 3600000) tidySession(f.replace(/\.json$/, ''))
      continue
    }
    keep.push({ ...emptyState(), ...st })
  }
  for (const st of keep) {
    if (!store.accent.has(st.sessionId)) store.accent.set(st.sessionId, ACCENTS[store.accent.size % ACCENTS.length])
    readEvents(st.sessionId)
  }
  keep.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
  store.sessions = keep
  if (store.pinned && !keep.some(s => s.sessionId === store.pinned)) store.pinned = ''
  if (now - lastTidy > 10000) {
    lastTidy = now
    for (const st of keep) trimEvents(st.sessionId)
  }
}

function tidySession(sid) {
  try {
    fs.unlinkSync(path.join(SESS, `${sid}.json`))
  } catch {
    // already gone
  }
  try {
    fs.rmSync(path.join(EVENTS, sid), { recursive: true, force: true })
  } catch {
    // already gone
  }
  // a resumed session numbers its events from 1 again
  evState.delete(sid)
  store.version++
}

function trimEvents(sid) {
  const dir = path.join(EVENTS, sid)
  try {
    const names = fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort()
    for (const n of names.slice(0, Math.max(0, names.length - KEEP_EVENTS))) fs.unlinkSync(path.join(dir, n))
  } catch {
    // nothing to trim
  }
}

function readEvents(sid) {
  let ev = evState.get(sid)
  if (!ev) {
    ev = { last: 0, items: [], byId: new Map() }
    evState.set(sid, ev)
  }
  let names
  try {
    names = fs.readdirSync(path.join(EVENTS, sid))
  } catch {
    return
  }
  const fresh = names
    .map(n => parseInt(n, 10))
    .filter(n => n > ev.last)
    .sort((a, b) => a - b)
    .slice(-KEEP_EVENTS)
  for (const seq of fresh) {
    let e
    try {
      e = readJson(path.join(EVENTS, sid, `${String(seq).padStart(7, '0')}.json`))
    } catch {
      break // mid-write: read it next time, in order
    }
    ev.last = seq
    absorb(sid, ev, e)
    store.version++
  }
  if (ev.items.length > KEEP_EVENTS) {
    for (const it of ev.items.splice(0, ev.items.length - KEEP_EVENTS)) if (it.id) ev.byId.delete(it.id)
  }
}

function absorb(sid, ev, e) {
  if (e.kind === 'done' && e.id && ev.byId.has(e.id)) {
    const it = ev.byId.get(e.id)
    it.running = false
    it.ok = e.ok
    it.ms = e.ms
    it.endT = e.t
    if (e.msg) it.result = e.msg
    if (e.output) it.output = e.output
    return
  }
  const it = {
    key: `${sid}:${e.seq}`,
    sid,
    seq: e.seq,
    t: e.t,
    kind: e.kind === 'done' ? 'call' : e.kind,
    agent: e.agent,
    id: e.id,
    src: e.src,
    tone: e.tone,
    tool: e.tool,
    cat: e.cat,
    label: e.label,
    msg: e.msg,
    code: e.code,
    diff: e.diff,
    output: e.output,
    ok: e.ok,
    ms: e.ms,
    running: e.kind === 'call',
    endT: e.kind === 'done' ? e.t : undefined,
  }
  ev.items.push(it)
  if (e.id) ev.byId.set(e.id, it)
}

export function itemsOf(sid) {
  return evState.get(sid)?.items ?? []
}

/** Every session's events, oldest first. */
export function allItems() {
  const out = []
  for (const st of store.sessions) for (const it of itemsOf(st.sessionId)) out.push(it)
  return out.sort((a, b) => a.t - b.t || a.seq - b.seq)
}

export function isWorking(st) {
  return st.phase !== 'idle' || (st.agents || []).some(a => a.status === 'running')
}
export function stateOf(st, now) {
  if (!st.sessionId) return 'none'
  if (st.ended) return 'ended'
  if (now - (st.updatedAt || 0) > 10000) return 'silent'
  return isWorking(st) ? 'working' : 'idle'
}
export function lastEventAt(st) {
  const items = itemsOf(st.sessionId)
  let t = items.length ? items[items.length - 1].t : 0
  for (const r of st.tools || []) t = Math.max(t, r.started)
  return t
}
export function liveSessions(now) {
  return store.sessions.filter(s => ['working', 'idle'].includes(stateOf(s, now)))
}
export function focused(now) {
  if (store.pinned) return store.sessions.find(s => s.sessionId === store.pinned) ?? emptyState()
  const live = liveSessions(now)
  const pool = live.length ? live : store.sessions
  if (!pool.length) return emptyState()
  return [...pool].sort((a, b) => lastEventAt(b) - lastEventAt(a))[0]
}
export function accentOf(sid) {
  return store.accent.get(sid) ?? P.opus
}
export function ctxPct(st) {
  if (st.ctxPct) return st.ctxPct
  return st.ctxWindow ? Math.round((st.context / st.ctxWindow) * 100) : 0
}
export function ctxLabel(st) {
  const k = n => (n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : n >= 1e4 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0))
  return st.ctxWindow ? `${k(st.context)} / ${k(st.ctxWindow)}` : k(st.context)
}

/**
 * Live figures per kind of tool for one session: calls running now, calls
 * started in each 2-second slot of the last minute, and the last start and end.
 */
export function kindStats(st, now) {
  const items = itemsOf(st.sessionId).filter(i => i.kind === 'call')
  const out = {}
  for (const c of CATS) out[c] = { running: 0, buckets: new Array(30).fill(0), lastStart: 0, lastEnd: 0, lastOk: true, total: st.cats?.[c] ?? 0 }
  for (const it of items) {
    const k = out[it.cat]
    if (!k) continue
    if (it.running && now - it.t < 15 * 60000) k.running++
    const age = now - it.t
    if (age >= 0 && age < 60000) k.buckets[29 - Math.floor(age / 2000)]++
    k.lastStart = Math.max(k.lastStart, it.t)
    if (it.endT && it.endT > k.lastEnd) {
      k.lastEnd = it.endT
      k.lastOk = it.ok !== false
    }
  }
  // Before any event file exists, fall back to the snapshot's running calls.
  if (!items.length) for (const r of st.tools || []) if (r.ms === undefined && out[r.cat]) out[r.cat].running++
  return out
}

export function callsPerMinute(st, now) {
  return itemsOf(st.sessionId).filter(i => i.kind === 'call' && now - i.t < 60000).length
}

/** Pairs of live sessions that edited the same file within two minutes. */
export function conflicts(now) {
  const live = liveSessions(now)
  const out = []
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      for (const f of live[i].files || []) {
        if (!f.abs || now - f.last > 120000) continue
        const g = (live[j].files || []).find(x => x.abs === f.abs && now - x.last < 120000)
        if (g) {
          out.push({ a: live[i].sessionId, b: live[j].sessionId, path: f.path, active: f.active || g.active })
          break
        }
      }
    }
  return out
}

/** SendMessage calls from the last few seconds, with the session they reach if it is one of ours. */
export function messages(now) {
  const out = []
  for (const st of store.sessions) {
    for (const it of itemsOf(st.sessionId)) {
      if (it.tool !== 'SendMessage' || now - it.t > 4000) continue
      const to = String(it.label || '').replace(/^to\s+/, '').toLowerCase()
      const target = store.sessions.find(
        s => s.sessionId !== st.sessionId && to && (s.sessionId.startsWith(to) || projectName(s.cwd).toLowerCase() === to || to.includes(projectName(s.cwd).toLowerCase())),
      )
      out.push({ from: st.sessionId, to: target?.sessionId, label: to, t: it.t })
    }
  }
  return out
}

/** Background tasks worth showing: running, or finished less than 4 s ago. */
export function visibleBg(st, now) {
  return (st.bg || []).filter(b => b.status === 'running' || now - (b.ended ?? 0) < 4000)
}

// ── a background shell's output, tailed live from the file it writes ───────
const outCache = new Map() // path -> { at, size, mtime, lines, total, bytes }
const ESC_RE = new RegExp(String.fromCharCode(27) + '\[[0-9;?]*[A-Za-z]', 'g')
/** The last lines of a background shell's output (re-read at most every 300 ms). */
export function bgOutput(b, now = Date.now()) {
  if (!b?.out) return undefined
  const hit = outCache.get(b.out)
  if (hit && now - hit.at < 300) return hit
  let st
  try {
    st = fs.statSync(b.out)
  } catch {
    return hit
  }
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) {
    hit.at = now
    return hit
  }
  const want = Math.min(st.size, 64 * 1024)
  let text = ''
  try {
    const fd = fs.openSync(b.out, 'r')
    const buf = Buffer.alloc(want)
    fs.readSync(fd, buf, 0, want, st.size - want)
    fs.closeSync(fd)
    text = buf.toString('utf8')
  } catch {
    return hit
  }
  // carriage returns redraw a line in place (progress bars): keep what the terminal would show
  const lines = text
    .replace(ESC_RE, '')
    .split('\n')
    .map(l => l.split('\r').filter(Boolean).pop() ?? '')
  if (st.size > want) lines.shift() // the first line was cut
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const total = (hit && st.size >= hit.size ? hit.total : 0) + (hit && st.size >= hit.size ? (text.slice(Math.max(0, text.length - (st.size - (hit?.size ?? 0)))).match(/\n/g) ?? []).length : (text.match(/\n/g) ?? []).length)
  const out = { at: now, size: st.size, mtime: st.mtimeMs, lines: lines.slice(-400), total: Math.max(total, lines.length), bytes: st.size }
  outCache.set(b.out, out)
  return out
}
