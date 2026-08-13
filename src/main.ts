import './styles.css';
import { mountGamePage } from './pages/GamePage';
import { mountPreviewPage } from './pages/PreviewPage';
import { mountStartPage } from './pages/StartPage';

const app = document.getElementById('app')!;
let dispose: (() => void) | null = null;

function render(): void {
  dispose?.();
  const hash = window.location.hash;
  if (hash === '#/game') dispose = mountGamePage(app);
  else if (hash === '#/preview') dispose = mountPreviewPage(app);
  else dispose = mountStartPage(app);
}

window.addEventListener('hashchange', render);
render();
