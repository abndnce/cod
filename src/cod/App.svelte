<script lang="ts">
  import type { Attachment } from 'svelte/attachments';

  import cod from '../assets/cod-animation.webp';
  import { createSession } from './spawn';

  type ScreenSize = {
    width: number;
    height: number;
  };

  type Session = ReturnType<typeof createSession>;

  type Props = {
    uid: string;
    appWindow: Window;
  };

  const NOVNC_SCRIPT_URL = 'https://static1.codehs.com/lib/noVNC/noVNC.js';

  const probeProgram = String.raw`import os
import subprocess
import time

print("STAGE probe started", flush=True)
print("DISPLAY", os.environ.get("DISPLAY"), flush=True)

def run(label, cmd):
    try:
        out = subprocess.run(cmd, text=True, capture_output=True, timeout=10)
        print(label, "rc=", out.returncode, flush=True)
        for line in out.stdout.splitlines():
            if "dimensions:" in line:
                print(label, line.strip(), flush=True)
        if out.stdout:
            print(label, "stdout", out.stdout[:1200], flush=True)
        if out.stderr:
            print(label, "stderr", out.stderr[:1200], flush=True)
    except Exception as exc:
        print(label, "failed", repr(exc), flush=True)

run("XDPYINFO_INITIAL", ["xdpyinfo"])

for cmd in (["xsetroot", "-solid", "#253040"], ["xeyes"], ["xclock"], ["xcalc"]):
    try:
        print("START", " ".join(cmd), flush=True)
        subprocess.Popen(cmd)
    except Exception as exc:
        print("FAILED", " ".join(cmd), repr(exc), flush=True)

for i in range(30):
    if i in (2, 8, 16):
        run("XDPYINFO_POLL_%02d" % i, ["xdpyinfo"])
    time.sleep(10)
`;

  let { uid, appWindow }: Props = $props();
  let loading = $state(true);

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

    const connect = () => {
      const RFB = appWindow.RFB;
      if (!RFB) return;

      connected = false;

      const rfb = new RFB(screen, url, {});
      rfb.scaleViewport = false;
      rfb.resizeSession = false;
      rfb.clipViewport = true;
      rfb.focusOnClick = true;

      rfb.addEventListener('disconnect', (event) => {
        if (connected) {
          console.warn('[rfb] disconnected', event);
          return;
        }

        appWindow.setTimeout(connect, 1000);
      });

      rfb.addEventListener('credentialsrequired', (event) => {
        console.warn('[rfb] credentials required', event);
      });

      rfb.addEventListener('securityfailure', (event) => {
        console.warn('[rfb] security failure', event);
      });

      rfb.addEventListener('connect', () => {
        connected = true;
        onConnect();
      });
    };

    connect();
  };

  const restartGraphics = (
    session: Session,
    size: ScreenSize,
  ) => {
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    const command = [
      'set -eu',
      `WIDTH=${width}`,
      `HEIGHT=${height}`,
      'echo "restarting graphics stack at ${WIDTH}x${HEIGHT}"',
      'pkill -9 Xvfb || true',
      'pkill -9 x11vnc || true',
      'pkill -9 python3.8 || true',
      'pkill -9 python3 || true',
      'for i in $(seq 1 30); do',
      '  if ! pgrep Xvfb >/dev/null 2>&1 && ! pgrep x11vnc >/dev/null 2>&1 && ! pgrep python3.8 >/dev/null 2>&1 && ! pgrep python3 >/dev/null 2>&1; then',
      '    break',
      '  fi',
      '  sleep 0.1',
      'done',
      'rm -f /tmp/.X99-lock /tmp/.X11-unix/X99',
      'nohup /usr/bin/Xvfb :99 -screen 0 ${WIDTH}x${HEIGHT}x16 -ac +extension GLX +extension RANDR >/tmp/cod-xvfb.log 2>&1 &',
      'for i in $(seq 1 50); do',
      '  if xdpyinfo -display :99 >/tmp/cod-xdpyinfo.log 2>&1; then',
      '    break',
      '  fi',
      '  sleep 0.1',
      'done',
      'xdpyinfo -display :99 >/tmp/cod-xdpyinfo.log 2>&1',
      'nohup x11vnc -noxrecord -xrandr -noncache -display :99 -forever -rfbport 5900 >/tmp/cod-x11vnc.log 2>&1 &',
      'for i in $(seq 1 50); do',
      "  if timeout 1 bash -lc '</dev/tcp/127.0.0.1/5900' >/dev/null 2>&1; then",
      '    break',
      '  fi',
      '  sleep 0.1',
      'done',
      "timeout 1 bash -lc '</dev/tcp/127.0.0.1/5900' >/dev/null 2>&1",
      'cd /usr/local/websockify && nohup /usr/bin/python3.8 -m websockify 1337 :5900 >/tmp/cod-websockify.log 2>&1 &',
      'for i in $(seq 1 50); do',
      "  if timeout 1 bash -lc '</dev/tcp/127.0.0.1/1337' >/dev/null 2>&1; then",
      '    break',
      '  fi',
      '  sleep 0.1',
      'done',
      "timeout 1 bash -lc '</dev/tcp/127.0.0.1/1337' >/dev/null 2>&1",
      'echo "graphics stack ready"',
    ].join('\n');

    return session.spawnCommand('graphics-bootstrap', command, {
      resolveOnOutput: (text) => text.includes('graphics stack ready'),
    });
  };

  const transferProbe = (session: Session) => {
    return session.transfer({
      'main.py': probeProgram,
    });
  };

  const spawnProbe = (session: Session) => {
    const command = 'set -e\nsource "./.pyvenv311/bin/activate"\npython -B "$MAIN_FILE"';

    session.spawnCommand(
      'console',
      command,
      {
        args: ['-i', '-c', command],
        type: 'echopty',
        env: {
          MAIN_FILE: 'main.py',
          DEBUG_MODE: 0,
        },
        untracked: true,
      },
    );
  };

  const startVnc = async (screen: HTMLElement) => {
    const url = `wss://scalinghub.codehs.com/user/${uid}/graphics`;

    observeCanvasLogicalSize(screen);

    const session = createSession(uid, appWindow, (stream, data) => {
      if (stream === 'stderr') console.warn('[spawn]', data);
    });

    await session.ready;

    const targetSize = measureLogicalPixelSize(screen);
    await restartGraphics(session, targetSize);

    await transferProbe(session);
    spawnProbe(session);

    await loadScript(appWindow.document, NOVNC_SCRIPT_URL);
    if (!appWindow.RFB) throw new Error('noVNC RFB global did not load');

    connectRfb(screen, url, () => {
      loading = false;
      syncCanvasLogicalSize(screen);
    });
  };

  const attachVnc: Attachment<HTMLElement> = (screen) => {
    void startVnc(screen);
  };
</script>

<div class="screen" {@attach attachVnc}></div>
<img
  class:hidden={!loading}
  class="cod-loader"
  src={cod}
  alt="Loading Cod"
/>

<style>
  .screen {
    position: absolute;
    inset: 0;
    overflow: visible;

    :global(canvas) {
      max-width: none;
      max-height: none;
      object-fit: none;
    }
  }

  .cod-loader {
    position: absolute;
    inset: 0;
    margin: auto;
    width: min(50vw, 50vh, 24rem);
    height: auto;
    transition: opacity 100ms;

    &.hidden {
      visibility: hidden;
      opacity: 0;
    }
  }
</style>
