import './preview.css';
import './style.css';
import { mountCube } from './main.ts';

const root = document.querySelector<HTMLElement>('[data-cube-app]')!;
const language = document.querySelector<HTMLSelectElement>('[data-preview-language]')!;
const theme = document.querySelector<HTMLSelectElement>('[data-preview-theme]')!;
let destroy = mountCube(root, { language: 'en' });
language.addEventListener('change', () => {
  destroy();
  const selected = language.value === 'zh-CN' ? 'zh-CN' : 'en';
  document.documentElement.lang = selected;
  destroy = mountCube(root, { language: selected });
});
theme.addEventListener('change', () => {
  document.documentElement.style.colorScheme = theme.value === 'auto' ? 'light dark' : theme.value;
});
window.addEventListener('pagehide', () => destroy());
window.addEventListener('pageshow', event => {
  if (event.persisted) destroy = mountCube(root, { language: language.value === 'zh-CN' ? 'zh-CN' : 'en' });
});
