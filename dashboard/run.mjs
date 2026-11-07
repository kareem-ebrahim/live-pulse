#!/usr/bin/env node
// Runs the dashboard and starts it again whenever it exits with 75, which it
// does when its own code changes: every update replaces the old window's
// contents with the new version, in the same window.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(HERE, 'pulse-dash.mjs')

function start() {
  const child = spawn(process.execPath, [script, ...process.argv.slice(2)], { stdio: 'inherit' })
  child.on('exit', code => {
    if (code === 75) setTimeout(start, 150)
    else process.exit(code ?? 0)
  })
}
start()
