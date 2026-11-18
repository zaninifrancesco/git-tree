import { expect, test } from 'claude-code/testing'

import { ago, layout, parseStatus } from './git.js'

const commit = (sha: string, parents: string[], subject = sha) => ({
  sha: sha.padEnd(40, '0'),
  parents: parents.map(p => p.padEnd(40, '0')),
  author: 'Ada',
  at: 1_700_000_000,
  subject,
  refs: [],
  isHeadRef: false,
})

test('the layout puts a branch on its own lane and joins it at the merge', () => {
  const M = commit('m', ['a', 'b'], 'merge feature')
  const { rows, lanes } = layout(
    [M, commit('b', ['r']), commit('a', ['r']), commit('r', [])],
    M.sha,
  )

  expect(lanes).toBe(2)
  expect(rows.map(r => r.col)).toEqual([0, 1, 0, 1])
  expect(rows[0].isMerge).toBe(true)
  expect(rows[0].isHead).toBe(true)
  // everything is reachable from HEAD here
  expect(rows.every(r => r.isOnBranch)).toBe(true)
})

test('a commit HEAD cannot reach is marked as off the current branch', () => {
  const head = commit('a', ['r'])
  const { rows } = layout([commit('f', ['r']), head, commit('r', [])], head.sha)

  expect(rows[0].isOnBranch).toBe(false)
  expect(rows[1].isOnBranch).toBe(true)
})

test('status gives the branch, how far it is and what changed', () => {
  const info = parseStatus(
    ['## main...origin/main [ahead 2, behind 1]', 'M  a.ts', ' M b.ts', '?? c.ts', 'UU d.ts'].join('\n'),
  )

  expect(info.branch).toBe('main')
  expect(info.upstream).toBe('origin/main')
  expect(info.ahead).toBe(2)
  expect(info.behind).toBe(1)
  expect(info.staged).toBe(1)
  expect(info.changed).toBe(1)
  expect(info.untracked).toBe(1)
  expect(info.conflicts).toBe(1)
  expect(parseStatus('## HEAD (no branch)').isDetached).toBe(true)
})

test('ages read in english', () => {
  expect(ago(1000, 1000 * 1000 + 5_000)).toBe('now')
  expect(ago(0, 3 * 3600 * 1000)).toBe('3 h ago')
})

const PANE = {
  plugin: 'git-tree',
  component: 'Pane',
  requestId: 'git-tree',
  props: {
    title: 'Git',
    isFocused: false,
    bodyColumns: 56,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the pane shows the current branch and the commits, on every surface', async ($, on) => {
  const head = 'a'.padEnd(40, '0')
  const { rows, lanes } = layout(
    [
      { ...commit('a', ['r'], 'work in progress'), refs: [{ n: 'feature', k: 'l' as const, cur: true }], isHeadRef: true },
      commit('r', [], 'first commit'),
    ],
    head,
  )
  const stored: Record<string, unknown> = {
    repo: {
      shape: 'repo-2',
      value: {
        state: 'ok', name: 'demo', branch: 'feature', isDetached: false, isUnborn: false,
        upstream: 'origin/feature', ahead: 1, behind: 0, staged: 0, changed: 2, untracked: 0,
        conflicts: 0, head, branches: ['feature', 'main'],
      },
    },
    graph: { shape: 'graph-1', value: { fingerprint: 'x', rows, lanes, hasMore: false } },
  }
  on('clock.now', () => ({ value: 1_700_000_100_000 }))
  on('state.get', (_, e) => ({ value: { value: stored[e.key], version: 1 } }))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: / feature / })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /first commit/ })).toBeTruthy()
    expect(await ui.find({ type: 'Select' })).toBeTruthy()
    await ui.unmount()
  }
})

test('a folder that is no repository says so', async ($, on) => {
  on('clock.now', () => ({ value: 1_700_000_100_000 }))
  on('state.get', (_, e) => ({
    value: {
      value:
        e.key === 'repo'
          ? { shape: 'repo-2', value: { state: 'no-repo', name: '', branch: '', isDetached: false, isUnborn: false, upstream: '', ahead: 0, behind: 0, staged: 0, changed: 0, untracked: 0, conflicts: 0, head: '', branches: [] } }
          : undefined,
      version: 1,
    },
  }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /not a git repository/ })).toBeTruthy()
  await ui.unmount()
})
