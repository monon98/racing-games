# 赛道生成（track-generation）

入口：`src/track/generator.ts`，类型见 `src/types.ts`。

## 中心线
- `generateCenterlinePoints(meta)`：由种子经 `mulberry32` 生成 10 个控制点（半径由 3 个正弦谐波叠加，约 60~130m），CatmullRomCurve3 闭环，采样 700 点。
- 复杂模式：每个采样点 y = `makeElevation(seed)(x, z)`（3 层分形值噪声，幅度 ±4.2m，见 `src/track/noise.ts`）。
- 采样点数组即 `BuiltTrack.points`；切线 `tangents[i] = normalize(p[i+1] - p[i-1])`。

## 路面与护栏
- 路面横向右向量 = `(t.z, 0, -t.x)` 归一化；两侧偏移 = 局部半宽 `halfWidths[i]`（直道 = 基础宽/2，弯道按曲率最多加宽 40%，见 `computeHalfWidths`，平滑处理）。
- 路面 BufferGeometry：每个采样点两个顶点（左/右），闭合带状三角面（法线向上），存入 `roadGeometry` 供物理 Trimesh 与导出复用。
- 起终点线：白色薄盒横跨路面（宽度取 `points[0]` 的局部宽），按切线朝向旋转。
- 护栏：每 3 个采样点一段，`BoxGeometry(BARRIER_THICKNESS, barrierHeight, segLen)` 置于该点局部半宽外侧 0.08m；段长 ×1.4 重叠防弯道缝隙；视觉与 cannon-es 静态 Box 一一对应。
- 脱轨判定使用 `BuiltTrack.halfWidths[idx]`（局部半宽）+ 余量。

## 地面
- 简单模式：无限 `CANNON.Plane`（y=0）+ 视觉大平面（绿色，y=-0.08）。
- 复杂模式：路面顶点直接构建 `CANNON.Trimesh`（与路面完全贴合）+ y=-30 兜底平面；视觉地面为同噪声函数位移的 PlaneGeometry。

## 注意
- 修改尺寸/比例只改 `src/config.ts` 常量。
- 新赛道字段若需随 GLB 往返，同步更新 `src/track/gltf.ts` 的 `TrackUserData`。
