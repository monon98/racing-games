import * as THREE from 'three';
import type { TrackMeta } from '../types';
import { mulberry32 } from '../utils/random';

/** 简单环境生成：低多边形树与石头，纯装饰，自动避开所有路面 */
export function buildEnvironment(
  meta: TrackMeta,
  points: THREE.Vector3[],
  halfWidths: number[],
  maxHalfWidth: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'environment';
  const rng = mulberry32(meta.seed ^ 0x5bd1e995);
  const n = points.length;

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
  const leafMats = [0x2f7d32, 0x3e8e41, 0x558b2f].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }),
  );
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d838c, roughness: 0.95 });

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
    obj.position.set(x, 0, z);
    obj.rotation.y = rng() * Math.PI * 2;
    const scale = 0.8 + rng() * 0.7;
    if (isTree) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6), trunkMat);
      trunk.position.y = 1.2;
      trunk.castShadow = true;
      obj.add(trunk);
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(1.7, 3.4, 7),
        leafMats[Math.floor(rng() * leafMats.length)],
      );
      leaf.position.y = 3.4;
      leaf.castShadow = true;
      obj.add(leaf);
    } else {
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.1, 0),
        rockMat,
      );
      rock.scale.set(1, 0.65, 1);
      rock.position.y = 0.55;
      rock.castShadow = true;
      obj.add(rock);
    }
    obj.scale.setScalar(scale);
    group.add(obj);
    placed++;
  }
  return group;
}
