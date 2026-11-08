// Worker: scans the transcripts, posts the totals, and scans again every 15 s.
import { parentPort } from 'node:worker_threads'
import { emptyTotals, scan } from './totals-scan.mjs'

const T = emptyTotals()
function post() {
  // the per-file offsets stay here; the window needs only the sums
  const { files, ...rest } = T
  void files
  parentPort.postMessage({ T: rest })
}
scan(T, (done, total) => parentPort.postMessage({ progress: [done, total] }))
post()
setInterval(() => {
  scan(T)
  post()
}, 15000)
