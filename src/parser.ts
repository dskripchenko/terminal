/**
 * The escape sequence parser: the state machine of the DEC VT500 series
 * (after Paul Williams' description at vt100.net), on text already decoded
 * from UTF-8. It knows the shape of sequences, not their meaning: printable
 * runs, C0/C1 controls, CSI with parameters and sub-parameters (`38:2::1:2:3`),
 * ESC, OSC strings; DCS, SOS, PM and APC strings are read to their end and
 * passed over. A sequence split between two writes is continued in the next.
 */

export interface ParserHandler {
  /** A run of printable text. */
  print(text: string): void
  /** A C0 or C1 control (BEL, BS, LF…). */
  execute(code: number): void
  /**
   * A control sequence: its parameters (each a list — the first value and
   * its `:` sub-parameters; -1 where none is given), the private marker
   * (`?`, `>`, `=`, `<` or ''), the intermediates and the final character.
   */
  csi(params: number[][], prefix: string, intermediates: string, final: string): void
  esc(intermediates: string, final: string): void
  /** An operating system command: `0;title`, `8;;https://…`. */
  osc(data: string): void
}

const enum State {
  Ground,
  Escape,
  EscapeIntermediate,
  CsiEntry,
  CsiParam,
  CsiIntermediate,
  CsiIgnore,
  Osc,
  /** DCS, SOS, PM, APC: read to the string terminator and dropped. */
  Ignored,
}

/** More parameters than this are dropped (as terminals do). */
const MAX_PARAMS = 32
/** An OSC string longer than this is cut (a stray one must not eat memory). */
const MAX_OSC = 1 << 20

export class Parser {
  private state = State.Ground
  private params: number[][] = []
  private current: number[] = []
  private digits = false
  private prefix = ''
  private intermediates = ''
  private oscData = ''
  /** ESC seen inside a string: a `\` after it ends the string. */
  private stringEsc = false

  constructor(private readonly h: ParserHandler) {}

  /** Back to the ground state (a reset). */
  reset(): void {
    this.state = State.Ground
    this.clear()
    this.oscData = ''
    this.stringEsc = false
  }

  parse(data: string): void {
    const n = data.length
    let i = 0
    while (i < n) {
      const c = data.charCodeAt(i)

      // Strings: everything up to BEL (OSC) or ST.
      if (this.state === State.Osc || this.state === State.Ignored) {
        if (this.stringEsc) {
          this.stringEsc = false
          if (c === 0x5c) {
            this.endString()
            i++
            continue
          }
          // ESC followed by something else: the string is cancelled, the ESC begins anew.
          this.state = State.Escape
          this.clear()
          continue
        }
        if (c === 0x1b) {
          this.stringEsc = true
          i++
          continue
        }
        if (c === 0x07 || c === 0x9c) {
          this.endString()
          i++
          continue
        }
        if (c === 0x18 || c === 0x1a) {
          this.state = State.Ground
          this.oscData = ''
          i++
          continue
        }
        if (this.state === State.Osc) {
          // Take the run to the next terminator at once.
          let j = i
          while (j < n) {
            const d = data.charCodeAt(j)
            if (d === 0x07 || d === 0x1b || d === 0x9c || d === 0x18 || d === 0x1a) break
            j++
          }
          if (this.oscData.length < MAX_OSC) this.oscData += data.slice(i, j)
          i = j
        } else i++
        continue
      }

      // Anywhere: CAN and SUB cancel, ESC starts over, C1 introducers.
      if (c === 0x18 || c === 0x1a) {
        this.state = State.Ground
        this.h.execute(c)
        i++
        continue
      }
      if (c === 0x1b) {
        this.state = State.Escape
        this.clear()
        i++
        continue
      }
      if (c >= 0x80 && c <= 0x9f) {
        i++
        this.c1(c)
        continue
      }

      switch (this.state) {
        case State.Ground: {
          if (c < 0x20 || c === 0x7f) {
            if (c !== 0x7f) this.h.execute(c)
            i++
            break
          }
          // A printable run: up to the next control.
          let j = i + 1
          while (j < n) {
            const d = data.charCodeAt(j)
            if (d < 0x20 || d === 0x7f || (d >= 0x80 && d <= 0x9f)) break
            j++
          }
          this.h.print(data.slice(i, j))
          i = j
          break
        }

        case State.Escape:
          i++
          if (c < 0x20) this.h.execute(c)
          else if (c >= 0x20 && c <= 0x2f) {
            this.intermediates += String.fromCharCode(c)
            this.state = State.EscapeIntermediate
          } else if (c === 0x5b) this.enterCsi()
          else if (c === 0x5d) this.enterOsc()
          else if (c === 0x50 || c === 0x58 || c === 0x5e || c === 0x5f) this.state = State.Ignored
          else if (c !== 0x7f) {
            this.h.esc('', String.fromCharCode(c))
            this.state = State.Ground
          }
          break

        case State.EscapeIntermediate:
          i++
          if (c < 0x20) this.h.execute(c)
          else if (c <= 0x2f) this.intermediates += String.fromCharCode(c)
          else if (c !== 0x7f) {
            this.h.esc(this.intermediates, String.fromCharCode(c))
            this.state = State.Ground
          }
          break

        case State.CsiEntry:
        case State.CsiParam:
        case State.CsiIntermediate:
        case State.CsiIgnore:
          i++
          this.csiByte(c)
          break
      }
    }
  }

