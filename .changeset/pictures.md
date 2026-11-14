---
'@dskripchenko/terminal': minor
---

Pictures in the output: sixel (DCS q, decoded here, the VT340 palette and the picture's own colours) and the kitty graphics protocol (APC G: PNG and raw RGB/RGBA, sent whole or in pieces, shown at once or kept by id and shown later, deleted; answers unless quiet; only what comes in the stream — a file or shared memory named by a program is refused, as is compression). A picture covers the cells its size takes, scrolls with the text, goes with the scrollback cut, with a cleared screen and with `clear()`; the alternate screen has its own. The view draws the pictures in view (an image or a canvas) and tells the core its cell size in pixels; a program asking gets it (CSI 14 t, 16 t), DA1 says sixel is there (`?62;4;22c`), XTSMGRAPHICS answers. The parser hands DCS and APC strings over (`dcs`, `apc` on the handler), up to 48 MB.
