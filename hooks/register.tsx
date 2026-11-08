import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pulse, PulseAgentRun, PulseAttention, PulseBgTask, PulseFile, PulseLogLine, PulseTone, PulseToolRun, PulseTurn } from '../types'
import { capLines, catOf, editedPath, emptyPulse, family, fit, labelOf, langOf, oneLine, prettyModel, relPath, secs } from './lib'

// live-pulse records what this session does (turns, tool calls, subagents,
// files it edits, tokens, context) and writes it four times a second to
// ~/.claude/live-pulse/sessions/<session id>.json. The dashboard
// (dashboard/pulse-dash.mjs) reads every session's file and draws them all in
// a window of its own. Nothing the person types is ever recorded.

const PANE = 'live-pulse'

// Change the tag when the record's fields change: it declines what an earlier
// version stored, which outlives a reload.
const pulseAtom = atom({ plugin: 'live-pulse', key: 'pulse' } as const, emptyPulse(0), {
  shape: 'pulse-5',
})

const SEP = String.fromCharCode(10) + '⋯' + String.fromCharCode(10)
const BACKSLASH = String.fromCharCode(92)
const MAX_LOG = 60
const MAX_TOOLS = 40
const MAX_AGENTS = 6
const MAX_FILES = 24
const MAX_TURNS = 40
const MAX_SAMPLES = 360 // one per 10 s: an hour
const MAX_COMPACTS = 20

let live: Pulse = emptyPulse(Date.now())
let dirty = true
let restored = false
const rateWindow: Array<[number, number]> = []
let lastChunkAt = 0
let ticks = 0
let timer: { cancel: () => void } | undefined
const turnTools = { n: 0 }
const io = {
  dir: '',
  file: '',
  sessionId: '',
  cwd: '',
  lastWrite: 0,
  ctxWindow: 0,
  ctxPct: 0,
  costUsd: 0,
  limits: [] as { kind: string; percentUsed: number; resetsAt?: string }[],
  waiting: undefined as { file: string; owner: string; since: number } | undefined,
  held: new Set<string>(),
  ended: false,
  seq: 0,
  writing: false,
}

function touch(): void {
  dirty = true
}

function log(src: string, tone: PulseTone, msg: string, tag = '', tagTone: PulseTone = 'dim'): void {
  const line: PulseLogLine = { t: Date.now(), src, tone, msg: oneLine(msg), tag, tagTone }
  live.log.push(line)
  if (live.log.length > MAX_LOG) live.log.splice(0, live.log.length - MAX_LOG)
  touch()
}

/**
 * One event, one file: events/<session>/<seq>.json, written once. The
 * dashboard's log reads these, code and all. Never holds what the person typed.
 */
type PulseEvent = {
  kind: 'call' | 'done' | 'turn' | 'turn-done' | 'agent' | 'agent-done' | 'note' | 'attention' | 'attention-clear' | 'compact' | 'turn-summary'
  id?: string
  agent?: string
  src: string
  tone: PulseTone
  tool?: string
  cat?: string
  label?: string
  ok?: boolean
  ms?: number
  msg?: string
  code?: { lang: string; text: string }
  diff?: { path: string; lang: string; old: string; new: string }
  output?: string
  turn?: PulseTurn
  attention?: PulseAttention
}

async function emit($: EngineInterface, ev: PulseEvent): Promise<void> {
  if (!io.dir) return
  io.seq += 1
  const name = String(io.seq).padStart(7, '0')
  try {
    await $.fs.write(`${io.dir}/events/${io.sessionId}/${name}.json`, JSON.stringify({ seq: io.seq, t: Date.now(), ...ev }))
  } catch {
    // the log misses this one line
  }
}

/** The code a call carries: a diff for edits, the command for shells. */
function codeOf(tool: string, input: Record<string, unknown>): Pick<PulseEvent, 'code' | 'diff'> {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  const file = s(input['file_path']) || s(input['notebook_path'])
  const lang = langOf(file)
  const path = relPath(file, io.cwd)
  if (tool === 'Edit') return { diff: { path, lang, old: capLines(s(input['old_string']), 80, 6000), new: capLines(s(input['new_string']), 80, 6000) } }
  if (tool === 'MultiEdit' && Array.isArray(input['edits'])) {
    const edits = input['edits'] as Array<Record<string, unknown>>
    return {
      diff: {
        path,
        lang,
        old: capLines(edits.map(e => s(e['old_string'])).join(SEP), 80, 6000),
        new: capLines(edits.map(e => s(e['new_string'])).join(SEP), 80, 6000),
      },
    }
  }
  if (tool === 'Write') return { code: { lang, text: capLines(s(input['content']), 40, 4000) } }
  if (tool === 'NotebookEdit') return { code: { lang: 'py', text: capLines(s(input['new_source']), 40, 4000) } }
  if (tool === 'Bash') return { code: { lang: 'sh', text: capLines(s(input['command']), 40, 4000) } }
  if (tool === 'PowerShell') return { code: { lang: 'ps1', text: capLines(s(input['command']), 40, 4000) } }
  return {}
}

