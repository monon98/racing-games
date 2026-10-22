# 赛道生成（track-generation）

入口：`src/track/generator.ts`，类型见 `src/types.ts`。

## 赛道来源两类（2026-10-22 预设制改造）
- **preset（默认）**：官方预设，控制点数据固定在 `src/track/presets.ts`；`generatePresetTrack(meta)` 用 `getPresetTrack(meta.presetId)`（无效 ID 回退第一个预设）→ `samplePresetCenterline`（Catmull-Rom 0.6，间距 1.2m 采样）→ `scaleLoop` 缩放到 `preset.length`；自交则抛错（预设数据错误必须显式失败，不换形状）。相同 presetId 输出逐点一致（确定性测试保证）。
- preset 模式走**平地管线**：无地形、无限 Plane 地面，与 simple 相同（`buildTrack` 内 `meta.mode !== 'complex'` 判断）。
- 环境 `meta.seed` 在 preset 模式使用 `preset.seed`（预设外观稳定）；自定义仍为随机种子。
- 新增预设：`PRESET_TRACKS` 追加条目（id/name/description/length/seed/controls），首页预设下拉数据驱动自动出现；**id 发布后不可更改**（leaderboard/存档/GLB 都引用 presetId）。
- **本地文件预设**：`#/start` 「本地文件预设」按钮导入 `.glb/.gltf` → `saveLocalPreset` 存 IndexedDB `presets` store（v2 新增，keyPath `id`，单槽位 clear+put）→ 下拉出现「本地预设 · 文件名」（`presetId` 为 `local-` 前缀）。选中后重新生成走 `activateLocalPreset`：复制包为新 id 激活（清榜语义与重新生成一致）。本地预设不存在时内置列表照常工作；存档里残留 `local-*` ID 会回落到第一个内置预设（`syncLocalPresetOption`）。

## 中心线（自定义随机生成，2026-08-12 从零重做版，用户选定 1C2A3A4B）
- `generateCenterlinePoints(meta)`：
  - 简单模式：星形随机控制点 + Catmull-Rom 闭环（光滑、不突左突右、不自交，`loopSelfIntersects` 自交重试）；**不要求直线**；长度 1600~2600m 随机，按目标长度采样（间距约 1.2m）后 `scaleLoop` 缩放。
  - 复杂模式（2026-08-14 地形优先重做）：**先生成覆盖赛道的 2D 高度图地形**（`generateTerrain`：值噪声 + 平滑插值 + 相邻格高差钳制 ≈10%，高度 0~14m，强制**双山丘**，并做**道路走廊找平**——中心线两侧约 24m 内压成最近中心线高度，保证轮距左右等高、轮胎接地），**再画 2D 闭环轨道**（复用星形控制点 + Catmull-Rom，不自交）；轨道逐点双线性采样地形高度，最后按采样点坡度 ≤12~13% 钳制；**不考虑交叉轨道**。
- 环境（`src/track/environment.ts`）：树与石头随机生成（树干粗细/高度、树冠锥形/球形与大小、岩石大小/扁度/朝向、多套材质），随机分布且避开路面与护栏；`meta.seed` 决定布点，重生成赛道时环境同步变化。
- 护栏（`buildBarriers`）：直道每 3 点一段、端点跟随加宽路面；站对方向差 >0.6rad（跨弯心）时两侧各自短段，杜绝横穿；缝合处无重复点。
- 安全落点：`findSafeSpawnIndex`（跳过兜底平面）保证出生/重生不与护栏体重叠。

## 路面与护栏
- 路面横向右向量 = `(t.z, 0, -t.x)` 归一化；两侧偏移 = 局部半宽 `halfWidths[i]`（直道 = 基础宽/2，弯道按曲率最多加宽 40%，见 `computeHalfWidths`，平滑处理）。
- 路面 BufferGeometry：每个采样点两个顶点（左/右），闭合带状三角面（法线向上），存入 `roadGeometry` 供导出复用；复杂模式下左右边沿各自采样地形高度并抬高 `ROAD_TERRAIN_OFFSET=0.05m`（贴地且不被地形遮挡）。
- 起终点线：白色薄盒横跨路面（宽度取 `points[0]` 的局部宽），按切线朝向旋转。
- 护栏：每 3 个采样点一段，`BoxGeometry(BARRIER_THICKNESS, barrierHeight, segLen)` 置于该点局部半宽外侧 0.05m；段长 ×1.4 重叠防弯道缝隙；视觉与 cannon-es 静态 Box 一一对应；厚度 0.8m、高度 1.1 × 车高（1.32m，车缩小后）。
- 脱轨判定使用 `BuiltTrack.halfWidths[idx]`（局部半宽）+ 余量。

## 地面
- 简单模式：无限 `CANNON.Plane`（y=0）+ 视觉大平面（绿色，y=-0.08）。
- 复杂模式：整片地形网格（`TerrainData` 高度场）作为视觉 `ground` mesh 与物理 `CANNON.Trimesh`（车直接在真实地形上行驶）+ y=-30 兜底平面；护栏、环境（树/石头）都按地形高度摆放。

## 注意
- 修改尺寸/比例只改 `src/config.ts` 常量。
- 新赛道字段若需随 GLB 往返，同步更新 `src/track/gltf.ts` 的 `TrackUserData`。
