---
"@dskripchenko/terminal": patch
---

A view made before its element is in the page — a hidden tab's, kept alive
while it is not shown — no longer throws ("Invalid array length") when it
draws: it waits until the element is put in a page, and the resize observer
draws it then. Copy (Cmd+C, Ctrl+Shift+C) and select all (Cmd+A,
Ctrl+Shift+A) go by the key's place, so they work on a Russian layout too,
where those keys type «с» and «ф».