/** Write the snapshot now rather than at the next tick. */
function kick($: EngineInterface): void {
  dirty = true
  if (!io.writing) void flush($)
}

function agentFor(agentId: string | undefined): PulseAgentRun | undefined {
  if (!agentId) return undefined
  const known = live.agents.find(a => a.agentId === agentId)
  if (known) return known
  // A loop not yet tied to a card: give it the oldest running card with no id.
  const open = live.agents.find(a => a.status === 'running' && !a.agentId)
  if (open) open.agentId = agentId
  return open
}

function srcOf(agent: PulseAgentRun | undefined): [string, PulseTone] {
  return agent ? [`@${agent.type}`, family(agent.model || 'haiku')] : ['main', family(live.model || 'opus')]
}

async function restore($: EngineInterface): Promise<void> {
  if (restored) return
  restored = true
  const stored = await read($, pulseAtom)
  if (stored.startedAt > 0 && (stored.turns > 0 || stored.toolCount > 0)) {
    live = { ...emptyPulse(Date.now()), ...JSON.parse(JSON.stringify(stored)) }
    for (const f of live.files) f.active = false
    // a prompt from before a reload is not on screen any more
    live.attention = undefined
  }
}

function finishAgent($: EngineInterface, card: PulseAgentRun, ok: boolean): void {
  if (card.status !== 'running') return
  card.status = ok ? 'done' : 'failed'
  bgEnd(card.key, ok ? 'done' : 'failed')
  card.ms = Date.now() - card.started
  card.current = ok ? 'finished' : 'stopped'
  log(`@${card.type}`, ok ? 'ok' : 'err', `${ok ? 'finished' : 'failed'}: ${card.desc} · ${card.tools} tools`, ok ? `${secs(card.ms)} ✓` : 'failed ✗', ok ? 'ok' : 'err')
  void emit($, { kind: 'agent-done', agent: card.key, src: `@${card.type}`, tone: family(card.model || 'haiku'), ok, ms: card.ms, msg: `${ok ? 'finished' : 'failed'}: ${card.desc} · ${card.tools} tools` })
  kick($)
  if (live.phase === 'agents' && !live.agents.some(a => a.status === 'running')) {
    live.phase = 'thinking'
    live.activity = 'thinking'
  }
}

const MAX_BG = 12

/** Starts tracking a background task (or refreshes one already known). */
function bgStart(id: string, kind: PulseBgTask['kind'], label: string, agentKey?: string, out?: string): void {
  if (!id) return
  if (!live.bg) live.bg = []
  const known = live.bg.find(b => b.id === id)
  if (known) {
    known.status = 'running'
    known.ended = undefined
    return
  }
  live.bg.push({ id, kind, label: fit(oneLine(label), 400), started: Date.now(), status: 'running', agentKey, out })
  if (live.bg.length > MAX_BG) live.bg.splice(0, live.bg.length - MAX_BG)
  touch()
}

/** Marks a background task finished; the dashboard lets it go a moment later. */
function bgEnd(id: string, status: string, exit?: number): void {
  const b = (live.bg ?? []).find(x => x.id === id || (x.agentKey !== undefined && x.agentKey === id))
  if (!b || b.status !== 'running') return
  const s = status.toLowerCase()
  b.status = s.includes('kill') || s.includes('stop') ? 'killed' : s.includes('fail') || s.includes('error') ? 'failed' : 'done'
  b.ended = Date.now()
  if (exit !== undefined) {
    b.exit = exit
    if (exit !== 0 && b.status === 'done') b.status = 'failed'
  }
  touch()
}

/** The text of a row, whatever its shape, for spotting task notifications. */
function rowText(content: unknown): string {
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content)
  } catch {
    return ''
  }
}

function noteFile(run: PulseToolRun, input: Record<string, unknown>, agent: PulseAgentRun | undefined): PulseFile | undefined {
  const full = editedPath(run.tool, input)
  if (!full) return undefined
  const path = relPath(full, io.cwd)
  let f = live.files.find(x => x.path === path)
  if (!f) {
    f = { path, abs: full.split(BACKSLASH).join('/').toLowerCase(), edits: 0, last: 0, active: false, ok: true, tool: run.tool }
    live.files.unshift(f)
    if (live.files.length > MAX_FILES) live.files.pop()
  } else {
    live.files.splice(live.files.indexOf(f), 1)
    live.files.unshift(f)
  }
  f.edits += 1
  f.last = Date.now()
  f.active = true
  f.tool = run.tool
  f.agent = agent ? `@${agent.type}` : undefined
  f.agentKey = agent?.key
  return f
}

// ── one session at a time per file ─────────────────────────────────────────
// A session that edits a file holds it for LEASE_MS after its last edit (or
// until its turn ends). Another session that wants to edit the same file
// waits for it, up to WAIT_MAX_MS, so their edits never interleave.
const LEASE_MS = 25000
const WAIT_MAX_MS = 90000

