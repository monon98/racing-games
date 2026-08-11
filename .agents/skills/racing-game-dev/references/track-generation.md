# 赛道生成（track-generation）

入口：`src/track/generator.ts`，类型见 `src/types.ts`。

## 中心线（赛道生成规则，2026-08-12 从零重做版，用户选定 1C2A3A4B）
- `generateCenterlinePoints(meta)`：
  - 简单模式：星形随机控制点 + Catmull-Rom 闭环（光滑、不突左突右、不自交，`loopSelfIntersects` 自交重试）；**不要求直线**；长度 1600~2600m 随机，按目标长度采样（间距约 1.2m）后 `scaleLoop` 缩放。
  - 复杂模式：随机有机八字（`generateFigureEight`，两片 Catmull-Rom 叶瓣中心交叉）或 lemniscate——均非圆环且必然有重叠；长度 1800~2600m。
  - 海拔（`assignAltitudeSegments`）：4~7 个区段，段内平台高度（0/3/6，相邻不同）；段界选在低曲率点且避开交叉点（坡在直道、弯道平台）；重叠对所在段强制高度差（同段则自动在弧长中点插段界）；邻点坡度直接钳制 ≤0.5m 保证无断崖。
- 护栏（`buildBarriers`）：直道每 3 点一段、端点跟随加宽路面；站对方向差 >0.6rad（跨弯心）时两侧各自短段，杜绝横穿；缝合处无重复点。
- 安全落点：`findSafeSpawnIndex`（跳过兜底平面）保证出生/重生不与护栏体重叠。

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
