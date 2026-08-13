import { expect } from 'vitest';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { TRACK_VERSION } from '../src/config';
import { CarPhysics, CHASSIS_SPAWN_HEIGHT } from '../src/physics/vehicle';
import { buildTrack, generateCenterlinePoints, type BuiltTrack } from '../src/track/generator';
import type { TrackMeta } from '../src/types';

if (typeof (globalThis as { FileReader?: unknown }).FileReader === 'undefined') {
  // GLTFExporter 二进制导出依赖 FileReader；Node 24 无全局实现，提供最小 polyfill
  class SimpleFileReader {
    result: ArrayBuffer | null = null;
    onload: ((ev: { target: SimpleFileReader }) => void) | null = null;
    onloadend: ((ev: { target: SimpleFileReader }) => void) | null = null;
    onerror: ((ev: { target: SimpleFileReader; error: unknown }) => void) | null = null;
    readAsArrayBuffer(blob: Blob): void {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
        })
        .catch((error: unknown) => {
          this.onerror?.({ target: this, error });
        });
    }
  }
  (globalThis as { FileReader?: unknown }).FileReader = SimpleFileReader;
}

export function check(name: string, cond: boolean, detail = ''): void {
  expect(cond, `${name} ${detail}`).toBe(true);
}

export function makeMeta(mode: 'simple' | 'complex', seed: number): TrackMeta {
  return { id: `test-${mode}-${seed}`, mode, seed, createdAt: Date.now(), version: TRACK_VERSION };
}

export function buildTrackForMode(mode: 'simple' | 'complex', seed = 42): BuiltTrack {
  const meta = makeMeta(mode, seed);
  return buildTrack(meta, generateCenterlinePoints(meta));
}

export interface CarRig {
  physics: CarPhysics;
  start: THREE.Vector3;
  tangent: THREE.Vector3;
  startQuat: THREE.Quaternion;
}

export function createCarRig(built: BuiltTrack, withBarriers = false): CarRig {
  const physics = new CarPhysics();
  physics.addGround(built.physics.ground);
  if (withBarriers) {
    for (const b of built.physics.barriers) physics.addGround(b);
  }
  const start = built.points[0];
  const tangent = built.tangents[0].clone();
  tangent.y = 0;
  tangent.normalize();
  const startQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    tangent,
  );
  physics.reset(
    new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
    new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
  );
  return { physics, start, tangent, startQuat };
}

export function resetRig(rig: CarRig): void {
  rig.physics.reset(
    new CANNON.Vec3(rig.start.x, rig.start.y + CHASSIS_SPAWN_HEIGHT, rig.start.z),
    new CANNON.Quaternion(rig.startQuat.x, rig.startQuat.y, rig.startQuat.z, rig.startQuat.w),
  );
}
