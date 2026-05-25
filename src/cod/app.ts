import css1 from '../assets/common.css?inline';
import css2 from './app.css?inline';
import { mount as mountSvelte } from 'svelte';
import App from './App.svelte';

export const mount = (uid: string, appWindow: Window) => {
  const { document } = appWindow;
  document.title = 'New Tab'; // do not edit

  const style = document.createElement('style');
  style.textContent = css1 + css2;
  document.head.appendChild(style);

  mountSvelte(App, {
    target: document.body,
    props: { uid, appWindow },
  });
};
