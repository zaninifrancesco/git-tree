import type { Graph, GraphRow, RefTag, Repo, Seg } from '../types'

/** The little of `$` this file needs, so it stays plain functions. */
export type Sys = {
  process: {
    run: (
      argv: readonly string[],
      init?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
    ) => Promise<{ exitCode: number; stdout: string; stderr?: string }>
  }
  session: { cwd: () => Promise<string> }
}

export const PALETTE = [
  '#4c9aff',
  '#36c78f',
  '#b57bff',
  '#2fc4d9',
  '#ff7ab6',
  '#ef6f6c',
  '#a6d84a',
  '#5fb3a1',
]

export const EMPTY_REPO: Repo = {
  state: 'loading',
  name: '',
  branch: '',
  isDetached: false,
  isUnborn: false,
  upstream: '',
  ahead: 0,
  behind: 0,
  staged: 0,
  changed: 0,
  untracked: 0,
  conflicts: 0,
  head: '',
  branches: [],
}

export const EMPTY_GRAPH: Graph = {
  fingerprint: '',
  rows: [],
  lanes: 1,
  hasMore: false,
}

const SEP = '\x1f'

// --- status ---------------------------------------------------------------

export function parseStatus(out: string): Partial<Repo> {
  const lines = out.split('\n').filter(Boolean)
  const info: Partial<Repo> = {
    branch: '',
    isDetached: false,
    isUnborn: false,
    upstream: '',
    ahead: 0,
    behind: 0,
    staged: 0,
    changed: 0,
    untracked: 0,
    conflicts: 0,
  }
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const text = line.slice(3)
      const unborn = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(text)
      if (unborn) {
        info.branch = unborn[1]
        info.isUnborn = true
      } else if (text.startsWith('HEAD (no branch)')) {
        info.isDetached = true
      } else {
        const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(text)
        if (m) {
          info.branch = m[1]
          info.upstream = m[2] ?? ''
          const ahead = /ahead (\d+)/.exec(m[3] ?? '')
          const behind = /behind (\d+)/.exec(m[3] ?? '')
          info.ahead = ahead ? Number(ahead[1]) : 0
          info.behind = behind ? Number(behind[1]) : 0
        }
      }
      continue
    }
    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') {
      info.untracked = (info.untracked ?? 0) + 1
    } else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      info.conflicts = (info.conflicts ?? 0) + 1
    } else {
      if (x !== ' ' && x !== '!') info.staged = (info.staged ?? 0) + 1
      if (y !== ' ' && y !== '!') info.changed = (info.changed ?? 0) + 1
    }
  }

  return info
}

// --- log ------------------------------------------------------------------

type Commit = {
  sha: string
  parents: string[]
  author: string
  at: number
  subject: string
  refs: RefTag[]
  isHeadRef: boolean
}

function parseDecorations(text: string): { refs: RefTag[]; isHeadRef: boolean } {
  const refs: RefTag[] = []
  let isHeadRef = false
  for (const raw of text.split(', ')) {
    const item = raw.trim()
    if (!item) continue
    if (item.startsWith('HEAD -> refs/heads/')) {
      isHeadRef = true
      refs.push({ n: item.slice('HEAD -> refs/heads/'.length), k: 'l', cur: true })
    } else if (item === 'HEAD') {
      isHeadRef = true
    } else if (item.startsWith('refs/heads/')) {
      refs.push({ n: item.slice('refs/heads/'.length), k: 'l' })
    } else if (item.startsWith('refs/remotes/')) {
      const name = item.slice('refs/remotes/'.length)
      if (!name.endsWith('/HEAD')) refs.push({ n: name, k: 'r' })
    } else if (item.startsWith('tag: refs/tags/')) {
      refs.push({ n: item.slice('tag: refs/tags/'.length), k: 't' })
    }
  }

  return { refs, isHeadRef }
}

function parseLog(out: string): Commit[] {
  const commits: Commit[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [sha, parents, author, at, deco, ...subject] = line.split(SEP)
    if (!sha) continue
    const { refs, isHeadRef } = parseDecorations(deco ?? '')
    commits.push({
      sha,
      parents: parents ? parents.split(' ') : [],
      author: author ?? '',
      at: Number(at) || 0,
      subject: subject.join(SEP),
      refs,
      isHeadRef,
    })
  }

  return commits
}

// --- lane layout ----------------------------------------------------------

type Lane = { sha: string; color: number; s: 0 | 1 | 2 } | null

