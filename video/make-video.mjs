#!/usr/bin/env node
// Renders the Live Pulse promo film: 1920×1080, 60 fps, H.264 + AAC, with an
// original score and sound design. A scripted scenario of three Claude Code
// sessions runs through the dashboard's real drawing code; stage.html paints
// every frame as vector graphics on a 3D panel (depth of field, motion blur,
// bloom, kinetic type, grain) and synthesises the audio; ffmpeg encodes.
//
//   npm run video                              → out/live-pulse.mp4
//   node make-video.mjs --stills 4.5,12,22     → out/still-<t>.png
//   node make-video.mjs --url github.com/you/live-pulse
//   node make-video.mjs --music track.mp3      → your own licensed track under the sound design
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import ffmpegPath from 'ffmpeg-static'
import { Sim } from './sim.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = n => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : undefined
}
const FPS = Number(opt('--fps') || 60)
const COLS = 170
const ROWS = 60
const DURATION = 66 // the scenario's length, timed at 120 BPM
const BPM = 120
// --tempo 128 plays the whole film faster by 128/120 so every cut stays on the beat
const TEMPO = Number(opt('--tempo') || 120)
const SCALE = TEMPO / 120
const OUT_DURATION = DURATION / SCALE
const BEAT = 60 / BPM
const OUT = path.join(HERE, 'out')
fs.mkdirSync(OUT, { recursive: true })
const URL_TEXT = opt('--url') || ''

const DATA = path.join(os.tmpdir(), 'live-pulse-video')
process.env.LIVE_PULSE_DIR = DATA
const dash = p => pathToFileURL(path.join(HERE, '..', 'dashboard', p)).href
const { Screen } = await import(dash('screen.mjs'))
const { poll, store, opts: dataOpts } = await import(dash('data.mjs'))
const { frame, ui } = await import(dash('scene.mjs'))
const { logUi } = await import(dash('views/log.mjs'))
dataOpts.keepEnded = true

// ════════════════════════════════════════════════════════════════════════════
// The scenario, timed to the cut
// ════════════════════════════════════════════════════════════════════════════
const BASE = new Date(2026, 10, 7, 14, 20, 0).getTime()
const sim = new Sim(DATA, BASE)
const callTimes = [] // [t, session index] for the blips
const S0 = sim.session('a1c4e9f2-orvix-api', 'C:/dev/orvix-api', 'claude-opus-5-5', { effort: 'high', turns: 6, toolsBefore: 61, context: 312000, outTok: 84000, cats: { edit: 14, exec: 12, read: 31, agent: 2, web: 1, mcp: 1 }, age: 5400 })
const S1 = sim.session('b7d2a0c1-shop-web', 'C:/dev/shop-web', 'claude-sonnet-5-5', { effort: 'medium', turns: 3, toolsBefore: 24, context: 118000, window: 200000, outTok: 31000, cats: { edit: 6, exec: 5, read: 13 }, age: 2400 })
const S2 = sim.session('c9e5b3d8-data-pipeline', 'C:/dev/data-pipeline', 'claude-opus-5-5', { effort: 'medium', turns: 2, toolsBefore: 9, context: 64000, outTok: 9000, cats: { edit: 2, exec: 3, read: 4 }, age: 1200 })
const SESS = [S0, S1, S2]
const call = (s, t, dur, tool, label, o) => {
  callTimes.push([t, SESS.indexOf(s)])
  return s.call(t, dur, tool, label, o)
}
const diff = (p, lang, o, n) => ({ path: p, lang, old: o, new: n })

// history
call(S0, -40, 0.3, 'Read', 'src/auth/session.ts', { out: '212 lines' })
call(S0, -34, 4.2, 'Bash', 'npm test -- auth', { code: { lang: 'sh', text: 'npm test -- auth' }, out: 'passed', output: ' PASS  src/auth/session.test.ts\n Tests  18 passed (18)' })
call(S1, -30, 0.4, 'Grep', '"useCart" in src', { out: '9 hits' })
call(S2, -25, 2.1, 'Bash', 'python -m pytest -q', { code: { lang: 'sh', text: 'python -m pytest -q' }, out: 'passed', output: '........ [100%]\n8 passed in 1.92s' })

