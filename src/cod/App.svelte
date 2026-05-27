<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import cod from '../assets/cod-animation.webp';
  import { createSession } from './spawn';
  import TerminalWindow from './TerminalWindow.svelte';
  import {
    applyTerminalHighlights,
    type TerminalLine,
    type TerminalWindow as TerminalWindowModel,
  } from './terminal';

  type RemoteWindow = {
    id: string;
    title: string;
  };

  type ScreenSize = {
    width: number;
    height: number;
  };

  type FirefoxStatus = 'installing' | 'ready' | 'error';

  type LoadingApp = {
    id: string;
    title: string;
    terminalId: string;
  };

  type TaskTerminalOptions = {
    id: string;
    title: string;
    command: string;
    onSuccess?: () => void;
    onFailure?: (error: Error) => void;
  };

  type Session = ReturnType<typeof createSession>;

  type Props = {
    uid: string;
    appWindow: Window;
  };

  const NOVNC_SCRIPT_URL = 'https://static1.codehs.com/lib/noVNC/noVNC.js';
  const REMOTE_DISPLAY_MAX_WIDTH = 1920;
  const REMOTE_DISPLAY_MAX_HEIGHT = 1080;
  const REMOTE_WINDOWS = 'COD_WINDOWS ';
  const GRAPHICS_READY = 'COD_STAGE graphics-ready';
  const JWM_READY = 'COD_STAGE jwm-ready';
  const FIREFOX_READY = 'COD_APP_STATUS firefox ready ';
  const launchTerminalCommand = String.raw`set -euo pipefail
export DISPLAY="\${DISPLAY:-:99}"
if command -v gnome-terminal >/dev/null 2>&1; then
  gnome-terminal &
elif command -v x-terminal-emulator >/dev/null 2>&1; then
  x-terminal-emulator &
elif command -v xterm >/dev/null 2>&1; then
  xterm &
elif command -v uxterm >/dev/null 2>&1; then
  uxterm &
elif command -v xfce4-terminal >/dev/null 2>&1; then
  xfce4-terminal &
elif command -v lxterminal >/dev/null 2>&1; then
  lxterminal &
else
  echo "No X terminal emulator found" >&2
  exit 1
fi
`;
  const firefoxInstallCommand = String.raw`set -euo pipefail
echo "Installing Firefox..."
export PATH="$HOME/.local/bin:$PATH"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/codehs-firefox"
mkdir -p "$BIN_DIR" "$APP_DIR"

if command -v firefox >/dev/null 2>&1; then
  BROWSER="$(command -v firefox)"
elif command -v firefox-esr >/dev/null 2>&1; then
  BROWSER="$(command -v firefox-esr)"
elif [ -x "$APP_DIR/firefox/firefox" ]; then
  BROWSER="$APP_DIR/firefox/firefox"
else
  ARCHIVE="/tmp/cod-firefox.tar.xz"
  URL="https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US"
  echo "Downloading Firefox from Mozilla..."
  if command -v curl >/dev/null 2>&1; then
    curl -L --fail --retry 2 --max-time 90 -o "$ARCHIVE" "$URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$ARCHIVE" "$URL"
  else
    python3 - <<'PY'
import urllib.request
url = 'https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US'
with urllib.request.urlopen(url) as response:
    content_type = response.headers.get('content-type', '')
    if response.status != 200:
        raise RuntimeError(f'unexpected Firefox response: {response.status} {content_type}')
    with open('/tmp/cod-firefox.tar.xz', 'wb') as f:
        f.write(response.read())
PY
  fi
  echo "Extracting Firefox..."
  rm -rf "$APP_DIR/firefox"
  tar -xf "$ARCHIVE" -C "$APP_DIR"
  BROWSER="$APP_DIR/firefox/firefox"
fi

cat > "$BIN_DIR/cod-firefox" <<EOF
#!/usr/bin/env bash
export DISPLAY="\${DISPLAY:-:99}"
exec "$BROWSER" --no-remote "\$@"
EOF
chmod +x "$BIN_DIR/cod-firefox"
"$BIN_DIR/cod-firefox" --version
echo "COD_APP_STATUS firefox ready $BIN_DIR/cod-firefox"
`;
  const remoteProgram = String.raw`import html
import json
import os
import subprocess
import sys
import threading
import tempfile
import textwrap
import time

HOME = os.environ.get('HOME') or '/home/karel'
BIN_DIR = os.path.join(HOME, '.local', 'bin')
WM_DIR = os.path.join(HOME, '.local', 'codehs-wm')
os.makedirs(BIN_DIR, exist_ok=True)
os.makedirs(WM_DIR, exist_ok=True)
os.environ['PATH'] = BIN_DIR + ':' + os.environ.get('PATH', '')

GRAPHICS_WIDTH = 1920
GRAPHICS_HEIGHT = 1080

def say(*parts):
    print(*parts, flush=True)

def run(cmd, timeout=60, cwd=None, env=None, quiet=False):
    if not quiet:
        say('COD_RUN', ' '.join(cmd))
    try:
        p = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout, cwd=cwd, env=env)
        if not quiet:
            say('COD_RUN_RC', p.returncode)
        if p.stdout and not quiet:
            say('COD_RUN_STDOUT', p.stdout[:2000])
        if p.stderr and not quiet:
            say('COD_RUN_STDERR', p.stderr[:2000])
        return p.returncode == 0, p.stdout, p.stderr
    except Exception as exc:
        if not quiet:
            say('COD_RUN_ERROR', type(exc).__name__, str(exc))
        return False, '', str(exc)

def download(url, path, timeout=120):
    return run(['curl', '-L', '--fail', '--max-time', str(timeout - 20), '-o', path, url], timeout=timeout)[0]

def extract_jwm():
    candidate = os.path.join(WM_DIR, 'usr', 'bin', 'jwm')
    if os.path.exists(candidate):
        return candidate
    deb = os.path.join(tempfile.mkdtemp(prefix='cod-jwm-'), 'jwm.deb')
    urls = [
        'https://mirrors.kernel.org/ubuntu/pool/universe/j/jwm/jwm_2.4.0-2_amd64.deb',
        'https://archive.ubuntu.com/ubuntu/pool/universe/j/jwm/jwm_2.4.0-2_amd64.deb',
    ]
    for url in urls:
        if download(url, deb, 90):
            ok, _out, _err = run(['dpkg-deb', '-x', deb, WM_DIR], timeout=60)
            if ok and os.path.exists(candidate):
                os.chmod(candidate, os.stat(candidate).st_mode | 0o111)
                return candidate
    return None

def start_background(cmd, log_path, cwd=None):
    log = open(log_path, 'ab', buffering=0)
    return subprocess.Popen(
        cmd,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

def wait_for_display(timeout=8):
    deadline = time.time() + timeout
    while time.time() < deadline:
        ok, _out, _err = run(['xdpyinfo', '-display', ':99'], timeout=2, quiet=True)
        if ok:
            return True
        time.sleep(0.25)
    return False

def restart_graphics_stack():
    say('COD_STAGE graphics-restart', f'{GRAPHICS_WIDTH}x{GRAPHICS_HEIGHT}')
    for pattern in [
        'websockify 1337 :5900',
        'x11vnc .* -display :99',
        '/usr/bin/Xvfb :99',
    ]:
        run(['pkill', '-f', pattern], timeout=5, quiet=True)
    time.sleep(1)
    for path in ['/tmp/.X99-lock', '/tmp/.X11-unix/X99']:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        except Exception as exc:
            say('COD_WARN remove-display-lock', path, type(exc).__name__, str(exc))

    start_background(
        [
            '/usr/bin/Xvfb',
            ':99',
            '-screen',
            '0',
            f'{GRAPHICS_WIDTH}x{GRAPHICS_HEIGHT}x16',
            '-ac',
            '+extension',
            'GLX',
            '+extension',
            'RANDR',
        ],
        '/tmp/cod-xvfb.log',
    )
    if not wait_for_display():
        say('COD_ERROR graphics-xvfb-not-ready')
        sys.exit(5)
    run(['xrandr', '-d', ':99', '--current'], timeout=5)
    start_background(
        ['x11vnc', '-noxrecord', '-xrandr', '-noncache', '-display', ':99', '-forever', '-rfbport', '5900'],
        '/tmp/cod-x11vnc.log',
    )
    time.sleep(1)
    start_background(
        ['/usr/bin/python3.8', '-m', 'websockify', '1337', ':5900'],
        '/tmp/cod-websockify.log',
        cwd='/usr/local/websockify',
    )
    time.sleep(2)
    say('COD_STAGE graphics-ready', f'{GRAPHICS_WIDTH}x{GRAPHICS_HEIGHT}')

def write_jwmrc(path):
    with open(path, 'w') as f:
        f.write(textwrap.dedent('''\
            <?xml version="1.0"?>
            <JWM>
              <RootMenu onroot="123">
                <Program label="Firefox">{browser}</Program>
                <Program label="Terminal">gnome-terminal</Program>
                <Restart label="Restart JWM"/>
                <Exit label="Exit JWM" confirm="false"/>
              </RootMenu>
              <Group>
                <Name>Navigator</Name>
                <Class>firefox</Class>
                <Class>Firefox</Class>
                <Option>maximized</Option>
              </Group>
              <Group>
                <Option>tiled</Option>
                <Option>aerosnap</Option>
                <Option>noborder</Option>
                <Option>notitle</Option>
              </Group>
              <WindowStyle decorations="motif">
                <Font>Sans-10</Font>
                <Width>0</Width>
                <Height>0</Height>
              </WindowStyle>
              <Tray autohide="true" x="0" y="-1" height="1"></Tray>
              <FocusModel>click</FocusModel>
              <MoveMode>opaque</MoveMode>
              <ResizeMode>opaque</ResizeMode>
              <DoubleClickSpeed>400</DoubleClickSpeed>
              <DoubleClickDelta>2</DoubleClickDelta>
              <Key key="A-Tab">nextstacked</Key>
              <Key key="A-F4">close</Key>
            </JWM>
        '''.format(browser=html.escape(os.path.join(BIN_DIR, 'cod-firefox')))))

def get_window_title(window_id):
    ok, out, _err = run(['xprop', '-id', window_id, '_NET_WM_NAME', 'WM_NAME'], timeout=2, quiet=True)
    if not ok:
        return ''
    for line in out.splitlines():
        if ' = ' not in line:
            continue
        _key, value = line.split(' = ', 1)
        if value.startswith('"') and value.endswith('"'):
            return value[1:-1]
    return ''

def list_windows():
    ok, out, _err = run(['xprop', '-root', '_NET_CLIENT_LIST'], timeout=2, quiet=True)
    if not ok or '#' not in out:
        return []
    ids = [part.strip().rstrip(',') for part in out.split('#', 1)[1].split(',')]
    windows = []
    for window_id in ids:
        if not window_id.startswith('0x'):
            continue
        title = get_window_title(window_id) or 'Untitled window'
        windows.append({'id': window_id, 'title': title})
    return windows

def watch_windows():
    previous = None
    while True:
        windows = list_windows()
        current = json.dumps(windows, sort_keys=True)
        if current != previous:
            say('COD_WINDOWS', current)
            previous = current
        time.sleep(1)

say('COD_STAGE desktop-start')
restart_graphics_stack()
try:
    subprocess.run(['xsetroot', '-solid', '#00120a'], timeout=5)
except Exception:
    pass

jwm = extract_jwm()
if not jwm:
    say('COD_ERROR no-jwm')
    sys.exit(2)
say('COD_STAGE jwm-installed', jwm)

jwmrc = os.path.join(tempfile.mkdtemp(prefix='cod-jwmrc-'), 'jwmrc')
write_jwmrc(jwmrc)
env = os.environ.copy()
env['PATH'] = os.path.dirname(jwm) + ':' + BIN_DIR + ':' + env.get('PATH', '')
wm = subprocess.Popen([jwm, '-f', jwmrc], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
time.sleep(1)
if wm.poll() is not None:
    say('COD_ERROR jwm-exited', wm.returncode)
    sys.exit(3)
say('COD_STAGE jwm-ready')
threading.Thread(target=watch_windows, daemon=True).start()

while True:
    if wm.poll() is not None:
        say('COD_ERROR jwm-stopped', wm.returncode)
        sys.exit(4)
    time.sleep(5)
`;

  let { uid, appWindow }: Props = $props();
  let loading = $state(true);
  let session = $state<Session>();
  let desktopReady = false;
  let graphicsReady = false;
  let resolveGraphicsReady: (() => void) | undefined;
  let latestDisplaySize: ScreenSize | undefined;
  let displayResizeTimer = 0;
  let firefoxInstallStarted = false;
  let openLogId = $state<string>();
  let terminals = $state<TerminalWindowModel[]>([]);
  let remoteWindows = $state<RemoteWindow[]>([]);
  let firefoxStatus = $state<FirefoxStatus>('installing');
  let firefoxLaunchCommand = $state('');
  let vncScreen: HTMLElement | undefined;

  const openLog = (id: string) => {
    openLogId = id;
    appWindow.setTimeout(() => focusTerminalWindow(id));
  };

  const loadScript = (document: Document, src: string) =>
    new Promise<void>((resolve, reject) => {
      const existing = [...document.scripts].find((script) => script.src === src);
      if (existing) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(script);
    });

  const measureLogicalPixelSize = (element: HTMLElement): ScreenSize => {
    const rect = element.getBoundingClientRect();

    return {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  };

  const observeDisplaySize = (
    screen: HTMLElement,
    onResize: (size: ScreenSize) => void,
  ) => {
    let frame = 0;
    let lastSize: ScreenSize | undefined;

    const emitResize = () => {
      frame = 0;
      const size = measureLogicalPixelSize(screen);
      if (lastSize?.width === size.width && lastSize.height === size.height) return;
      lastSize = size;
      onResize(size);
    };

    const scheduleResize = () => {
      if (frame) appWindow.cancelAnimationFrame(frame);
      frame = appWindow.requestAnimationFrame(emitResize);
    };

    const observer = new ResizeObserver(scheduleResize);
    observer.observe(screen);
    scheduleResize();

    return () => {
      observer.disconnect();
      if (frame) appWindow.cancelAnimationFrame(frame);
    };
  };

  const syncCanvasLogicalSize = (screen: HTMLElement) => {
    const canvas = screen.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;

    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
    canvas.style.objectFit = 'fill';
  };

  const observeCanvasLogicalSize = (screen: HTMLElement) => {
    let canvasObserver: MutationObserver | undefined;

    const observeCanvas = () => {
      const canvas = screen.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) return false;

      canvasObserver?.disconnect();
      const observer = new MutationObserver(() => syncCanvasLogicalSize(screen));
      canvasObserver = observer;
      observer.observe(canvas, {
        attributes: true,
        attributeFilter: ['width', 'height'],
      });
      syncCanvasLogicalSize(screen);
      return true;
    };

    const screenObserver = new MutationObserver(() => {
      if (observeCanvas()) screenObserver.disconnect();
    });

    if (!observeCanvas()) {
      screenObserver.observe(screen, { childList: true, subtree: true });
    }
  };

  const connectRfb = (
    screen: HTMLElement,
    url: string,
    onConnect: () => void,
  ) => {
    let connected = false;
    let rfb: RfbClient | undefined;
    let reconnectTimer = 0;

    const connect = () => {
      const RFB = appWindow.RFB;
      if (!RFB) return;

      connected = false;
      reconnectTimer = 0;

      rfb = new RFB(screen, url, {});
      rfb.scaleViewport = false;
      rfb.resizeSession = false;
      rfb.clipViewport = true;
      rfb.focusOnClick = true;

      rfb.addEventListener('disconnect', (event) => {
        if (connected) console.warn('[rfb] disconnected', event);
        connected = false;
        if (!reconnectTimer) reconnectTimer = appWindow.setTimeout(connect, 1000);
      });

      rfb.addEventListener('connect', () => {
        connected = true;
        onConnect();
      });
    };

    connect();

    return () => {
      if (reconnectTimer) appWindow.clearTimeout(reconnectTimer);
      rfb?.disconnect();
    };
  };

  const resizeDisplay = (activeSession: Session, size: ScreenSize) => {
    const width = Math.min(size.width, REMOTE_DISPLAY_MAX_WIDTH);
    const height = Math.min(size.height, REMOTE_DISPLAY_MAX_HEIGHT);
    latestDisplaySize = { width, height };
    if (!graphicsReady) return;

    if (displayResizeTimer) appWindow.clearTimeout(displayResizeTimer);
    displayResizeTimer = appWindow.setTimeout(() => {
      displayResizeTimer = 0;
      const target = latestDisplaySize;
      if (!target) return;
      const command = `set -euo pipefail
WIDTH=${target.width}
HEIGHT=${target.height}
MODE="\${WIDTH}x\${HEIGHT}"
if ! xrandr -d :99 --query | awk '{print $1}' | grep -Fxq "$MODE"; then
  xrandr -d :99 --newmode "$MODE" $(gtf "$WIDTH" "$HEIGHT" 60 | sed -n -e 's/^.*"  //p')
  xrandr -d :99 --addmode screen "$MODE" || true
fi
xrandr -d :99 --output screen --mode "$MODE"
echo "COD_STAGE display-resized $MODE"
`;
      activeSession.spawnCommand(
        `display-resize-${Date.now()}`,
        command,
        { untracked: true },
      );
    }, 120);
  };

  const updateRemoteWindows = (line: string) => {
    const json = line.slice(REMOTE_WINDOWS.length).trim();
    try {
      const windows = (JSON.parse(json) as RemoteWindow[]).filter(
        (window) => typeof window.id === 'string' && typeof window.title === 'string',
      );
      const windowsById = new Map(windows.map((window) => [window.id, window]));
      const orderedWindows = remoteWindows
        .map((window) => windowsById.get(window.id))
        .filter((window): window is RemoteWindow => !!window);

      for (const window of windows) {
        if (!orderedWindows.some((orderedWindow) => orderedWindow.id === window.id)) {
          orderedWindows.push(window);
        }
      }

      remoteWindows = orderedWindows;
    } catch (error) {
      console.warn('[wm] failed to parse windows', error, line);
    }
  };

  const handleRemoteOutput = (text: string) => {
    for (const line of text.split('\n')) {
      if (line.startsWith(REMOTE_WINDOWS)) updateRemoteWindows(line);
      if (line.startsWith(FIREFOX_READY)) {
        firefoxStatus = 'ready';
        firefoxLaunchCommand = line.slice(FIREFOX_READY.length).trim() || 'cod-firefox';
      }
    }
    if (text.includes(JWM_READY)) {
      desktopReady = true;
      startFirefoxInstall();
    }
    if (text.includes(GRAPHICS_READY)) {
      graphicsReady = true;
      if (session && latestDisplaySize) resizeDisplay(session, latestDisplaySize);
      resolveGraphicsReady?.();
      resolveGraphicsReady = undefined;
    }
    if (text.includes('COD_APP_STATUS firefox installing')) {
      firefoxStatus = 'installing';
    }
    if (text.includes('COD_APP_ERROR firefox')) {
      firefoxStatus = 'error';
    }
  };

  const transferDesktop = (activeSession: Session) => {
    return activeSession.transfer({
      'main.py': remoteProgram,
    });
  };

  const spawnDesktop = (activeSession: Session) => {
    const command = 'set -e\nsource "./.pyvenv311/bin/activate"\npython -B "$MAIN_FILE"';

    activeSession.spawnCommand('desktop', command, {
      args: ['-i', '-c', command],
      type: 'echopty',
      env: {
        MAIN_FILE: 'main.py',
        DEBUG_MODE: 0,
      },
      untracked: true,
    });
  };

  const waitForGraphicsReady = () => {
    if (graphicsReady) return Promise.resolve();
    return new Promise<void>((resolve) => {
      resolveGraphicsReady = resolve;
    });
  };

  const startVnc = async (screen: HTMLElement) => {
    const url = `wss://scalinghub.codehs.com/user/${uid}/graphics`;

    observeCanvasLogicalSize(screen);

    const activeSession = createSession(uid, appWindow, (stream, data, id) => {
      const text = String(data ?? '');
      if (id && (id.startsWith('terminal-') || id.startsWith('task-'))) {
        appendTerminal(id, stream, text);
      }

      if (stream === 'stderr') console.warn('[spawn]', text);
      handleRemoteOutput(text);
    });
    session = activeSession;

    await activeSession.ready;
    graphicsReady = false;
    observeDisplaySize(screen, (size) => resizeDisplay(activeSession, size));
    await transferDesktop(activeSession);
    spawnDesktop(activeSession);
    await waitForGraphicsReady();
    await loadScript(appWindow.document, NOVNC_SCRIPT_URL);
    if (!appWindow.RFB) throw new Error('noVNC RFB global did not load');

    connectRfb(screen, url, () => {
      loading = false;
      syncCanvasLogicalSize(screen);
    });
  };

  const attachVnc: Attachment<HTMLElement> = (screen) => {
    vncScreen = screen;
    void startVnc(screen);
  };

  const focusVncScreen = () => {
    const canvas = vncScreen?.querySelector('canvas');
    if (canvas instanceof HTMLCanvasElement) canvas.focus({ preventScroll: true });
  };

  const focusTerminalWindow = (id: string) => {
    const terminal = appWindow.document.querySelector<HTMLElement>(
      `[data-terminal-window-id="${id}"]`,
    );
    terminal?.focus({ preventScroll: true });
  };

  const loadingApps = (): LoadingApp[] => {
    const apps: LoadingApp[] = [];
    const firefoxTask = terminals.find((terminal) => terminal.id === 'task-firefox-install');
    if (firefoxTask?.running) {
      apps.push({ id: 'firefox', title: firefoxTask.title, terminalId: firefoxTask.id });
    }
    return apps;
  };

  const launchFirefox = (event?: MouseEvent) => {
    if (!session) return;
    if (firefoxStatus !== 'ready') return;

    const id = event?.ctrlKey
      ? `firefox-${Date.now()}`
      : 'firefox-launcher';
    const command = firefoxLaunchCommand || 'cod-firefox';
    session.spawnCommand(id, `${command} about:blank >/tmp/cod-firefox-launch.log 2>&1 &`, {
      untracked: true,
    });
  };

  const launchTerminal = (event?: MouseEvent) => {
    if (!session || !desktopReady) return;

    const id = event?.ctrlKey
      ? `terminal-launcher-${Date.now()}`
      : 'terminal-launcher';
    startTaskTerminal({
      id,
      title: 'Opening Terminal',
      command: launchTerminalCommand,
    });
    appWindow.setTimeout(focusVncScreen);
  };

  const focusRemoteWindow = (window: RemoteWindow) => {
    if (session) {
      const windowId = JSON.stringify(window.id);
      session.spawnCommand(`focus-${Date.now()}`, `python -B - <<'PY'
import ctypes
import time

window_id = ${windowId}
if not window_id.startswith('0x'):
    raise SystemExit(0)

class ClientMessageData(ctypes.Union):
    _fields_ = [
        ('b', ctypes.c_char * 20),
        ('s', ctypes.c_short * 10),
        ('l', ctypes.c_long * 5),
    ]

class XClientMessageEvent(ctypes.Structure):
    _fields_ = [
        ('type', ctypes.c_int),
        ('serial', ctypes.c_ulong),
        ('send_event', ctypes.c_int),
        ('display', ctypes.c_void_p),
        ('window', ctypes.c_ulong),
        ('message_type', ctypes.c_ulong),
        ('format', ctypes.c_int),
        ('data', ClientMessageData),
    ]

class XEvent(ctypes.Union):
    _fields_ = [
        ('type', ctypes.c_int),
        ('xclient', XClientMessageEvent),
        ('pad', ctypes.c_long * 24),
    ]

x11 = ctypes.cdll.LoadLibrary('libX11.so.6')
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XInternAtom.restype = ctypes.c_ulong

display = x11.XOpenDisplay(None)
if not display:
    raise SystemExit(0)
try:
    window = int(window_id, 16)
    root = x11.XDefaultRootWindow(display)
    active_window = x11.XInternAtom(display, b'_NET_ACTIVE_WINDOW', False)
    event = XEvent()
    event.xclient.type = 33
    event.xclient.display = display
    event.xclient.window = window
    event.xclient.message_type = active_window
    event.xclient.format = 32
    event.xclient.data.l[0] = 1
    event.xclient.data.l[1] = int(time.time())
    x11.XSendEvent(display, root, False, 0x00100000 | 0x00080000, ctypes.byref(event))
    x11.XRaiseWindow(display, window)
    x11.XFlush(display)
finally:
    x11.XCloseDisplay(display)
PY`, {
        untracked: true,
      });
    }
    appWindow.setTimeout(focusVncScreen);
  };

  const appendTerminal = (
    id: string,
    stream: TerminalLine['stream'],
    text: string,
  ) => {
    terminals = terminals.map((terminal) =>
      terminal.id === id
        ? {
            ...terminal,
            running: stream === 'system' && text.includes('exited') ? false : terminal.running,
            lines: [...terminal.lines, { stream, text }].slice(-500),
          }
        : terminal,
    );
  };

  const markTerminalFinished = (id: string, failed: boolean, text: string) => {
    terminals = terminals.map((terminal) =>
      terminal.id === id
        ? {
            ...terminal,
            running: false,
            failed,
            lines: [
              ...terminal.lines,
              { stream: 'system' as const, text },
            ].slice(-500),
          }
        : terminal,
    );
  };

  const startTaskTerminal = ({
    id,
    title,
    command,
    onSuccess,
    onFailure,
  }: TaskTerminalOptions) => {
    if (!session || terminals.some((terminal) => terminal.id === id)) return;
    const marker = `COD_TASK_EXIT ${id} `;
    const wrappedCommand = `set +e\n(\n${command}\n)\ncode=$?\necho "${marker}$code"\nexit 0`;

    terminals = [
      ...terminals,
      {
        id,
        title,
        kind: 'task',
        running: true,
        started: true,
        failed: false,
        lines: [{ stream: 'system', text: `${title}\n` }],
      },
    ];
    openLogId = id;

    session.spawnCommand(id, wrappedCommand, {
      type: 'echopty',
      args: ['-lc', wrappedCommand],
      resolveOnOutput: (text) => text.includes(`${marker}0`),
      rejectOnOutput: (text) => {
        const match = text.match(new RegExp(`${marker}(\\d+)`));
        if (!match || match[1] === '0') return undefined;
        return new Error(`${title} exited with code ${match[1]}`);
      },
    })
      ?.then(() => {
        markTerminalFinished(id, false, '\nTask completed successfully.\n');
        onSuccess?.();
      })
      .catch((error: Error) => {
        markTerminalFinished(id, true, `\nTask failed: ${error.message}\n`);
        onFailure?.(error);
      });
  };

  const startFirefoxInstall = () => {
    if (!desktopReady || !session || firefoxInstallStarted) return;
    firefoxInstallStarted = true;
    firefoxStatus = 'installing';
    startTaskTerminal({
      id: 'task-firefox-install',
      title: 'Installing Firefox',
      command: firefoxInstallCommand,
      onSuccess: () => {
        firefoxStatus = 'ready';
        if (!firefoxLaunchCommand) firefoxLaunchCommand = 'cod-firefox';
      },
      onFailure: () => {
        firefoxStatus = 'error';
      },
    });
  };

  const closeTerminal = (id: string) => {
    openLogId = openLogId === id ? undefined : openLogId;
  };

  const sendTerminalInput = (id: string, input: string) => {
    session?.input(id, input);
    terminals = terminals.map((terminal) =>
      terminal.id === id
        ? {
            ...terminal,
            lines: [...terminal.lines, { stream: 'input' as const, text: input }].slice(-500),
          }
        : terminal,
    );
  };

  const firefoxTitle = () => {
    if (firefoxStatus === 'installing') return 'Installing Firefox';
    if (firefoxStatus === 'error') return 'Firefox failed to install';
    return 'Open Firefox';
  };

  $effect(() => {
    openLogId;
    terminals.map((terminal) => `${terminal.id}:${terminal.lines.length}`).join(',');
    appWindow.setTimeout(() => {
      if (!openLogId) return;
      applyTerminalHighlights(appWindow, terminals, openLogId);
    });
  });
