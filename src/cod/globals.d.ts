type RfbClient = {
  disconnect: () => void;
  addEventListener: (type: string, cb: (event: Event) => void) => void;
  scaleViewport?: boolean;
  resizeSession?: boolean;
  clipViewport?: boolean;
  focusOnClick?: boolean;
};

interface Window {
  RFB?: new (target: HTMLElement, url: string, options?: Record<string, unknown>) => RfbClient;
}
