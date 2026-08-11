import * as THREE from 'three';
import { CAR } from '../config';

export interface CarVisual {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  dims: { width: number; height: number; length: number };
}

/** 代码生成低多边形汽车：同一模型函数，仅颜色参数不同 */
export function buildCar(color: string): CarVisual {
  const group = new THREE.Group();
  group.name = 'car';

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.15, metalness: 0.6 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });

  // 车身底盘（降低、更流线，让前轮在追尾视角露出）
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR.width, 0.42, CAR.length), bodyMat);
  body.position.y = 0.42;
  body.castShadow = true;
  group.add(body);

  // 座舱
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(CAR.width * 0.7, 0.36, CAR.length * 0.5), glassMat);
  cabin.position.set(0, 0.78, -0.3);
  cabin.castShadow = true;
  group.add(cabin);

  // 尾翼
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(CAR.width * 0.8, 0.1, 0.32), bodyMat);
  spoiler.position.set(0, 0.86, -CAR.length / 2 + 0.3);
  group.add(spoiler);

  // 前灯 / 尾灯
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xfff3c4, emissiveIntensity: 0.5 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xaa2222, emissive: 0xaa2222, emissiveIntensity: 0.4 });
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.08), lightMat);
    head.position.set(side * CAR.width * 0.36, 0.52, CAR.length / 2 + 0.02);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.08), tailMat);
    tail.position.set(side * CAR.width * 0.36, 0.52, -CAR.length / 2 - 0.02);
    group.add(tail);
  }

  // 四个轮子：圆柱体转 Z 轴使轴线沿 X
  const wheelGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.34, 20);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels: THREE.Mesh[] = [];
  const wheelPositions: Array<[number, number, number]> = [
    // 轮距略宽于车身（与物理连接点一致），让前轮在追尾视角下露出
    [-(CAR.width / 2 + 0.12), CAR.wheelRadius, CAR.length * 0.37],
    [CAR.width / 2 + 0.12, CAR.wheelRadius, CAR.length * 0.37],
    [-(CAR.width / 2 + 0.12), CAR.wheelRadius, -CAR.length * 0.37],
    [CAR.width / 2 + 0.12, CAR.wheelRadius, -CAR.length * 0.37],
  ];
  for (const [x, y, z] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(x, y, z);
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);
  }

  return { group, wheels, dims: { width: CAR.width, height: CAR.height, length: CAR.length } };
}
