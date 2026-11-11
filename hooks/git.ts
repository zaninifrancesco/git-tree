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