export function layout(
  commits: Commit[],
  head: string,
): { rows: GraphRow[]; lanes: number } {
  const byId = new Map(commits.map(c => [c.sha, c]))

  // What HEAD reaches (the current branch's history) and its first-parent line.
  const onBranch = new Set<string>()
  const stack = head ? [head] : []
  while (stack.length > 0) {
    const sha = stack.pop() as string
    if (onBranch.has(sha)) continue
    const c = byId.get(sha)
    if (!c) continue
    onBranch.add(sha)
    for (const p of c.parents) stack.push(p)
  }
  const chain = new Set<string>()
  for (let sha: string | undefined = head; sha && !chain.has(sha); ) {
    chain.add(sha)
    sha = byId.get(sha)?.parents[0]
  }

  const lanes: Lane[] = []
  let nextColor = 0
  let maxLane = 0
  const rows: GraphRow[] = []

  for (const c of commits) {
    const hit: number[] = []
    lanes.forEach((l, i) => {
      if (l && l.sha === c.sha) hit.push(i)
    })

    let col: number
    let color: number
    if (hit.length > 0) {
      col = hit[0]
      color = (lanes[col] as NonNullable<Lane>).color
    } else {
      col = lanes.findIndex(l => l === null)
      if (col < 0) col = lanes.length
      color = nextColor++ % PALETTE.length
    }

    const hitSet = new Set(hit)
    const top: Seg[] = hit.map(i => {
      const l = lanes[i] as NonNullable<Lane>

      return { l: i, c: l.color, s: l.s }
    })
    const pass: Seg[] = []
    lanes.forEach((l, i) => {
      if (l && !hitSet.has(i)) pass.push({ l: i, c: l.color, s: l.s })
    })
    for (const i of hit) lanes[i] = null

    const isChain = chain.has(c.sha)
    const edgeStyle: 0 | 1 | 2 = onBranch.has(c.sha) ? (isChain ? 1 : 0) : 2
    const bot: Seg[] = []
    c.parents.forEach((p, idx) => {
      const style: 0 | 1 | 2 = idx === 0 ? edgeStyle : onBranch.has(c.sha) ? 0 : 2
      const existing = lanes.findIndex(l => l !== null && l.sha === p)
      if (existing >= 0) {
        bot.push({ l: existing, c: (lanes[existing] as NonNullable<Lane>).color, s: style })

        return
      }
      let target: number
      let useColor: number
      if (idx === 0) {
        target = col
        useColor = color
      } else {
        target = lanes.findIndex(l => l === null)
        if (target < 0) target = lanes.length
        useColor = nextColor++ % PALETTE.length
      }
      lanes[target] = { sha: p, color: useColor, s: style }
      bot.push({ l: target, c: useColor, s: style })
    })

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    for (const s of [...top, ...pass, ...bot]) maxLane = Math.max(maxLane, s.l)
    maxLane = Math.max(maxLane, col)

    rows.push({
      sha: c.sha,
      short: c.sha.slice(0, 7),
      subject: c.subject,
      author: c.author,
      at: c.at,
      isMerge: c.parents.length > 1,
      col,
      color,
      refs: c.refs,
      isHead: c.sha === head,
      isOnBranch: onBranch.has(c.sha),
      top,
      pass,
      bot,
    })
  }

  return { rows, lanes: maxLane + 1 }
}

// --- fetching ---------------------------------------------------------------

export type Probe =
  | { kind: 'no-repo' }
  | { kind: 'ok'; repo: Repo; fingerprint: string }

const ENV = { GIT_OPTIONAL_LOCKS: '0' }

/** The cheap part, run on every tick: status, the refs and HEAD. */
export async function probe(sys: Sys, limit: number): Promise<Probe> {
  const cwd = await sys.session.cwd()
  const git = (args: string[]) =>
    sys.process.run(['git', '-c', 'core.quotepath=off', ...args], {
      cwd,
      env: ENV,
      timeoutMs: 15000,
    })

  const top = await git(['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return { kind: 'no-repo' }
  const root = top.stdout.trim()

  const [status, refs, head] = await Promise.all([
    git(['status', '--porcelain=v1', '--branch']),
    git([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]),
    git(['rev-parse', 'HEAD']),
  ])
  const branches = listBranches(refs.stdout)
  const headSha = head.exitCode === 0 ? head.stdout.trim() : ''
  const info = parseStatus(status.stdout)
  const repo: Repo = {
    ...EMPTY_REPO,
    ...info,
    state: 'ok',
    name: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
    head: headSha,
    branches,
  }

  return {
    kind: 'ok',
    repo,
    fingerprint: [headSha, info.branch, limit, refs.stdout].join('|'),
  }
}

/** The costly part, run when the fingerprint moved. */
export async function loadGraph(
  sys: Sys,
  limit: number,
  head: string,
  fingerprint: string,
): Promise<Graph> {
  const cwd = await sys.session.cwd()
  const format = ['%H', '%P', '%an', '%at', '%D', '%s'].join('%x1f')
  let stdout = ''
  const log = await sys.process.run(
    [
      'git',
      '-c',
      'core.quotepath=off',
      'log',
      '--topo-order',
      '--decorate=full',
      `-n${limit + 1}`,
      `--format=${format}`,
      '--branches',
      '--remotes',
      '--tags',
      'HEAD',
    ],
    { cwd, env: ENV, timeoutMs: 30000 },
  )
  if (log.exitCode !== 0) {
    // An unborn HEAD makes `HEAD` a bad revision: ask without it.
    const retry = await sys.process.run(
      [
        'git',
        'log',
        '--topo-order',
        '--decorate=full',
        `-n${limit + 1}`,
        `--format=${format}`,
        '--branches',
        '--remotes',
        '--tags',
      ],
      { cwd, env: ENV, timeoutMs: 30000 },
    )
    if (retry.exitCode !== 0) return { ...EMPTY_GRAPH, fingerprint }
    stdout = retry.stdout
  } else {
    stdout = log.stdout
  }

  const commits = parseLog(stdout)
  const hasMore = commits.length > limit
  const shown = hasMore ? commits.slice(0, limit) : commits
  const { rows, lanes } = layout(shown, head)

  return { fingerprint, rows, lanes, hasMore }
}