// session 0 — a refactor with three subagents, a failing test, a fix
sim.at(7, () => S0.turn())
call(S0, 8.6, 0.5, 'Grep', '"createSession" in src', { out: '14 hits' })
call(S0, 10.2, 0.3, 'Read', 'src/auth/refresh.ts', { out: '96 lines' })
call(S0, 11.5, 1.6, 'Edit', 'src/auth/refresh.ts', {
  file: 'C:/dev/orvix-api/src/auth/refresh.ts',
  diff: diff('src/auth/refresh.ts', 'ts', 'export function refresh(token: string) {\n  const claims = verify(token)\n  return sign({ sub: claims.sub })\n}', 'export async function refresh(token: string): Promise<string> {\n  const claims = verify(token)\n  // rotate the refresh token on every use\n  const next = await rotate(claims.jti)\n  return sign({ sub: claims.sub, jti: next.id }, { expiresIn: 900 })\n}'),
})
call(S0, 14.2, 0.4, 'Read', 'src/api/routes/token.ts', { out: '58 lines' })
call(S0, 20.6, 0.2, 'Agent', '3 parallel subagents', { out: 'spawned' })
S0.spawn(21.0, 'ag-explore', 'Explore', 'map every caller of refresh()', 'claude-haiku-5-5')
S0.spawn(21.5, 'ag-tests', 'test-writer', 'cover token rotation', 'claude-haiku-5-5')
S0.spawn(22.0, 'ag-review', 'code-reviewer', 'review the auth change', 'claude-sonnet-5-5')
call(S0, 22.4, 0.5, 'Grep', '"refresh(" in src', { agent: 'ag-explore', out: '6 hits' })
call(S0, 23.0, 1.6, 'Edit', 'src/api/routes/token.ts', {
  agent: 'ag-explore',
  file: 'C:/dev/orvix-api/src/api/routes/token.ts',
  diff: diff('src/api/routes/token.ts', 'ts', "router.post('/token/refresh', (req, res) => {\n  res.json({ token: refresh(req.body.token) })\n})", "router.post('/token/refresh', async (req, res) => {\n  const token = await refresh(req.body.token)\n  res.json({ token })\n})"),
})
call(S0, 22.7, 2.2, 'Write', 'src/auth/refresh.test.ts', {
  agent: 'ag-tests',
  file: 'C:/dev/orvix-api/src/auth/refresh.test.ts',
  code: { lang: 'ts', text: "import { refresh } from './refresh'\n\ntest('rotates the refresh token', async () => {\n  const first = await refresh(seed.token)\n  const second = await refresh(first)\n  expect(decode(second).jti).not.toBe(decode(first).jti)\n})" },
})
call(S0, 23.6, 0.6, 'Read', 'src/auth/refresh.ts', { agent: 'ag-review', out: '104 lines' })
call(S0, 25.0, 1.4, 'Edit', 'src/auth/session.ts', {
  agent: 'ag-review',
  file: 'C:/dev/orvix-api/src/auth/session.ts',
  diff: diff('src/auth/session.ts', 'ts', 'const TTL = 3600', '// access tokens live 15 minutes; refresh rotates them\nconst TTL = 900'),
})
call(S0, 25.4, 1.2, 'Edit', 'src/auth/refresh.test.ts', {
  agent: 'ag-tests',
  file: 'C:/dev/orvix-api/src/auth/refresh.test.ts',
  diff: diff('src/auth/refresh.test.ts', 'ts', "test('rotates the refresh token', async () => {", "test('rotates the refresh token on every use', async () => {"),
})
S0.agentDone(26.6, 'ag-explore')
S0.agentDone(27.1, 'ag-tests')
S0.agentDone(27.6, 'ag-review')
call(S0, 28.4, 0.3, 'Grep', '"rotate(" in src', { out: '2 hits' })
call(S0, 29.2, 0.3, 'Read', 'src/auth/rotate.ts', { out: '22 lines' })
call(S0, 31.2, 1.3, 'Bash', 'npm test -- auth', {
  code: { lang: 'sh', text: 'npm test -- auth --reporter=dot' },
  ok: false,
  out: '1 failed',
  output: ' FAIL  src/auth/refresh.test.ts > rotates the refresh token on every use\n AssertionError: expected "a91f" not to be "a91f"\n   at refresh.test.ts:6:37\n\n Tests  1 failed | 18 passed (19)',
  name: 'failedTest',
})
call(S0, 34.0, 1.1, 'Edit', 'src/auth/rotate.ts', {
  file: 'C:/dev/orvix-api/src/auth/rotate.ts',
  diff: diff('src/auth/rotate.ts', 'ts', 'export async function rotate(id: string) {\n  return db.tokens.find(id)\n}', 'export async function rotate(id: string) {\n  await db.tokens.revoke(id)\n  return db.tokens.create({ parent: id })\n}'),
  name: 'rotateDiff',
})
call(S0, 36.0, 1.5, 'Bash', 'npm test -- auth', {
  code: { lang: 'sh', text: 'npm test -- auth --reporter=dot' },
  out: 'passed',
  output: ' PASS  src/auth/refresh.test.ts\n PASS  src/auth/session.test.ts\n\n Tests  19 passed (19)\n Duration  3.84s',
  name: 'passedTest',
})
sim.at(38, () => S0.ctx(341000))
sim.at(38.2, () => S0.turnDone())

