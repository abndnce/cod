type SpawnOutputStream = 'stdout' | 'stderr';

type SpawnOutputHandler = (
  stream: SpawnOutputStream,
  data: unknown,
  id?: string,
) => void;

type SpawnEventData = {
  id?: string;
  data?: unknown;
};

type SpawnExitData = {
  code?: number | null;
  exitCode?: number | null;
  status?: number | null;
  signal?: string | null;
};

type CodeHsSpawnRequest = {
  cmd: string;
  args: string[];
  id: string;
  options: {
    type: 'normal' | 'echopty';
    env?: Record<string, string | number>;
  };
};

type RunningSpawn = {
  output: string;
  resolve: () => void;
  reject: (error: Error) => void;
  resolveOnOutput: (text: string) => boolean;
  rejectOnOutput: (text: string) => Error | undefined;
};

type SpawnTrackingOptions = {
  resolveOnOutput?: (text: string) => boolean;
  rejectOnOutput?: (text: string) => Error | undefined;
};

type SpawnCommandOptions = SpawnTrackingOptions & {
  args?: string[];
  env?: Record<string, string | number>;
  type?: CodeHsSpawnRequest['options']['type'];
  untracked?: boolean;
};

type CodeHsSocketHandlers = {
  onStdout?: (data: SpawnEventData) => void;
  onStderr?: (data: SpawnEventData) => void;
  onExit?: (data: SpawnEventData) => void;
  onTransferComplete?: (data: SpawnEventData) => void;
};

const createSpawnTracker = (onOutput: SpawnOutputHandler) => {
  const runningSpawns = new Map<string, RunningSpawn>();

  return {
    start(id: string, options: SpawnTrackingOptions = {}) {
      if (runningSpawns.has(id)) {
        throw new Error(`spawn id already running: ${id}`);
      }

      return new Promise<void>((resolve, reject) => {
        runningSpawns.set(id, {
          output: '',
          resolve,
          reject,
          resolveOnOutput: options.resolveOnOutput ?? (() => false),
          rejectOnOutput: options.rejectOnOutput ?? (() => undefined),
        });
      });
    },
    handleOutput(stream: SpawnOutputStream, data: SpawnEventData) {
      const eventId = data?.id;
      const runningSpawn = eventId ? runningSpawns.get(eventId) : undefined;

      if (!runningSpawn) {
        onOutput(stream, data?.data ?? data, eventId);
        return;
      }

      const text = String(data?.data ?? '');
      runningSpawn.output += text;
      onOutput(stream, text, eventId);

      const error = runningSpawn.rejectOnOutput(text);
      if (error) {
        runningSpawns.delete(eventId!);
        runningSpawn.reject(error);
        return;
      }

      if (runningSpawn.resolveOnOutput(text)) {
        runningSpawns.delete(eventId!);
        runningSpawn.resolve();
      }
    },
    handleExit(data: SpawnEventData) {
      const eventId = data?.id;
      const runningSpawn = eventId ? runningSpawns.get(eventId) : undefined;
      if (!eventId || !runningSpawn) return;

      runningSpawns.delete(eventId);
      const exitData = data?.data as SpawnExitData | number | null | undefined;
      const code = typeof exitData === 'number'
        ? exitData
        : exitData?.code ?? exitData?.exitCode ?? exitData?.status;
      const signal = typeof exitData === 'number' ? null : exitData?.signal;

      if (code === 0 && !signal) {
        runningSpawn.resolve();
        return;
      }

      runningSpawn.reject(
        new Error(
          `${eventId} exited with code ${code ?? 'unknown'} signal ${signal ?? 'null'}: ${runningSpawn.output}`,
        ),
      );
    },
  };
};

const connectCodeHsSocket = (
  uid: string,
  appWindow: Window,
  handlers: CodeHsSocketHandlers,
) => {
  const socket = new WebSocket(
    `wss://scalinghub.codehs.com/user/${uid}/spawn/?watch=true&EIO=3&transport=websocket`,
  );
  let open = false;
  let keepaliveSize = { width: 1100, height: 800 };
  let resolveReady: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const sendEvent = (event: string, data: unknown) => {
    if (!open || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`spawn socket is not open; cannot send ${event}`);
    }
    socket.send(`42${JSON.stringify([event, data])}`);
  };

  appWindow.setInterval(() => {
    if (open && socket.readyState === WebSocket.OPEN) {
      sendEvent('keepalive', null);
    }
  }, 20_000);

  socket.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;

    if (event.data.startsWith('0')) {
      socket.send('40');
      return;
    }

    if (event.data === '40') {
      open = true;
      resolveReady();
      return;
    }

    if (event.data.startsWith('42')) {
      const [eventName, data] = JSON.parse(event.data.slice(2)) as [
        string,
        SpawnEventData,
      ];

      if (eventName === 'stdout') {
        handlers.onStdout?.(data);
      } else if (eventName === 'stderr') {
        handlers.onStderr?.(data);
      } else if (eventName === 'exit') {
        handlers.onExit?.(data);
      } else if (eventName === 'transferComplete') {
        handlers.onTransferComplete?.(data);
      }
      return;
    }

    if (event.data === '2') {
      socket.send('3');
    }
  });

  socket.addEventListener('close', () => {
    open = false;
  });

  return {
    ready,
    spawn(request: CodeHsSpawnRequest) {
      sendEvent('spawn', request);
    },
    kill(id: string) {
      sendEvent('kill', { id });
    },
    input(id: string, data: string) {
      sendEvent('stdin', { id, data });
    },
    resize(width: number, height: number) {
      keepaliveSize = {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };
      sendEvent('resize', { w: keepaliveSize.width, h: keepaliveSize.height });
    },
    transfer(files: Record<string, string>) {
      sendEvent('transfer', files);
    },
  };
};

export const createSession = (
  uid: string,
  appWindow: Window,
  onOutput: SpawnOutputHandler = () => {},
) => {
  let outputHandler = onOutput;
  const spawnTracker = createSpawnTracker((stream, data, id) => {
    outputHandler(stream, data, id);
  });
  const transferResolvers: Array<() => void> = [];
  const socket = connectCodeHsSocket(uid, appWindow, {
    onStdout: (data) => spawnTracker.handleOutput('stdout', data),
    onStderr: (data) => spawnTracker.handleOutput('stderr', data),
    onExit: (data) => spawnTracker.handleExit(data),
    onTransferComplete: () => transferResolvers.shift()?.(),
  });

  const spawnCommand = (
    id: string,
    command: string,
    options: SpawnCommandOptions = {},
  ) => {
    const result = options.untracked
      ? undefined
      : spawnTracker.start(id, options);

    socket.spawn({
      cmd: 'bash',
      args: options.args ?? ['-lc', command],
      id,
      options: {
        type: options.type ?? 'normal',
        env: options.env,
      },
    });

    return result;
  };

  return {
    ready: socket.ready,
    setOutputHandler(handler: SpawnOutputHandler) {
      outputHandler = handler;
    },
    spawnCommand,
    kill(id: string) {
      socket.kill(id);
    },
    input(id: string, data: string) {
      socket.input(id, data);
    },
    resize(width: number, height: number) {
      socket.resize(width, height);
    },
    transfer(files: Record<string, string>) {
      const result = new Promise<void>((resolve) => {
        transferResolvers.push(resolve);
      });
      socket.transfer(files);
      return result;
    },
  };
};

export type SpawnSession = ReturnType<typeof createSession>;