function hashOf(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

const lockFile = (abs: string) => `${io.dir}/locks/${hashOf(abs)}.json`

interface Lease {
  session: string
  project: string
  file: string
  at: number
  released?: boolean
}

async function readLease($: EngineInterface, abs: string): Promise<Lease | undefined> {
  try {
    return JSON.parse(await $.fs.read(lockFile(abs))) as Lease
  } catch {
    return undefined
  }
}

/** Whether the session holding a lease still runs: its snapshot is fresh and not ended. */
async function holderAlive($: EngineInterface, session: string): Promise<boolean> {
  try {
    const snap = JSON.parse(await $.fs.read(`${io.dir}/sessions/${session}.json`)) as { updatedAt?: number; ended?: boolean }
    return !snap.ended && Date.now() - (snap.updatedAt ?? 0) < 12000
  } catch {
    return false
  }
}

async function holdFile($: EngineInterface, abs: string, rel: string): Promise<void> {
  const project = io.cwd.split(/[\/]/).filter(Boolean).pop() ?? ''
  try {
    await $.fs.write(lockFile(abs), JSON.stringify({ session: io.sessionId, project, file: rel, at: Date.now() } satisfies Lease))
    io.held.add(abs)
  } catch {
    // without a lease the edit still goes ahead
  }
}

/** Waits while another live session holds the file; returns how long it waited. */
async function waitForFile($: EngineInterface, abs: string, rel: string): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < WAIT_MAX_MS) {
    const l = await readLease($, abs)
    const busy = l && !l.released && l.session !== io.sessionId && Date.now() - l.at < LEASE_MS && (await holderAlive($, l.session))
    if (!busy) break
    if (!io.waiting) {
      io.waiting = { file: rel, owner: l!.project || l!.session.slice(0, 8), since: start }
      log('main', 'warn', `waiting for ${rel}: ${io.waiting.owner} is editing it`, 'waiting', 'warn')
      touch()
      await flush($)
    }
    await $.clock.sleep(1000)
  }
  const waited = Date.now() - start
  if (io.waiting) {
    io.waiting = undefined
    log('main', 'ok', `${rel} is free after ${secs(waited)}`, 'go', 'ok')
    touch()
  }
  return waited
}

async function releaseFiles($: EngineInterface): Promise<void> {
  for (const abs of io.held) {
    const l = await readLease($, abs)
    if (l && l.session === io.sessionId) {
      try {
        await $.fs.write(lockFile(abs), JSON.stringify({ ...l, released: true }))
      } catch {
        // it expires by itself
      }
    }
  }
  io.held.clear()
}

async function flush($: EngineInterface): Promise<void> {
  ticks += 1
  const now = Date.now()
  while (rateWindow.length > 0 && now - rateWindow[0]![0] > 3000) rateWindow.shift()
  const sum = rateWindow.reduce((s, [, n]) => s + n, 0)
  const span = rateWindow.length > 1 ? Math.max(500, now - rateWindow[0]![0]) : 1000
  const rate = now - lastChunkAt > 2500 ? 0 : Math.round((sum / span) * 1000)
  if (rate !== live.rate) {
    live.rate = rate
    dirty = true
  }

  // Every two seconds, check running agents against the engine's own list.
  if (ticks % 8 === 0 && live.agents.some(a => a.status === 'running')) {
    try {
      const list = await $.agent.list()
      for (const card of live.agents) {
        if (card.status !== 'running') continue
        const info =
          list.find(a => a.id === card.agentId) ??
          (card.agentId ? undefined : list.find(a => a.description === card.desc))
        if (!info) continue
        card.agentId = info.id
        if (info.status === 'completed' || info.status === 'idle') finishAgent($, card, true)
        else if (info.status === 'failed' || info.status === 'killed') finishAgent($, card, false)
      }
    } catch {
      // The list is a nicety; the events carry the same news.
    }
  }

  // The context window as the status line reads it.
  if (ticks % 4 === 0) {
    try {
      const u = await $.session.usage()
      if (u.context.tokens !== undefined && u.context.tokens !== live.context) {
        live.context = u.context.tokens
        dirty = true
      }
      io.ctxWindow = u.context.window
      io.ctxPct = u.context.percent ?? (u.context.window ? Math.round((live.context / u.context.window) * 100) : 0)
      const usd = u.cost?.usd ?? 0
      if (Math.abs(usd - io.costUsd) >= 0.001) dirty = true
      io.costUsd = usd
      io.limits = (u.rateLimits ?? []).map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
    } catch {
      // keep the last figures
    }
  }

  const isHeartbeat = now - io.lastWrite > 2000
  if (!dirty && !isHeartbeat) return
  const wasDirty = dirty
  dirty = false
  if (io.file) {
    io.lastWrite = now
    io.writing = true
    try {
      await $.fs.write(
        io.file,
        JSON.stringify({
          ...live,
          sessionId: io.sessionId,
          cwd: io.cwd,
          updatedAt: now,
          ctxWindow: io.ctxWindow,
          ctxPct: io.ctxPct,
          costUsd: io.costUsd,
          limits: io.limits,
          waiting: io.waiting,
          ended: io.ended,
        }),
      )
    } catch {
      // the window shows the last record it read
    }
    io.writing = false
  }
  if (!wasDirty) return
  const snapshot: Pulse = JSON.parse(JSON.stringify(live))
  await update($, pulseAtom, () => snapshot)
}

