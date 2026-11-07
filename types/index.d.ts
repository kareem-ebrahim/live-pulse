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
}

declare module 'claude-code' {
  interface PluginState {
    'live-pulse': {
      pulse: Shaped<Pulse>
    }
  }
}
