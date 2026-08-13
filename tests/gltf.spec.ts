import { describe, it } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildTrackForMode, check } from './helpers';
import { exportTrackToBlob, extractTrackUserData, TRACK_ASSET_TYPE } from '../src/track/gltf';

describe('GLB export/import roundtrip', () => {
  it('exports GLB with preserved userData and centerline', async () => {
    const built = buildTrackForMode('simple', 7);
    const blob = await exportTrackToBlob(built);
    const buf = Buffer.from(await blob.arrayBuffer());
    check('GLB size > 100KB', buf.length > 100_000, `${buf.length} bytes`);

    const loader = new GLTFLoader();
    const gltf = await new Promise<Awaited<ReturnType<typeof loader.parseAsync>>>((resolve, reject) => {
      loader.parse(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        '',
        (g) => resolve(g),
        (e) => reject(e),
      );
    });
    const ud = extractTrackUserData(gltf.scene);
    check('userData.type preserved', ud.type === TRACK_ASSET_TYPE, String(ud.type));
    check('centerline preserved', Array.isArray(ud.centerline) && ud.centerline.length === built.points.length, `${ud.centerline?.length} vs ${built.points.length}`);
    check(
      'first point matches',
      !!ud.centerline &&
        Math.abs(ud.centerline[0].x - built.points[0].x) < 1e-4 &&
        Math.abs(ud.centerline[0].z - built.points[0].z) < 1e-4,
      JSON.stringify(ud.centerline?.[0]),
    );
  });
});