/** The turn in progress, if any. */
function openTurn(): PulseTurn | undefined {
  const t = live.turnLog[live.turnLog.length - 1]
  return t && t.end === undefined ? t : undefined
}

const turnBase = { cost: 0, inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0 }
let lastTick = 0
let lastSample = 0

function tick($: EngineInterface): void {
  const now = Date.now()
  const dt = lastTick ? Math.min(1000, now - lastTick) : 0
  lastTick = now
  // where the turn's time goes: thinking, writing, or tools and subagents
  const t = openTurn()
  if (t && dt) {
    if (live.phase === 'thinking') t.think += dt
    else if (live.phase === 'writing') t.write += dt
    else if (live.phase === 'tool' || live.phase === 'agents') t.tools += dt
  }
  // a sample every ten seconds for the charts
  if (now - lastSample >= 10000) {
    lastSample = now
    live.history.push({ t: now, cost: io.costUsd, out: live.outTok, ctx: io.ctxPct, calls: live.toolCount })
    if (live.history.length > MAX_SAMPLES) live.history.splice(0, live.history.length - MAX_SAMPLES)
    touch()
  }
  void flush($)
}

function beginTurn(): void {
  turnBase.cost = io.costUsd
  turnBase.inTok = live.inTok
  turnBase.outTok = live.outTok
  turnBase.cacheRead = live.cacheRead
  turnBase.cacheWrite = live.cacheWrite
  live.turnLog.push({
    n: live.turns,
    start: Date.now(),
    think: 0,
    write: 0,
    tools: 0,
    calls: 0,
    errors: 0,
    cats: {},
    files: 0,
    agents: 0,
    cost: 0,
    inTok: 0,
    outTok: 0,
    cacheRead: 0,
    cacheWrite: 0,
  })
  if (live.turnLog.length > MAX_TURNS) live.turnLog.splice(0, live.turnLog.length - MAX_TURNS)
}

async function endTurn($: EngineInterface, aborted: boolean): Promise<PulseTurn | undefined> {
  const t = openTurn()
  if (!t) return undefined
  // the cost the status line has now, not the one read a second ago
  try {
    const u = await $.session.usage()
    io.costUsd = u.cost?.usd ?? io.costUsd
  } catch {
    // keep the last figure
  }
  t.end = Date.now()
  t.ms = t.end - t.start
  if (aborted) t.aborted = true
  t.cost = Math.max(0, io.costUsd - turnBase.cost)
  t.inTok = live.inTok - turnBase.inTok
  t.outTok = live.outTok - turnBase.outTok
  t.cacheRead = live.cacheRead - turnBase.cacheRead
  t.cacheWrite = live.cacheWrite - turnBase.cacheWrite
  return t
}

let pendingAsk: PulseAttention | undefined

/** A prompt is on the person's screen: the kept ask becomes "needs you". */
function promoteAsk($: EngineInterface, tool: string): void {
  if (live.attention?.kind === 'permission') return
  const a = pendingAsk && (!tool || pendingAsk.tool === tool || !pendingAsk.tool) ? pendingAsk : pendingAsk ?? { kind: 'permission' as const, tool: tool || 'a tool', label: '', since: Date.now() }
  setAttention($, { ...a, since: Date.now() })
}

function attentionText(a: PulseAttention): string {
  if (a.kind === 'permission') return `allow ${a.tool} ${a.label}`
  if (a.kind === 'question') return 'a question'
  return 'a plan to approve'
}

function setAttention($: EngineInterface, a: PulseAttention): void {
  live.attention = a
  log('main', 'warn', `needs you: ${attentionText(a)}`, 'needs you', 'warn')
  void emit($, { kind: 'attention', src: 'main', tone: 'warn', msg: attentionText(a), attention: a })
  kick($)
}

function clearAttention($: EngineInterface): void {
  pendingAsk = undefined
  if (!live.attention) return
  const a = live.attention
  live.attention = undefined
  void emit($, { kind: 'attention-clear', src: 'main', tone: 'dim', ms: Date.now() - a.since, attention: a })
  kick($)
}

/** Lines in a text, for the +/- counts of an edit. */
function lineCount(v: unknown): number {
  return typeof v === 'string' && v.length ? v.split('\n').length : 0
}

