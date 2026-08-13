import { describe, it } from 'vitest';
import * as CANNON from 'cannon-es';
import { CAR } from '../src/config';
import { buildTrack, findSafeSpawnIndex, generateCenterlinePoints, loopSelfIntersects } from '../src/track/generator';
import { buildTrackForMode, check, makeMeta } from './helpers';

function maxHeadingTurn(points: { x: number; z: number }[], tangents: { x: number; z: number }[]): number {
  let maxTurn = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const h0 = Math.atan2(tangents[i].x, tangents[i].z);
    const h1 = Math.atan2(tangents[j].x, tangents[j].z);
    let dh = h1 - h0;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    maxTurn = Math.max(maxTurn, Math.abs(dh));
  }
  return maxTurn;
}

describe('track generation', () => {
  it('simple track: smooth, self-intersection free, correctly sized', () => {
    const built = buildTrackForMode('simple');
    const points = built.points;
    check('centerline length 1200~2400', points.length > 1200 && points.length < 2400, String(points.length));
    check('wheelRadius = 0.45', CAR.wheelRadius === 0.45, String(CAR.wheelRadius));
    check('roadWidth = 12.0', Math.abs(built.roadWidth - 12.0) < 1e-6, String(built.roadWidth));
    check(
      'curves wider than base',
      Math.max(...built.halfWidths) > built.roadWidth / 2 + 0.5,
      `max halfWidth=${Math.max(...built.halfWidths).toFixed(2)}m base=${(built.roadWidth / 2).toFixed(2)}m`,
    );
    check('barrierHeight = 1.54', Math.abs(built.barrierHeight - 1.54) < 1e-6, String(built.barrierHeight));
    check('totalLength in [1500, 2700]', built.totalLength > 1500 && built.totalLength < 2700, String(built.totalLength.toFixed(0)));
    // 新规则：不要求直线，但不能突左突右（相邻采样方向变化小）、不自交
    check('simple no zigzag', maxHeadingTurn(points, built.tangents) < 0.3, `max turn=${maxHeadingTurn(points, built.tangents).toFixed(3)}rad`);
    check('simple no self-intersection', !loopSelfIntersects(built.points));
    check('simple has no terrain', built.terrain === null);
    const roadAttr = (built.group.getObjectByName('road') as import('three').Mesh)?.geometry.getAttribute('position');
    check('road mesh has positions', !!roadAttr && roadAttr.count === points.length * 2, `count=${roadAttr?.count}`);
  });

  it('complex track: real terrain, drivable slopes, road follows terrain', () => {
    const built = buildTrackForMode('complex');
    const points = built.points;
    const ys = points.map((p) => p.y);
    check('complex elevation range', Math.max(...ys) - Math.min(...ys) > 2, `range=${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}m`);

    // 坡度可行驶：相邻采样点最大坡度 ≤ 13%，且无断崖（|Δh| ≤ 0.5m）
    let maxSlope = 0;
    let noCliff = true;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const dh = Math.abs(points[i].y - points[j].y);
      if (dh > 0.5) noCliff = false;
      const ds = points[i].distanceTo(points[j]);
      maxSlope = Math.max(maxSlope, dh / Math.max(0.01, ds));
    }
    check('complex drivable slopes', maxSlope < 0.13, `max slope=${(maxSlope * 100).toFixed(1)}%`);
    check('complex no cliffs', noCliff);
    check('complex has terrain heightfield', !!built.terrain);

    if (built.terrain) {
      const terrainYs = built.terrain.heights.flat();
      check(
        'terrain elevation range',
        Math.max(...terrainYs) - Math.min(...terrainYs) > 2,
        `terrain range=${(Math.max(...terrainYs) - Math.min(...terrainYs)).toFixed(1)}m`,
      );
      // 轨道贴地形：采样点高度与地形采样一致（最终坡度钳制只允许小偏差）
      let maxDev = 0;
      for (let i = 0; i < points.length; i += 40) {
        const p = points[i];
        maxDev = Math.max(maxDev, Math.abs(p.y - built.terrain.sample(p.x, p.z)));
      }
      check('track follows terrain', maxDev < 1.0, `maxDev=${maxDev.toFixed(2)}m`);
      const groundMesh = built.group.getObjectByName('ground') as import('three').Mesh;
      const attr = groundMesh?.geometry.getAttribute('position');
      if (attr) {
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < attr.count; i++) {
          const y = attr.getY(i);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        check('ground mesh is real terrain', maxY - minY > 1, `ground range=${(maxY - minY).toFixed(1)}m`);
      }
    }
    const roadAttr = (built.group.getObjectByName('road') as import('three').Mesh)?.geometry.getAttribute('position');
    check('road mesh has positions', !!roadAttr && roadAttr.count === points.length * 2, `count=${roadAttr?.count}`);
  });

  it('spawn points are clear of barriers', () => {
    for (const mode of ['simple', 'complex'] as const) {
      const built = buildTrackForMode(mode);
      let spawnSafe = true;
      for (let i = 0; i < built.points.length; i += 150) {
        const safe = findSafeSpawnIndex(built, i);
        const p = built.points[safe];
        for (const b of built.physics.barriers) {
          if (b.shapes[0] instanceof CANNON.Plane) continue;
          const bb = b.aabb;
          if (
            p.x > bb.lowerBound.x - 2.4 &&
            p.x < bb.upperBound.x + 2.4 &&
            p.z > bb.lowerBound.z - 1.4 &&
            p.z < bb.upperBound.z + 1.4
          ) {
            spawnSafe = false;
          }
        }
      }
      check(`respawn points clear of barriers (${mode})`, spawnSafe);
      check(`has barriers (${mode})`, built.physics.barriers.length > 20, String(built.physics.barriers.length));
    }
  });

  it('complex multi-seed validity', () => {
    let validSeeds = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const built = buildTrackForMode('complex', seed);
      let ok = built.totalLength > 1500 && built.totalLength < 2700;
      let maxSlope = 0;
      for (let i = 0; i < built.points.length; i++) {
        const j = (i + 1) % built.points.length;
        const dh = Math.abs(built.points[i].y - built.points[j].y);
        const ds = built.points[i].distanceTo(built.points[j]);
        maxSlope = Math.max(maxSlope, dh / Math.max(0.01, ds));
        if (dh > 0.5) ok = false;
      }
      if (maxSlope >= 0.13) ok = false;
      if (ok) {
        validSeeds++;
      } else {
        console.log(`  seed ${seed} invalid: len=${built.totalLength.toFixed(0)} maxSlope=${(maxSlope * 100).toFixed(1)}%`);
      }
    }
    check('complex multi-seed validity', validSeeds === 6, `valid=${validSeeds}/6`);
  });

  it('generated centerline matches build input', () => {
    for (const mode of ['simple', 'complex'] as const) {
      const meta = makeMeta(mode, 42);
      const points = generateCenterlinePoints(meta);
      const built = buildTrack(meta, points);
      check(`${mode} centerline used as-is`, built.points === points);
    }
  });
});