// session 1 — checkout, then the shared config
sim.at(7.5, () => S1.turn())
call(S1, 9.0, 0.4, 'Read', 'src/pages/checkout.tsx', { out: '188 lines' })
call(S1, 12.2, 1.4, 'Edit', 'src/pages/checkout.tsx', {
  file: 'C:/dev/shop-web/src/pages/checkout.tsx',
  diff: diff('src/pages/checkout.tsx', 'ts', '<Button onClick={pay}>Pay</Button>', '<Button onClick={pay} disabled={!cart.items.length}>\n  Pay {format(cart.total)}\n</Button>'),
})
call(S1, 16.2, 2.6, 'Bash', 'npm run typecheck', { code: { lang: 'sh', text: 'npm run typecheck' }, out: 'clean', output: '> tsc --noEmit\n\nNo errors.' })
sim.at(17, () => S1.ctx(144000))
call(S1, 39.6, 0.4, 'Read', '../shared/config/env.ts', { out: '41 lines' })
call(S1, 40.4, 1.4, 'Edit', '../shared/config/env.ts', {
  file: 'C:/dev/shared/config/env.ts',
  diff: diff('../shared/config/env.ts', 'ts', "export const API_URL = 'http://localhost:8080'", "export const API_URL = process.env.API_URL ?? 'http://localhost:8080'"),
  name: 'envDiff',
})
sim.at(42, () => S1.ctx(151000))

// session 2 — wakes on camera, then touches the same file and messages session 1
sim.at(18.6, () => S2.turn())
call(S2, 18.9, 0.4, 'Glob', 'pipelines/**/*.py', { out: '12 files' })
call(S2, 19.5, 1.6, 'Bash', 'python -m pytest -q tests/test_ingest.py', { code: { lang: 'sh', text: 'python -m pytest -q tests/test_ingest.py' }, out: 'passed', output: '.... [100%]\n4 passed in 0.88s' })
call(S2, 30.0, 1.3, 'Edit', 'pipelines/ingest.py', {
  file: 'C:/dev/data-pipeline/pipelines/ingest.py',
  diff: diff('pipelines/ingest.py', 'py', 'def load(path):\n    return pd.read_csv(path)', 'def load(path, *, chunk=50_000):\n    # stream large exports instead of loading them whole\n    return pd.read_csv(path, chunksize=chunk)'),
})
call(S2, 43.8, 1.4, 'Edit', '../shared/config/env.ts', {
  file: 'C:/dev/shared/config/env.ts',
  diff: diff('../shared/config/env.ts', 'ts', "export const QUEUE = 'ingest'", "export const QUEUE = process.env.QUEUE ?? 'ingest'"),
})
call(S2, 46.4, 0.5, 'SendMessage', 'to shop-web', { out: 'delivered' })

// the montage: every session busy
const busy = [
  ['Read', 'read', 'src/db/pool.ts'], ['Grep', 'read', '"TODO" in src'], ['Bash', 'exec', 'npm run lint'], ['Edit', 'edit', 'src/api/routes/users.ts'],
  ['Glob', 'read', 'src/**/*.test.ts'], ['Bash', 'exec', 'git status --short'], ['Edit', 'edit', 'src/lib/cache.ts'], ['Read', 'read', 'package.json'],
]
for (let i = 0; i < 26; i++) {
  const s = SESS[i % 3]
  const [tool, , label] = busy[i % busy.length]
  const isEdit = tool === 'Edit'
  call(s, 48 + i * 0.31, 0.25 + (i % 3) * 0.1, tool, label, isEdit ? { file: `C:/dev/x/${s.id}/${label}`, diff: diff(label, 'ts', 'const ttl = 60', 'const ttl = 300') } : { out: 'ok' })
}
sim.at(48.2, () => S0.turn())
sim.at(60, () => S0.turnDone())
sim.at(60.5, () => S1.turnDone())
sim.at(61, () => S2.turnDone())

// ════════════════════════════════════════════════════════════════════════════
// The director
// ════════════════════════════════════════════════════════════════════════════
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, k) => a + (b - a) * k
const E = {
  linear: k => k,
  inOut: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: k => 1 - Math.pow(1 - k, 4),
  in: k => k * k * k,
  expo: k => (k === 1 ? 1 : 1 - Math.pow(2, -10 * k)),
  snap: k => (k < 0.5 ? 16 * Math.pow(k, 5) : 1 - Math.pow(-2 * k + 2, 5) / 2),
}
/** A track of [time, values..., easing-to-next] keys. */
function track(keys) {
  return t => {
    if (t <= keys[0][0]) return keys[0].slice(1, -1)
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i]
      const b = keys[i + 1]
      if (t <= b[0]) {
        const k = (E[a[a.length - 1]] ?? E.inOut)(clamp((t - a[0]) / (b[0] - a[0]), 0, 1))
        return a.slice(1, -1).map((v, j) => lerp(v, b[j + 1], k))
      }
    }
    const last = keys[keys.length - 1]
    return last.slice(1, -1)
  }
}
const win = (t, a, b, fade = 0.35) => clamp(Math.min((t - a) / fade, (b - t) / fade), 0, 1)

