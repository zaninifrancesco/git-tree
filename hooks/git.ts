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