async function locate($: EngineInterface, cwd: string): Promise<void> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  if (!home) return
  io.sessionId = await $.session.id()
  io.cwd = cwd
  io.dir = `${home.split('\\').join('/')}/.claude/live-pulse`
  io.file = `${io.dir}/sessions/${io.sessionId}.json`
  try {
    const names = await $.fs.list(`${io.dir}/events/${io.sessionId}`)
    for (const n of names) io.seq = Math.max(io.seq, parseInt(n.name, 10) || 0)
  } catch {
    // no events yet
  }
}

const NO_NODE =
  'Live Pulse needs Node.js: install it (winget install OpenJS.NodeJS.LTS), restart the computer, then run /pulse.'

/**
 * Node's full path. A terminal started by a process that began before Node was
 * installed has no `node` on its PATH, so the window is launched by full path.
 */
async function findNode($: EngineInterface): Promise<string | undefined> {
  try {
    const r = await $.process.run(['where.exe', 'node'], { timeoutMs: 5000 })
    const hit = r.stdout
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(l => /node\.exe$/i.test(l))
    if (r.exitCode === 0 && hit) return hit
  } catch {
    // no where.exe: try the usual places below
  }
  const home = io.dir.replace(/\/\.claude\/live-pulse$/, '')
  const places = [
    'C:/Program Files/nodejs/node.exe',
    'C:/Program Files (x86)/nodejs/node.exe',
    `${home}/AppData/Local/Programs/nodejs/node.exe`,
    `${home}/scoop/apps/nodejs-lts/current/node.exe`,
    `${home}/scoop/apps/nodejs/current/node.exe`,
  ]
  for (const p of places) {
    try {
      if (await $.fs.exists(p)) return p
    } catch {
      // keep looking
    }
  }
  return undefined
}

