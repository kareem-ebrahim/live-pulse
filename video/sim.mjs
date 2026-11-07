// A small simulator that writes session snapshots and event files in exactly
// the shape the live-pulse mod writes them, on a virtual clock, so the
// dashboard draws a scripted scenario as if it were happening live.
import fs from 'node:fs'
import path from 'node:path'

const CATS = { Edit: 'edit', MultiEdit: 'edit', Write: 'edit', Bash: 'exec', PowerShell: 'exec', Read: 'read', Grep: 'read', Glob: 'read', Agent: 'agent', SendMessage: 'agent', WebFetch: 'web', WebSearch: 'web' }

export class Sim {
  constructor(dir, base) {
    this.dir = dir
    this.base = base
    this.queue = []
    this.sessions = new Map()
    this.now = base
    this.keys = new Map() // names given to events, for the director
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true })
  }
  /** Runs `fn` when the clock reaches `t` seconds (negative: before the video starts). */
  at(t, fn) {
    this.queue.push({ t, fn })
    this.queue.sort((a, b) => a.t - b.t)
  }
  advance(t) {
    while (this.queue.length && this.queue[0].t <= t) {
      const job = this.queue.shift()
      this.now = this.base + job.t * 1000
      job.fn()
    }
    this.now = this.base + t * 1000
    for (const s of this.sessions.values()) s.write(this.now)
  }
  session(id, cwd, model, o = {}) {
    const s = new SimSession(this, id, cwd, model, o)
    this.sessions.set(id, s)
    return s
  }
}

