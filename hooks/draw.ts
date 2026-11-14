import type { GraphRow, Seg } from '../types'

import { PALETTE } from './git.js'

export const ROW_H = 46
const LANE_W = 18
const PAD = 8
/** The one color reserved for the checked-out branch: no lane ever uses it. */
export const ACCENT = '#ffb020'

const color = (i: number) => PALETTE[i % PALETTE.length]

export const graphWidth = (lanes: number) => lanes * LANE_W + PAD

const laneX = (lane: number, cap: number) =>
  PAD / 2 + Math.min(lane, cap - 1) * LANE_W + LANE_W / 2

function curve(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`
  const ym = (y1 + y2) / 2

  return `M${x1} ${y1}C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`
}

/** One row of the graph as an SVG: lines, the node and, for HEAD, a pulsing halo. */
export function rowSvg(row: GraphRow, lanes: number): { source: string; isAnimated: boolean } {
  const cap = lanes
  const width = graphWidth(lanes)
  const mid = ROW_H / 2
  const xc = laneX(row.col, cap)

  const segs: { d: string; seg: Seg }[] = [
    ...row.pass.map(seg => ({ seg, d: `M${laneX(seg.l, cap)} 0L${laneX(seg.l, cap)} ${ROW_H}` })),
    ...row.top.map(seg => ({ seg, d: curve(laneX(seg.l, cap), 0, xc, mid) })),
    ...row.bot.map(seg => ({ seg, d: curve(xc, mid, laneX(seg.l, cap), ROW_H) })),
  ]
  // Dim lines first, the current branch's own line last, so it stays on top.
  const weight = (s: Seg) => (s.s === 2 ? 0 : s.s === 0 ? 1 : 2)
  segs.sort((a, b) => weight(a.seg) - weight(b.seg))

  const lines = segs
    .map(({ d, seg }) => {
      const w = seg.s === 1 ? 3.6 : 2.2
      const o = seg.s === 2 ? 0.45 : 1

      return `<path d="${d}" fill="none" stroke="${color(seg.c)}" stroke-width="${w}" stroke-opacity="${o}" stroke-linecap="round"/>`
    })
    .join('')

  const c = color(row.color)
  let node: string
  if (row.isHead) {
    node =
      `<circle cx="${xc}" cy="${mid}" r="13" fill="${ACCENT}" fill-opacity="0.25">` +
      `<animate attributeName="r" values="10;15;10" dur="2.4s" repeatCount="indefinite"/>` +
      `<animate attributeName="fill-opacity" values="0.4;0.05;0.4" dur="2.4s" repeatCount="indefinite"/></circle>` +
      `<circle cx="${xc}" cy="${mid}" r="7.5" fill="${c}" stroke="${ACCENT}" stroke-width="3"/>`
  } else if (row.isMerge) {
    node = `<circle cx="${xc}" cy="${mid}" r="5" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="2.5" stroke-opacity="${row.isOnBranch ? 1 : 0.5}"/>`
  } else {
    node = `<circle cx="${xc}" cy="${mid}" r="5" fill="${c}" fill-opacity="${row.isOnBranch ? 1 : 0.55}"/>`
  }
  // The accent sits on the lane itself: a capsule centered on the HEAD node's lane, under the lines.
  const bar = row.isHead
    ? `<rect x="${xc - 4.5}" y="1" width="9" height="${ROW_H - 2}" rx="4.5" fill="${ACCENT}" fill-opacity="0.45"/>`
    : ''

  return {
    isAnimated: row.isHead,
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ROW_H}" viewBox="0 0 ${width} ${ROW_H}">` +
      bar +
      lines +
      node +
      `</svg>`,
  }
}