  private c1(c: number): void {
    switch (c) {
      case 0x9b:
        this.enterCsi()
        return
      case 0x9d:
        this.enterOsc()
        return
      case 0x90:
      case 0x98:
      case 0x9e:
      case 0x9f:
        this.state = State.Ignored
        return
      default:
        this.state = State.Ground
        this.h.execute(c)
    }
  }

  private clear(): void {
    this.params = []
    this.current = []
    this.digits = false
    this.prefix = ''
    this.intermediates = ''
  }

  private enterCsi(): void {
    this.clear()
    this.state = State.CsiEntry
  }

  private enterOsc(): void {
    this.oscData = ''
    this.stringEsc = false
    this.state = State.Osc
  }

  private endString(): void {
    if (this.state === State.Osc) this.h.osc(this.oscData)
    this.oscData = ''
    this.state = State.Ground
  }

  private csiByte(c: number): void {
    if (c < 0x20) {
      // C0 controls are executed in the middle of a sequence (as on a VT).
      this.h.execute(c)
      return
    }
    if (c === 0x7f) return
    if (this.state === State.CsiIgnore) {
      if (c >= 0x40 && c <= 0x7e) this.state = State.Ground
      return
    }
    if (c >= 0x30 && c <= 0x39) {
      if (this.state === State.CsiIntermediate) {
        this.state = State.CsiIgnore
        return
      }
      this.state = State.CsiParam
      const last = this.current.length - 1
      if (!this.digits) {
        if (last < 0) this.current.push(c - 0x30)
        else this.current[last] = c - 0x30
        this.digits = true
      } else this.current[last] = Math.min(this.current[last]! * 10 + (c - 0x30), 0x7fffffff)
      return
    }
    if (c === 0x3b || c === 0x3a) {
      if (this.state === State.CsiIntermediate) {
        this.state = State.CsiIgnore
        return
      }
      this.state = State.CsiParam
      if (this.current.length === 0) this.current.push(-1)
      if (c === 0x3b) {
        if (this.params.length < MAX_PARAMS) this.params.push(this.current)
        this.current = [-1]
      } else this.current.push(-1)
      this.digits = false
      return
    }
    if (c >= 0x3c && c <= 0x3f) {
      // A private marker only at the start.
      if (this.state === State.CsiEntry) this.prefix = String.fromCharCode(c)
      else this.state = State.CsiIgnore
      return
    }
    if (c >= 0x20 && c <= 0x2f) {
      this.intermediates += String.fromCharCode(c)
      this.state = State.CsiIntermediate
      return
    }
    if (c >= 0x40 && c <= 0x7e) {
      if (this.current.length > 0 && this.params.length < MAX_PARAMS) this.params.push(this.current)
      this.h.csi(this.params, this.prefix, this.intermediates, String.fromCharCode(c))
      this.state = State.Ground
      this.clear()
    }
  }
}