class SimSession {
  constructor(sim, id, cwd, model, o) {
    this.sim = sim
    this.id = id
    this.seq = 0
    this.n = o.toolsBefore ?? 0
    fs.mkdirSync(path.join(sim.dir, 'events', id), { recursive: true })
    this.st = {
      model,
      effort: o.effort ?? 'high',
      phase: 'idle',
      activity: '',
      turns: o.turns ?? 0,
      turnStarted: sim.base - 600000,
      lastTurnMs: 0,
      inTok: 4000,
      outTok: o.outTok ?? 20000,
      cacheRead: 800000,
      cacheWrite: 30000,
      context: o.context ?? 120000,
      rate: 0,
      tools: [],
      toolCount: this.n,
      okCount: this.n,
      errCount: 0,
      toolMs: this.n * 900,
      cats: { edit: 0, exec: 0, read: 0, mcp: 0, agent: 0, web: 0, ...(o.cats ?? {}) },
      agents: [],
      files: [],
      log: [],
      startedAt: sim.base - (o.age ?? 3600) * 1000,
      cwd,
      sessionId: id,
      updatedAt: sim.base,
      ctxWindow: o.window ?? 1000000,
      ctxPct: 0,
      ended: false,
    }
    this.ctx(this.st.context)
    this.calls = new Map()
  }
  get now() {
    return this.sim.now
  }
  emit(ev, name) {
    this.seq++
    const file = path.join(this.sim.dir, 'events', this.id, String(this.seq).padStart(7, '0') + '.json')
    fs.writeFileSync(file, JSON.stringify({ seq: this.seq, t: this.now, ...ev }))
    if (name) this.sim.keys.set(name, `${this.id}:${this.seq}`)
  }
  write(now) {
    const st = this.st
    st.updatedAt = now
    const working = st.phase !== 'idle'
    st.rate = working ? Math.round(240 + 110 * Math.sin(now / 900 + this.id.length)) : 0
    if (working) st.outTok += st.rate / 30
    fs.writeFileSync(path.join(this.sim.dir, 'sessions', this.id + '.json'), JSON.stringify(st))
  }
  ctx(tokens) {
    this.st.context = tokens
    this.st.ctxPct = Math.round((tokens / this.st.ctxWindow) * 100)
  }
  turn() {
    const st = this.st
    st.turns++
    st.turnStarted = this.now
    st.phase = 'thinking'
    st.activity = 'thinking'
    this.emit({ kind: 'turn', src: 'main', tone: family(st.model), msg: `turn ${st.turns} started` })
  }
  turnDone() {
    const st = this.st
    st.phase = 'idle'
    st.lastTurnMs = this.now - st.turnStarted
    st.activity = ''
    this.emit({ kind: 'turn-done', src: 'main', tone: 'ok', ok: true, ms: st.lastTurnMs, msg: `turn ${st.turns} done` })
  }
  phase(p, activity) {
    this.st.phase = p
    this.st.activity = activity
  }
  /** A tool call from `t` for `dur` seconds. `o.agent` is a subagent's key. */
  call(t, dur, tool, label, o = {}) {
    const id = `c${this.id}${++this.n}${Math.random().toString(36).slice(2, 6)}`
    const n = this.n
    this.sim.at(t, () => {
      const st = this.st
      const cat = CATS[tool] ?? 'mcp'
      const agent = o.agent ? st.agents.find(a => a.key === o.agent) : undefined
      const run = { id, n, tool, cat, label, agentId: agent?.agentId, started: this.now }
      st.tools.push(run)
      if (st.tools.length > 40) st.tools.shift()
      st.toolCount++
      st.cats[cat]++
      if (agent) {
        agent.tools++
        agent.current = `${tool} ${label}`
      } else {
        st.phase = cat === 'agent' ? 'agents' : 'tool'
        st.activity = `${tool} · ${label}`
      }
      if (o.file) {
        let f = st.files.find(x => x.path === label)
        if (!f) {
          f = { path: label, abs: o.file.toLowerCase(), edits: 0, last: 0, active: false, ok: true, tool }
          st.files.unshift(f)
        } else {
          st.files.splice(st.files.indexOf(f), 1)
          st.files.unshift(f)
        }
        f.edits++
        f.last = this.now
        f.active = true
        f.agent = agent ? '@' + agent.type : undefined
        f.agentKey = agent?.key
      }
      this.calls.set(id, { run, agent, file: o.file ? st.files.find(x => x.path === label) : undefined })
      this.emit({ kind: 'call', id, agent: agent?.key, src: agent ? '@' + agent.type : 'main', tone: agent ? 'haiku' : family(st.model), tool, cat, label, code: o.code, diff: o.diff }, o.name)
    })
    this.sim.at(t + dur, () => {
      const st = this.st
      const c = this.calls.get(id)
      if (!c) return
      const ok = o.ok !== false
      c.run.ms = Math.round(dur * 1000)
      c.run.ok = ok
      c.run.out = o.out ?? (ok ? 'ok' : 'error')
      st.toolMs += c.run.ms
      if (ok) st.okCount++
      else st.errCount++
      if (c.file) {
        c.file.active = false
        c.file.ok = ok
      }
      if (!c.agent && st.phase !== 'agents') {
        st.phase = 'thinking'
        st.activity = 'thinking'
      }
      this.emit({ kind: 'done', id, src: c.agent ? '@' + c.agent.type : 'main', tone: 'ok', tool, ok, ms: c.run.ms, msg: c.run.out, output: o.output })
    })
    return id
  }
  spawn(t, key, type, desc, model) {
    this.sim.at(t, () => {
      const st = this.st
      st.agents.push({ key, agentId: key, desc, type, model, status: 'running', tools: 0, outTok: 0, current: 'starting', started: this.now })
      st.phase = 'agents'
      st.activity = `waiting on @${type}`
      this.emit({ kind: 'agent', src: 'main', tone: 'haiku', msg: `started @${type}: ${desc}` })
    })
  }
  agentDone(t, key) {
    this.sim.at(t, () => {
      const a = this.st.agents.find(x => x.key === key)
      if (!a) return
      a.status = 'done'
      a.ms = this.now - a.started
      a.current = 'finished'
      this.emit({ kind: 'agent-done', src: '@' + a.type, tone: 'ok', ok: true, ms: a.ms, msg: `finished: ${a.desc} · ${a.tools} tools` })
      if (!this.st.agents.some(x => x.status === 'running') && this.st.phase === 'agents') this.phase('thinking', 'thinking')
    })
  }
}

function family(m) {
  m = m.toLowerCase()
  return m.includes('haiku') ? 'haiku' : m.includes('sonnet') ? 'sonnet' : 'opus'
}
