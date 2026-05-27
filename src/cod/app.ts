import css1 from '../assets/common.css?inline';
import css2 from './app.css?inline';
import { mount as mountSvelte } from 'svelte';
import App from './App.svelte';
import type { SpawnSession } from './spawn';

const addLayerRipples = (appWindow: Window) => {
  const ownerWindow = appWindow as Window & typeof globalThis;
  const { document, HTMLButtonElement, HTMLInputElement, HTMLLabelElement } = ownerWindow;
  const activePointerRipples: (() => void)[] = [];
  const activeKeyboardRipples: (() => void)[] = [];

  const isEnabled = (node: Element) => {
    if (node instanceof HTMLButtonElement && node.disabled) return false;
    if (node instanceof HTMLInputElement && node.disabled) return false;
    if (node instanceof HTMLLabelElement) {
      const control = node.control;
      if (control instanceof HTMLInputElement && control.disabled) return false;
    }
    return true;
  };

  const createRippleSvg = (
    node: Element,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    if (appWindow.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const size = Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) * 2.5;
    const speed = Math.max(Math.min(Math.log(size) * 50, 600), 200);
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
    gradient.id = `ripple-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    for (const { offset, opacity } of [
      { offset: '0%', opacity: '0.12' },
      { offset: '70%', opacity: '0.12' },
      { offset: '100%', opacity: '0' },
    ]) {
      const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', 'currentColor');
      stop.setAttribute('stop-opacity', opacity);
      gradient.appendChild(stop);
    }

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', `${x}`);
    circle.setAttribute('cy', `${y}`);
    circle.setAttribute('r', '0');
    circle.setAttribute('fill', `url(#${gradient.id})`);

    const expand = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    expand.setAttribute('attributeName', 'r');
    expand.setAttribute('from', '0');
    expand.setAttribute('to', `${size / 2}`);
    expand.setAttribute('dur', `${speed}ms`);
    expand.setAttribute('fill', 'freeze');
    expand.setAttribute('calcMode', 'spline');
    expand.setAttribute('keySplines', '0.4 0, 0.2 1');
    circle.appendChild(expand);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('active-ripple');
    svg.style.cssText = [
      'position: absolute',
      'inset: 0',
      'width: 100%',
      'height: 100%',
      'overflow: hidden',
      'border-radius: inherit',
      'pointer-events: none',
    ].join(';');
    svg.appendChild(gradient);
    svg.appendChild(circle);
    node.appendChild(svg);

    return () => {
      const fade = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
      fade.setAttribute('attributeName', 'opacity');
      fade.setAttribute('from', '1');
      fade.setAttribute('to', '0');
      fade.setAttribute('dur', '800ms');
      fade.setAttribute('fill', 'freeze');
      fade.setAttribute('calcMode', 'spline');
      fade.setAttribute('keySplines', '0.4 0, 0.2 1');
      circle.appendChild(fade);
      fade.beginElement();
      appWindow.setTimeout(() => svg.remove(), 800);
    };
  };

  document.documentElement.classList.add('js');

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const layer = (event.target as Element | null)?.closest('.m3-layer');
    if (!layer || !isEnabled(layer)) return;

    const rect = layer.getBoundingClientRect();
    const cancel = createRippleSvg(
      layer,
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
    );
    if (cancel) activePointerRipples.push(cancel);
  });

  const cancelPointerRipples = () => {
    for (const cancel of activePointerRipples) cancel();
    activePointerRipples.length = 0;
  };
  document.addEventListener('pointerup', cancelPointerRipples);
  document.addEventListener('dragend', cancelPointerRipples);

  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const target = event.target as Element | null;
    const layer = target?.closest('.m3-layer');
    if (!layer || !isEnabled(layer)) return;

    const isActivate = event.key === 'Enter' || (event.key === ' ' && layer.tagName === 'BUTTON');
    if (!isActivate) return;

    const rect = layer.getBoundingClientRect();
    const cancel = createRippleSvg(layer, rect.width / 2, rect.height / 2, rect.width, rect.height);
    if (cancel) activeKeyboardRipples.push(cancel);
  });

  document.addEventListener('keyup', () => {
    for (const cancel of activeKeyboardRipples) cancel();
    activeKeyboardRipples.length = 0;
  });
};

export const mount = (uid: string, appWindow: Window, session: SpawnSession) => {
  const { document } = appWindow;
  document.title = 'New Tab'; // do not edit

  const style = document.createElement('style');
  style.textContent = css1 + css2;
  document.head.appendChild(style);
  addLayerRipples(appWindow);

  mountSvelte(App, {
    target: document.body,
    props: { uid, appWindow, session },
  });
};