// the 2D camera over the grid: [t, x, y, zoom, ease]
const CREATURE = [[30, 7.5], [85, 7.5], [140, 7.5]]
const MONTAGE = [
  [30, 9, 3.2], [80, 33, 2.1], [112, 27, 1.9], [82, 20, 2.7], [140, 9, 3.0], [150, 32, 2.3], [40, 50, 2.0], [85, 9, 3.0],
  [70, 36, 2.6], [112, 30, 2.2], [30, 9, 3.6], [82, 20, 3.0], [140, 9, 3.6], [80, 33, 2.4], [150, 28, 2.6], [85, 9, 3.4],
  [112, 27, 2.2], [30, 9, 3.4], [80, 33, 2.6], [140, 9, 3.2],
]
const montageCut = t => (t < 48 || t >= 56 ? -1 : t < 54 ? Math.floor((t - 48) / 0.5) : 12 + Math.floor((t - 54) / 0.25))
const camTrack = track([
  [8.0, 31, 7.2, 9.0, 'expo'],
  [10.8, 85, 30, 1.0, 'inOut'],
  [13.9, 85, 30, 1.0, 'snap'],
  [14.4, 30, 7.5, 2.6, 'linear'],
  [15.6, 33, 7.5, 2.65, 'snap'],
  [16.05, 85, 7.5, 2.6, 'linear'],
  [17.6, 88, 7.5, 2.65, 'snap'],
  [18.05, 140, 7.5, 2.6, 'linear'],
  [19.9, 142, 7.5, 2.7, 'snap'],
  [20.4, 80, 33, 1.9, 'linear'],
  [27.9, 80, 33, 2.0, 'snap'],
  [28.35, 82, 20, 2.7, 'linear'],
  [30.9, 82, 20, 2.85, 'snap'],
  [31.4, 85, 37, 1.25, 'inOut'],
  [32.2, 112, 27, 1.75, 'linear'],
  [38.8, 112, 28, 1.85, 'snap'],
  [39.3, 85, 30, 1.0, 'linear'],
  [41.8, 85, 30, 1.05, 'inOut'],
  [43.6, 105, 14, 1.75, 'linear'],
  [47.9, 105, 14, 1.95, 'linear'],
])
function camera(t) {
  let x, y, z
  const cut = montageCut(t)
  if (cut >= 0) {
    const [mx, my, mz] = MONTAGE[cut % MONTAGE.length]
    const span = t < 54 ? 0.5 : 0.25
    const local = ((t - 48) % span) / span
    x = mx + (cut % 2 ? 1 : -1) * local * 2
    y = my
    z = mz * (0.94 + 0.08 * E.out(local))
  } else if (t >= 56) {
    ;[x, y, z] = [85, 30, 1]
  } else [x, y, z] = camTrack(t)
  const hx = COLS / 2 / z
  const hy = ROWS / 2 / z
  const c = (v, h, size) => (h >= size / 2 ? size / 2 : Math.min(size - h, Math.max(h, v)))
  return { x: c(x, hx, COLS), y: c(y, hy, ROWS), z }
}

// the 3D panel: [t, rx, ry, rz, tx, ty, tz, scale, ease]
const panelTrack = track([
  [8.0, 22, -30, 4, 0, 40, -260, 1.0, 'expo'],
  [11.0, 7, -9, 0, 0, 0, 0, 0.94, 'inOut'],
  [14.0, 4, 8, 0, 0, 0, 0, 0.94, 'inOut'],
  [20.0, 9, -6, -1, 0, 0, 0, 0.95, 'inOut'],
  [28.0, 5, 7, 0, 0, 0, 0, 0.95, 'inOut'],
  [31.0, 3, -4, 0, 0, 0, 0, 0.96, 'inOut'],
  [39.0, 3, -4, 0, 0, 0, 0, 0.96, 'snap'],
  [39.6, 4, 16, 0, 0, 0, 0, 0.94, 'inOut'],
  [42.0, 8, -4, 1, 0, 0, 0, 0.94, 'inOut'],
  [48.0, 4, 6, 0, 0, 0, 0, 0.95, 'linear'],
  [56.0, 24, -34, 6, 0, 140, -320, 0.74, 'out'],
  [61.0, 8, 18, -2, 0, 150, -120, 0.74, 'in'],
  [62.0, 30, 40, -4, 0, 400, -900, 0.6, 'linear'],
])
function panel(t) {
  if (t < 8 || t > 62) return undefined
  let [rx, ry, rz, tx, ty, tz, s] = panelTrack(t)
  // a slow breathing drift keeps the shot alive
  rx += Math.sin(t * 0.43) * 1.1
  ry += Math.sin(t * 0.31 + 1) * 1.4
  const cut = montageCut(t)
  if (cut >= 0) {
    ry += (cut % 3 - 1) * 6
    rx += (cut % 2 ? 3 : -2)
  }
  const o = t < 8.15 ? (t - 8) / 0.15 : t > 61.4 ? Math.max(0, (62 - t) / 0.6) : 1
  return { rx, ry, rz, tx, ty, tz, s, o, radius: 26 }
}

