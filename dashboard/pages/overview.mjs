// Overview: every session as a creature, then the selected one's router,
// agents, files and shells, then the activity log.
import { clamp } from '../common.mjs'
import { drawConstellation } from '../views/constellation.mjs'
import { drawLog, logUi } from '../views/log.mjs'
import { drawSession } from '../views/session.mjs'

export const view = { fullLog: false }

export function drawOverview(S, st, y0, y1, t, now) {
  const W = S.w
  const H = y1 - y0
  let afterConst = y0
  let slots = new Map()
  if (!view.fullLog) {
    const constH = H >= 54 ? 12 : H >= 42 ? 10 : 9
    slots = drawConstellation(S, 1, y0 + 1, W - 2, constH, t, now, st.sessionId)
    afterConst = y0 + 1 + constH + 1
  }
  // running subagents each need four more rows in the agents map; the log gives way
  const subs =
    (st.agents || []).filter(a => a.status === 'running' || now - (a.started + (a.ms || 0)) < 5 * 60000).length +
    (st.bg || []).filter(b => b.kind !== 'agent' && (b.status === 'running' || now - (b.ended ?? 0) < 4000)).length
  const needs = 26 + 4 * Math.min(3, subs)
  const logH = view.fullLog ? y1 - y0 - 1 : clamp(y1 - (afterConst + 1) - needs - 1, 9, 22)
  const logY = y1 - logH
  if (!view.fullLog) {
    const slot = slots.get(st.sessionId)
    drawSession(S, st, afterConst + 1, logY - 2, t, now, slot ? { x: slot.cx, y: slot.bottom + 1 } : undefined)
  }
  logUi.expanded = view.fullLog
  drawLog(S, st, 1, logY, W - 2, logH, t, now)
  return slots
}
