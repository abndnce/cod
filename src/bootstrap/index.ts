import css1 from '../assets/common.css?inline';
import css2 from './bootstrap.css?inline';
import loader from './loader.svg';
import abundance from './abundance.svg';
import { mount } from '../cod/app';
import { createSession } from '../cod/spawn';

const uid = (Math.random() * 100000).toFixed(0);
const uidSpinup = fetch(
  `https://scalinghub.codehs.com/hub/api/spinup/${uid}/config/default`,
  {
    credentials: 'include',
  },
);

const style = document.createElement('style');
style.textContent = css1 + css2;
document.head.appendChild(style);

const button = document.createElement('button');
button.innerHTML = loader;
button.disabled = true;

const abndnce = document.createElement('a');
abndnce.innerHTML = `Made by <span>${abundance} Abundance</span>, the makers of <u>0K</u>`;
abndnce.href =
  'https://cdn.jsdelivr.net/gh/abndnce/b0k@main/jsdelivr/index.svg';
abndnce.target = '_blank';

document.body.replaceChildren(button, abndnce);

uidSpinup.then(async () => {
  const session = createSession(uid, window);
  await session.ready;

  button.disabled = false;
  button.onclick = () => {
    const appWindow = window.open('about:blank', '_blank');
    if (!appWindow) throw new Error('failed to open');

    mount(uid, appWindow, session);
  };
});