// motion blur from the camera's speed, plus whips
function motionBlur(t) {
  // a cut is not a move: inside the montage only a light blur
  if (montageCut(t) >= 0) return { x: 1.2, y: 0.6 }
  const a = camera(Math.max(0, t - 1 / 60))
  const b = camera(t)
  const vx = Math.abs(b.x - a.x) * b.z * 11.3 * 60
  const vy = Math.abs(b.y - a.y) * b.z * 18 * 60
  const vz = Math.abs(b.z - a.z) * 60 * 160
  let x = clamp(vx / 220 + vz / 60, 0, 22)
  let y = clamp(vy / 220 + vz / 60, 0, 16)
  if (t >= 39.0 && t <= 39.5) x = Math.max(x, 36 * Math.sin(((t - 39.0) / 0.5) * Math.PI))
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
}

// depth of field: where the eye should be, in display pixels on the panel
function toDisplay(cam, gx, gy) {
  return [960 + (gx - cam.x) * (1920 / COLS) * cam.z, 540 + (gy - cam.y) * (1080 / ROWS) * cam.z]
}
function dof(t, cam) {
  const focus = (gx, gy, rw, rh, blur) => {
    const [x, y] = toDisplay(cam, gx, gy)
    return { x, y, rx: rw * cam.z * (1920 / COLS), ry: rh * cam.z * (1080 / ROWS), blur }
  }
  if (t >= 10.4 && t < 14) return { x: 960, y: 540, rx: 1, ry: 1, blur: 7 * win(t, 10.4, 13.9, 0.4) } // under the big type
  if (t >= 14 && t < 20.2) {
    const i = t < 15.8 ? 0 : t < 17.8 ? 1 : 2
    return focus(CREATURE[i][0], CREATURE[i][1], 30, 8, 5)
  }
  if (t >= 20.2 && t < 28) return focus(80, 34, 48, 13, 4.5 * win(t, 20.2, 28, 0.5))
  if (t >= 28.2 && t < 31) return focus(82, 20, 38, 6, 5 * win(t, 28.2, 31, 0.4))
  if (t >= 43.5 && t < 48) return focus(112, 6, 60, 10, 4 * win(t, 43.5, 48, 0.6))
  return undefined
}

// headlines and lower-thirds: [from, to, item]
const W = 1920
const H = 1080
const TYPE = [
  [4.0, 7.0, { text: 'Live Pulse', x: W / 2, y: 520, size: 210, weight: 900, align: 'center', track: -0.045, stagger: 0.12, blurIn: 18, glow: 'rgba(208,109,88,0.35)' }],
  [4.65, 7.0, { text: 'Every Claude Code session. Live.', x: W / 2, y: 790, size: 50, weight: 500, align: 'center', color: '#b8c2cc', stagger: 0.07, blurIn: 8 }],
  [10.5, 13.9, { text: 'Every session.', x: 150, y: 330, size: 150, weight: 900, track: -0.04, stagger: 0.12, blurIn: 14 }],
  [11.0, 13.9, { text: 'One window.', x: 150, y: 520, size: 150, weight: 900, track: -0.04, stagger: 0.12, blurIn: 14, color: '#e08a72' }],
  [14.3, 15.9, { text: 'One creature per session', x: 110, y: 860, size: 64, weight: 800, stagger: 0.06 }],
  [14.5, 15.9, { text: 'ITS ORBIT IS THE CONTEXT WINDOW', x: 112, y: 800, size: 22, weight: 700, track: 0.22, color: '#6dc0ff' }],
  [16.2, 17.9, { text: 'It works when the session works', x: 110, y: 860, size: 64, weight: 800, stagger: 0.06 }],
  [18.2, 20.1, { text: '…and wakes the moment it starts', x: 110, y: 860, size: 64, weight: 800, stagger: 0.06 }],
  [20.6, 27.8, { text: 'Every subagent gets its own creature', x: 110, y: 860, size: 64, weight: 800, stagger: 0.05 }],
  [20.8, 27.8, { text: 'AGENTS & FILES', x: 112, y: 800, size: 22, weight: 700, track: 0.22, color: '#6dc0ff' }],
  [23.4, 27.8, { text: 'wired to the exact files it edits.', x: 110, y: 940, size: 46, weight: 500, color: '#b8c2cc', stagger: 0.05 }],
  [28.5, 30.9, { text: 'Tool calls by kind — live.', x: 110, y: 860, size: 64, weight: 800, stagger: 0.06 }],
  [31.6, 38.8, { text: 'Real diffs. Real output.', x: 110, y: 860, size: 64, weight: 800, stagger: 0.06 }],
  [31.8, 38.8, { text: 'ACTIVITY', x: 112, y: 800, size: 22, weight: 700, track: 0.22, color: '#eca06e' }],
  [35.0, 38.8, { text: 'From red to green, as it happens.', x: 110, y: 940, size: 46, weight: 500, color: '#b8c2cc', stagger: 0.05 }],
  [39.7, 42.0, { text: 'Jump between sessions', x: 110, y: 860, size: 64, weight: 800, stagger: 0.06 }],
  [39.9, 42.0, { text: 'ONE CLICK', x: 112, y: 800, size: 22, weight: 700, track: 0.22, color: '#bbb3f1' }],
  [44.3, 47.9, { text: 'Two sessions. One file.', x: 110, y: 860, size: 64, weight: 800, stagger: 0.07, color: '#ff8a80' }],
  [46.6, 47.9, { text: 'Caught live — before they collide.', x: 110, y: 940, size: 46, weight: 500, color: '#b8c2cc', stagger: 0.05 }],
  [56.3, 61.3, { text: 'Live Pulse', x: W / 2, y: 70, size: 150, weight: 900, align: 'center', track: -0.045, stagger: 0.1, blurIn: 16, glow: 'rgba(208,109,88,0.3)' }],
  [56.8, 61.3, { text: 'Open source · a Claude Code mod + a live dashboard', x: W / 2, y: 250, size: 40, weight: 500, align: 'center', color: '#b8c2cc', stagger: 0.04 }],
  [62.2, 65.6, { text: 'Live Pulse', x: W / 2, y: 560, size: 170, weight: 900, align: 'center', track: -0.045, stagger: 0.1, blurIn: 16, glow: 'rgba(208,109,88,0.35)' }],
  [62.7, 65.6, { text: URL_TEXT || 'Every Claude Code session. Live.', x: W / 2, y: 780, size: URL_TEXT ? 44 : 46, weight: URL_TEXT ? 700 : 500, align: 'center', color: URL_TEXT ? '#82edab' : '#b8c2cc', font: URL_TEXT ? 'mono' : undefined, stagger: 0.05 }],
]
function typeAt(t) {
  const out = []
  for (const [a, b, it] of TYPE) {
    if (t < a || t > b + 0.7) continue
    out.push({ ...it, p: (t - a) / 0.9 + 0.0, out: t > b ? (t - b) / 0.55 : 0 })
  }
  return out
}

