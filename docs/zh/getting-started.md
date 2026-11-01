# 入门

## 终端背后的程序

终端本身不运行程序：它显示在别处运行的程序，并与之双向以文本交流。在桌面应用中，程序运行在主进程的伪终端里：

```ts
// 主进程（Electron、Node）：node-pty
import { spawn } from 'node-pty'
const pty = spawn(process.env.SHELL ?? 'bash', [], { name: 'xterm-256color', cols: 80, rows: 24, cwd })
pty.onData((data) => window.webContents.send('pty:data', data))
ipcMain.on('pty:input', (_e, data) => pty.write(data))
ipcMain.on('pty:resize', (_e, cols, rows) => pty.resize(cols, rows))
```

```ts
// 页面
import { Terminal, TerminalView } from '@dskripchenko/terminal'

const term = new Terminal()
const view = new TerminalView(term, element, { onResize: (c, r) => ipc.send('pty:resize', c, r) })
ipc.on('pty:data', (data) => term.write(data))
term.onData((data) => ipc.send('pty:input', data))
```

在服务器上，同样的两个数据流通过 WebSocket 传输。请将程序的 `TERM` 设为 `xterm-256color`：终端说的正是这一家族的语言。

## `Terminal`

```ts
new Terminal({ cols?: 80, rows?: 24, scrollback?: 1000, foreground?: '#000000', background?: '#ffffff' })
```

当程序询问颜色时（OSC 10/11：`vim` 会这样做，以选择浅色或深色方案），会告知 `foreground` 和 `background`。

| | |
|---|---|
| `write(data)` | 程序写出的内容——任意分块，一个序列可以拆在两次写入之间 |
| `onData(fn)` | 发往程序的内容：在视图中输入的按键、粘贴、对其询问的应答 |
| `input(data)` | 自己向程序发送（例如一个输入 `ls` 的按钮） |
| `paste(text)` | 以粘贴方式发送文本：程序请求时包在 bracketed paste 标记中 |
| `resize(cols, rows)` | 新的尺寸；主屏幕的行按新宽度重新折行，光标保持在原字符上 |
| `reset()` | 回到初始状态 |
| `onTitle(fn)`、`title` | 程序设置的标题（OSC 0/2） |
| `onCwd(fn)`、`cwd` | shell 报告的工作目录（OSC 7） |
| `onBell(fn)` | BEL |
| `onMark(fn)` | shell 集成（OSC 133）：`A` 提示符开始，`B`/`C` 命令，`D` 命令结束——附带所在行 |
| `onChange(fn)` | 屏幕上有内容变化 |
| `screenText()`、`lineText(i)` | 以文本形式获取屏幕或缓冲区中的一行 |
| `buffer` | 当前屏幕：`lines`（回滚区和屏幕）、`x`、`y`、`base`（屏幕首行在 `lines` 中的位置） |
| `normal`、`alt` | 两个屏幕；全屏程序运行时 `buffer === alt` |
| `trimmed` | 迄今从回滚区顶部丢弃的行数：绝对行号随之移动 |

程序设置的模式也可以读取：`applicationCursor`、`bracketedPaste`、`mouseTracking`、`cursorVisible`、`cursorStyle`、`reverseVideo` 等。

一行（`Line`）为每个单元格提供 `char(x)`、`width(x)`（宽字符右半部分为 0）、`fg(x)`、`bg(x)`（0 为默认，`PALETTE | n`、`RGB | 0xrrggbb`）和 `flags(x)`（`BOLD`、`ITALIC`、`UNDERLINE`……；链接编号从第 16 位开始，地址在 `terminal.links` 中），以及 `text()`；`wrapped` 表示该行在下一行继续。

## `TerminalView`

```ts
new TerminalView(term, host, {
  fontFamily?, fontSize?: 13, lineHeight?: 1.25,
  theme?: LIGHT_THEME,
  altIsMeta?,            // Alt 在按键前发送 ESC；Mac 上默认关闭（Option 输入字符）
  onLink?: (url) => {},  // 按住 Cmd（Ctrl）点击的链接
  onResize?: (cols, rows) => {},
})
```

视图填满 `host`；其尺寸决定列数和行数，并会跟随变化（`fit()` 手动完成同样的事）。页面中只有可见的行：回滚区原生滚动，若视图不在底部，新输出不会移动视图。

| | |
|---|---|
| `focus()` | 键盘交给终端 |
| `getSelection()`、`hasSelection()`、`selectAll()`、`clearSelection()` | 选区（折行的行会被连接） |
| `scrollToBottom()` | 滚到最新输出 |
| `setTheme(theme)` | 颜色：`foreground`、`background`、`cursor`、`selection` 和 16 个 `ansi` |
| `dispose()` | 移除视图的元素和监听（终端保留） |

**按键。** 文本通过隐藏的输入框进入，因此键盘布局和输入法均可用；方向键、Home/End、Page Up/Down、Insert/Delete 和 F1–F12 按 xterm 的方式发送，并带修饰键（Ctrl+→ 为 `ESC [1;5C`）；Ctrl 加字母按按键位置发送控制字符（任何布局下 Ctrl+C 都是 ^C）；开启 `altIsMeta` 时 Alt 在按键前发送 ESC。Mac 上 Cmd+C / Cmd+A、其他系统上 Ctrl+Shift+C / Ctrl+Shift+A 用于复制和全选；粘贴由浏览器完成。

**鼠标。** 拖动选择；双击选择一个词，三击选择一行；Shift 扩展选区。程序请求鼠标时（`htop`、`mc`、设置了 `mouse=a` 的 `vim`），点击、拖动和滚轮都交给程序——按住 Shift 则仍归终端。在没有鼠标报告的全屏程序中，滚轮发送方向键。

**颜色**是视图元素上的 CSS 自定义属性：`--dsk-term-fg`、`--dsk-term-bg`、`--dsk-term-cursor`、`--dsk-term-selection`、`--dsk-term-0` … `--dsk-term-15`。已提供 `LIGHT_THEME` 和 `DARK_THEME`。

## 不支持

终端内图片（sixel、iTerm2、Kitty 图形）、Kitty 键盘协议、双宽和双高行（DECDWL、DECDHL）、132 列模式、从右到左的文本、从输出写入剪贴板（OSC 52，有意拒绝）。DCS 字符串（`tmux` 透传、`DECRQSS`）会被读取并丢弃。
