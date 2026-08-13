import * as THREE from 'three';
import type { TrackMeta } from '../types';
import { mulberry32 } from '../utils/random';
import type { TerrainData } from './generator';

/** 环境生成：低多边形树与石头，纯装饰，自动避开所有路面；复杂赛道按地形高度摆放 */
export function buildEnvironment(
  meta: TrackMeta,
  points: THREE.Vector3[],
  halfWidths: number[],
  maxHalfWidth: number,
  terrain: TerrainData | null,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'environment';
  const rng = mulberry32(meta.seed ^ 0x5bd1e995);
  const n = points.length;

  const trunkMats = [0x5d3f24, 0x6b4a2b, 0x7a5633].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }),
  );
  const leafMats = [0x2f7d32, 0x3e8e41, 0x558b2f, 0x33691e].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }),
  );
  const rockMats = [0x6f7680, 0x7d838c, 0x8d949c].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }),
  );

  const isClear = (x: number, z: number): boolean => {
    for (let i = 0; i < n; i += 4) {
      const p = points[i];
      const d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
      if (d < (maxHalfWidth + 5) ** 2) return false;
    }
    return true;
  };

  let placed = 0;
  for (let i = 0; i < n; i += 12 + Math.floor(rng() * 8)) {
    const p = points[i];
    const t = points[(i + 1) % n].clone().sub(points[(i - 1 + n) % n]).normalize();
    const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    const side = rng() < 0.5 ? -1 : 1;
    const dist = halfWidths[i] + 9 + rng() * 20;
    const x = p.x + right.x * dist * side;
    const z = p.z + right.z * dist * side;
    if (!isClear(x, z)) continue;

    const isTree = rng() < 0.7;
    const obj = new THREE.Group();
    obj.position.set(x, terrain ? terrain.sample(x, z) : 0, z);
    obj.rotation.y = rng() * Math.PI * 2;
    if (isTree) {
      // 树：随机粗细/高低/树冠大小/形状
      const trunkR = 0.16 + rng() * 0.24;
      const trunkH = 1.6 + rng() * 3.0;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(trunkR, trunkR * 1.5, trunkH, 6),
        trunkMats[Math.floor(rng() * trunkMats.length)],
      );
      trunk.position.y = trunkH / 2;
      trunk.castShadow = true;
      obj.add(trunk);
      const crownR = 1.0 + rng() * 2.0;
      const crownH = 2.0 + rng() * 3.0;
      const leafMat = leafMats[Math.floor(rng() * leafMats.length)];
      if (rng() < 0.6) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(crownR, crownH, 7), leafMat);
        leaf.position.y = trunkH + crownH * 0.45;
        leaf.castShadow = true;
        obj.add(leaf);
      } else {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(crownR, 8, 6), leafMat);
        leaf.position.y = trunkH + crownR * 0.7;
        leaf.scale.y = 0.8;
        leaf.castShadow = true;
        obj.add(leaf);
      }
    } else {
      // 石头：随机大小/扁度/朝向
      const rockR = 0.7 + rng() * 2.0;
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rockR, 0),
        rockMats[Math.floor(rng() * rockMats.length)],
      );
      rock.scale.set(1, 0.45 + rng() * 0.55, 1);
      rock.position.y = rockR * rock.scale.y * 0.6;
      rock.rotation.set(rng() * 0.3, rng() * Math.PI * 2, rng() * 0.3);
      rock.castShadow = true;
      obj.add(rock);
    }
    group.add(obj);
    placed++;
  }
  return group;
}