/** Opens the dashboard in a window of its own, unless one is already up. */
async function launchWindow($: EngineInterface): Promise<string> {
  if (!io.dir) return 'no home folder found'
  try {
    const beat = Number(await $.fs.read(`${io.dir}/dash.alive`))
    if (Date.now() - beat < 4000) return 'already open'
  } catch {
    // no window yet
  }
  const script = `${$.plugin.root.split('\\').join('/')}/dashboard/run.mjs`
  const node = await findNode($)
  if (!node) {
    $.ui.toast(NO_NODE)
    return NO_NODE
  }
  try {
    const r = await $.process.run(
      ['wt.exe', '-w', 'new', '--focus', '--pos', '0,0', 'new-tab', '--title', 'Live Pulse', '--suppressApplicationTitle', node, script],
      { timeoutMs: 15000 },
    )
    if (r.exitCode === 0) return 'opened'
  } catch {
    // no Windows Terminal: fall back below
  }
  try {
    await $.process.run(['cmd.exe', '/c', 'start', 'Live Pulse', node, script], { timeoutMs: 15000 })
    return 'opened'
  } catch (err) {
    return `could not open a window: ${String(err)}`
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await restore($)
    await $.command.register({
      name: 'pulse',
      description: 'Live dashboard of every Claude session, in its own window: /pulse, /pulse auto, /pulse reset',
      argumentHint: '[auto|reset]',
    })
    await locate($, e.cwd)
    io.ended = false
    try {
      const r = await $.session.repo()
      if (r) live.repo = { root: r.root, remote: r.remote }
    } catch {
      // not a repository
    }
    void $.ui.close({ id: PANE })
    timer?.cancel()
    timer = $.clock.every(250, () => {
      tick($)
    })
    if (live.log.length === 0) log('main', 'dim', 'session connected to live pulse', 'online', 'ok')
    void emit($, { kind: 'note', src: 'main', tone: 'dim', msg: `session connected · ${io.cwd}` })
    if ((await $.store.get('autoWindow')) !== false) await launchWindow($)

    return next(e)
  })

  on('command.run', { command: 'pulse' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'auto') {
      const isOn = (await $.store.get('autoWindow')) !== false
      await $.store.set('autoWindow', !isOn)
      return { text: `Live Pulse window ${isOn ? 'no longer opens' : 'opens'} by itself when a session starts.` }
    }
    if (arg === 'reset') {
      live = emptyPulse(Date.now())
      rateWindow.length = 0
      log('main', 'dim', 'counters reset', 'reset', 'ok')
      await flush($)
      return { text: 'Live Pulse counters reset for this session.' }
    }
    const how = await launchWindow($)

    return {
      text:
        how === 'already open'
          ? 'The Live Pulse window is already open.'
          : how === 'opened'
            ? 'Live Pulse window opened.'
            : `Live Pulse: ${how}`,
    }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      live.turns += 1
      live.turnStarted = Date.now()
      clearAttention($)
      beginTurn()
      live.phase = 'thinking'
      live.activity = 'thinking'
      turnTools.n = 0
      log('main', family(live.model || 'opus'), `turn ${live.turns} started`, `turn ${live.turns}`, 'text')
      void emit($, { kind: 'turn', src: 'main', tone: family(live.model || 'opus'), msg: `turn ${live.turns} started` })
      kick($)
    } else {
      const card = agentFor(e.agentId)
      if (card) {
        card.current = 'thinking'
        touch()
      }
    }

    return next(e)
  })

  // The response as it streams: phase, the tool being prepared, a
  // tokens-per-second reading and the exact usage at each request's end.
  on('turn.step', async function* ($, e, next) {
    const card = agentFor(e.agentId)
    if (!e.agentId) {
      if (e.model && e.model !== live.model) {
        if (live.model) log('main', 'dim', `model switched to ${prettyModel(e.model)}`, 'model', family(e.model))
        live.model = e.model
      }
      if (e.effort !== undefined) live.effort = String(e.effort)
      touch()
    } else if (card && e.model) {
      card.model = e.model
    }

    for await (const c of next(e)) {
      const now = Date.now()
      if (c.kind === 'text' || c.kind === 'thinking' || c.kind === 'input') {
        const chars = c.kind === 'input' ? c.json.length : c.text.length
        rateWindow.push([now, chars / 4])
        lastChunkAt = now
        if (card) {
          card.outTok += chars / 4
          if (c.kind !== 'input') card.current = c.kind === 'thinking' ? 'thinking' : 'writing'
        } else if (!e.agentId && live.phase !== 'agents') {
          const phase = c.kind === 'thinking' ? 'thinking' : c.kind === 'text' ? 'writing' : live.phase
          if (phase !== live.phase) {
            live.phase = phase
            live.activity = phase === 'thinking' ? 'thinking' : 'writing a reply'
          }
        }
        touch()
      } else if (c.kind === 'tool') {
        if (card) card.current = `preparing ${c.name}`
        else if (!e.agentId) {
          live.phase = 'tool'
          live.activity = `preparing ${c.name}`
        }
        touch()
      } else if (c.kind === 'stop' && c.usage) {
        const u = c.usage
        live.inTok += u.input_tokens
        live.outTok += u.output_tokens
        live.cacheRead += u.cache_read_input_tokens ?? 0
        live.cacheWrite += u.cache_creation_input_tokens ?? 0
        touch()
      }
      yield c
    }
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const card = agentFor(e.agentId)
    const run: PulseToolRun = {
      id: e.tool_use_id ?? `t${live.toolCount + 1}`,
      n: live.toolCount + 1,
      tool,
      cat: catOf(tool),
      label: labelOf(tool, input, io.cwd),
      agentId: e.agentId,
      started: Date.now(),
    }
live.toolCount += 1
    live.cats[run.cat] += 1
    const turn = openTurn()
    if (turn) {
      turn.calls += 1
      turn.cats[run.cat] = (turn.cats[run.cat] ?? 0) + 1
    }
    if (tool.startsWith('mcp__')) {
      const server = tool.split('__')[1] ?? 'mcp'
      live.mcp[server] = (live.mcp[server] ?? 0) + 1
    }
    // a permission granted: the call it was for is running now
    if (live.attention?.kind === 'permission') clearAttention($)
    if (tool === 'AskUserQuestion') setAttention($, { kind: 'question', tool, label: 'a question for you', since: Date.now(), id: run.id })
    if (tool === 'ExitPlanMode') setAttention($, { kind: 'plan', tool, label: 'plan ready for approval', since: Date.now(), id: run.id })
    live.tools.push(run)
    if (live.tools.length > MAX_TOOLS) live.tools.splice(0, live.tools.length - MAX_TOOLS)
    const file = noteFile(run, input, card)
    if (file) {
      if (turn && file.edits === 1) turn.files += 1
      const edits = Array.isArray(input['edits']) ? (input['edits'] as Array<Record<string, unknown>>) : [input]
      if (tool === 'Write') file.added = (file.added ?? 0) + lineCount(input['content'])
      else
        for (const ed of edits) {
          file.added = (file.added ?? 0) + lineCount(ed['new_string'])
          file.removed = (file.removed ?? 0) + lineCount(ed['old_string'])
        }
    }
    if (card) {
      card.tools += 1
      card.current = fit(`${tool} ${run.label}`, 60)
    } else if (!e.agentId) {
      turnTools.n += 1
      live.phase = run.cat === 'agent' ? 'agents' : 'tool'
      live.activity = fit(`${tool} · ${run.label}`, 120)
    }
    const [src0, tone0] = srcOf(card)
    void emit($, { kind: 'call', id: run.id, agent: card?.key, src: src0, tone: tone0, tool, cat: run.cat, label: run.label, ...codeOf(tool, input) })
    kick($)

    // another session editing the same file right now: let it finish first
    if (file?.abs) {
      await waitForFile($, file.abs, file.path)
      await holdFile($, file.abs, file.path)
    }

    const ran = await next(e)
    if (file?.abs) await holdFile($, file.abs, file.path)

    run.ms = Date.now() - run.started
    run.ok = ran.deny === undefined && ran.isError !== true
    run.out = ran.deny !== undefined ? 'denied' : ran.isError ? 'error' : outGist(tool, ran.text)
    live.toolMs += run.ms
    if (run.ok) live.okCount += 1
    else {
      live.errCount += 1
      if (turn) turn.errors += 1
    }
    if (live.attention && live.attention.id === run.id) clearAttention($)
    if (pendingAsk?.id === run.id) pendingAsk = undefined
    if (file) {
      file.active = false
      file.ok = run.ok
    }
    if (!e.agentId && live.phase !== 'agents') {
      live.phase = 'thinking'
      live.activity = 'thinking'
    }
    const [src, tone] = srcOf(card)
    log(
      src,
      tone,
      `${tool} ${run.label}${run.out ? ' → ' + run.out : ''}`,
      run.ok ? `${secs(run.ms)} ✓` : `${run.out} ✗`,
      run.ok ? 'ok' : 'err',
    )
    // background work: a shell or monitor started with run_in_background, a background agent
    if (run.ok && input['run_in_background'] === true) {
      const id = (ran.text ?? '').match(/\bID:\s*([A-Za-z0-9_-]+)/)?.[1] ?? run.id
      const outFile = (ran.text ?? '').match(/Output is being written to:\s*(\S[^\n]*?\.output)/)?.[1]
      if (tool === 'Bash' || tool === 'PowerShell') bgStart(id, 'shell', String(input['command'] ?? run.label), undefined, outFile)
      else if (tool === 'Agent' || tool === 'Task') {
        const spawned = live.agents.find(a => a.key === run.id)
        bgStart(spawned?.agentId ?? id, 'agent', `@${spawned?.type ?? 'agent'} · ${spawned?.desc ?? run.label}`, run.id)
      }
    }
    if (run.ok && tool === 'Monitor') bgStart((ran.text ?? '').match(/\bID:\s*([A-Za-z0-9_-]+)/)?.[1] ?? run.id, 'monitor', String(input['description'] ?? run.label))
    if (tool === 'KillShell' || tool === 'TaskStop') bgEnd(String(input['shell_id'] ?? input['task_id'] ?? ''), 'killed')
    const wantsOutput = ['Bash', 'PowerShell', 'BashOutput', 'Grep', 'Glob'].includes(tool)
    void emit($, {
      kind: 'done',
      id: run.id,
      src,
      tone,
      tool,
      cat: run.cat,
      label: run.label,
      ok: run.ok,
      ms: run.ms,
      msg: ran.deny !== undefined ? `denied: ${oneLine(ran.deny)}` : run.out,
      output: wantsOutput && ran.text ? capLines(ran.text, 20, 2000) : ran.isError && ran.text ? capLines(ran.text, 12, 1500) : undefined,
    })
    kick($)

    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const card: PulseAgentRun = {
      key: e.tool_use_id,
      desc: oneLine(e.description),
      type: e.subagentType || 'general-purpose',
      model: '',
      status: 'running',
      tools: 0,
      outTok: 0,
      current: 'starting',
      started: Date.now(),
      parent: agentFor(e.parentAgentId)?.key,
    }
    live.agents.push(card)
    const turnNow = openTurn()
    if (turnNow) turnNow.agents += 1
    if (live.agents.length > MAX_AGENTS) {
      const doneIdx = live.agents.findIndex(a => a.status !== 'running')
      live.agents.splice(doneIdx >= 0 ? doneIdx : 0, 1)
    }
    live.phase = 'agents'
    live.activity = `waiting on @${card.type}`
    log('main', family(live.model || 'opus'), `started @${card.type}: ${card.desc}`, 'agent', 'haiku')
    void emit($, { kind: 'agent', agent: card.key, label: card.parent, src: 'main', tone: 'haiku', msg: `started @${card.type}: ${card.desc}` })
    kick($)

    const r = await next(e)

    if (r.deny !== undefined) {
      card.status = 'failed'
      card.current = 'refused'
      log('main', 'err', `@${card.type} refused: ${oneLine(r.deny)}`, 'denied ✗', 'err')
    } else {
      card.agentId = r.agentId ?? card.agentId
      card.model = r.model || card.model
      card.current = 'running'
    }
    touch()

    return r
  })

