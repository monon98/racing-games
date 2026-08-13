import { describe, it } from 'vitest';
import { updateLapProgress } from '../src/game/lapProgress';
import { isWrongWay } from '../src/game/wrongWay';
import { randomPlayerName } from '../src/utils/random';
import { check } from './helpers';

describe('lap progress', () => {
  it('detects crossing, mid-lap, and backward movement', () => {
    const L = 1000;
    const cross = updateLapProgress(10, 990, L, 800);
    check('crossed line detected', cross.crossedLine && Math.abs(cross.completedDistance - 820) < 1e-6, JSON.stringify(cross));
    const mid = updateLapProgress(400, 300, L, 500);
    check('mid-lap no crossing', !mid.crossedLine && Math.abs(mid.completedDistance - 600) < 1e-6, JSON.stringify(mid));
    const back = updateLapProgress(300, 400, L, 600);
    check('backward no progress', !back.crossedLine && back.dS < 0 && Math.abs(back.completedDistance - 600) < 1e-6, JSON.stringify(back));
  });
});

describe('wrong-way detection', () => {
  it('requires backward heading plus forward motion; reversing is not wrong-way', () => {
    const fwd = { x: 0, y: 0, z: 1 };
    const bwd = { x: 0, y: 0, z: -1 };
    const tangent = { x: 0, y: 0, z: 1 };
    check('nose forward driving is not wrong-way', !isWrongWay(fwd, tangent, 5));
    check('nose forward reversing is not wrong-way', !isWrongWay(fwd, tangent, -5));
    check('nose backward driving forward is wrong-way', isWrongWay(bwd, tangent, 5));
    check('nose backward reversing is not wrong-way', !isWrongWay(bwd, tangent, -5));
    check('nose backward too slow is not wrong-way', !isWrongWay(bwd, tangent, 1));
  });
});

describe('default player name', () => {
  it('is 玩家 + 5 random alphanumeric chars', () => {
    for (let i = 0; i < 20; i++) {
      const name = randomPlayerName();
      check('player name format', /^玩家[A-Z0-9]{5}$/.test(name), name);
    }
  });
});
