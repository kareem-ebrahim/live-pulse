// A small line highlighter: comments, strings, numbers, keywords and calls,
// for the languages Claude Code sessions touch most.
import { P, hx } from './common.mjs'

const C = {
  kw: P.opus,
  str: P.router,
  num: P.peach,
  com: P.dim,
  fn: P.haiku,
  type: P.sonnet,
  flag: P.haiku,
  var: P.pink,
  text: hx('#d6dde4'),
  punct: P.mid,
}

const KW = {
  ts: 'import export from const let var function return if else for while do switch case break continue new class extends implements interface type enum async await yield try catch finally throw typeof instanceof in of as void null undefined true false this super default public private protected readonly static declare namespace keyof',
  py: 'import from as def return if elif else for while in not and or is None True False class try except finally raise with lambda yield pass break continue global nonlocal async await self',
  sh: 'if then else elif fi for in do done while case esac function return export local echo cd ls rm mkdir cp mv cat grep sed awk git npm npx node pnpm yarn cargo python pip sudo set unset source true false',
  ps1: 'if else elseif foreach for while do switch function return param begin process end try catch finally throw Get-ChildItem Get-Content Set-Content Write-Output Write-Host New-Item Remove-Item Test-Path Select-Object Where-Object ForEach-Object $true $false $null',
  rs: 'fn let mut const pub use mod struct enum impl trait for in if else match loop while return self Self crate super async await move ref true false Some None Ok Err',
  go: 'package import func var const type struct interface map chan go defer return if else for range switch case default break continue nil true false',
  sql: 'select from where insert into values update set delete create table alter add drop index primary key foreign references join left right inner outer on group by order having limit as and or not null',
  css: 'important',
  json: 'true false null',
}
const SETS = {}
for (const [k, v] of Object.entries(KW)) SETS[k] = new Set(v.split(' ').map(w => w.toLowerCase()))
const familyOf = lang => (lang === 'js' || lang === 'ts' || lang === 'java' || lang === 'cs' ? 'ts' : lang === 'yaml' ? 'py' : lang)

/** Splits one line into [text, color] runs. */
export function highlight(line, lang) {
  const fam = familyOf(lang)
  const kws = SETS[fam] ?? SETS.ts
  const out = []
  const push = (s, c) => s && out.push([s, c])
  const lineCom = fam === 'py' || fam === 'sh' || fam === 'ps1' || lang === 'yaml' ? '#' : fam === 'sql' ? '--' : '//'
  let i = 0
  let word = ''
  const flushWord = next => {
    if (!word) return
    const lw = word.toLowerCase()
    if (/^\d[\d_.xXa-fA-F]*$/.test(word)) push(word, C.num)
    else if ((fam === 'sh' || fam === 'ps1') && /^-{1,2}[\w-]+$/.test(word)) push(word, C.flag)
    else if (/^\$[\w:]+$/.test(word)) push(word, C.var)
    else if (kws.has(lw) || kws.has(word)) push(word, C.kw)
    else if (next === '(') push(word, C.fn)
    else if (/^[A-Z][A-Za-z0-9]+$/.test(word)) push(word, C.type)
    else push(word, C.text)
    word = ''
  }
  while (i < line.length) {
    const ch = line[i]
    if (line.startsWith(lineCom, i) || (fam === 'ts' && line.startsWith('/*', i))) {
      flushWord()
      push(line.slice(i), C.com)
      return out
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      flushWord()
      let j = i + 1
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1
      push(line.slice(i, j + 1), C.str)
      i = j + 1
      continue
    }
    if (/[\w$-]/.test(ch) && !(ch === '-' && word === '' && !/[\w-]/.test(line[i + 1] ?? ''))) {
      word += ch
      i++
      continue
    }
    flushWord(ch)
    push(ch, ch === ' ' ? C.text : C.punct)
    i++
  }
  flushWord()
  return out
}

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[A-Za-z]', 'g')
export function stripAnsi(s) {
  return String(s ?? '').replace(ANSI, '').replace(/\r/g, '').replace(/\t/g, '  ')
}

/**
 * A line diff (longest common subsequence): ' ' kept, '-' removed, '+' added,
 * with old (`a`) and new (`b`) line numbers.
 */
export function diffLines(A, B) {
  const n = A.length
  const m = B.length
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) out.push({ t: ' ', s: A[i], a: ++i, b: ++j })
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) out.push({ t: '+', s: B[j], b: ++j })
    else out.push({ t: '-', s: A[i], a: ++i })
  }
  return out
}

/** How many lines a diff adds and removes. */
export function diffStat(it) {
  if (!it.diff) return undefined
  let add = 0
  let del = 0
  for (const op of diffLines(stripAnsi(it.diff.old).split('\n'), stripAnsi(it.diff.new).split('\n'))) {
    if (op.t === '+') add++
    if (op.t === '-') del++
  }
  return { add, del }
}

/**
 * The lines a log item shows in the code view, each a list of [text, color]
 * runs plus an optional row background and gutter mark.
 */
export function codeLines(it) {
  const rows = []
  const add = (runs, o = {}) => rows.push({ runs, ...o })
  if (it.diff) {
    const lang = it.diff.lang
    for (const op of diffLines(stripAnsi(it.diff.old).split('\n'), stripAnsi(it.diff.new).split('\n'))) {
      if (op.t === ' ') add(highlight(op.s, lang), { mark: ' ', n: op.b, markColor: P.dim, ctx: true })
      else if (op.t === '-') add(highlight(op.s, lang), { mark: '-', n: op.a, bg: P.delBg, markColor: P.err })
      else add(highlight(op.s, lang), { mark: '+', n: op.b, bg: P.addBg, markColor: P.ok })
    }
  }
  if (it.code) {
    const isShell = it.code.lang === 'sh' || it.code.lang === 'ps1'
    stripAnsi(it.code.text)
      .split('\n')
      .forEach((l, k) => add(highlight(l, it.code.lang), { mark: isShell ? (k === 0 ? '$' : '>') : undefined, n: isShell ? undefined : k + 1, markColor: P.router }))
  }
  if (it.output) {
    add([[it.ok === false ? ' OUTPUT · FAILED ' : ' OUTPUT ', it.ok === false ? P.err : P.mid]], { head: true, section: true })
    for (const l of stripAnsi(it.output).split('\n')) add([[l, it.ok === false ? P.err : hx('#b8c1ca')]], { mark: '│', markColor: P.faint, bg: hx('#0a0d12') })
  }
  if (!rows.length) {
    if (it.msg) add([[it.msg, P.text]])
    if (it.result && it.result !== it.msg) add([[it.result, P.mid]])
    if (!rows.length) add([[it.running ? 'running…' : 'no code for this call', P.dim]])
  }
  return rows
}