// creatures drawn over the stage: intro, outro
function creatures(t) {
  const list = []
  if (t < 8.05) {
    const assemble = clamp((t - 0.3) / 2.6, 0, 1)
    let px = 26
    let x = W / 2
    let y = 520
    if (t >= 4.0) {
      const k = E.out(clamp((t - 4.0) / 0.7, 0, 1))
      px = lerp(26, 13, k)
      y = lerp(520, 300, k)
    }
    if (t >= 6.9) {
      // dive into the left eye
      const k = E.in(clamp((t - 6.9) / 1.1, 0, 1))
      px = lerp(13, 520, k)
      const eyeX = (4.5 - 8) * px
      const eyeY = (2.5 - 5.5) * px
      x = W / 2 - eyeX * k
      y = lerp(300, 540, k) - eyeY * k
    }
    list.push({ x, y, px, color: '#d06d58', p: assemble, blink: t > 3.3 && t < 3.42, glow: t >= 4 ? 0.4 : 0.8 })
  }
  if (t >= 62) {
    const colors = ['#d06d58', '#6dc0ff', '#bbb3f1']
    colors.forEach((c, i) => {
      const beat = ((t - 62) / BEAT) % 1
      const hop = Math.max(0, Math.sin(Math.PI * beat)) * 10 * (i === Math.floor((t - 62) / BEAT) % 3 ? 1 : 0.3)
      list.push({ x: W / 2 + (i - 1) * 230, y: 330 - hop, px: 9, color: c, p: clamp((t - 62 - i * 0.18) / 1.1, 0, 1), glow: 0.5, blink: Math.floor((t + i) * 10) % 29 === 0 })
    })
  }
  return list
}

// what is on screen, as a person would click it
function steer(t) {
  store.pinned = t < 39.25 ? S0.id : t < 48 ? S1.id : S0.id
  if (t >= 48 && t < 56) store.pinned = SESS[Math.max(0, montageCut(t)) % 3].id
  ui.fullLog = t >= 31.2 && t < 39.2
  logUi.scope = 'session'
  logUi.kind = 'all'
  const key = n => sim.keys.get(n) ?? ''
  logUi.selKey = t >= 37.6 && t < 39.3 ? key('passedTest') : t >= 34.1 ? (t < 37.6 ? key('rotateDiff') : '') : t >= 32.55 && t < 34.1 ? key('failedTest') : ''
  if (t >= 39.3 && t < 44) logUi.selKey = t >= 41.9 ? key('envDiff') : ''
  if (t >= 44) logUi.selKey = ''
  logUi.codeTop = 0
}

