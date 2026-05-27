export type TerminalKind = 'terminal' | 'task';

export type TerminalLine = {
  stream: 'input' | 'stdout' | 'stderr' | 'system';
  text: string;
};

export type TerminalWindow = {
  id: string;
  title: string;
  kind: TerminalKind;
  running: boolean;
  started: boolean;
  failed: boolean;
  lines: TerminalLine[];
};

type AnsiRange = {
  name: string;
  start: number;
  end: number;
};

type TerminalCell = {
  text: string;
  foreground: string;
  bold: boolean;
};

type HighlightWindow = Window & {
  CSS: {
    highlights: HighlightRegistry;
  };
  Highlight: typeof Highlight;
};

const ANSI_HIGHLIGHTS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
].map((name) => `cod-ansi-${name}`);

const ANSI_COLOR_BY_CODE: Record<number, string> = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white',
  90: 'bright-black',
  91: 'bright-red',
  92: 'bright-green',
  93: 'bright-yellow',
  94: 'bright-blue',
  95: 'bright-magenta',
  96: 'bright-cyan',
  97: 'bright-white',
};

export const keyToTerminalInput = (event: KeyboardEvent) => {
  if (event.ctrlKey && event.key.length === 1) {
    const code = event.key.toUpperCase().charCodeAt(0) - 64;
    if (code >= 1 && code <= 26) return String.fromCharCode(code);
  }

  if (event.key === 'Enter') return '\r';
  if (event.key === 'Backspace') return '\x7f';
  if (event.key === 'Tab') return '\t';
  if (event.key === 'Escape') return '\x1b';
  if (event.key === 'ArrowUp') return '\x1b[A';
  if (event.key === 'ArrowDown') return '\x1b[B';
  if (event.key === 'ArrowRight') return '\x1b[C';
  if (event.key === 'ArrowLeft') return '\x1b[D';
  if (event.key === 'Home') return '\x1b[H';
  if (event.key === 'End') return '\x1b[F';
  if (event.key === 'Delete') return '\x1b[3~';
  if (event.key === 'PageUp') return '\x1b[5~';
  if (event.key === 'PageDown') return '\x1b[6~';
  if (event.key.length === 1 && !event.metaKey && !event.altKey) return event.key;
  return undefined;
};

export const renderTerminal = (terminal: TerminalWindow) => {
  const input = terminal.lines
    .map((line) => line.text)
    .join('')
    .replace(/\x1b(?!\[)/g, '');
  const ranges: AnsiRange[] = [];
  const rows: TerminalCell[][] = [[]];
  let row = 0;
  let column = 0;
  let foreground = '';
  let bold = false;

  const ensureRow = () => {
    rows[row] ??= [];
    return rows[row];
  };

  const write = (value: string) => {
    const current = ensureRow();
    while (current.length < column) {
      current.push({ text: ' ', foreground: '', bold: false });
    }
    current[column] = { text: value, foreground, bold };
    column += 1;
  };

  const eraseLine = (mode: number) => {
    const current = ensureRow();
    if (mode === 2) {
      rows[row] = [];
      column = 0;
    } else if (mode === 1) {
      for (let index = 0; index <= column; index += 1) {
        current[index] = { text: ' ', foreground: '', bold: false };
      }
    } else {
      current.length = column;
    }
  };

  const applySgr = (params: string) => {
    const codes = params ? params.split(';').map(Number) : [0];
    for (const code of codes) {
      if (code === 0) {
        foreground = '';
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        foreground = '';
      } else if (ANSI_COLOR_BY_CODE[code]) {
        foreground = ANSI_COLOR_BY_CODE[code];
      }
    }
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === '\x1b' && input[index + 1] === '[') {
      const match = input.slice(index).match(/^\x1b\[([0-9;?]*)([A-Za-z~])/);
      if (!match) continue;

      index += match[0].length - 1;
      const params = match[1];
      const command = match[2];
      const firstParam = Number(params.split(';')[0]) || 0;

      if (command === 'm') {
        applySgr(params);
      } else if (command === 'K') {
        eraseLine(firstParam);
      } else if (command === 'G') {
        column = Math.max(0, firstParam - 1);
      } else if (command === 'C') {
        column += firstParam || 1;
      } else if (command === 'D') {
        column = Math.max(0, column - (firstParam || 1));
      } else if (command === 'A') {
        row = Math.max(0, row - (firstParam || 1));
        column = Math.min(column, ensureRow().length);
      } else if (command === 'B') {
        row += firstParam || 1;
        column = Math.min(column, ensureRow().length);
      }
      continue;
    }

    if (char === '\r') {
      column = 0;
    } else if (char === '\n') {
      row += 1;
      column = 0;
      ensureRow();
    } else if (char === '\b' || char === '\x7f') {
      column = Math.max(0, column - 1);
      const current = ensureRow();
      if (column === current.length - 1) {
        current.length = column;
      } else if (current[column]) {
        current[column] = { text: ' ', foreground: '', bold: false };
      }
    } else if (char === '\t') {
      const nextTabStop = column + (8 - (column % 8));
      while (column < nextTabStop) write(' ');
    } else if (char >= ' ') {
      write(char);
    }
  }

  let text = '';
  rows.forEach((cells, rowIndex) => {
    if (rowIndex > 0) text += '\n';
    cells.forEach((cell) => {
      const start = text.length;
      text += cell.text;
      if (cell.foreground) {
        ranges.push({
          name: `cod-ansi-${cell.bold && !cell.foreground.startsWith('bright-') ? `bright-${cell.foreground}` : cell.foreground}`,
          start,
          end: text.length,
        });
      }
    });
  });

  return { text, ranges };
};

const clearTerminalHighlights = (appWindow: Window) => {
  const highlights = (appWindow as HighlightWindow).CSS.highlights;
  for (const name of ANSI_HIGHLIGHTS) highlights.delete(name);
};

export const applyTerminalHighlights = (
  appWindow: Window,
  terminals: TerminalWindow[],
  activeTerminalId?: string,
) => {
  clearTerminalHighlights(appWindow);
  if (!activeTerminalId) return;

  const terminal = terminals.find((item) => item.id === activeTerminalId);
  const pre = appWindow.document.querySelector<HTMLPreElement>(
    `pre[data-terminal-id="${activeTerminalId}"]`,
  );
  const textNode = pre?.firstChild;
  const highlightWindow = appWindow as HighlightWindow;
  const highlights = highlightWindow.CSS.highlights;
  const HighlightCtor = highlightWindow.Highlight;
  if (!terminal) throw new Error(`active terminal not found: ${activeTerminalId}`);
  if (!pre) throw new Error(`terminal pre not found: ${activeTerminalId}`);
  if (textNode?.nodeType !== Node.TEXT_NODE) {
    throw new Error(`terminal output is not a text node: ${activeTerminalId}`);
  }

  const rendered = renderTerminal(terminal);
  if ((textNode.nodeValue ?? '').length !== rendered.text.length) {
    throw new Error(`terminal highlight text mismatch: ${activeTerminalId}`);
  }

  const byName = new Map<string, Range[]>();
  for (const item of rendered.ranges) {
    const range = appWindow.document.createRange();
    range.setStart(textNode, item.start);
    range.setEnd(textNode, item.end);
    byName.set(item.name, [...(byName.get(item.name) ?? []), range]);
  }
  for (const [name, ranges] of byName) highlights.set(name, new HighlightCtor(...ranges));
  pre.scrollTop = pre.scrollHeight;
};