// a permission prompt: the session waits for the person
  // An ask is only a question for the mode's decider: in auto mode the
  // classifier usually settles it with no prompt at all. So an ask is kept
  // aside, and becomes "needs you" only when a prompt is really put to the person.
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (r.decision === 'ask' && !e.agentId && e.tool_use_id) {
      const input = (e.input ?? {}) as Record<string, unknown>
      pendingAsk = { kind: 'permission', tool: e.tool, label: labelOf(e.tool, input, io.cwd), since: Date.now(), id: e.tool_use_id }
    }
    return r
  })

  // the permission dialog is about to show (in auto mode the classifier may still settle it)
  on('classic.PermissionRequest', async ($, e, next) => {
    const r = await next(e)
    const mode = String((e as unknown as { permission_mode?: string }).permission_mode ?? '')
    const decided = (r as unknown as { decision?: unknown } | undefined)?.decision !== undefined
    if (!decided && !['auto', 'bypassPermissions', 'dontAsk'].includes(mode)) promoteAsk($, String((e as unknown as { tool_name?: string }).tool_name ?? ''))
    return r
  })

  // Claude Code tells the person it waits for their permission: certain
  on('classic.Notification', async ($, e, next) => {
    const n = e as unknown as { notification_type?: string; message?: string }
    if (n.notification_type === 'permission_prompt' || /permission/i.test(n.message ?? '')) {
      const tool = /use (\S+)/.exec(n.message ?? '')?.[1] ?? ''
      promoteAsk($, tool)
    }
    return next(e)
  })

  // refused: nothing waits any more
  on('classic.PermissionDenied', async ($, e, next) => {
    pendingAsk = undefined
    if (live.attention?.kind === 'permission') clearAttention($)
    return next(e)
  })

  // the conversation compacted: how much context it freed
  on('session.compact', async ($, e, next) => {
    const before = live.context
    const r = await next(e)
    let after: number | undefined
    try {
      after = (await $.session.usage()).context.tokens
      if (after !== undefined) live.context = after
    } catch {
      // the next tick reads it
    }
    if (!e.agentId) {
      live.compacts.push({ t: Date.now(), trigger: e.trigger, before, after })
      if (live.compacts.length > MAX_COMPACTS) live.compacts.splice(0, live.compacts.length - MAX_COMPACTS)
      const freed = after !== undefined ? `: ${Math.round(before / 1000)}k → ${Math.round(after / 1000)}k` : ''
      log('main', 'warn', `context compacted (${e.trigger})${freed}`, 'compact', 'warn')
      void emit($, { kind: 'compact', src: 'main', tone: 'warn', msg: `compacted (${e.trigger})`, label: e.trigger })
      kick($)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await releaseFiles($)
      clearAttention($)
      const done = await endTurn($, e.isAborted)
      if (done) void emit($, { kind: 'turn-summary', src: 'main', tone: e.isAborted ? 'warn' : 'ok', turn: done })
      live.phase = 'idle'
      live.lastTurnMs = e.durationMs
      live.activity = ''
      log(
        'main',
        family(live.model || 'opus'),
        e.isAborted
          ? `turn ${live.turns} interrupted after ${secs(e.durationMs)}`
          : `turn ${live.turns} done in ${secs(e.durationMs)} · ${turnTools.n} tools`,
        e.isAborted ? 'stopped' : 'done ✓',
        e.isAborted ? 'warn' : 'ok',
      )
      void emit($, { kind: 'turn-done', src: 'main', tone: e.isAborted ? 'warn' : 'ok', ok: !e.isAborted, ms: e.durationMs, msg: e.isAborted ? `turn ${live.turns} interrupted` : `turn ${live.turns} done · ${turnTools.n} tools` })
      kick($)
    } else {
      const card = agentFor(e.agentId)
      if (card) finishAgent($, card, !e.isAborted)
    }

    return next(e)
  })

  // a background task's end arrives as a notification row in the conversation
  on('session.append', async ($, e, next) => {
    const text = rowText(e.message.content)
    if (text.includes('task-notification')) {
      const re = /<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([^<]+)<\/status>(?:[\s\S]*?<summary>([^<]*)<\/summary>)?/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        const code = (m[3] ?? '').match(/exit code (-?\d+)/)?.[1]
        bgEnd(m[1]!.trim(), m[2]!.trim(), code === undefined ? undefined : Number(code))
      }
    }
    return next(e)
  })

  // at the end of every turn, the engine's own list settles what is still running
  on('classic.Stop', async ($, e, next) => {
    const listed = (e as unknown as { background_tasks?: Array<{ id: string; type: string; status: string; description: string; command?: string }> }).background_tasks
    if (Array.isArray(listed)) {
      const now = Date.now()
      for (const t of listed) {
        const running = /run|pend|active/i.test(t.status)
        if (running) {
          const kind = t.type === 'shell' ? 'shell' : t.type === 'subagent' ? 'agent' : t.type === 'monitor' ? 'monitor' : t.type === 'workflow' ? 'workflow' : 'task'
          bgStart(t.id, kind, t.command ?? t.description)
        } else bgEnd(t.id, t.status)
      }
      for (const b of live.bg ?? []) if (b.status === 'running' && now - b.started > 5000 && !listed.some(t => t.id === b.id) && !b.agentKey) bgEnd(b.id, 'done')
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    timer = undefined
    io.ended = true
    live.phase = 'idle'
    dirty = true
    await releaseFiles($)
    await flush($)

    return next(e)
  })
}

function outGist(tool: string, text: string | undefined): string {
  if (!text) return ''
  if (tool === 'Read') return `${text.split('\n').length} lines`
  if (tool === 'Glob' || tool === 'Grep') return `${text.split('\n').filter(l => l.trim().length > 0).length} hits`
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write' || tool === 'NotebookEdit') return 'saved'
  return ''
}
