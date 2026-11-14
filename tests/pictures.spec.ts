import { describe, expect, it } from 'vitest'
import { decodeSixel, kittySource, readKitty } from '../src/pictures'
import { Terminal } from '../src/terminal'

const pixel = (d: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [...d.data.slice((y * d.width + x) * 4, (y * d.width + x) * 4 + 4)]

describe('sixel', () => {
  it('pixels in bands of six, colours of its own, repeats, carriage returns and new bands', () => {
    // A red 2×6 column, then a green one over it at x 1; a new band: one blue pixel.
    const d = decodeSixel('0;1;0q"1;1;3;7#1;2;100;0;0#2;2;0;100;0#1~~$#2?~-#3;2;0;0;100@')!
    expect([d.width, d.height]).toEqual([3, 7])
    expect(pixel(d, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(d, 1, 5)).toEqual([0, 255, 0, 255])
    expect(pixel(d, 0, 6)).toEqual([0, 0, 255, 255])
    // Not set: clear.
    expect(pixel(d, 2, 0)).toEqual([0, 0, 0, 0])
    const r = decodeSixel('q#0;2;0;0;0!5~')!
    expect([r.width, r.height]).toEqual([5, 6])
  })

  it('not a picture, or too big: none', () => {
    expect(decodeSixel('$qm')).toBeNull()
    expect(decodeSixel('q')).toBeNull()
    // A repeat past the limit is cut to it.
    expect(decodeSixel('q!99999~')?.width).toBe(4096)
    expect(decodeSixel('q~~-'.repeat(700) + '~')).toBeNull()
  })
})

describe('the kitty graphics protocol', () => {
  it('its keys read; another APC is not it', () => {
    expect(readKitty('Ga=T,f=100,i=7,q=2,c=10,C=1;iVBOR')).toMatchObject({ action: 'T', format: 100, id: 7, quiet: 2, cols: 10, stay: true, payload: 'iVBOR' })
    expect(readKitty('Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA')).toMatchObject({ action: 'q', format: 24, width: 1, height: 1, medium: 'd' })
    expect(readKitty('X something')).toBeNull()
  })

  it('a PNG by its header; raw pixels to RGBA', () => {
    // An 8×4 PNG's first bytes (signature and IHDR).
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 4, 8, 6, 0, 0, 0]).toString('base64')
    expect(kittySource(100, 0, 0, png)).toMatchObject({ width: 8, height: 4, source: { kind: 'png' } })
    expect(kittySource(100, 0, 0, Buffer.from('not png at all, really not').toString('base64'))).toEqual({ error: 'EBADPNG:not a PNG' })
    const rgb = kittySource(24, 2, 1, Buffer.from([255, 0, 0, 0, 0, 255]).toString('base64'))
    expect('source' in rgb && rgb.source.kind === 'rgba' && [...rgb.source.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
    expect(kittySource(24, 2, 2, Buffer.from([1, 2, 3]).toString('base64'))).toEqual({ error: 'ENODATA:short' })
  })
})

describe('pictures in the terminal', () => {
  const png8x4 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 16, 0, 0, 0, 32, 8, 6, 0, 0, 0]).toString('base64')
  const make = () => {
    const t = new Terminal({ cols: 20, rows: 5, scrollback: 10 })
    t.setCellPixels(8, 16)
    const replies: string[] = []
    t.onData((d) => replies.push(d))
    return { t, replies }
  }

  it('a sixel picture at the cursor, over the cells its size takes; the cursor below it', () => {
    const { t } = make()
    t.write('ab')
    // 12×20 pixels: 2 columns, 2 rows.
    t.write('\x1bP0;1q"1;1;12;20#0;2;100;0;0!12~\x1b\\')
    expect(t.pictures).toEqual([expect.objectContaining({ row: 0, col: 2, cols: 2, rows: 2, width: 12, height: 20 })])
    expect([t.buffer.x, t.buffer.y]).toEqual([0, 2])
  })

  it('the kitty protocol: shown, kept and shown again, deleted; answers unless quiet; files refused', () => {
    const { t, replies } = make()
    t.write(`\x1b_Ga=T,f=100,i=5;${png8x4}\x1b\\`)
    // 16×32: 2 columns, 2 rows; the cursor on its last row past its right edge.
    expect(t.pictures).toEqual([expect.objectContaining({ row: 0, col: 0, cols: 2, rows: 2, kittyId: 5 })])
    expect([t.buffer.x, t.buffer.y]).toEqual([2, 1])
    t.write('\x1b_Ga=p,i=5,c=4,r=1,q=1\x1b\\')
    expect(t.pictures[1]).toMatchObject({ cols: 4, rows: 1 })
    t.write('\x1b_Ga=d,d=i,i=5\x1b\\')
    expect(t.pictures).toEqual([])
    t.write(`\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\`)
    t.write(`\x1b_Ga=T,t=f,i=6;L2V0Yy9wYXNzd2Q=\x1b\\`)
    expect(replies).toEqual(['\x1b_Gi=5;OK\x1b\\', '\x1b_Gi=31;OK\x1b\\', '\x1b_Gi=6;ENOTSUPPORTED:only direct transmission\x1b\\'])
  })

  it('a transmission in pieces is joined', () => {
    const { t } = make()
    t.write(`\x1b_Ga=T,f=100,m=1;${png8x4.slice(0, 20)}\x1b\\\x1b_Gm=1;${png8x4.slice(20, 30)}\x1b\\\x1b_Gm=0;${png8x4.slice(30)}\x1b\\`)
    expect(t.pictures).toHaveLength(1)
  })

  it('scrolled with the text, cut with the scrollback, gone with the screen; the alternate screen its own', () => {
    const { t } = make()
    t.write(`\x1b_Ga=T,f=100;${png8x4}\x1b\\`)
    expect(t.pictures[0]!.row).toBe(0)
    t.write('\r\n'.repeat(30))
    expect(t.pictures).toEqual([])
    t.write(`\x1b_Ga=T,f=100;${png8x4}\x1b\\`)
    t.write('\x1b[?1049h')
    expect(t.screenPictures).toEqual([])
    t.write(`\x1b_Ga=T,f=100;${png8x4}\x1b\\`)
    expect(t.screenPictures).toHaveLength(1)
    t.write('\x1b[?1049l')
    expect(t.altPictures).toEqual([])
    expect(t.screenPictures).toHaveLength(1)
    t.write('\x1b[2J')
    expect(t.pictures).toEqual([])
  })

  it('a program told the cell size in pixels and that sixel is there', () => {
    const { t, replies } = make()
    t.write('\x1b[16t\x1b[14t\x1b[c')
    expect(replies).toEqual(['\x1b[6;16;8t', '\x1b[4;80;160t', '\x1b[?62;4;22c'])
  })
})
