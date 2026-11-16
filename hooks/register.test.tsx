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
