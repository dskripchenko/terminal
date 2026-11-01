import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import xterm from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { Terminal } from '../src/terminal'
import { differences } from './oracle'

const { Terminal: XTerm } = xterm as unknown as { Terminal: new (o: object) => import('@xterm/headless').Terminal }
const dir = join(import.meta.dirname, 'fixtures', 'sessions')

/**
 * Real programs, recorded (scripts/record.mjs): after every piece the screen
 * reads as xterm's does; at the end, every cell's colour and style too.
 */
describe('recorded sessions read as xterm reads them', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    it(file.replace('.json', ''), async () => {
      const { cols, rows, chunks } = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { cols: number; rows: number; chunks: string[] }
      const ours = new Terminal({ cols, rows, scrollback: 1000 })
      const theirs = new XTerm({ cols, rows, scrollback: 1000, allowProposedApi: true })
      for (const [i, c] of chunks.entries()) {
        ours.write(c)
        await new Promise<void>((r) => theirs.write(c, r))
        expect(differences(ours, theirs, false), `after piece ${i}`).toEqual([])
      }
      expect(differences(ours, theirs, true), 'cells at the end').toEqual([])
    })
  }
})
