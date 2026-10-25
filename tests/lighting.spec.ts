import * as THREE from 'three';
import { it } from 'vitest';
import { SUN_OFFSET, createSkyDome, createSunFollower } from '../src/render/lighting';
import { check } from './helpers';

/** 与实现相同的光空间基推导（SUN_OFFSET 恒定 ⇒ 基恒定） */
function lightBasis(): { xAxis: THREE.Vector3; yAxis: THREE.Vector3; viewDir: THREE.Vector3 } {
  const viewDir = SUN_OFFSET.clone().negate().normalize();
  const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDir).normalize();
  const yAxis = new THREE.Vector3().crossVectors(viewDir, xAxis).normalize();
  return { xAxis, yAxis, viewDir };
}

it('sun follower: focus snaps to texel grid, offset preserved, idempotent', () => {
  const scene = new THREE.Scene();
  const frustum = 90;
  const mapSize = 64;
  const texel = frustum / mapSize;
  const follower = createSunFollower(scene, frustum, mapSize);
  const { xAxis, yAxis, viewDir } = lightBasis();

  const focusA = new THREE.Vector3(100.3, 2.0, -50.6);
  follower.update(focusA);
  const targetA = follower.light.target.position.clone();

  // 偏移保持：light = target + SUN_OFFSET
  const offset = follower.light.position.clone().sub(targetA);
  check('offset preserved', offset.distanceTo(SUN_OFFSET) < 1e-9, `${offset.length().toFixed(6)}m`);

  // 连续移动：光空间屏幕两轴上的位移必须是整纹素（阴影贴图只做整纹素平移，边缘不闪）
  const focusB = focusA.clone().add(new THREE.Vector3(0.37, 0, 0));
  follower.update(focusB);
  const targetB = follower.light.target.position.clone();
  const delta = targetB.clone().sub(targetA);
  const kx = delta.dot(xAxis) / texel;
  const ky = delta.dot(yAxis) / texel;
  check(
    'screen-axis displacement integral texels',
    Math.abs(kx - Math.round(kx)) < 1e-6 && Math.abs(ky - Math.round(ky)) < 1e-6,
    `kx=${kx.toFixed(4)} ky=${ky.toFixed(4)}`,
  );

  // 吸附误差有界：屏幕两轴各 ≤ texel/2（+数值容差）
  const errA = targetA.clone().sub(focusA);
  check(
    'snap error bounded (<1 texel/axis)',
    Math.abs(errA.dot(xAxis)) <= texel / 2 + 1e-9 && Math.abs(errA.dot(yAxis)) <= texel / 2 + 1e-9,
    `ex=${errA.dot(xAxis).toFixed(4)} ey=${errA.dot(yAxis).toFixed(4)} texel=${texel}`,
  );
  // 深度轴不吸附：与原始焦点投影一致（深度精度与抖动解耦）
  check('depth axis continuous', Math.abs(targetA.dot(viewDir) - focusA.dot(viewDir)) < 1e-9);

  // 幂等：同一焦点重复 update 结果一致
  follower.update(focusB);
  check('repeat update stable', targetB.distanceTo(follower.light.target.position) < 1e-9);

  // 视锥切换后：新网格下仍整纹素步进，且视锥尺寸生效
  follower.update(focusB, 300);
  const targetB2 = follower.light.target.position.clone();
  const texel2 = 300 / mapSize;
  const focusC = focusB.clone().add(new THREE.Vector3(0, 0.5, 1.1));
  follower.update(focusC, 300);
  const delta2 = follower.light.target.position.clone().sub(targetB2);
  const kx2 = delta2.dot(xAxis) / texel2;
  const ky2 = delta2.dot(yAxis) / texel2;
  check(
    'wide frustum: integral texel steps',
    Math.abs(kx2 - Math.round(kx2)) < 1e-6 && Math.abs(ky2 - Math.round(ky2)) < 1e-6,
    `kx2=${kx2.toFixed(4)} ky2=${ky2.toFixed(4)}`,
  );
  check('frustum applied', follower.light.shadow.camera.right - follower.light.shadow.camera.left === 300);

  follower.dispose();
  check('disposed removes light', !scene.children.includes(follower.light));
});

it('sky dome: vertex colors, back side, fog-free', () => {
  const dome = createSkyDome(500);
  const geometry = dome.geometry as THREE.SphereGeometry;
  const colors = geometry.getAttribute('color');
  check('dome has per-vertex colors', !!colors && colors.count === geometry.getAttribute('position').count, `count=${colors.count}`);
  check('dome renders back side', (dome.material as THREE.MeshBasicMaterial).side === THREE.BackSide);
  check('dome ignores fog', (dome.material as THREE.MeshBasicMaterial).fog === false);
  check('dome not frustum culled', dome.frustumCulled === false);
  // 渐变端点：取 y 最大顶点应接近天顶色
  const pos = geometry.getAttribute('position');
  let topIdx = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > pos.getY(topIdx)) topIdx = i;
  }
  const top = new THREE.Color(0x427fd4);
  const cTop = new THREE.Color(colors.getX(topIdx), colors.getY(topIdx), colors.getZ(topIdx));
  const hslTop = { h: 0, s: 0, l: 0 };
  const hslWant = { h: 0, s: 0, l: 0 };
  cTop.getHSL(hslTop);
  top.getHSL(hslWant);
  check(
    'pole vertex ≈ sky-top color',
    Math.abs(hslTop.h - hslWant.h) < 0.02 && Math.abs(hslTop.s - hslWant.s) < 0.05 && hslTop.l > hslWant.l - 0.03,
    `got=${cTop.getHexString()} want=${top.getHexString()}`,
  );
  dome.geometry.dispose();
});
