#!/usr/bin/env node
// Copies this mod to the folder every new Claude Code session loads it from
// (settings.json: env.CLAUDE_CODE_PLUGIN_DIRS). Run after each change:
//   node sync.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = path.dirname(fileURLToPath(import.meta.url))
const dst = process.argv[2] || path.join(os.homedir(), '.claude', 'live-pulse-mod')
const skip = new Set([path.join('.claude-plugin', 'types')])

let n = 0
function copy(rel) {
  if (skip.has(rel)) return
  const from = path.join(src, rel)
  const to = path.join(dst, rel)
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const name of fs.readdirSync(from)) copy(path.join(rel, name))
  } else if (!fs.existsSync(to) || !fs.readFileSync(to).equals(fs.readFileSync(from))) {
    fs.copyFileSync(from, to)
    n++
  }
}
copy('')
console.log(`live-pulse: ${n} file(s) updated in ${dst}`)
