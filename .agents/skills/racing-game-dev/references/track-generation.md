# 赛道生成（track-generation）

入口：`src/track/generator.ts`，类型见 `src/types.ts`。

## 赛道来源两类（2026-10-22 预设制改造）
- **preset（默认）**：官方预设，控制点数据固定在 `src/track/presets.ts`；`generatePresetTrack(meta)` 用 `getPresetTrack(meta.presetId)`（无效 ID 回退第一个预设）→ `samplePresetCenterline`（Catmull-Rom 0.6，间距 1.2m 采样）→ `scaleLoop` 缩放到 `preset.length`；自交则抛错（预设数据错误必须显式失败，不换形状）。相同 presetId 输出逐点一致（确定性测试保证）。
- preset 模式走**平地管线**：无地形、无限 Plane 地面，与 simple 相同（`buildTrack` 内 `meta.mode !== 'complex'` 判断）。
- 新增预设：`PRESET_TRACKS` 追加条目（id/name/description/length/seed/controls），首页预设下拉数据驱动自动出现；**id 发布后不可更改**（leaderboard/存档/GLB 都引用 presetId）。**2026-10-25 花名册**：`aurora-ring` 极光环道（默认，1800m）/ `sunfall-sweep` 落日余晖（1800m 大半径高速环+左侧回旋）/ `windmill-corridor` 回旋花廊（1400m 双发卡回旋+底部直道）。逐预设永久回归在 tests/track.spec.ts（确定性逐位一致、长度 ±1m、逐步航向 <0.25rad、非邻接最近间距 >25m——实测最窄 32m，发卡不自交的静态后备防线、可驾驶冒烟 ≥3 轮接地）；设计新预设时控制点环路两段的最近间距须 ≳16m（2×8.4m 全加宽半宽 + 安全边距）。
- 本地文件预设已**收回**（2026-10-22 用户决策）：不提供用户导入预设的 UI 入口；本地预设定为**代码文件定义**（编辑 `src/track/presets.ts`），IndexedDB `presets` store 已随 DB v3 升级删除。
- **本地 GLB 预设（public 目录方案，2026-10-22 定版）**：`.glb` 放 `public/presets/` + `index.json` 登记 → `src/track/localPresets.ts` 运行时读取（`base()` 用 `import.meta.env.BASE_URL` 兼容 Pages 子路径）；`gltf.ts` 提供 `importTrackFromUrl` / `trackPackageFromGltf`（metaOverride）；`loadLocalPresetTrack` 覆盖 meta：`mode='preset'`、`presetId='local-<文件名安全化>'`（`localPresetIdFor`，同名跨部署同 ID）、`seed=0`（环境确定）。`StartPage` 清单驱动下拉（data-local），激活 = 解析包 → 新 id → `replaceActiveTrack`（清榜）；清单为空/缺失 = 仅有内置列表。
- 环境 `meta.seed` 在 preset 模式使用 `preset.seed`（预设外观稳定）；自定义仍为随机种子。
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
- 护栏：每 3 个采样点一段，`BoxGeometry(BARRIER_THICKNESS, barrierHeight, segLen)` 置于该点局部半宽外侧 0.05m；段长 ×1.4 重叠防弯道缝隙；视觉与 cannon-es 静态 Box 一一对应；厚度 0.8m、高度 1.5 × 车高（1.8m，2026-10-28 由 1.32m 加高）。物理盒在可见内侧面向外扩 `BARRIER_COLLIDER_DEPTH_EXTRA/2`（半厚 `t/2+extra/2`、中心外移 `extra/2`）；**静态 Body 设置 position/quaternion 后必须 `updateAABB()`**。
- 脱轨判定使用 `BuiltTrack.halfWidths[idx]`（局部半宽）+ 余量。

## 地面
- 简单模式：无限 `CANNON.Plane`（y=0）+ 视觉大平面（绿色，y=-0.08）。
- 复杂模式：整片地形网格（`TerrainData` 高度场）作为视觉 `ground` mesh 与物理 `CANNON.Trimesh`（车直接在真实地形上行驶）+ y=-30 兜底平面；护栏、环境（树/石头）都按地形高度摆放。

## 注意
- 修改尺寸/比例只改 `src/config.ts` 常量。
- 新赛道字段若需随 GLB 往返，同步更新 `src/track/gltf.ts` 的 `TrackUserData`。
