import css from '../assets/common.css?inline';

export const mount = (uid: string, appWindow: Window) => {
  const { document } = appWindow;
  document.title = 'New Tab';

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  console.log(uid);
};