// beats of light: flashes, sweeps, shakes
function flash(t) {
  const hit = (at, v, len = 0.35) => (t >= at && t < at + len ? v * (1 - (t - at) / len) : 0)
  let f = hit(4.0, 0.85, 0.5) + hit(8.0, 0.5, 0.3) + hit(44.0, 0.25, 0.3) + hit(56.0, 0.9, 0.6) + hit(62.0, 0.6, 0.5)
  const cut = montageCut(t)
  if (cut >= 0) {
    const span = t < 54 ? 0.5 : 0.25
    f += hit(48 + (t < 54 ? cut * 0.5 : 6 + (cut - 12) * 0.25), 0.16, span * 0.4)
  }
  return Math.min(1, f)
}
const sweep = t => (t >= 5.3 && t < 6.6 ? (t - 5.3) / 1.3 : t >= 57.2 && t < 58.6 ? (t - 57.2) / 1.4 : null)
function shake(t) {
  const s = t >= 44 && t < 44.5 ? (1 - (t - 44) / 0.5) * 10 : t >= 56 && t < 56.4 ? (1 - (t - 56) / 0.4) * 8 : 0
  return s ? { x: (Math.random() - 0.5) * s, y: (Math.random() - 0.5) * s } : undefined
}
function fadeOut(t) {
  return t > 65 ? (t - 65) / 1 : 0
}