</script>

<div class="screen" {@attach attachVnc}></div>

{#each terminals as terminal (terminal.id)}
  <TerminalWindow
    {terminal}
    open={openLogId === terminal.id}
    onOpen={openLog}
    onClose={closeTerminal}
    onInput={sendTerminalInput}
  />
{/each}

<div class:force-expand={loading} class="bar-anchor">
  <nav class="bar" aria-label="Open windows">
    {#each loadingApps() as app (app.id)}
      <button
        class="app-entry loading"
        type="button"
        title={app.title}
        onclick={() => openLog(app.terminalId)}
      >
        <img src={cod} alt="Cod loading" />
      </button>
    {/each}
    {#each remoteWindows as window (window.id)}
      <button
        class="app-entry alive"
        type="button"
        title={window.title}
        onclick={() => focusRemoteWindow(window)}
      >
        <span>{window.title}</span>
      </button>
    {/each}
    {#if remoteWindows.length === 0 && firefoxStatus !== 'installing'}
      <button
        class="app-entry"
        class:error={firefoxStatus === 'error'}
        aria-disabled={firefoxStatus === 'error'}
        type="button"
        title={firefoxTitle()}
        onclick={launchFirefox}
      >
        <span>Launch Firefox</span>
      </button>
    {/if}
    {#each terminals.filter((terminal) => terminal.kind === 'task') as terminal (terminal.id)}
      <button
        class="app-entry alive"
        class:error={terminal.failed}
        type="button"
        title={terminal.title}
        onclick={() => openLog(terminal.id)}
      >
        <span>{terminal.title}</span>
      </button>
    {/each}
    {#if !loading}
      <button
        class="app-entry"
        type="button"
        title="Open Terminal"
        onclick={launchTerminal}
      >
        <span>Terminal</span>
      </button>
    {/if}
  </nav>
</div>

<div class:hidden={!loading} class="loader">
  <img src={cod} alt="Loading Cod" />
</div>

<style>
  .screen {
    position: absolute;
    z-index: 10;
    inset: 0;
    overflow: visible;

    :global(canvas) {
      max-width: none;
      max-height: none;
      object-fit: none;
    }
  }

  .bar-anchor {
    display: contents;
    --transition: 220ms cubic-bezier(0.2, 0, 0, 1);
  }

  .bar {
    position: fixed;
    z-index: 70;
    bottom: 0;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    width: max-content;
    max-width: calc(100vw - 1rem);
    height: 2.25rem;
    overflow: visible;
    padding: 0.25rem;
    background: transparent;
    translate: -50% 0;
    transition:
      height var(--transition),
      width var(--transition),
      padding var(--transition),
      border-radius var(--transition);

    &::after {
      position: absolute;
      top: auto;
      bottom: 0.18rem;
      left: 50%;
      width: 2.7rem;
      height: 0.28rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--m3c-primary-container) 70%, transparent);
      content: '';
      translate: -50% 0;
      transition:
        opacity var(--transition),
        visibility var(--transition);
    }
  }

  .bar-anchor:not(:hover, :focus-within, .force-expand) > .bar {
    width: 3.5rem;
    height: 0.75rem;
    padding: 0;
  }

  .bar-anchor:is(:hover, :focus-within, .force-expand) > .bar::after {
    visibility: hidden;
    opacity: 0;
  }

  .bar-anchor:not(:hover, :focus-within, .force-expand) > .bar > button {
    width: 0;
    min-width: 0;
    padding-inline: 0;
    visibility: hidden;
  }

  .bar button {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 5.25rem;
    max-width: 10rem;
    height: 1.75rem;
    border: 0;
    border-radius: 0.48rem;
    padding: 0 0.6rem;
    background: color-mix(in srgb, var(--m3c-surface-container-low) 82%, transparent);
    color: var(--m3c-on-surface);
    text-align: center;
    cursor: pointer;
    transition:
      width var(--transition),
      min-width var(--transition),
      padding var(--transition),
      background 120ms;

    &:hover {
      background: var(--m3c-surface-container-high);
    }

    &.alive::after {
      position: absolute;
      bottom: 0.2rem;
      left: 50%;
      width: 0.3rem;
      height: 0.3rem;
      border-radius: 999px;
      background: currentColor;
      content: '';
      opacity: 0.72;
      translate: -50% 0;
    }

    &.error {
      background: var(--m3c-error-container-subtle);
      color: var(--m3c-on-error-container-subtle);
    }

    &.loading {
      min-width: 2.4rem;
      background: transparent;
      cursor: default;

      &:hover {
        background: transparent;
      }
    }

    img {
      width: 1.5rem;
      height: 1.5rem;
      object-fit: contain;
    }

    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 650;
      line-height: 1.1;
    }
  }

  .loader {
    position: absolute;
    z-index: 90;
    inset: 0;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 1rem;
    background: var(--m3c-surface);
    transition: opacity 140ms;

    &.hidden {
      visibility: hidden;
      opacity: 0;
    }

    img {
      width: min(50vw, 50vh, 24rem);
      height: auto;
    }
  }
</style>
