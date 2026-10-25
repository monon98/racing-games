import * as THREE from 'three';

/**
 * 渲染光影管线（Game 与 TrackPreview 共用）：ACES 色调映射、天空渐变穹顶、
 * PMREM 环境贴图、太阳阴影相机纹素对齐（根治移车时的阴影边缘亚像素抖动）。
 * 纯数学部分（纹素吸附基向量）可在 node 测试，WebGL 相关（PMREM）仅在浏览器调用。
 */

/** 天空配色（雾色 = 地平线色，保证远处物体渐隐与穹顶无缝衔接） */
export const SKY_TOP = 0x427fd4;
export const SKY_HORIZON = 0xcfe9ff;
export const SKY_GROUND = 0x87a86d;

/** 太阳相对焦点的固定偏移（光轴方向恒定，纹素对齐依赖该不变性） */
export const SUN_OFFSET = new THREE.Vector3(120, 180, 80);

/** 彩色顶点：按球面 y 从地平线色渐变到天顶色（下半球向地面色） */
function domeColors(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(SKY_TOP);
  const horizon = new THREE.Color(SKY_HORIZON);
  const ground = new THREE.Color(SKY_GROUND);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const t = Math.min(1, Math.max(0, v.y));
    if (v.y >= 0) {
      c.copy(horizon).lerp(top, Math.pow(t, 0.65));
    } else {
      c.copy(horizon).lerp(ground, Math.pow(Math.min(1, -v.y), 0.7));
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  const attr = new THREE.BufferAttribute(colors, 3);
  return attr;
}

/** 天空穹顶：内置 MeshBasicMaterial（自带色调映射与 sRGB 输出链路），不受雾影响 */
export function createSkyDome(radius = 1500): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 96, 48);
  geometry.setAttribute('color', domeColors(geometry));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/** 色调映射管线：ACES + 曝光 1.05；阴影类型保持 PCF（比 PCFSoft 边缘更稳，少闪烁） */
export function applyColorPipeline(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

/** 从天空穹顶烘 PMREM 环境贴图：给车身金属材质真实的天光反射（需 WebGL 上下文，仅浏览器） */
export function bakeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const dome = createSkyDome(60);
  envScene.add(dome);
  const texture = pmrem.fromScene(envScene, 0.03).texture;
  pmrem.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  return texture;
}

export interface SunFollower {
  /** 已配置阴影与固定偏移的平行光（light.target 已加入场景） */
  light: THREE.DirectionalLight;
  /**
   * 帧调用：焦点=被跟随点（车）。frustumSize 可省（用当前阴影相机范围）；
   * 预览页全景/近景切换时传入不同视锥宽（同一视角内保持恒定，吸附网格才稳定）。
   */
  update(focus: THREE.Vector3, frustumSize?: number): void;
  dispose(): void;
}

/**
 * 太阳阴影相机跟随器：
 * - 光空间正交基（X/Y 屏幕轴、Z 光轴）由固定光轴方向推导，YOLO 变化 = 0；
 * - 焦点吸附到纹素网格（frustum/mapSize ≈0.088m），阴影贴图内容逐帧只整纹素平移，
 *   彻底消除既有“跟随但不吸附”残余的亚像素抖动；
 * - bias/normalBias 防 acne 与光漏（路面上细物体投影无阴影条纹）。
 */
export function createSunFollower(
  scene: THREE.Scene,
  frustumSize = 180,
  mapSize = 2048,
): SunFollower {
  const light = new THREE.DirectionalLight(0xfff2e0, 2.0);
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  const half = frustumSize / 2;
  light.shadow.camera.left = -half;
  light.shadow.camera.right = half;
  light.shadow.camera.top = half;
  light.shadow.camera.bottom = -half;
  light.shadow.camera.near = 10;
  light.shadow.camera.far = 800;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.05;
  scene.add(light);
  scene.add(light.target);

  // 光空间基：假定 Z=光前进方向（light→target，随 SUN_OFFSET 恒定），X=UP×Z，Y=Z×X
  const viewDir = SUN_OFFSET.clone().negate().normalize(); // light → target
  const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDir).normalize();
  const yAxis = new THREE.Vector3().crossVectors(viewDir, xAxis).normalize();
  let texel = frustumSize / mapSize;

  const update = (focus: THREE.Vector3, frustumSizeNew?: number): void => {
    // 视锥可按视角切换（同一视角内保持恒定的吸附网格才稳定）；frustumSize 与构造参数同为全宽语义
    const half = frustumSizeNew !== undefined ? frustumSizeNew / 2 : (light.shadow.camera.right - light.shadow.camera.left) / 2;
    if (light.shadow.camera.right !== half) {
      light.shadow.camera.left = -half;
      light.shadow.camera.right = half;
      light.shadow.camera.top = half;
      light.shadow.camera.bottom = -half;
      light.shadow.camera.updateProjectionMatrix();
      texel = (half * 2) / mapSize;
    }
    const fx = focus.dot(xAxis);
    const fy = focus.dot(yAxis);
    const fz = focus.dot(viewDir);
    const sx = Math.round(fx / texel) * texel;
    const sy = Math.round(fy / texel) * texel;
    // 深度轴不吸附（不影响二维纹素对齐），保持焦点深度连续
    light.target.position
      .set(0, 0, 0)
      .addScaledVector(xAxis, sx)
      .addScaledVector(yAxis, sy)
      .addScaledVector(viewDir, fz);
    light.position.copy(light.target.position).add(SUN_OFFSET);
  };
  update(new THREE.Vector3());

  return {
    light,
    update,
    dispose(): void {
      scene.remove(light);
      scene.remove(light.target);
      light.dispose();
      light.shadow.dispose();
    },
  };
}
