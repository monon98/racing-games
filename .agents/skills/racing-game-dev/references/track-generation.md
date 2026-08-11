# 赛道生成（track-generation）

入口：`src/track/generator.ts`，类型见 `src/types.ts`。

## 中心线（赛道生成规则，2026-08-12 版）
- `generateCenterlinePoints(meta)`：
  - 简单模式 = `generatePolygonLoop`：凸多边形（5~7 边）+ 圆角（fillet），保证至少一条 ≥100m 长直线，弯道为光滑圆弧且保持趋势；长度 1200~2200m 随机。
  - 复杂模式 = `generateComplexTrack`：布局随机（lemniscate 八字 / 多边形圆角）；高度由 `assignElevation` 生成——曲率 >0.006 的弯道区域分配平台高度（0/3/6），直线段用短坡连接平台（坡长 ≥18m 且随高差加长、坡度 ≤0.25、无断崖，可连续）；弯道本身不倾斜；平台区域少于 2 个时按最高曲率点兜底强制。
- 采样间距约 1.2m；`BuiltTrack.points` 数量随长度（900~2200 点）。

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
