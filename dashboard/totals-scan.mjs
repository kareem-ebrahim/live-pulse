// Totals across the whole machine: every Claude Code transcript under
// ~/.claude/projects (every project, every session, subagents included).
// Only the numbers are read: each assistant message's token usage, its model,
// its project folder and its time. No text of any message is kept.
// Scans incrementally: each file is read from where the last scan stopped.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PROJECTS = process.env.LIVE_PULSE_PROJECTS || path.join(os.homedir(), '.claude', 'projects')

// $ per million tokens: input, output, cache read. Cache writes cost 1.25× input
// (5-minute) or 2× input (1-hour). API list prices: on a subscription this is
// what the same use would cost through the API.
const PRICES = [
  [/fable-5-1|mythos-5-1/, 10, 50, 0.25],
  [/fable|mythos/, 10, 50, 1],
  [/opus-5-5/, 4, 20, 0.2],
  [/opus-5|opus-4-[5-9]/, 5, 25, 0.5],
  [/opus/, 15, 75, 1.5],
  [/sonnet-5/, 2, 10, 0.2],
  [/sonnet/, 3, 15, 0.3],
  [/haiku-5/, 0.1, 0.5, 0.01],
  [/haiku-4/, 1, 5, 0.1],
  [/haiku/, 0.8, 4, 0.08],
]
export function priceOf(model) {
  const p = PRICES.find(([re]) => re.test(model || ''))
  return p ? { in: p[1], out: p[2], read: p[3] } : undefined
}
export function familyOf(model = '') {
  const m = String(model).match(/(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/)
  if (!m) return 'other'
  return `${m[1]} ${m[2]}${m[3] && m[3].length <= 2 ? '.' + m[3] : ''}`
}

const zero = () => ({ in: 0, out: 0, read: 0, write: 0, cost: 0, msgs: 0, last: 0 })
export function emptyTotals() {
  return { files: {}, all: zero(), projects: {}, models: {}, days: {}, hours: {}, scanned: 0, fileCount: 0, at: 0 }
}

function add(b, u, cost, t) {
  b.in += u.in
  b.out += u.out
  b.read += u.read
  b.write += u.write
  b.cost += cost
  b.msgs += 1
  if (t > b.last) b.last = t
}

function listFiles(dir, out = []) {
  let names
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const d of names) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) listFiles(p, out)
    else if (d.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

const two = n => String(n).padStart(2, '0')

/** Reads what is new since `T` was last updated; returns T. `onProgress(done, total)` is optional. */
export function scan(T, onProgress) {
  const files = listFiles(PROJECTS)
  T.fileCount = files.length
  let done = 0
  for (const f of files) {
    done++
    let st
    try {
      st = fs.statSync(f)
    } catch {
      continue
    }
    const rec = T.files[f] ?? { offset: 0, lastId: '', project: '' }
    if (st.size < rec.offset) Object.assign(rec, { offset: 0, lastId: '' }) // rewritten
    if (st.size === rec.offset) {
      T.files[f] = rec
      continue
    }
    let buf
    try {
      const fd = fs.openSync(f, 'r')
      buf = Buffer.alloc(st.size - rec.offset)
      fs.readSync(fd, buf, 0, buf.length, rec.offset)
      fs.closeSync(fd)
    } catch {
      continue
    }
    const end = buf.lastIndexOf(10)
    if (end < 0) continue // no whole line yet
    const text = buf.subarray(0, end).toString('utf8')
    rec.offset += end + 1
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
      let j
      try {
        j = JSON.parse(line)
      } catch {
        continue
      }
      const m = j.message
      if (j.type !== 'assistant' || !m?.usage) continue
      // one message is written as several lines, one per block, with the same usage
      if (m.id && m.id === rec.lastId) continue
      rec.lastId = m.id ?? ''
      const p = priceOf(m.model)
      if (!p) continue // synthetic messages: no model, no cost
      const u = m.usage
      const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
      const w = u.cache_creation_input_tokens ?? 0
      const usage = { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0, read: u.cache_read_input_tokens ?? 0, write: w }
      const cost = (usage.in * p.in + usage.out * p.out + usage.read * p.read + (w - w1h) * p.in * 1.25 + w1h * p.in * 2) / 1e6
      const t = Date.parse(j.timestamp) || st.mtimeMs
      const d = new Date(t)
      const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
      const hour = `${day}T${two(d.getHours())}`
      const proj = j.cwd ? String(j.cwd).split(/[\\/]/).filter(Boolean).pop() : path.basename(path.dirname(f))
      rec.project = proj
      add(T.all, usage, cost, t)
      add((T.projects[proj] ??= zero()), usage, cost, t)
      add((T.models[familyOf(m.model)] ??= zero()), usage, cost, t)
      add((T.days[day] ??= zero()), usage, cost, t)
      add((T.hours[hour] ??= zero()), usage, cost, t)
    }
    T.files[f] = rec
    if (onProgress && done % 20 === 0) onProgress(done, files.length)
  }
  // hours older than three days are dropped; days stay
  const cutoff = Date.now() - 3 * 86400000
  for (const k of Object.keys(T.hours)) if (Date.parse(k + ':00:00') < cutoff) delete T.hours[k]
  T.scanned = files.length
  T.at = Date.now()
  return T
}
