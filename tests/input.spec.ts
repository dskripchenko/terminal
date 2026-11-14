import { describe, expect, it } from 'vitest'
import { keySequence, mouseSequence, type KeyLike } from '../src/input'

const k = (key: string, o: Partial<KeyLike> = {}): KeyLike => ({ key, code: o.code ?? '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o })
const modes = { applicationCursor: false, altIsMeta: true }

describe('keys', () => {
  it('arrows: normal and application cursor, with modifiers', () => {
    expect(keySequence(k('ArrowUp'), modes)).toBe('\x1b[A')
    expect(keySequence(k('ArrowUp'), { ...modes, applicationCursor: true })).toBe('\x1bOA')
    expect(keySequence(k('ArrowLeft', { ctrlKey: true }), modes)).toBe('\x1b[1;5D')
    expect(keySequence(k('ArrowRight', { shiftKey: true, altKey: true }), modes)).toBe('\x1b[1;4C')
  })

  it('editing and function keys', () => {
    expect(keySequence(k('Delete'), modes)).toBe('\x1b[3~')
    expect(keySequence(k('PageDown', { shiftKey: true }), modes)).toBe('\x1b[6;2~')
    expect(keySequence(k('F1'), modes)).toBe('\x1bOP')
    expect(keySequence(k('F5'), modes)).toBe('\x1b[15~')
    expect(keySequence(k('F12', { ctrlKey: true }), modes)).toBe('\x1b[24;5~')
    expect(keySequence(k('Enter'), modes)).toBe('\r')
    expect(keySequence(k('Backspace'), modes)).toBe('\x7f')
    expect(keySequence(k('Tab', { shiftKey: true }), modes)).toBe('\x1b[Z')
  })

  it('Ctrl with a letter: by the key, in any layout', () => {
    expect(keySequence(k('c', { ctrlKey: true, code: 'KeyC' }), modes)).toBe('\x03')
    // A Russian layout: the key prints «с», Ctrl+C is still ^C.
    expect(keySequence(k('с', { ctrlKey: true, code: 'KeyC' }), modes)).toBe('\x03')
    expect(keySequence(k('[', { ctrlKey: true, code: 'BracketLeft' }), modes)).toBe('\x1b')
    expect(keySequence(k(' ', { ctrlKey: true, code: 'Space' }), modes)).toBe('\x00')
  })

  it('Alt as meta; Cmd and plain characters are not the terminal’s', () => {
    expect(keySequence(k('b', { altKey: true, code: 'KeyB' }), modes)).toBe('\x1bb')
    expect(keySequence(k('∫', { altKey: true, code: 'KeyB' }), { ...modes, altIsMeta: false })).toBeNull()
    expect(keySequence(k('c', { metaKey: true, code: 'KeyC' }), modes)).toBeNull()
    expect(keySequence(k('a', { code: 'KeyA' }), modes)).toBeNull()
    expect(keySequence(k('ж', { code: 'Semicolon' }), modes)).toBeNull()
  })
})

describe('the kitty keyboard protocol', () => {
  const kitty = { ...modes, kittyFlags: 1 }
  it('Esc, and keys with Ctrl or Alt, told apart', () => {
    expect(keySequence(k('Escape'), kitty)).toBe('\x1b[27u')
    expect(keySequence(k('c', { code: 'KeyC', ctrlKey: true }), kitty)).toBe('\x1b[99;5u')
    // By the key's place: Ctrl+C on a Russian layout is the same.
    expect(keySequence(k('с', { code: 'KeyC', ctrlKey: true }), kitty)).toBe('\x1b[99;5u')
    expect(keySequence(k('i', { code: 'KeyI', ctrlKey: true }), kitty)).toBe('\x1b[105;5u')
    expect(keySequence(k('A', { code: 'KeyA', ctrlKey: true, shiftKey: true }), kitty)).toBe('\x1b[97;6u')
    expect(keySequence(k('x', { code: 'KeyX', altKey: true }), kitty)).toBe('\x1b[120;3u')
    expect(keySequence(k(' ', { code: 'Space', ctrlKey: true }), kitty)).toBe('\x1b[32;5u')
  })

  it('Enter, Tab, Backspace as before unless with a modifier (Shift+Enter is its own)', () => {
    expect(keySequence(k('Enter'), kitty)).toBe('\r')
    expect(keySequence(k('Enter', { shiftKey: true }), kitty)).toBe('\x1b[13;2u')
    expect(keySequence(k('Tab'), kitty)).toBe('\t')
    expect(keySequence(k('Tab', { shiftKey: true }), kitty)).toBe('\x1b[9;2u')
    expect(keySequence(k('Backspace', { ctrlKey: true }), kitty)).toBe('\x1b[127;5u')
  })

  it('arrows, function keys and plain text as without it', () => {
    expect(keySequence(k('ArrowUp'), kitty)).toBe('\x1b[A')
    expect(keySequence(k('ArrowLeft', { ctrlKey: true }), kitty)).toBe('\x1b[1;5D')
    expect(keySequence(k('a', { code: 'KeyA' }), kitty)).toBeNull()
    expect(keySequence(k('A', { code: 'KeyA', shiftKey: true }), kitty)).toBeNull()
  })
})

describe('mouse', () => {
  it('SGR and X10', () => {
    expect(mouseSequence('down', 0, 4, 2, { shift: false, alt: false, ctrl: false }, true)).toBe('\x1b[<0;5;3M')
    expect(mouseSequence('up', 0, 4, 2, { shift: false, alt: false, ctrl: false }, true)).toBe('\x1b[<0;5;3m')
    expect(mouseSequence('wheel', 1, 0, 0, { shift: false, alt: false, ctrl: true }, true)).toBe('\x1b[<81;1;1M')
    expect(mouseSequence('down', 0, 0, 0, { shift: false, alt: false, ctrl: false }, false)).toBe('\x1b[M !!')
  })
})
