/**
 * Pictures in the output: sixel (DCS q) decoded to pixels here, and the kitty
 * graphics protocol (APC G) read into what it asks. Pure — no DOM: the view
 * turns the pixels or the PNG into an element.
 */

/** The biggest picture taken, either side, in pixels. */
export const MAX_SIDE = 4096

export type PictureSource =
  | { kind: 'png'; base64: string }
  | { kind: 'rgba'; width: number; height: number; data: Uint8ClampedArray }

/** A picture placed in the output: its top-left cell and the cells it covers. */
export interface Picture {
  id: number
  /** The row it starts at, counted as commands' rows are (with the rows cut from the top). */
  row: number
  col: number
  cols: number
  rows: number
  /** Its own size in pixels. */
  width: number
  height: number
  source: PictureSource
  /** The kitty protocol's image id, when it gave one (a delete by id finds it). */
  kittyId?: number
}

// Sixel ----------------------------------------------------------------------------------

/** The VT340's 16 colours, sixel's palette before a picture sets its own. */
const VT340 = [
  [0, 0, 0], [20, 20, 80], [80, 13, 13], [20, 80, 20], [80, 20, 80], [20, 80, 80], [80, 80, 20], [53, 53, 53],
  [26, 26, 26], [33, 33, 60], [60, 26, 26], [33, 60, 33], [60, 33, 60], [33, 60, 60], [60, 60, 33], [80, 80, 80],
].map(([r, g, b]) => rgb(Math.round((r! * 255) / 100), Math.round((g! * 255) / 100), Math.round((b! * 255) / 100)))

function rgb(r: number, g: number, b: number): number {
  return (255 << 24) | (b << 16) | (g << 8) | r
}

function hls(h: number, l: number, s: number): number {
  // Sixel's hue starts at blue (0°), red at 120°.
  const hue = (((h + 240) % 360) + 360) % 360 / 360
  const lum = l / 100
  const sat = s / 100
  if (sat === 0) {
    const v = Math.round(lum * 255)
    return rgb(v, v, v)
  }
  const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat
  const p = 2 * lum - q
  const f = (t: number) => {
    t = (t + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return rgb(Math.round(f(hue + 1 / 3) * 255), Math.round(f(hue) * 255), Math.round(f(hue - 1 / 3) * 255))
}

/**
 * A sixel picture's pixels from its DCS string (`0;1;0q"1;1;20;12#0;2;100;0;0#0~~!8~-…`),
 * or null for one that is not a picture or too big. Pixels no sixel set are
 * clear when its second parameter is 1, else the background (also clear here).
 */
export function decodeSixel(dcs: string): { width: number; height: number; data: Uint8ClampedArray } | null {
  const q = dcs.indexOf('q')
  if (q < 0 || !/^[\d;]*$/.test(dcs.slice(0, q))) return null
  const palette = VT340.slice()
  let color = palette[0]!
  let x = 0
  let band = 0
  let width = 0
  let height = 0
  let declaredW = 0
  let declaredH = 0
  // Pixels row by row, each row grown as the picture comes.
  const px: Uint32Array[] = []
  const put = (bits: number, repeat: number): boolean => {
    if (x + repeat > MAX_SIDE || band * 6 + 6 > MAX_SIDE) return false
    for (let i = 0; i < 6; i++) {
      if (!(bits & (1 << i))) continue
      const y = band * 6 + i
      let row = px[y]
      if (!row || row.length < x + repeat) {
        const next = new Uint32Array(Math.min(MAX_SIDE, Math.max(64, (x + repeat) * 2)))
        if (row) next.set(row)
        px[y] = row = next
      }
      row.fill(color, x, x + repeat)
      height = Math.max(height, y + 1)
    }
    x += repeat
    width = Math.max(width, x)
    return true
  }
  const num = (s: string, at: number): [number[], number] => {
    let j = at
    while (j < s.length && /[\d;]/.test(s[j]!)) j++
    return [s.slice(at, j).split(';').map((n) => (n === '' ? 0 : Number(n))), j]
  }
  const s = dcs.slice(q + 1)
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i)
    if (c >= 0x3f && c <= 0x7e) {
      if (!put(c - 0x3f, 1)) return null
      i++
    } else if (c === 0x21) {
      // !Pn<sixel>: repeated.
      const [[n = 1], j] = num(s, i + 1)
      const d = s.charCodeAt(j)
      if (d >= 0x3f && d <= 0x7e && !put(d - 0x3f, Math.max(1, Math.min(n, MAX_SIDE)))) return null
      i = j + 1
    } else if (c === 0x23) {
      // #Pc (choose) or #Pc;Pu;Px;Py;Pz (define).
      const [p, j] = num(s, i + 1)
      const reg = (p[0] ?? 0) % 1024
      if (p.length >= 5) palette[reg] = p[1] === 1 ? hls(p[2]!, p[3]!, p[4]!) : rgb(Math.round((Math.min(100, p[2]!) * 255) / 100), Math.round((Math.min(100, p[3]!) * 255) / 100), Math.round((Math.min(100, p[4]!) * 255) / 100))
      color = palette[reg] ?? palette[0]!
      i = j
    } else if (c === 0x22) {
      // "Pan;Pad;Ph;Pv: the picture's size, when said.
      const [p, j] = num(s, i + 1)
      declaredW = Math.min(p[2] ?? 0, MAX_SIDE)
      declaredH = Math.min(p[3] ?? 0, MAX_SIDE)
      i = j
    } else if (c === 0x24) {
      x = 0
      i++
    } else if (c === 0x2d) {
      x = 0
      band++
      i++
    } else i++
  }
  width = Math.max(width, declaredW)
  height = Math.max(height, declaredH)
  if (!width || !height) return null
  const data = new Uint8ClampedArray(width * height * 4)
  const out = new Uint32Array(data.buffer)
  for (let y = 0; y < height; y++) {
    const row = px[y]
    if (row) out.set(row.length > width ? row.subarray(0, width) : row, y * width)
  }
  return { width, height, data }
}

