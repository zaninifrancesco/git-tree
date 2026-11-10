/** Un tratto di linea del grafo: corsia, indice colore, stile (0 normale, 1 ramo corrente, 2 attenuato). */
export type Seg = { l: number; c: number; s: 0 | 1 | 2 }

/** Un'etichetta su un commit: branch locale (l), remoto (r) o tag (t); `cur` per il branch corrente. */
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
  /** Il commit su cui punta HEAD. */
  isHead: boolean
  /** Raggiungibile da HEAD (fa parte del branch corrente). */
  isOnBranch: boolean
  top: Seg[]
  pass: Seg[]
  bot: Seg[]
}
