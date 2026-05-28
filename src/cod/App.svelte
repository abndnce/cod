<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import cod from '../assets/cod-animation.webp';
  import type { SpawnSession } from './spawn';
  import TerminalWindow from './TerminalWindow.svelte';
  import {
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

  type TaskTerminalOptions = {
    id: string;
    title: string;
    command: string;
    args?: string[];
    env?: Record<string, string | number>;
    type?: 'normal' | 'echopty';
    track?: boolean;
    onOutput?: (stream: TerminalLine['stream'], text: string) => void;
    onSuccess?: () => void;
    onFailure?: (error: Error) => void;
  };

  type Props = {
    uid: string;
    appWindow: Window;
    session: SpawnSession;
  };

  const NOVNC_SCRIPT_URL = 'https://static1.codehs.com/lib/noVNC/noVNC.js';
  const REMOTE_DISPLAY_MAX_WIDTH = 1920;
  const REMOTE_DISPLAY_MAX_HEIGHT = 1080;
  const REMOTE_WINDOWS = 'COD_WINDOWS ';
  const RELATIVE_MOUSE_ID = 'task-relative-mouse';
  const firefoxInstallCommand = String.raw`set -euo pipefail
echo "Installing Firefox..."
export PATH="$HOME/.local/bin:$PATH"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local"
APPLICATIONS_DIR="$HOME/.local/share/applications"
mkdir -p "$BIN_DIR" "$APP_DIR" "$APPLICATIONS_DIR"
BROWSER="$APP_DIR/firefox/firefox"
FIREFOX_BIN="$APP_DIR/firefox/firefox-bin"
DESKTOP_FILE="$APPLICATIONS_DIR/firefox.desktop"

if [ ! -x "$BROWSER" ]; then
  ARCHIVE="/tmp/firefox.tar.xz"
  EXTRACT_DIR="$(mktemp -d "$APP_DIR/firefox-install.XXXXXX")"
  URL="https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US"
  cleanup() {
    rm -rf "$EXTRACT_DIR"
  }
  trap cleanup EXIT
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
    with open('/tmp/firefox.tar.xz', 'wb') as f:
        f.write(response.read())
PY
  fi
  echo "Extracting Firefox..."
  tar -xf "$ARCHIVE" -C "$EXTRACT_DIR"
  rm -rf "$APP_DIR/firefox"
  mv "$EXTRACT_DIR/firefox" "$APP_DIR/firefox"
fi

ln -sfn "$BROWSER" "$BIN_DIR/firefox"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Encoding=UTF-8
Version=1.0
Type=Application
NoDisplay=true
Exec=$FIREFOX_BIN %u
Name=Firefox
Comment=Custom definition for Firefox
Icon=$APP_DIR/firefox/browser/chrome/icons/default/default128.png
MimeType=x-scheme-handler/http;x-scheme-handler/https;x-scheme-handler/chrome;text/html;application/x-extension-htm;application/x-extension-html;application/x-extension-shtml;application/xhtml+xml;application/x-extension-xhtml;application/x-extension-xht;
StartupWMClass=firefox
EOF
chmod 644 "$DESKTOP_FILE"
mkdir -p "$HOME/.config"
python3 - <<'PY'
import configparser
import os

home = os.environ['HOME']
path = os.path.join(home, '.config', 'mimeapps.list')
defaults = {
    'x-scheme-handler/http': 'firefox.desktop',
    'x-scheme-handler/https': 'firefox.desktop',
    'x-scheme-handler/chrome': 'firefox.desktop',
    'text/html': 'firefox.desktop',
    'application/x-extension-htm': 'firefox.desktop',
    'application/x-extension-html': 'firefox.desktop',
    'application/x-extension-shtml': 'firefox.desktop',
    'application/xhtml+xml': 'firefox.desktop',
    'application/x-extension-xhtml': 'firefox.desktop',
    'application/x-extension-xht': 'firefox.desktop',
}
config = configparser.RawConfigParser(strict=False, delimiters=('='))
config.optionxform = str
config.read(path)
for section, suffix in [('Default Applications', ''), ('Added Associations', ';')]:
    if not config.has_section(section):
        config.add_section(section)
    for key, value in defaults.items():
        config.set(section, key, value + suffix)
with open(path, 'w') as f:
    config.write(f, space_around_delimiters=False)
PY

"$BROWSER" --version
echo "Firefox is ready: $BROWSER"
`;
  const prismInstallCommand = String.raw`set -euo pipefail
echo "Installing Prism Launcher..."
python3 - <<'PY'
import json
import os
import shutil
import subprocess
import tarfile
import urllib.request

release_api = 'https://api.github.com/repos/PrismLauncher/PrismLauncher/releases/latest'
fallback_url = 'https://github.com/PrismLauncher/PrismLauncher/releases/download/11.0.2/PrismLauncher-Linux-Qt6-Portable-11.0.2.tar.gz'
home = os.environ.get('HOME') or '/tmp'
app_root = os.path.join(home, '.local', 'prism')
bin_dir = os.path.join(home, '.local', 'bin')
extract_dir = os.path.join(app_root, 'portable')
launcher = os.path.join(bin_dir, 'prismlauncher')
os.makedirs(app_root, exist_ok=True)
os.makedirs(bin_dir, exist_ok=True)

def download(url, dest, timeout=240):
    curl = shutil.which('curl')
    wget = shutil.which('wget')
    if curl:
        return subprocess.run([curl, '-L', '--fail', '--max-time', str(timeout), '-o', dest, url]).returncode == 0
    if wget:
        return subprocess.run([wget, '-O', dest, url], timeout=timeout + 30).returncode == 0
    req = urllib.request.Request(url, headers={'User-Agent': 'prism-bootstrap/1'})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, 'wb') as f:
        shutil.copyfileobj(resp, f)
    return True

def latest_url():
    override = os.environ.get('PRISM_URL')
    if override:
        return override
    try:
        req = urllib.request.Request(release_api, headers={'User-Agent': 'prism-bootstrap/1'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            release = json.load(resp)
        assets = release.get('assets') or []
        for asset in assets:
            name = asset.get('name') or ''
            if name.startswith('PrismLauncher-Linux-Qt6-Portable-') and name.endswith('.tar.gz'):
                print('Prism release:', release.get('tag_name'), name, flush=True)
                return asset.get('browser_download_url')
        for asset in assets:
            name = asset.get('name') or ''
            if name == 'PrismLauncher-Linux-x86_64.AppImage':
                print('Prism AppImage fallback:', release.get('tag_name'), name, flush=True)
                return asset.get('browser_download_url')
    except Exception as exc:
        print('Could not look up latest Prism release:', type(exc).__name__, str(exc), flush=True)
    return fallback_url

def find_prism(root):
    names = {'prismlauncher', 'PrismLauncher', 'prismlauncher.bin'}
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if name in names:
                path = os.path.join(dirpath, name)
                os.chmod(path, os.stat(path).st_mode | 0o111)
                return path
    return None

url = latest_url()
archive = os.path.join(app_root, os.path.basename(url.split('?', 1)[0]) or 'prism.tar.gz')
if not os.path.exists(archive) or os.path.getsize(archive) < 1024 * 1024:
    print('Downloading Prism from', url, flush=True)
    tmp = archive + '.download'
    if os.path.exists(tmp):
        os.remove(tmp)
    if not download(url, tmp):
        raise RuntimeError('failed to download Prism')
    os.replace(tmp, archive)

print('Prism archive:', archive, os.path.getsize(archive), flush=True)
shutil.rmtree(extract_dir, ignore_errors=True)
os.makedirs(extract_dir, exist_ok=True)
if archive.endswith('.AppImage'):
    os.chmod(archive, os.stat(archive).st_mode | 0o111)
    result = subprocess.run([archive, '--appimage-extract'], cwd=extract_dir)
    if result.returncode != 0:
        raise RuntimeError('failed to extract Prism AppImage')
else:
    with tarfile.open(archive, 'r:gz') as tar:
        tar.extractall(extract_dir)

prism = find_prism(extract_dir)
if not prism:
    raise RuntimeError('could not find Prism executable after extraction')

with open(launcher, 'w') as f:
    f.write('#!/bin/sh\nexec "{}" "$@"\n'.format(prism))
os.chmod(launcher, 0o755)
subprocess.run([launcher, '--version'], timeout=30, check=True)
print('Prism is ready:', launcher, flush=True)
PY
`;
  const relativeMouseCommand = String.raw`set -euo pipefail
export DISPLAY=:99
for _ in $(seq 1 1200); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
xdpyinfo -display :99 >/dev/null
HELPER="$(mktemp /tmp/cod-relative-mouse.XXXXXX.py)"
trap 'rm -f "$HELPER"' EXIT
cat > "$HELPER" <<'PY'
import ctypes
import sys

x11 = ctypes.cdll.LoadLibrary('libX11.so.6')
xtst = ctypes.cdll.LoadLibrary('libXtst.so.6')

XErrorHandler = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
XIOErrorHandler = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p)

@XErrorHandler
def handle_x_error(display, event):
    print('Relative mouse X error', flush=True)
    return 0

@XIOErrorHandler
def handle_x_io_error(display):
    print('Relative mouse X IO error', flush=True)
    return 0

x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x11.XSetErrorHandler.argtypes = [XErrorHandler]
x11.XSetIOErrorHandler.argtypes = [XIOErrorHandler]
xtst.XTestFakeRelativeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeRelativeMotionEvent.restype = ctypes.c_int
xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeButtonEvent.restype = ctypes.c_int

x11.XSetErrorHandler(handle_x_error)
x11.XSetIOErrorHandler(handle_x_io_error)
display = x11.XOpenDisplay(None)
if not display:
    raise SystemExit('could not open DISPLAY')

print('Relative mouse helper ready', flush=True)

def clamp(value):
    return max(-2000, min(2000, int(value)))

for line in sys.stdin:
    parts = line.split()
    if not parts:
        continue
    try:
        if parts[0] == 'm' and len(parts) == 3:
            dx = clamp(parts[1])
            dy = clamp(parts[2])
            if dx or dy:
                xtst.XTestFakeRelativeMotionEvent(display, dx, dy, 0, 0)
                x11.XSync(display, 0)
        elif parts[0] == 'b' and len(parts) == 3:
            button = max(1, min(7, int(parts[1])))
            down = 1 if int(parts[2]) else 0
            xtst.XTestFakeButtonEvent(display, button, down, 0)
            x11.XSync(display, 0)
    except Exception as exc:
        print('Relative mouse input error:', type(exc).__name__, exc, flush=True)
PY
exec python3 -u "$HELPER"
`;
  const remoteProgram = String.raw`import json
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

def say_block(label, text):
    if not text:
        return
    print(label, flush=True)
    print(text[:2000].rstrip(), flush=True)

def run(cmd, timeout=60, cwd=None, env=None, quiet=False):
    if not quiet:
        say('$', ' '.join(cmd))
    try:
        p = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout, cwd=cwd, env=env)
        if not quiet:
            say('Command finished with exit code', p.returncode)
        if not quiet:
            say_block('Output:', p.stdout)
            say_block('Errors:', p.stderr)
        return p.returncode == 0, p.stdout, p.stderr
    except Exception as exc:
        if not quiet:
            say('Command failed:', type(exc).__name__, str(exc))
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
    say('Restarting graphics stack at', f'{GRAPHICS_WIDTH}x{GRAPHICS_HEIGHT}')
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
            say('Warning: could not remove display lock', path, type(exc).__name__, str(exc))

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
        say('Error: Xvfb display did not become ready')
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
    say('Graphics stack is ready at', f'{GRAPHICS_WIDTH}x{GRAPHICS_HEIGHT}')

def write_jwmrc(path):
    with open(path, 'w') as f:
        f.write(textwrap.dedent('''\
            <?xml version="1.0"?>
            <JWM>
              <RootMenu onroot="123">
                <Restart label="Restart JWM"/>
                <Exit label="Exit JWM" confirm="false"/>
              </RootMenu>
              <Group>
                <Name>Navigator</Name>
                <Class>firefox</Class>
                <Class>Firefox</Class>
                <Option>maximized</Option>
                <Option>noborder</Option>
                <Option>notitle</Option>
              </Group>
              <Group>
                <Name>PrismLauncher</Name>
                <Class>PrismLauncher</Class>
                <Class>prismlauncher</Class>
                <Option>maximized</Option>
              </Group>
              <Group>
                <Option>tiled</Option>
                <Option>aerosnap</Option>
              </Group>
              <WindowStyle decorations="motif">
                <Font>Sans-10</Font>
                <Width>1</Width>
                <Height>20</Height>
                <Corner>0</Corner>
                <Foreground>#81b69f</Foreground>
                <Background>#001e14</Background>
                <Outline>#001e14</Outline>
                <Active>
                  <Foreground>#daffec</Foreground>
                  <Background>#002c1f</Background>
                  <Outline>#002c1f</Outline>
                </Active>
              </WindowStyle>
              <TitleButtonOrder>tx</TitleButtonOrder>
              <Tray autohide="true" x="0" y="-1" height="1"></Tray>
              <FocusModel>click</FocusModel>
              <MoveMode>opaque</MoveMode>
              <ResizeMode>opaque</ResizeMode>
              <DoubleClickSpeed>400</DoubleClickSpeed>
              <DoubleClickDelta>2</DoubleClickDelta>
              <Mouse context="title" button="1">move</Mouse>
              <Mouse context="title" button="11">maximize</Mouse>
              <Mouse context="close" button="1">close</Mouse>
              <Key key="A-Tab">nextstacked</Key>
              <Key key="A-F4">close</Key>
            </JWM>
        '''))

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

say('Starting desktop services')
restart_graphics_stack()
try:
    subprocess.run(['xsetroot', '-solid', '#00120a'], timeout=5)
except Exception:
    pass

jwm = extract_jwm()
if not jwm:
    say('Error: could not install the window manager')
    sys.exit(2)
say('Window manager is ready:', jwm)

jwmrc = os.path.join(tempfile.mkdtemp(prefix='cod-jwmrc-'), 'jwmrc')
write_jwmrc(jwmrc)
env = os.environ.copy()
env['PATH'] = os.path.dirname(jwm) + ':' + BIN_DIR + ':' + env.get('PATH', '')
wm = subprocess.Popen([jwm, '-f', jwmrc], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
time.sleep(1)
if wm.poll() is not None:
    say('Error: window manager exited during startup with code', wm.returncode)
    sys.exit(3)
say('Desktop is ready')
threading.Thread(target=watch_windows, daemon=True).start()

while True:
    if wm.poll() is not None:
        say('Error: window manager stopped with code', wm.returncode)
        sys.exit(4)
    time.sleep(5)
`;

  let { uid, appWindow, session }: Props = $props();
  let loading = $state(true);
  let latestDisplaySize: ScreenSize | undefined;
  let displayResizeTimer = 0;
  let terminalOpen = $state(false);
  let activeTerminalTab = $state('tasks');
  let terminals = $state<TerminalWindowModel[]>([]);
  let remoteWindows = $state<RemoteWindow[]>([]);
  let firefoxInstalled = $state(false);
  let prismInstalled = $state(false);
  let relativeMouseEnabled = $state(false);
  let showRelativeMouseHint = $state(false);
  let relativeMouseHintSeen = $state(false);
  let vncScreen: HTMLElement | undefined;
  let relativeMouseReady = false;
  let relativeMouseDx = 0;
  let relativeMouseDy = 0;
  let relativeMouseFlushTimer = 0;
  let relativeMouseHintTimer = 0;
  const taskOutputHandlers = new Map<string, NonNullable<TaskTerminalOptions['onOutput']>>();

  const openTerminalApp = (tab = activeTerminalTab) => {
    activeTerminalTab = tab;
    terminalOpen = true;
    appWindow.setTimeout(focusTerminalApp);
  };

  const closeTerminalApp = () => {
    terminalOpen = false;
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

  const getWindowDisplaySize = (): ScreenSize => ({
    width: Math.max(1, Math.round(appWindow.innerWidth)),
    height: Math.max(1, Math.round(appWindow.innerHeight)),
  });

  const observeDisplaySize = (onResize: (size: ScreenSize) => void) => {
    let timer = 0;
    let lastSize: ScreenSize | undefined;

    const emitResize = () => {
      timer = 0;
      const size = getWindowDisplaySize();
      if (lastSize?.width === size.width && lastSize.height === size.height) return;
      lastSize = size;
      onResize(size);
    };

    const scheduleResize = () => {
      if (timer) appWindow.clearTimeout(timer);
      timer = appWindow.setTimeout(emitResize);
    };

    appWindow.addEventListener('resize', scheduleResize);
    scheduleResize();

    return () => {
      appWindow.removeEventListener('resize', scheduleResize);
      if (timer) appWindow.clearTimeout(timer);
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

  const flushRelativeMouse = () => {
    relativeMouseFlushTimer = 0;
    const dx = Math.round(relativeMouseDx);
    const dy = Math.round(relativeMouseDy);
    relativeMouseDx = 0;
    relativeMouseDy = 0;
    if (!relativeMouseReady) return;
    if (!dx && !dy) return;
    session.input(RELATIVE_MOUSE_ID, `m ${dx} ${dy}\n`);
  };

  const queueRelativeMouse = (dx: number, dy: number) => {
    relativeMouseDx += dx;
    relativeMouseDy += dy;
    if (!relativeMouseFlushTimer) {
      relativeMouseFlushTimer = appWindow.setTimeout(flushRelativeMouse, 8);
    }
  };

  const remoteButtonForMouseEvent = (event: MouseEvent) => {
    if (event.button === 0) return 1;
    if (event.button === 1) return 2;
    if (event.button === 2) return 3;
    return undefined;
  };

  const isRelativeMouseCandidateWindow = (window: RemoteWindow) => {
    const title = window.title.toLowerCase();
    return title.includes('minecraft');
  };

  const showRelativeMouseToast = () => {
    if (relativeMouseHintSeen || relativeMouseEnabled) return;
    relativeMouseHintSeen = true;
    showRelativeMouseHint = true;
    if (relativeMouseHintTimer) appWindow.clearTimeout(relativeMouseHintTimer);
    relativeMouseHintTimer = appWindow.setTimeout(() => {
      relativeMouseHintTimer = 0;
      showRelativeMouseHint = false;
    }, 6500);
  };

  const attachRelativeMouse = (screen: HTMLElement) => {
    const document = appWindow.document;

    const hasPointerLock = () => document.pointerLockElement === screen;

    const updatePointerLockState = () => {
      if (!hasPointerLock() && relativeMouseFlushTimer) {
        appWindow.clearTimeout(relativeMouseFlushTimer);
        flushRelativeMouse();
      }
      relativeMouseEnabled = hasPointerLock();
    };

    const requestPointerLock = (event: MouseEvent) => {
      if (!event.ctrlKey || event.button !== 0 || hasPointerLock()) return;
      screen.requestPointerLock();
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!hasPointerLock()) return;
      queueRelativeMouse(event.movementX, event.movementY);
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handleMouseButton = (event: MouseEvent) => {
      if (!hasPointerLock()) return;
      const button = remoteButtonForMouseEvent(event);
      if (button) session.input(RELATIVE_MOUSE_ID, `b ${button} ${event.type === 'mousedown' ? 1 : 0}\n`);
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!hasPointerLock()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    screen.addEventListener('mousedown', requestPointerLock, { capture: true });
    document.addEventListener('mousemove', handleMouseMove, { capture: true });
    document.addEventListener('pointermove', handleMouseMove, { capture: true });
    document.addEventListener('mousedown', handleMouseButton, { capture: true });
    document.addEventListener('mouseup', handleMouseButton, { capture: true });
    document.addEventListener('contextmenu', handleContextMenu, { capture: true });
    document.addEventListener('pointerlockchange', updatePointerLockState);

    return () => {
      screen.removeEventListener('mousedown', requestPointerLock, { capture: true });
      document.removeEventListener('mousemove', handleMouseMove, { capture: true });
      document.removeEventListener('pointermove', handleMouseMove, { capture: true });
      document.removeEventListener('mousedown', handleMouseButton, { capture: true });
      document.removeEventListener('mouseup', handleMouseButton, { capture: true });
      document.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      document.removeEventListener('pointerlockchange', updatePointerLockState);
      if (relativeMouseFlushTimer) appWindow.clearTimeout(relativeMouseFlushTimer);
      relativeMouseFlushTimer = 0;
      relativeMouseEnabled = false;
    };
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

  const resizeDisplay = (size: ScreenSize) => {
    const width = Math.min(size.width, REMOTE_DISPLAY_MAX_WIDTH);
    const height = Math.min(size.height, REMOTE_DISPLAY_MAX_HEIGHT);
    latestDisplaySize = { width, height };

    if (displayResizeTimer) appWindow.clearTimeout(displayResizeTimer);
    displayResizeTimer = appWindow.setTimeout(() => {
      displayResizeTimer = 0;
      const target = latestDisplaySize;
      if (!target) return;
      const command = `set -euo pipefail
WIDTH=${target.width}
HEIGHT=${target.height}
MODE="\${WIDTH}x\${HEIGHT}"
MODEL="$(gtf "$WIDTH" "$HEIGHT" 60 | sed -n -e 's/^.*"  //p')"
for _ in $(seq 1 1200); do
  if xdpyinfo -display :99 >/dev/null 2>&1 && xrandr -d :99 --query >/dev/null 2>&1; then
    xrandr -d :99 --newmode "$MODE" $MODEL >/dev/null 2>&1 || true
    xrandr -d :99 --addmode screen "$MODE" >/dev/null 2>&1 || true
    if xrandr -d :99 --output screen --mode "$MODE" >/dev/null 2>&1; then
      echo "Display resized to $MODE"
      exit 0
    fi
  fi
  sleep 0.5
done
xdpyinfo -display :99 >/dev/null
xrandr -d :99 --query >/dev/null
for _ in $(seq 1 10); do
  xrandr -d :99 --newmode "$MODE" $MODEL || true
  xrandr -d :99 --addmode screen "$MODE" || true
  if xrandr -d :99 --output screen --mode "$MODE"; then
    echo "Display resized to $MODE"
    break
  fi
  sleep 0.5
done
xrandr -d :99 --output screen --mode "$MODE" >/dev/null
`;
      startTaskTerminal({
        id: `task-display-resize-${Date.now()}`,
        title: `Resize display to ${target.width}x${target.height}`,
        command,
      });
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
      if (orderedWindows.some(isRelativeMouseCandidateWindow)) showRelativeMouseToast();
    } catch (error) {
      console.warn('[wm] failed to parse windows', error, line);
    }
  };

  const transferDesktop = () => {
    return session.transfer({
      'main.py': remoteProgram,
    });
  };

  const spawnDesktop = (onDesktopWindowsReady: () => void) => {
    const command = 'set -e\nsource "./.pyvenv311/bin/activate"\npython -B "$MAIN_FILE"';

    startTaskTerminal({
      id: 'task-desktop',
      title: 'Starting desktop',
      command,
      args: ['-i', '-c', command],
      type: 'echopty',
      env: {
        MAIN_FILE: 'main.py',
        DEBUG_MODE: 0,
      },
      track: false,
      onOutput: (_stream, text) => {
        for (const line of text.split('\n')) {
          if (line.startsWith(REMOTE_WINDOWS)) updateRemoteWindows(line);
          if (line.trim() === 'COD_WINDOWS []') onDesktopWindowsReady();
        }
      },
    });
  };

  const spawnRelativeMouse = () => {
    relativeMouseReady = false;
    startTaskTerminal({
      id: RELATIVE_MOUSE_ID,
      title: 'Relative mouse helper',
      command: relativeMouseCommand,
      args: ['-lc', relativeMouseCommand],
      type: 'echopty',
      track: false,
      onOutput: (_stream, text) => {
        if (text.includes('Relative mouse helper ready')) relativeMouseReady = true;
      },
    });
  };

  const startVnc = async (screen: HTMLElement) => {
    const url = `wss://scalinghub.codehs.com/user/${uid}/graphics`;
    let resolveDesktopWindowsReady: () => void = () => {};
    const desktopWindowsReady = new Promise<void>((resolve) => {
      resolveDesktopWindowsReady = resolve;
    });

    observeCanvasLogicalSize(screen);

    session.setOutputHandler((stream, data, id) => {
      const text = String(data ?? '');
      if (id && terminals.some((terminal) => terminal.id === id)) {
        appendTerminal(id, stream, text);
      }

      if (id) taskOutputHandlers.get(id)?.(stream, text);
      if (stream === 'stderr') console.warn('[spawn]', text);
    });

    observeDisplaySize(resizeDisplay);
    await transferDesktop();
    spawnDesktop(resolveDesktopWindowsReady);
    startTaskTerminal({
      id: 'task-firefox-install',
      title: 'Installing Firefox',
      command: firefoxInstallCommand,
      onSuccess: () => {
        firefoxInstalled = true;
        launchFirefox();
      },
    });
    startTaskTerminal({
      id: 'task-prism-install',
      title: 'Installing Prism Launcher',
      command: prismInstallCommand,
      onSuccess: () => {
        prismInstalled = true;
      },
    });
    await loadScript(appWindow.document, NOVNC_SCRIPT_URL);
    if (!appWindow.RFB) throw new Error('noVNC RFB global did not load');

    await desktopWindowsReady;
    spawnRelativeMouse();
    connectRfb(screen, url, () => {
      loading = false;
      syncCanvasLogicalSize(screen);
    });
  };

  const attachVnc: Attachment<HTMLElement> = (screen) => {
    vncScreen = screen;
    const detachRelativeMouse = attachRelativeMouse(screen);
    void startVnc(screen);

    return () => {
      detachRelativeMouse();
      if (relativeMouseHintTimer) appWindow.clearTimeout(relativeMouseHintTimer);
      relativeMouseHintTimer = 0;
      showRelativeMouseHint = false;
      vncScreen = undefined;
    };
  };

  const focusVncScreen = () => {
    const canvas = vncScreen?.querySelector('canvas');
    if (canvas instanceof HTMLCanvasElement) canvas.focus({ preventScroll: true });
  };

  const focusTerminalApp = () => {
    const terminal = appWindow.document.querySelector<HTMLElement>(
      '[data-terminal-app]',
    );
    terminal?.focus({ preventScroll: true });
  };

  const shellsCount = () => terminals.filter((terminal) => terminal.kind === 'terminal').length;

  const hasRemoteWindowNamed = (name: string) =>
    remoteWindows.some((window) => window.title.toLowerCase().includes(name));

  const launchFirefox = () => {
    if (!firefoxInstalled) return;
    startTaskTerminal({
      id: `task-firefox-launch-${Date.now()}`,
      title: 'Launching Firefox',
      command: `set -euo pipefail
BROWSER="$HOME/.local/firefox/firefox"
for _ in $(seq 1 1200); do
  if xdpyinfo -display :99 >/dev/null 2>&1 && xprop -root _NET_SUPPORTING_WM_CHECK >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
[ -x "$BROWSER" ]
xdpyinfo -display :99 >/dev/null
xprop -root _NET_SUPPORTING_WM_CHECK >/dev/null
"$BROWSER" about:blank`,
    });
  };

  const launchPrism = () => {
    if (!prismInstalled) return;
    startTaskTerminal({
      id: `task-prism-launch-${Date.now()}`,
      title: 'Launching Prism Launcher',
      command: `set -euo pipefail
PRISM="$HOME/.local/bin/prismlauncher"
RUNTIME="$HOME/.local/run"
mkdir -p "$RUNTIME"
chmod 700 "$RUNTIME"
export DISPLAY=:99
export XDG_RUNTIME_DIR="$RUNTIME"
export NO_AT_BRIDGE=1
export GTK_A11Y=none
export GTK_MODULES=
export QT_XCB_GL_INTEGRATION="\${QT_XCB_GL_INTEGRATION:-none}"
export QT_LOGGING_RULES="\${QT_LOGGING_RULES:-qt.qpa.*=true}"
export LIBGL_ALWAYS_SOFTWARE="\${LIBGL_ALWAYS_SOFTWARE:-1}"
export MESA_LOADER_DRIVER_OVERRIDE="\${MESA_LOADER_DRIVER_OVERRIDE:-llvmpipe}"
for _ in $(seq 1 1200); do
  if xdpyinfo -display :99 >/dev/null 2>&1 && xprop -root _NET_SUPPORTING_WM_CHECK >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
[ -x "$PRISM" ]
xdpyinfo -display :99 >/dev/null
xprop -root _NET_SUPPORTING_WM_CHECK >/dev/null
"$PRISM" \${PRISM_ARGS:-}`,
    });
  };

  const launchTerminal = () => {

    const id = `terminal-${Date.now()}`;
    terminals = [
      ...terminals,
      {
        id,
        title: `Bash ${shellsCount() + 1}`,
        kind: 'terminal',
        running: true,
        started: true,
        failed: false,
        collapsed: false,
        lines: [],
      },
    ];
    activeTerminalTab = id;
    openTerminalApp(id);

    session.spawnCommand(id, 'exec bash -l', {
      type: 'echopty',
      args: ['-l'],
      untracked: true,
    });
  };

  const focusRemoteWindow = (window: RemoteWindow) => {
    if (session) {
      const windowId = JSON.stringify(window.id);
      startTaskTerminal({
        id: `task-focus-${Date.now()}`,
        title: `Focus ${window.title}`,
        command: `python -B - <<'PY'
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
PY`,
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
            collapsed: true,
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
    args,
    env,
    type,
    track = true,
    onOutput,
    onSuccess,
    onFailure,
  }: TaskTerminalOptions) => {
    if (terminals.some((terminal) => terminal.id === id)) {
      throw new Error(`cannot start ${id}: terminal already exists`);
    }
    const marker = `COD_TASK_EXIT ${id} `;
    const wrappedCommand = `set +e\n(\n${command}\n)\ncode=$?\necho "${marker}$code"\nexit 0`;
    const spawnCommand = track ? wrappedCommand : command;

    terminals = [
      ...terminals,
      {
        id,
        title,
        kind: 'task',
        running: true,
        started: true,
        failed: false,
        collapsed: true,
        lines: [],
      },
    ];
    if (onOutput) taskOutputHandlers.set(id, onOutput);

    let result: Promise<void> | undefined;
    try {
      result = session.spawnCommand(id, spawnCommand, {
        type: type ?? 'echopty',
        args: args ?? ['-lc', spawnCommand],
        env,
        untracked: !track,
        resolveOnOutput: (text) => text.includes(`${marker}0`),
        rejectOnOutput: (text) => {
          const match = text.match(new RegExp(`${marker}(\\d+)`));
          if (!match || match[1] === '0') return undefined;
          return new Error(`${title} exited with code ${match[1]}`);
        },
      });
    } catch (error) {
      taskOutputHandlers.delete(id);
      const spawnError = error instanceof Error ? error : new Error(String(error));
      markTerminalFinished(id, true, `\nTask failed to start: ${spawnError.message}\n`);
      onFailure?.(spawnError);
      return;
    }

    result
      ?.then(() => {
        taskOutputHandlers.delete(id);
        markTerminalFinished(id, false, '\nTask completed successfully.\n');
        onSuccess?.();
      })
      .catch((error: Error) => {
        taskOutputHandlers.delete(id);
        markTerminalFinished(id, true, `\nTask failed: ${error.message}\n`);
        onFailure?.(error);
      });
  };

  const selectTerminalTab = (id: string) => {
    activeTerminalTab = id;
    openTerminalApp(id);
  };

  const toggleTask = (id: string) => {
    terminals = terminals.map((terminal) =>
      terminal.id === id
        ? {
            ...terminal,
            collapsed: !terminal.collapsed,
          }
        : terminal,
    );
  };

  const sendTerminalInput = (id: string, input: string) => {
    session?.input(id, input);
  };

</script>

<div class="screen" {@attach attachVnc}></div>

{#if showRelativeMouseHint || relativeMouseEnabled}
  <div class:active={relativeMouseEnabled} class="mouse-lock-hint">
    {relativeMouseEnabled
      ? 'Relative mouse active. Press Esc to release.'
      : 'Game detected. Ctrl+click the desktop for relative mouse.'}
  </div>
{/if}

<TerminalWindow
  {terminals}
  open={terminalOpen}
  activeTab={activeTerminalTab}
  onClose={closeTerminalApp}
  onSelectTab={selectTerminalTab}
  onToggleTask={toggleTask}
  onNewTerminal={launchTerminal}
  onInput={sendTerminalInput}
/>

<div class:force-expand={loading} class="bar-anchor">
  <nav class="bar" aria-label="Open windows">
    {#each remoteWindows as window (window.id)}
      <button
        class="app-entry alive m3-layer"
        type="button"
        title={window.title}
        onclick={() => focusRemoteWindow(window)}
      >
        <span>{window.title}</span>
      </button>
    {/each}
    {#if firefoxInstalled && !hasRemoteWindowNamed('firefox')}
      <button
        class="app-entry m3-layer"
        type="button"
        onclick={launchFirefox}
      >
        <span>Launch Firefox</span>
      </button>
    {/if}
    {#if prismInstalled && !hasRemoteWindowNamed('prism')}
      <button
        class="app-entry m3-layer"
        type="button"
        onclick={launchPrism}
      >
        <span>Launch Prism</span>
      </button>
    {/if}
    <button
      class="app-entry m3-layer"
      class:alive={terminalOpen || terminals.length > 0}
      type="button"
      title="Terminal"
      onclick={() => openTerminalApp()}
    >
      <span>Terminal</span>
    </button>
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

  .mouse-lock-hint {
    position: fixed;
    z-index: 120;
    top: 0.75rem;
    left: 50%;
    max-width: calc(100vw - 1.5rem);
    border-radius: 999px;
    padding: 0.45rem 0.75rem;
    background: color-mix(in srgb, var(--m3c-surface-container-highest) 88%, transparent);
    color: var(--m3c-on-surface);
    font-size: 0.8125rem;
    font-weight: 650;
    opacity: 0.9;
    pointer-events: none;
    translate: -50% 0;
    animation: mouse-lock-hint-in 180ms ease-out;
    box-shadow: 0 0.375rem 1.5rem rgb(0 0 0 / 0.18);

    &.active {
      background: var(--m3c-primary-container);
      color: var(--m3c-on-primary-container);
      opacity: 1;
    }
  }

  @keyframes mouse-lock-hint-in {
    from {
      opacity: 0;
      transform: translateY(-0.35rem);
    }

    to {
      opacity: 0.9;
      transform: translateY(0);
    }
  }

  .bar-anchor {
    display: contents;
    --transition: 220ms cubic-bezier(0.2, 0, 0, 1);
  }

  .bar {
    position: fixed;
    z-index: 100;
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
      bottom: 0.1875rem;
      left: 50%;
      width: 2.75rem;
      height: 0.25rem;
      border-radius: 999px;
      background: var(--m3c-primary-container);
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
    border-radius: 0.5rem;
    padding: 0 0.625rem;
    background: var(--m3c-surface-container-low);
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
      width: 0.25rem;
      height: 0.25rem;
      border-radius: 999px;
      background: currentColor;
      content: '';
      opacity: 0.75;
      translate: -50% 0;
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
    z-index: 60;
    inset: 0;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 1rem;
    background: var(--m3c-surface-container-lowest);
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