// The kitty graphics protocol ------------------------------------------------------------

export interface KittyCommand {
  /** t transmit, T transmit and show, p show one sent before, d delete, q ask whether it would work. */
  action: string
  format: number
  medium: string
  id: number
  more: boolean
  quiet: number
  /** Raw pixels' size. */
  width: number
  height: number
  /** Cells to fill; 0 — by its size. */
  cols: number
  rows: number
  /** 1: the cursor stays where it is. */
  stay: boolean
  compressed: boolean
  /** d=… for a delete. */
  what: string
  payload: string
}

/** An APC string of the protocol (`Ga=T,f=100;iVBOR…`), or null for another APC. */
export function readKitty(apc: string): KittyCommand | null {
  if (apc[0] !== 'G') return null
  const semi = apc.indexOf(';')
  const keys = (semi < 0 ? apc.slice(1) : apc.slice(1, semi)).split(',')
  const v: Record<string, string> = {}
  for (const kv of keys) {
    const eq = kv.indexOf('=')
    if (eq > 0) v[kv.slice(0, eq)] = kv.slice(eq + 1)
  }
  const n = (k: string, d = 0) => {
    const x = Number(v[k])
    return Number.isFinite(x) ? x : d
  }
  return {
    action: v.a ?? 't',
    format: n('f', 32),
    medium: v.t ?? 'd',
    id: n('i'),
    more: v.m === '1',
    quiet: n('q'),
    width: n('s'),
    height: n('v'),
    cols: n('c'),
    rows: n('r'),
    stay: v.C === '1',
    compressed: v.o === 'z',
    what: v.d ?? 'a',
    payload: semi < 0 ? '' : apc.slice(semi + 1),
  }
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** A picture's pixels or PNG from a whole transmission; its size; or why not. */
export function kittySource(format: number, width: number, height: number, b64: string): { source: PictureSource; width: number; height: number } | { error: string } {
  if (format === 100) {
    const head = base64Bytes(b64.slice(0, 44))
    // PNG: the signature, then IHDR's width and height.
    if (head.length < 24 || head[0] !== 0x89 || head[1] !== 0x50) return { error: 'EBADPNG:not a PNG' }
    const w = ((head[16]! << 24) | (head[17]! << 16) | (head[18]! << 8) | head[19]!) >>> 0
    const h = ((head[20]! << 24) | (head[21]! << 16) | (head[22]! << 8) | head[23]!) >>> 0
    if (!w || !h || w > MAX_SIDE || h > MAX_SIDE) return { error: 'EINVAL:too big' }
    return { source: { kind: 'png', base64: b64.replace(/[^A-Za-z0-9+/=]/g, '') }, width: w, height: h }
  }
  if (format !== 24 && format !== 32) return { error: 'EINVAL:unknown format' }
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) return { error: 'EINVAL:size' }
  const bytes = base64Bytes(b64)
  const step = format === 24 ? 3 : 4
  if (bytes.length < width * height * step) return { error: 'ENODATA:short' }
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, j = 0; i < width * height; i++, j += step) {
    data[i * 4] = bytes[j]!
    data[i * 4 + 1] = bytes[j + 1]!
    data[i * 4 + 2] = bytes[j + 2]!
    data[i * 4 + 3] = step === 4 ? bytes[j + 3]! : 255
  }
  return { source: { kind: 'rgba', width, height, data }, width, height }
}
