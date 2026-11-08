import type { Pulse, PulseCat } from '../types'

export function family(model: string): 'opus' | 'sonnet' | 'haiku' | 'fable' {
  const m = model.toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('fable')) return 'fable'
  return 'opus'
}

/** `claude-opus-5-5[1m]` → `Opus 5.5`. */
export function prettyModel(model: string): string {
  if (!model) return 'Claude'
  const m = model.toLowerCase().replace(/\[.*\]$/, '')
  const fam = family(m)
  if (!m.includes(fam)) return model
  const ver = m.match(/(\d+)[-.](\d+)/)
  const name = fam.charAt(0).toUpperCase() + fam.slice(1)
  return ver ? `${name} ${ver[1]}.${ver[2]}` : name
}

export const CAT_LABEL: Record<PulseCat, string> = {
  edit: 'EDIT',
  exec: 'EXEC',
  read: 'READ',
  mcp: 'MCP',
  agent: 'AGENT',
  web: 'WEB',
}

export function catOf(tool: string): PulseCat {
  if (tool.startsWith('mcp__')) return 'mcp'
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'edit'
    case 'Bash':
    case 'PowerShell':
    case 'BashOutput':
    case 'KillShell':
    case 'Monitor':
      return 'exec'
    case 'Read':
    case 'Glob':
    case 'Grep':
    case 'LS':
    case 'NotebookRead':
      return 'read'
    case 'WebFetch':
    case 'WebSearch':
      return 'web'
    case 'Agent':
    case 'Task':
    case 'SendMessage':
    case 'Workflow':
      return 'agent'
    default:
      return 'mcp'
  }
}

/** The file a tool call edits, if it edits one. */
export function editedPath(tool: string, input: Record<string, unknown>): string {
  if (catOf(tool) !== 'edit') return ''
  const p = input['file_path'] ?? input['notebook_path']
  return typeof p === 'string' ? p : ''
}

/** `C:\proj\src\a.ts` under `C:\proj` → `src/a.ts`; elsewhere the full path. */
export function relPath(path: string, cwd: string): string {
  const norm = (p: string) => p.split('\\').join('/').replace(/\/+$/, '')
  const p = norm(path)
  const c = norm(cwd)
  if (c && p.toLowerCase().startsWith(c.toLowerCase() + '/')) return p.slice(c.length + 1)
  return p
}

/** The one-line gist of a tool call's input. */
export function labelOf(tool: string, input: Record<string, unknown>, cwd: string): string {
  const s = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return oneLine(s('command'))
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return relPath(s('file_path') || s('notebook_path'), cwd)
    case 'Grep':
      return `"${s('pattern')}"${s('path') ? ' in ' + relPath(s('path'), cwd) : ''}`
    case 'Glob':
      return s('pattern')
    case 'WebFetch':
      return s('url').replace(/^https?:\/\//, '')
    case 'WebSearch':
      return `"${s('query')}"`
    case 'Agent':
    case 'Task':
      return s('description') || s('subagent_type')
    case 'Skill':
      return s('skill')
    case 'SendMessage':
      return `to ${s('to')}`
    default:
      return ''
  }
}

/** A language tag for the dashboard's highlighter, from a file's extension. */
export function langOf(path: string): string {
  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  const map: Record<string, string> = {
    ts: 'ts',
    tsx: 'ts',
    mts: 'ts',
    cts: 'ts',
    js: 'js',
    jsx: 'js',
    mjs: 'js',
    cjs: 'js',
    py: 'py',
    sh: 'sh',
    bash: 'sh',
    ps1: 'ps1',
    json: 'json',
    md: 'md',
    css: 'css',
    html: 'html',
    rs: 'rs',
    go: 'go',
    java: 'java',
    cs: 'cs',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
  }
  return map[ext] ?? 'text'
}

/** The head of a text: at most `lines` lines and `bytes` characters. */
export function capLines(text: string, lines: number, bytes: number): string {
  const all = text.split('\n')
  let out = all.slice(0, lines).join('\n')
  if (out.length > bytes) out = out.slice(0, bytes)
  const cut = all.length > lines || text.length > out.length
  return cut ? `${out}\n… (${all.length} lines in all)` : out
}

export function oneLine(t: string): string {
  return t.replace(/\s+/g, ' ').trim()
}

export function fit(t: string, w: number): string {
  if (w <= 0) return ''
  if (t.length <= w) return t
  return w <= 1 ? t.slice(0, w) : t.slice(0, w - 1) + '…'
}

export function secs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  return `${m}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

export function emptyPulse(now: number): Pulse {
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
    bg: [],
    log: [],
    startedAt: now,
    turnLog: [],
    history: [],
    compacts: [],
    mcp: {},
  }
}
