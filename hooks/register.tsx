import { atom, read, update } from 'claude-code'
import type { Hook, Register, Timer } from 'claude-code'

import { ACCENT, ROW_H, graphWidth, rowCells, rowSvg } from './draw.js'
import {
  EMPTY_GRAPH,
  EMPTY_REPO,
  PALETTE,
  ago,
  loadGraph,
  probe,
  runPull,
  runSwitch,
} from './git.js'
import type { Sys } from './git.js'

type Dollar = Parameters<Hook<'session.start'>>[0]

/** `$` never crosses an import, so git.ts gets this thin view of it instead. */
function sysOf($: Dollar): Sys {
  return {
    process: { run: (argv, init) => $.process.run(argv, init) },
    session: { cwd: () => $.session.cwd() },
  }
}

const PANE = 'git-tree'
const PAGE = 200
const POLL_MS = 3000
/** Lanes drawn side by side; busier histories fold into the last one. */
const MAX_LANES = 8

// Change a tag when the fields of its value change: it declines what an
// earlier version stored, which outlives a reload.
const repoAtom = atom({ plugin: 'git-tree', key: 'repo' } as const, EMPTY_REPO, {
  shape: 'repo-2',
})
const graphAtom = atom({ plugin: 'git-tree', key: 'graph' } as const, EMPTY_GRAPH, {
  shape: 'graph-1',
})
const limitAtom = atom({ plugin: 'git-tree', key: 'limit' } as const, PAGE, {
  shape: 'limit-1',
})

let poll: Timer | undefined
let isBusy = false
let isQueued = false

/** Looks at the repository and redraws only what moved. */
async function refresh($: Dollar): Promise<void> {
  if (isBusy) {
    isQueued = true

    return
  }
  isBusy = true
  try {
    do {
      isQueued = false
      const limit = await read($, limitAtom)
      const seen = await probe(sysOf($), limit)
      if (seen.kind === 'no-repo') {
        const old = await read($, repoAtom)
        if (old.state !== 'no-repo') {
          await update($, repoAtom, () => ({ ...EMPTY_REPO, state: 'no-repo' as const }))
        }
        continue
      }
      const old = await read($, repoAtom)
      if (JSON.stringify(old) !== JSON.stringify(seen.repo)) {
        await update($, repoAtom, () => seen.repo)
      }
      const graph = await read($, graphAtom)
      if (graph.fingerprint !== seen.fingerprint) {
        const fresh = await loadGraph(sysOf($), limit, seen.repo.head, seen.fingerprint)
        await update($, graphAtom, () => fresh)
      }
    } while (isQueued)
  } catch {
    // A git call that failed or timed out: what is drawn stays, the next tick tries again.
  } finally {
    isBusy = false
  }
}

function open($: Dollar) {
  return $.ui.open({ id: PANE, title: 'Git', columns: 56 })
}

const pullingAtom = atom({ plugin: 'git-tree', key: 'isPulling' } as const, false, {
  shape: 'pulling-1',
})

/** The pull button: one pull at a time, the result as a toast. */
async function pull($: Dollar): Promise<void> {
  if (await read($, pullingAtom)) return
  await update($, pullingAtom, () => true)
  try {
    const out = await runPull(sysOf($))
    void $.ui.toast(out.isOk ? `⬇ ${out.text}` : `Pull non riuscito: ${out.text}`, {
      timeoutMs: out.isOk ? 5000 : 12000,
    })
  } catch (error) {
    void $.ui.toast(`Pull non riuscito: ${String(error).slice(0, 200)}`, { timeoutMs: 12000 })
  } finally {
    await update($, pullingAtom, () => false)
    void refresh($)
  }
}

/** The branch selector: switches to a branch the pane listed, one operation at a time. */
async function switchTo($: Dollar, branch: string): Promise<void> {
  if (await read($, pullingAtom)) return
  const repo = await read($, repoAtom)
  if (!repo.branches.includes(branch) || branch === repo.branch) return
  await update($, pullingAtom, () => true)
  try {
    const out = await runSwitch(sysOf($), branch)
    void $.ui.toast(out.isOk ? `⎇ Ora su ${branch}` : `Cambio branch non riuscito: ${out.text}`, {
      timeoutMs: out.isOk ? 4000 : 12000,
    })
  } catch (error) {
    void $.ui.toast(`Cambio branch non riuscito: ${String(error).slice(0, 200)}`, { timeoutMs: 12000 })
  } finally {
    await update($, pullingAtom, () => false)
    void refresh($)
  }
}
