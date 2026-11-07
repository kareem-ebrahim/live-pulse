import { expect, mock, test } from 'claude-code/testing'

test('calls pass through untouched while their code lands in event files', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
  mock.store(on, { autoWindow: false })
  const writes: Array<{ path: string; text: string }> = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path.split(String.fromCharCode(92)).join('/'), text: e.text })
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', () => ({ value: { command: 'pulse' } }))
  on('ui.close', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1200, window: 200000, percent: 1 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { ok: true }, text: 'line one\nline two' }))

  await $.session.start({ cwd: 'C:\\proj', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'run the tests' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\proj\\src\\a.ts', old_string: 'const a = 1', new_string: 'const a = 2' })
  await clock.advance(600)

  expect(ran.deny).toBeUndefined()
  const events = writes.filter(w => w.path.includes('/events/sess-1/')).map(w => JSON.parse(w.text))
  const bash = events.find(ev => ev.kind === 'call' && ev.tool === 'Bash')
  expect(bash?.code?.text).toBe('npm test')
  const bashDone = events.find(ev => ev.kind === 'done' && ev.tool === 'Bash')
  expect(bashDone?.output).toBe('line one\nline two')
  const edit = events.find(ev => ev.kind === 'call' && ev.tool === 'Edit')
  expect(edit?.diff?.path).toBe('src/a.ts')
  expect(edit?.diff?.new).toBe('const a = 2')
  const snap = writes.filter(w => w.path.endsWith('/sessions/sess-1.json')).pop()
  expect(JSON.parse(snap?.text ?? '{}').files[0].abs).toBe('c:/proj/src/a.ts')
})

test('a background shell shows while it runs and goes when it ends', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { USERPROFILE: 'C:\Users\me' })
  mock.store(on, { autoWindow: false })
  const snaps: string[] = []
  on('fs.write', (_, e) => {
    if (e.path.split(String.fromCharCode(92)).join('/').endsWith('/sessions/sess-2.json')) snaps.push(e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('session.id', () => ({ value: 'sess-2' }))
  on('command.register', () => ({ value: { command: 'pulse' } }))
  on('ui.close', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 200000, percent: 0 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { ok: true }, text: 'Command running in background with ID: bg42abc' }))

  await $.session.start({ cwd: 'C:\proj', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  await clock.advance(600)
  const running = JSON.parse(snaps[snaps.length - 1]).bg
  expect(running[0].id).toBe('bg42abc')
  expect(running[0].status).toBe('running')

  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: '<task-notification><task-id>bg42abc</task-id><status>completed</status></task-notification>' }] } })
  await clock.advance(600)
  expect(JSON.parse(snaps[snaps.length - 1]).bg[0].status).toBe('done')
})
