---
'@dskripchenko/terminal': minor
---

The kitty keyboard protocol's "disambiguate" flag: a program that pushes it (`CSI > 1 u`) gets Esc as `CSI 27 u` and keys with Ctrl or Alt as `CSI code;mods u` (by the key's place, in any layout), and Enter, Tab and Backspace with a modifier as their own — Shift+Enter is no longer Enter. The flags are asked (`CSI ? u`), pushed, popped and set, a stack for each screen; `Terminal.kittyFlags` says the ones in force.
