/** Un tratto di linea del grafo: corsia, indice colore, stile (0 normale, 1 ramo corrente, 2 attenuato). */
export type Seg = { l: number; c: number; s: 0 | 1 | 2 }

/** A label on a commit: local branch (l), remote (r) or tag (t); `cur` for the current branch. */
export type RefTag = { n: string; k: 'l' | 'r' | 't'; cur?: true }

export type GraphRow = {
  sha: string
  short: string
  subject: string
  author: string
  /** Secondi dall'epoch. */
  at: number
  isMerge: boolean
  col: number
  color: number
  refs: RefTag[]
  /** The commit HEAD points at. */
  isHead: boolean
  /** Reachable from HEAD (part of the current branch). */
  isOnBranch: boolean
  top: Seg[]
  pass: Seg[]
  bot: Seg[]
}

export type Graph = {
  fingerprint: string
  rows: GraphRow[]
  lanes: number
  hasMore: boolean
}

export type Repo = {
  state: 'loading' | 'no-repo' | 'ok'
  name: string
  branch: string
  isDetached: boolean
  isUnborn: boolean
  upstream: string
  ahead: number
  behind: number
  staged: number
  changed: number
  untracked: number
  conflicts: number
  head: string
  /** Local branches and those only on a remote, to switch to. */
  branches: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'git-tree': {
      repo: Shaped<Repo>
      graph: Shaped<Graph>
      limit: Shaped<number>
      isPulling: Shaped<boolean>
    }
  }
}
