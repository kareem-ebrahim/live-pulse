#!/usr/bin/env node
// Renders the whole film segment by segment, each in a fresh process, then
// joins the segments and lays the score under them. Run it again after an
// interruption and it picks up where it stopped.
//
//   node render.mjs [--url github.com/you/live-pulse] [--music track.mp3]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')
const SEGDIR = path.join(OUT, 'segments')
const SEGS = 11
const pass = process.argv.slice(2)
fs.mkdirSync(SEGDIR, { recursive: true })

const run = args => {
  const r = spawnSync(process.execPath, [path.join(HERE, 'make-video.mjs'), ...args, ...pass], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`make-video ${args.join(' ')} failed`)
}

const audio = path.join(OUT, pass.includes('--music') ? 'mix.wav' : 'score.wav')
if (!fs.existsSync(audio)) run(['--audio'])

for (let i = 0; i < SEGS; i++) {
  const done = path.join(SEGDIR, `seg-${String(i).padStart(2, '0')}.mp4`)
  if (fs.existsSync(done)) {
    console.log(`segment ${i + 1}/${SEGS} already rendered`)
    continue
  }
  const started = Date.now()
  run(['--segment', String(i), '--of', String(SEGS)])
  console.log(`  ${Math.round((Date.now() - started) / 1000)}s`)
}

// join the segments without re-encoding, then add the audio
const list = path.join(SEGDIR, 'list.txt')
fs.writeFileSync(list, Array.from({ length: SEGS }, (_, i) => `file 'seg-${String(i).padStart(2, '0')}.mp4'`).join('\n'))
const file = path.join(OUT, pass.includes('--tempo') ? 'live-pulse-festival.mp4' : 'live-pulse.mp4')
const r = spawnSync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', file], { stdio: 'inherit' })
if (r.status !== 0) throw new Error('joining failed')
console.log(`\n${file}`)
