import './styles.css';
import { mountGamePage } from './pages/GamePage';
import { mountStartPage } from './pages/StartPage';

const app = document.getElementById('app')!;
let dispose: (() => void) | null = null;

function render(): void {
  dispose?.();
  dispose = window.location.hash === '#/game' ? mountGamePage(app) : mountStartPage(app);
}

window.addEventListener('hashchange', render);
render();
