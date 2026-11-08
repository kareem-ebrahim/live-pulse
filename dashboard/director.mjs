// AUTO: a director that tours the dashboard by itself. It watches what the
// sessions do and picks the page, the session and the scroll that show it best:
// a session that needs the person comes first, then whatever just happened
// (a subagent born, a burst of edits, a cost jump), otherwise it rotates the
// pages every ~20 s and walks the busiest sessions. Any key or click pauses it
// for a minute.
import { projectName } from './common.mjs'
import { lastEventAt, listeners, liveSessions, planLimits, store } from './data.mjs'

export const PAGE_IDS = ['overview', 'timeline', 'network', 'files', 'cost', 'inspector', 'totals']
const DWELL = 20000 // a calm view
const MIN_DWELL = 7000 // before something new may cut in
const PAUSE = 60000

export const auto = {
  on: false,
  pausedUntil: 0,
  page: 'overview',
  sid: '',
  since: 0, // when this view started
  until: 0, // when it ends
  reason: '',
}

const hints = [] // { t, page, sid, why, weight }
listeners.push((sid, e) => {
  const now = Date.now()
  if ((e.t ?? 0) < now - 5000) return
  const push = (page, why, weight) => hints.push({ t: now, page, sid, why, weight })
  if (e.kind === 'agent') push('network', 'a subagent started', 6)
  else if (e.tool === 'SendMessage') push('network', 'a message between agents', 5)
  else if (e.kind === 'call' && e.cat === 'edit') push('files', 'files being edited', 2)
  else if (e.kind === 'compact') push('inspector', 'context compacted', 5)
  else if (e.kind === 'turn-summary') push('timeline', 'a turn finished', 3)
  else if (e.kind === 'call' && e.cat === 'mcp') push('network', 'MCP calls', 2)
  if (hints.length > 200) hints.splice(0, hints.length - 200)
})

export function setAuto(on) {
  auto.on = on
  auto.pausedUntil = 0
  auto.since = 0
  auto.until = 0
}
/** The person touched something: AUTO steps aside for a minute. */
export function pauseAuto() {
  if (auto.on) auto.pausedUntil = Date.now() + PAUSE
}
export const autoActive = (now = Date.now()) => auto.on && now >= auto.pausedUntil

function busiest(now) {
  return [...liveSessions(now)].sort((a, b) => lastEventAt(b) - lastEventAt(a))
}

function choose(now) {
  const live = liveSessions(now)
  // 1. a session waits for the person
  const waiting = live.filter(s => s.attention).sort((a, b) => a.attention.since - b.attention.since)[0]
  if (waiting) return { page: 'inspector', sid: waiting.sessionId, why: `${projectName(waiting.cwd)} needs you`, dwell: 15000, urgent: true }
  // 2. something just happened
  const recent = hints.filter(h => now - h.t < 8000)
  if (recent.length) {
    const score = new Map()
    for (const h of recent) {
      const k = `${h.page}|${h.sid}`
      score.set(k, (score.get(k) ?? 0) + h.weight)
    }
    const [best, pts] = [...score.entries()].sort((a, b) => b[1] - a[1])[0]
    const [page, sid] = best.split('|')
    if (pts >= 4 && !(page === auto.page && sid === auto.sid)) {
      const h = recent.filter(x => x.page === page && x.sid === sid).pop()
      const st = store.sessions.find(s => s.sessionId === sid)
      return { page, sid, why: `${h.why}${st ? ` · ${projectName(st.cwd)}` : ''}`, dwell: 14000 }
    }
  }
  // 3. a plan limit running high: show the money once in a while
  const five = planLimits().find(l => l.kind === 'five_hour')
  if (five && five.percentUsed >= 60 && auto.page !== 'cost' && now - (auto.lastCost ?? 0) > 5 * 60000) {
    auto.lastCost = now
    return { page: 'cost', sid: auto.sid, why: `5-hour limit at ${Math.round(five.percentUsed)}%`, dwell: 15000 }
  }
  return undefined
}

function rotate(now) {
  const i = PAGE_IDS.indexOf(auto.page)
  const next = PAGE_IDS[(i + 1) % PAGE_IDS.length]
  let sid = auto.sid
  // each full round of pages moves on to the next busiest session
  if (next === 'overview' || !sid) {
    const order = busiest(now)
    const j = order.findIndex(s => s.sessionId === sid)
    sid = order.length ? order[(j + 1) % order.length].sessionId : ''
  }
  const st = store.sessions.find(s => s.sessionId === sid)
  return { page: next, sid, why: st ? `tour · ${projectName(st.cwd)}` : 'tour', dwell: DWELL }
}

/** Called every frame while AUTO runs: returns the view to show. */
export function autoTick(now) {
  if (!autoActive(now)) return undefined
  if (!auto.since) {
    const st = busiest(now)[0]
    Object.assign(auto, { since: now, until: now + DWELL, sid: st?.sessionId ?? '', reason: 'tour' })
    return auto
  }
  const elapsed = now - auto.since
  const pick = choose(now)
  const cut = pick && (pick.urgent ? !(auto.page === pick.page && auto.sid === pick.sid) : elapsed >= MIN_DWELL)
  if (cut || now >= auto.until) {
    const v = cut ? pick : rotate(now)
    Object.assign(auto, { page: v.page, sid: v.sid, reason: v.why, since: now, until: now + v.dwell })
  }
  return auto
}

/**
 * The first row of a long list while AUTO shows it: rests at the top, glides
 * down to the end, rests, and comes back up, within the view's time.
 */
export function autoScroll(total, shown, now = Date.now()) {
  if (!autoActive(now) || total <= shown) return undefined
  const span = Math.max(1, auto.until - auto.since)
  const u = (now - auto.since) / span
  const max = total - shown
  const rest = 0.18
  if (u < rest) return 0
  if (u < 0.5) return Math.round(max * smooth((u - rest) / (0.5 - rest)))
  if (u < 0.5 + rest) return max
  return Math.round(max * (1 - smooth((u - 0.5 - rest) / (0.5 - rest))))
}
const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u))

/** The view's progress, 0..1, for the thin line under the tabs. */
export const autoProgress = (now = Date.now()) => (auto.until > auto.since ? Math.min(1, (now - auto.since) / (auto.until - auto.since)) : 0)
