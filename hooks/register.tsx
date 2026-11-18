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
    void $.ui.toast(out.isOk ? `⬇ ${out.text}` : `Pull failed: ${out.text}`, {
      timeoutMs: out.isOk ? 5000 : 12000,
    })
  } catch (error) {
    void $.ui.toast(`Pull failed: ${String(error).slice(0, 200)}`, { timeoutMs: 12000 })
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
    void $.ui.toast(out.isOk ? `⎇ Now on ${branch}` : `Switch failed: ${out.text}`, {
      timeoutMs: out.isOk ? 4000 : 12000,
    })
  } catch (error) {
    void $.ui.toast(`Switch failed: ${String(error).slice(0, 200)}`, { timeoutMs: 12000 })
  } finally {
    await update($, pullingAtom, () => false)
    void refresh($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'git-tree',
      description: 'Opens the git tree pane',
    })
    void open($)
    void refresh($)
    poll?.cancel()
    poll = $.clock.every(POLL_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'git-tree' }, async $ => {
    await open($)
    void refresh($)

    return { text: 'Git tree pane opened.' }
  })

  // A commit, pull, push or merge is mostly a shell command: look right after.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.tool === 'Bash' || e.tool === 'PowerShell') void refresh($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Select } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const repo = await read($, repoAtom)
    const graph = await read($, graphAtom)
    const now = await $.clock.now()
    const isPulling = await read($, pullingAtom)

    if (repo.state !== 'ok') {
      return (
        <Box flexDirection="column" padding={1} gap={1}>
          <Text bold>Git tree</Text>
          <Text dimColor>
            {repo.state === 'loading'
              ? 'Reading the repository…'
              : 'The session folder is not a git repository.'}
          </Text>
        </Box>
      )
    }

    const label = repo.isDetached
      ? `Detached HEAD @ ${repo.head.slice(0, 7)}`
      : repo.branch || '(no branch)'
    const lanes = Math.max(1, Math.min(graph.lanes, MAX_LANES))
    const hasChanges = repo.staged + repo.changed + repo.untracked + repo.conflicts > 0

    const toolbar = (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1} marginBottom={1}>
        {repo.branches.length > 0 && (
          <Select
            key="branch"
            label="Branch"
            value={repo.isDetached ? undefined : repo.branch}
            options={repo.branches.map(name => ({ value: name, label: name }))}
            onSelect={name => void switchTo($, name)}
          />
        )}
        <Button
          key="pull"
          variant="primary"
          label={isPulling ? 'Working…' : repo.behind > 0 ? `⬇ Pull (${repo.behind})` : '⬇ Pull'}
          onPress={() => void pull($)}
        />
      </Box>
    )

    const header = (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={ACCENT}
        paddingX={1}
        marginBottom={1}
      >
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color={ACCENT} bold>
            ⎇
          </Text>
          <Text backgroundColor={ACCENT} color="#1a1200" bold wrap="truncate-end">
            {` ${label} `}
          </Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          {repo.name}
          {repo.upstream ? ` → ${repo.upstream}` : repo.isUnborn ? ' · no commits yet' : ' · no upstream'}
        </Text>
        <Text wrap="wrap">
          {repo.ahead > 0 && <Text color="success" bold>{`↑${repo.ahead} `}</Text>}
          {repo.behind > 0 && <Text color="warning" bold>{`↓${repo.behind} `}</Text>}
          {repo.staged > 0 && <Text color="success">{`● ${repo.staged} staged  `}</Text>}
          {repo.changed > 0 && <Text color="warning">{`✎ ${repo.changed} modified  `}</Text>}
          {repo.untracked > 0 && <Text dimColor>{`? ${repo.untracked} untracked  `}</Text>}
          {repo.conflicts > 0 && <Text color="error" bold>{`⚠ ${repo.conflicts} conflicts`}</Text>}
          {!hasChanges && repo.ahead === 0 && repo.behind === 0 && (
            <Text dimColor>✓ clean and up to date</Text>
          )}
        </Text>
      </Box>
    )

    const rows = graph.rows.map(row => {
      const refs = row.refs.map(r => {
        if (r.cur) {
          return (
            <Text backgroundColor={ACCENT} color="#1a1200" bold>
              {` ⎇ ${r.n} `}
            </Text>
          )
        }
        if (r.k === 'l') {
          return (
            <Text backgroundColor={PALETTE[row.color % PALETTE.length]} color="#0d1117" bold>
              {` ${r.n} `}
            </Text>
          )
        }
        if (r.k === 't') return <Text color="warning">{`◆ ${r.n}`}</Text>

        return (
          <Text color={PALETTE[row.color % PALETTE.length]} dimColor>
            {`${r.n}`}
          </Text>
        )
      })
      const pills = refs.flatMap(p => [p, ' '])
      const subject = (
        <Text bold={row.isHead} dimColor={!row.isOnBranch}>
          {row.subject}
        </Text>
      )

      if (!Svg) {
        // The terminal draws no SVG: one line of box-drawing glyphs.
        return (
          <Box flexDirection="row" key={row.sha}>
            <Text>
              {rowCells(row, lanes).map(cell =>
                cell.color ? <Text color={cell.color}>{cell.ch}</Text> : cell.ch,
              )}
            </Text>
            <Text wrap="truncate-end">
              {' '}
              {pills}
              {subject}
              <Text dimColor>{`  ${row.short}`}</Text>
            </Text>
          </Box>
        )
      }

      const drawn = rowSvg(row, lanes)

      return (
        <Box flexDirection="row" alignItems="center" key={row.sha}>
          <Svg
            source={drawn.source}
            alt={`${row.isHead ? 'HEAD, ' : ''}${row.subject}`}
            width={graphWidth(lanes)}
            height={ROW_H}
            isInteractive={drawn.isAnimated}
          />
          <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" paddingLeft={1}>
            <Text wrap="truncate-end">
              {pills}
              {subject}
            </Text>
            <Text dimColor wrap="truncate-end">
              {`${row.short}  ·  ${row.author}  ·  ${ago(row.at, now)}`}
            </Text>
          </Box>
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        {toolbar}
        {header}
        {graph.rows.length === 0 && <Text dimColor>No commits yet.</Text>}
        {rows}
        <Box flexDirection="row" gap={2} marginTop={1}>
          {graph.hasMore && (
            <Button
              key="more"
              label={`Show ${PAGE} more commits`}
              onPress={async () => {
                await update($, limitAtom, n => n + PAGE)
                void refresh($)
              }}
            />
          )}
          <Button key="refresh" label="Refresh" dimColor onPress={() => void refresh($)} />
        </Box>
      </Box>
    )
  })
}
