# Erste Schritte

## Ein Programm dahinter

Das Terminal führt keine Programme aus: Es zeigt eines, das anderswo läuft,
und spricht mit ihm in beide Richtungen in Text. In einer Desktop-App läuft
das Programm in einem Pseudoterminal des Hauptprozesses:

```ts
// Hauptprozess (Electron, Node): node-pty
import { spawn } from 'node-pty'
const pty = spawn(process.env.SHELL ?? 'bash', [], { name: 'xterm-256color', cols: 80, rows: 24, cwd })
pty.onData((data) => window.webContents.send('pty:data', data))
ipcMain.on('pty:input', (_e, data) => pty.write(data))
ipcMain.on('pty:resize', (_e, cols, rows) => pty.resize(cols, rows))
```

```ts
// die Seite
import { Terminal, TerminalView } from '@dskripchenko/terminal'

const term = new Terminal()
const view = new TerminalView(term, element, { onResize: (c, r) => ipc.send('pty:resize', c, r) })
ipc.on('pty:data', (data) => term.write(data))
term.onData((data) => ipc.send('pty:input', data))
```

Auf einem Server laufen dieselben zwei Ströme über einen WebSocket. Setzen Sie
`TERM` für das Programm auf `xterm-256color`: Das ist die Familie, deren
Sprache das Terminal spricht.

## `Terminal`

```ts
new Terminal({ cols?: 80, rows?: 24, scrollback?: 1000, foreground?: '#000000', background?: '#ffffff' })
```

`foreground` und `background` erfährt ein Programm, wenn es nach den Farben
fragt (OSC 10/11: `vim` tut das, um ein helles oder dunkles Schema zu wählen).

| | |
|---|---|
| `write(data)` | was das Programm schrieb — in beliebigen Stücken, eine Sequenz darf auf zwei verteilt sein |
| `onData(fn)` | was zum Programm geht: in der Ansicht getippte Tasten, Eingefügtes, Antworten auf seine Fragen |
| `input(data)` | selbst an das Programm senden (ein Knopf, der `ls` tippt) |
| `paste(text)` | Text als eingefügt senden: in den Bracketed-Paste-Marken, wenn das Programm darum bat |
| `resize(cols, rows)` | eine neue Größe; Zeilen des normalen Bildschirms werden für die neue Breite neu umbrochen, der Cursor bleibt auf seinem Zeichen |
| `reset()` | zurück zum Anfangszustand |
| `onTitle(fn)`, `title` | der vom Programm gesetzte Titel (OSC 0/2) |
| `onCwd(fn)`, `cwd` | der von der Shell gemeldete Arbeitsordner (OSC 7) |
| `onBell(fn)` | BEL |
| `onMark(fn)` | Shell-Integration (OSC 133): `A` eine Eingabeaufforderung beginnt, `B`/`C` ein Befehl, `D` er endete — mit der Zeile |
| `onChange(fn)` | etwas auf dem Bildschirm hat sich geändert |
| `screenText()`, `lineText(i)` | der Bildschirm oder eine Zeile des Puffers als Text |
| `buffer` | der aktive Bildschirm: `lines` (Rücklauf und Bildschirm), `x`, `y`, `base` (die erste Bildschirmzeile in `lines`) |
| `normal`, `alt` | die zwei Bildschirme; `buffer === alt`, solange ein Vollbildprogramm läuft |
| `trimmed` | bisher oben aus dem Rücklauf entfernte Zeilen: Um so viel verschieben sich absolute Zeilennummern |

Auch die von einem Programm gesetzten Modi sind lesbar: `applicationCursor`,
`bracketedPaste`, `mouseTracking`, `cursorVisible`, `cursorStyle`,
`reverseVideo` und weitere.

Eine Zeile (`Line`) liefert für jede Zelle `char(x)`, `width(x)` (0 für die
rechte Hälfte eines breiten Zeichens), `fg(x)`, `bg(x)` (0 der Standard,
`PALETTE | n`, `RGB | 0xrrggbb`) und `flags(x)` (`BOLD`, `ITALIC`,
`UNDERLINE` …; die Nummer eines Links ab Bit 16, seine Adresse in
`terminal.links`) sowie `text()`; `wrapped` sagt, dass die Zeile auf der
nächsten weitergeht.

## `TerminalView`

```ts
new TerminalView(term, host, {
  fontFamily?, fontSize?: 13, lineHeight?: 1.25,
  theme?: LIGHT_THEME,
  altIsMeta?,            // Alt sendet ESC vor der Taste; auf dem Mac standardmäßig aus (Option tippt Zeichen)
  onLink?: (url) => {},  // ein mit Cmd (Strg) angeklickter Link
  onResize?: (cols, rows) => {},
})
```

Die Ansicht füllt `host`; dessen Größe ergibt Spalten und Zeilen, Änderungen
werden verfolgt (`fit()` tut dasselbe von Hand). Nur die sichtbaren Zeilen
sind in der Seite: Der Rücklauf scrollt nativ, und neue Ausgabe lässt die
Ansicht, wo sie ist, außer sie steht ganz unten.

| | |
|---|---|
| `focus()` | die Tastatur zum Terminal |
| `getSelection()`, `hasSelection()`, `selectAll()`, `clearSelection()` | die Auswahl (umbrochene Zeilen werden verbunden) |
| `scrollToBottom()` | zur neuesten Ausgabe |
| `setTheme(theme)` | Farben: `foreground`, `background`, `cursor`, `selection` und die 16 `ansi` |
| `dispose()` | Element und Listener der Ansicht entfernt (das Terminal bleibt) |

**Tasten.** Text kommt über ein verborgenes Eingabefeld, daher funktionieren
Tastaturbelegungen und Eingabemethoden; Pfeile, Pos1/Ende, Bild auf/ab,
Einfg/Entf und F1–F12 werden gesendet, wie xterm sie sendet, mit Modifikatoren
(`ESC [1;5C` für Strg+→); Strg mit einem Buchstaben ist das Steuerzeichen der
Tastenposition (Strg+C ist ^C in jeder Belegung); Alt sendet ESC vor der
Taste, wenn `altIsMeta`. Cmd+C / Cmd+A auf dem Mac, Strg+Umschalt+C /
Strg+Umschalt+A sonst kopieren und wählen alles; Einfügen übernimmt der
Browser.

**Die Maus.** Ziehen wählt aus; ein Doppelklick wählt ein Wort, ein
Dreifachklick eine Zeile; Umschalt erweitert. Fragt ein Programm nach der Maus
(`htop`, `mc`, `vim` mit `mouse=a`), gehören Klicks, Ziehen und das Rad ihm —
mit Umschalt bleiben sie beim Terminal. In einem Vollbildprogramm ohne
Mausberichte sendet das Rad Pfeile.

**Farben** sind CSS-Eigenschaften am Element der Ansicht: `--dsk-term-fg`,
`--dsk-term-bg`, `--dsk-term-cursor`, `--dsk-term-selection`,
`--dsk-term-0` … `--dsk-term-15`. `LIGHT_THEME` und `DARK_THEME` sind fertig.

## Nicht unterstützt

Bilder im Terminal (Sixel, iTerm2, Kitty-Grafik), das Kitty-Tastaturprotokoll,
Zeilen doppelter Breite und Höhe (DECDWL, DECDHL), der 132-Spalten-Modus,
Text von rechts nach links, das Schreiben der Zwischenablage aus der Ausgabe
(OSC 52, absichtlich abgelehnt). DCS-Strings (`tmux`-Passthrough, `DECRQSS`)
werden gelesen und verworfen.
