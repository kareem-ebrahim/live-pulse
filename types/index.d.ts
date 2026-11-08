export type PulseTone = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'text' | 'dim' | 'ok' | 'err' | 'warn'

export type PulseCat = 'edit' | 'exec' | 'read' | 'mcp' | 'agent' | 'web'

/** One line of the session's live log. Never holds what the person typed. */
export type PulseLogLine = {
  t: number
  src: string
  tone: PulseTone
  msg: string
  tag: string
  tagTone: PulseTone
}

export type PulseToolRun = {
  id: string
  n: number
  tool: string
  cat: PulseCat
  label: string
  agentId?: string
  started: number
  ms?: number
  ok?: boolean
  out?: string
}

export type PulseAgentRun = {
  key: string
  agentId?: string
  desc: string
  type: string
  model: string
  status: 'running' | 'done' | 'failed'
  tools: number
  outTok: number
  current: string
  started: number
  ms?: number
  /** the card of the subagent that started this one; absent when the main loop did */
  parent?: string
}

/** A file the session edited: the path relative to the project when inside it. */
export type PulseFile = {
  path: string
  abs: string
  edits: number
  last: number
  active: boolean
  ok: boolean
  tool: string
  agent?: string
  agentKey?: string
  /** lines written and taken out, over all its edits */
  added?: number
  removed?: number
}

/** A task running in the background: a shell, a monitor, a background agent. */
export type PulseBgTask = {
  id: string
  kind: 'shell' | 'monitor' | 'agent' | 'workflow' | 'task'
  label: string
  started: number
  status: 'running' | 'done' | 'failed' | 'killed'
  ended?: number
  agentKey?: string
  /** the file the shell writes its output to, which the dashboard tails live */
  out?: string
  exit?: number
}

export type PulsePhase = 'idle' | 'thinking' | 'writing' | 'tool' | 'agents'

/** The session is waiting for the person: a permission prompt, a question, a plan to approve. */
export type PulseAttention = {
  kind: 'permission' | 'question' | 'plan'
  tool: string
  label: string
  since: number
  id?: string
}

/** One turn of the main loop, measured. */
export type PulseTurn = {
  n: number
  start: number
  end?: number
  ms?: number
  /** milliseconds spent thinking, writing and in tools */
  think: number
  write: number
  tools: number
  calls: number
  errors: number
  cats: Partial<Record<PulseCat, number>>
  files: number
  agents: number
  cost: number
  inTok: number
  outTok: number
  cacheRead: number
  cacheWrite: number
  aborted?: boolean
}

/** A sample every ten seconds, for the charts. */
export type PulseSample = { t: number; cost: number; out: number; ctx: number; calls: number }

export type PulseCompact = { t: number; trigger: string; before: number; after?: number }

export type Pulse = {
  model: string
  effort: string
  phase: PulsePhase
  activity: string
  turns: number
  turnStarted: number
  lastTurnMs: number
  inTok: number
  outTok: number
  cacheRead: number
  cacheWrite: number
  context: number
  rate: number
  tools: PulseToolRun[]
  toolCount: number
  okCount: number
  errCount: number
  toolMs: number
  cats: Record<PulseCat, number>
  agents: PulseAgentRun[]
  files: PulseFile[]
  bg: PulseBgTask[]
  log: PulseLogLine[]
  startedAt: number
  attention?: PulseAttention
  turnLog: PulseTurn[]
  history: PulseSample[]
  compacts: PulseCompact[]
  /** calls per MCP server */
  mcp: Record<string, number>
  repo?: { root: string; remote: string | null }
}

declare module 'claude-code' {
  interface PluginState {
    'live-pulse': {
      pulse: Shaped<Pulse>
    }
  }
}
