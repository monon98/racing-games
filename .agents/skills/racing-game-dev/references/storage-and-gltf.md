# 存储与 GLTF（storage-and-gltf）

## IndexedDB（idb，`src/storage/db.ts`）
- 库 `racing-game` v1，两个 store：`tracks`（keyPath `key`，活动赛道 key=`active`）、`leaderboard`（keyPath `trackId`，值为 `{trackId, entries[]}`）。
- `TrackPackage = { meta, centerline: Point3[], glb: Blob | null }`；单活动赛道约束。
- `replaceActiveTrack`：覆盖活动赛道并删除旧 trackId 的排行榜（重新生成/导入即清榜）。
- `addLeaderboardEntry`：按 `lapTimeMs` 升序、截取前 10。

## localStorage（`src/storage/settings.ts`）
- 玩家名 `racing.playerName`、颜色 `racing.carColor`、模式 `racing.trackMode`（默认 simple）。

## GLTF/GLB 往返（`src/track/gltf.ts`）
- 导出：`GLTFExporter.parseAsync(group, { binary: true })`；赛道数据写入 `group.userData`（type=`racing-game-track`、meta、roadWidth、barrierHeight、centerline），GLTFExporter 会序列化到 extras，GLTFLoader 会还原到 `scene.userData`。
- 导入：仅接受 `.glb` / `.gltf`（内嵌资源）；校验 `userData.type` 与 `centerline.length >= 20`，否则报“非本游戏导出的赛道文件”。
- 导入后以中心线重建视觉与物理（不依赖原 mesh），GLB 原样存入 DB 供再次导出。

## 注意
- 修改赛道数据结构（meta/centerline）时，同步 bump `TRACK_VERSION` 并保留旧数据兼容或迁移。
- 导出文件命名：`racing-track-<seed>.glb`。
