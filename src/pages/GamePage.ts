import * as THREE from 'three';
import { TRACK_VERSION } from '../config';
import { Game, type GameOptions } from '../game/Game';
import { loadSettings } from '../storage/settings';
import { loadActiveTrack, saveActiveTrack } from '../storage/db';
import { buildTrack, generateCenterlinePoints } from '../track/generator';
import type { TrackMeta } from '../types';
import { randomSeed } from '../utils/random';

export function mountGamePage(root: HTMLElement): () => void {
  const container = document.createElement('div');
  container.className = 'game-root';
  root.appendChild(container);

  let game: Game | null = null;

  function start(): void {
    void (async () => {
      const settings = loadSettings();
      let pkg = await loadActiveTrack();
      if (!pkg) {
        const meta: TrackMeta = {
          id: crypto.randomUUID(),
          mode: settings.trackMode,
          seed: randomSeed(),
          createdAt: Date.now(),
          version: TRACK_VERSION,
        };
        const points = generateCenterlinePoints(meta);
        pkg = { meta, centerline: points.map((p) => ({ x: p.x, y: p.y, z: p.z })), glb: null };
        await saveActiveTrack(pkg);
      }
      const points = pkg.centerline.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const track = buildTrack(pkg.meta, points);
      const opts: GameOptions = {
        playerName: settings.playerName,
        carColor: settings.carColor,
        onBack: () => {
          game?.dispose();
          window.location.hash = '#/start';
        },
        onRestart: () => {
          game?.dispose();
          start();
        },
      };
      game = new Game(container, track, opts);
    })();
  }

  start();

  return () => {
    game?.dispose();
    root.removeChild(container);
  };
}