// ════════════════════════════════════════════════════════════════════════════
// The score and its cues
// ════════════════════════════════════════════════════════════════════════════
function audioSpec() {
  const cues = [
    { kind: 'impact', t: 4.0, v: 1.1 },
    { kind: 'whoosh', t: 6.95, len: 1.1, v: 1.2 },
    { kind: 'impact', t: 8.0, v: 0.8 },
    { kind: 'whoosh', t: 8.0, len: 1.4, v: 0.9, dir: -1 },
    { kind: 'whoosh', t: 13.85, len: 0.6 },
    { kind: 'whoosh', t: 15.55, len: 0.55, dir: -1 },
    { kind: 'whoosh', t: 17.55, len: 0.55 },
    { kind: 'whoosh', t: 19.85, len: 0.6, dir: -1 },
    { kind: 'pop', t: 21.0, pan: -0.3 },
    { kind: 'pop', t: 21.5, v: 0.9 },
    { kind: 'pop', t: 22.0, pan: 0.3 },
    { kind: 'whoosh', t: 27.85, len: 0.5 },
    { kind: 'whoosh', t: 30.85, len: 0.7, dir: -1 },
    { kind: 'error', t: 32.5 },
    { kind: 'typing', t: 34.0, len: 1.1 },
    { kind: 'success', t: 37.5 },
    { kind: 'whoosh', t: 38.95, len: 0.55, v: 1.3, dir: -1 },
    { kind: 'impact', t: 44.0, v: 0.8 },
    { kind: 'alarm', t: 44.1 },
    { kind: 'zap', t: 46.4 },
    { kind: 'impact', t: 56.0, v: 1.2 },
    { kind: 'whoosh', t: 61.4, len: 0.8, v: 1.1 },
    { kind: 'impact', t: 62.0, v: 1.0 },
  ]
  // a tick on every montage cut
  for (let c = 0; c < 20; c++) cues.push({ kind: 'tick', t: c < 12 ? 48 + c * 0.5 : 54 + (c - 12) * 0.25, v: 0.8 })
  // a soft blip for each tool call while the dashboard is on screen
  let last = -1
  for (const [t, si] of callTimes.sort((a, b) => a[0] - b[0])) {
    if (t < 8.2 || t > 61 || t - last < 0.14) continue
    cues.push({ kind: 'blip', t, i: Math.floor(t * 3) % 7, v: t >= 48 && t < 56 ? 0.7 : 0.55, pan: (si - 1) * 0.5 })
    last = t
  }
  const warp = c => ({ ...c, t: c.t / SCALE, ...(c.len ? { len: c.len / SCALE } : {}) })
  return {
    duration: OUT_DURATION,
    bpm: TEMPO,
    form: [
      { from: 0, to: 2, kind: 'intro' },
      { from: 2, to: 10, kind: 'drop1' },
      { from: 10, to: 12, kind: 'lift' },
      { from: 12, to: 21, kind: 'drop2' },
      { from: 21, to: 24, kind: 'halftime' },
      { from: 24, to: 28, kind: 'build' },
      { from: 28, to: 31, kind: 'final' },
      { from: 31, to: 34, kind: 'tail' },
    ],
    noMusic: !!opt('--music'),
    musicGain: 1,
    arpFrom: 16,
    sections: [
      { from: 0, to: 4, kind: 'intro' },
      { from: 4, to: 42, kind: 'drive' },
      { from: 42, to: 48, kind: 'tension' },
      { from: 48, to: 56, kind: 'build' },
      { from: 56, to: 62, kind: 'drop' },
      { from: 62, to: 66, kind: 'tail' },
    ],
    risers: [
      { t: 1.6, len: 2.4, v: 1 },
      { t: 6.6, len: 1.4, v: 0.6 },
      { t: 46, len: 2, v: 0.8 },
      { t: 52, len: 4, v: 1.3 },
    ],
    crashes: [8, 20, 28, 31, 39, 48],
    fills: [[19.5, 20], [27.5, 28], [38.5, 39], [47, 48], [54, 56]],
    cues: cues.map(warp),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Rendering
// ════════════════════════════════════════════════════════════════════════════
function edgePath() {
  const c = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  return process.env.CHROME_PATH || c.find(p => fs.existsSync(p))
}
const browser = await puppeteer.launch({
  executablePath: edgePath(),
  headless: true,
  args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'],
})
const page = await browser.newPage()
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(path.join(HERE, 'stage.html')).href)
if (!(await page.evaluate(() => window.ready))) console.warn('fonts did not load')

const S = new Screen(COLS, ROWS)
let simUpTo = -1
function advanceTo(t) {
  sim.advance(t)
  poll(BASE + t * 1000, true)
  simUpTo = t
}
async function renderAt(t) {
  advanceTo(t)
  const now = BASE + t * 1000
  steer(t)
  const cam = camera(t)
  const p = panel(t)
  let grid
  if (p) {
    frame(S, t, now)
    grid = { w: S.w, h: S.h, ch: S.ch, fg: Array.from(S.fg), bg: Array.from(S.bg), b: Array.from(S.b).join(''), cam }
  }
  const f = {
    t,
    drift: { x: Math.sin(t * 0.21) * 0.6 + (p ? p.ry / 30 : 0), y: Math.cos(t * 0.17) * 0.4 },
    grid,
    panel: p,
    dof: p ? dof(t, cam) : undefined,
    mb: p ? motionBlur(t) : { x: 0, y: 0 },
    type: typeAt(t),
    scrim: Math.max(0, ...typeAt(t).filter(it => it.y >= 780).map(it => Math.min(1, it.p * 2) * (1 - Math.min(1, it.out)))),
    creatures: creatures(t),
    flash: Math.min(1, flash(t) + fadeOut(t) * 0) ,
    sweep: sweep(t),
    shake: shake(t),
  }
  await page.evaluate(d => window.renderFrame(d), f)
  if (fadeOut(t) > 0) await page.evaluate(a => (document.getElementById('stage').style.opacity = String(1 - a)), fadeOut(t))
}

const stills = opt('--stills')
if (stills) {
  for (const t of stills.split(',').map(Number).sort((a, b) => a - b)) {
    for (let x = Math.max(0, simUpTo); x < t; x += 1 / 30) advanceTo(x)
    await renderAt(t)
    await page.screenshot({ path: path.join(OUT, `still-${t}.png`) })
    console.log('still', t)
  }
  await browser.close()
  process.exit(0)
}

// The film is rendered in segments, each in a fresh process (see render.mjs),
// so memory is given back between them and an interrupted render resumes.
const SEGDIR = path.join(OUT, 'segments')
fs.mkdirSync(SEGDIR, { recursive: true })

// --audio: compose the score (and mix in --music) once
if (argv.includes('--audio')) {
  const wavPath = path.join(OUT, 'score.wav')
  console.log('composing the score…')
  await page.goto(pathToFileURL(path.join(HERE, TEMPO !== 120 || argv.includes('--festival') ? 'festival.html' : 'score.html')).href)
  const b64 = await page.evaluate(spec => window.renderAudio(spec), audioSpec())
  fs.writeFileSync(wavPath, Buffer.from(b64, 'base64'))
  if (opt('--music')) {
    const mixed = path.join(OUT, 'mix.wav')
    await new Promise((res, rej) =>
      spawn(ffmpegPath, ['-y', '-i', opt('--music'), '-i', wavPath, '-filter_complex', '[0:a]volume=0.8,afade=t=out:st=63:d=3[m];[m][1:a]amix=inputs=2:normalize=0[a]', '-map', '[a]', '-t', String(DURATION), mixed], { stdio: 'inherit' }).on('close', c => (c ? rej(new Error('mix failed')) : res())),
    )
  }
  await browser.close()
  process.exit(0)
}

// --segment <i> --of <n>: frames [i·len, (i+1)·len) into segments/seg-<i>.mp4
const seg = Number(opt('--segment'))
const SEGS = Number(opt('--of') || 11)
if (!Number.isInteger(seg)) {
  console.log('use render.mjs (or --audio / --segment <i> --of <n>)')
  await browser.close()
  process.exit(1)
}
const total = Math.round(OUT_DURATION * FPS)
const per = Math.ceil(total / SEGS)
const f0 = seg * per
const f1 = Math.min(total, f0 + per)
for (let x = 0; x < (f0 / FPS) * SCALE; x += 1 / 30) advanceTo(x) // replay the scenario up to the segment
const part = path.join(SEGDIR, `seg-${String(seg).padStart(2, '0')}.part.mp4`)
const ff = spawn(
  ffmpegPath,
  ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'film', '-an', part],
  { stdio: ['pipe', 'ignore', 'ignore'] },
)
for (let f = f0; f < f1; f++) {
  await renderAt((f / FPS) * SCALE)
  const png = await page.screenshot({ type: 'png' })
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r))
}
ff.stdin.end()
await new Promise(r => ff.on('close', r))
await browser.close()
fs.renameSync(part, path.join(SEGDIR, `seg-${String(seg).padStart(2, '0')}.mp4`))
console.log(`segment ${seg + 1}/${SEGS} done`)
