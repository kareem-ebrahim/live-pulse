// The machine-wide totals, kept fresh in a worker thread so the window never
// waits on the disk: a full read once, then only what is new every 15 s.
import { Worker } from 'node:worker_threads'
import { emptyTotals, scan } from './totals-scan.mjs'

export const totals = { T: undefined, progress: [0, 0], ready: false, error: '' }
let worker

export function startTotals() {
  if (worker) return
  try {
    worker = new Worker(new URL('./totals-worker.mjs', import.meta.url))
    worker.on('message', m => {
      if (m.progress) totals.progress = m.progress
      if (m.T) {
        totals.T = m.T
        totals.ready = true
      }
    })
    worker.on('error', e => (totals.error = String(e?.message ?? e)))
    worker.unref()
  } catch (e) {
    totals.error = String(e?.message ?? e)
  }
}
export function stopTotals() {
  void worker?.terminate()
}
/** For the previews: read everything now, on this thread. */
export function totalsNow() {
  totals.T = scan(emptyTotals())
  totals.ready = true
}
