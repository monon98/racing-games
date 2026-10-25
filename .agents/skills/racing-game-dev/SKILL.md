---
name: racing-game-dev
description: 'Implementation guidelines for the three.js racing game in the repo (Vite + native TypeScript + cannon-es + IndexedDB). Use when implementing, extending, debugging, or reviewing this game: track generation and GLTF/GLB import-export, code-generated car model, cannon-es vehicle physics, flip/off-track respawn and penalties, per-track leaderboard, HUD/minimap, start/game pages, or project rule changes.'
---

# Racing Game Dev

## Overview

维护 three.js 代码生成赛车游戏。先读根目录 `AGENTS.md`（项目规则），再按本技能约定开发；涉及细节时按需读取 references 中的对应文档。

## Core Conventions

- 包管理一律用 `pnpm`；验证命令 `pnpm typecheck` 与 `pnpm build` 必须通过。
- TypeScript `strict`；公共数据类型集中在 `src/types.ts`；游戏常量集中在 `src/config.ts`，改动前先查。
- 尺寸比例固定：车宽 1.7m、车高 1.2m、车长 3.6m（2026-10-20 整车缩小，原 2.0/1.4/4.2），赛道基础宽保持 12.0m（`ROAD_WIDTH_MULTIPLIER = 12/1.7`），弯道按曲率最多再加宽 40%，护栏高 = 1.1 × 车高（1.32m），1 单位 = 1m。
- 单活动赛道：IndexedDB 只存一条，重新生成/导入会清除旧排行榜；排行榜为单圈计时升序前 10。
- 汽车与赛道必须代码生成；汽车同一模型函数只接受颜色参数。
- 每个里程碑完成后更新 `docs/progress.md`；需求变化先更新 `docs/requirements.md`。

## Workflows

### 赛道生成或物理调整
读 `references/track-generation.md` 与 `references/physics-and-rules.md`，然后修改 `src/track/generator.ts`、`src/track/presets.ts`、`src/physics/vehicle.ts`、`src/game/Game.ts`。
- 赛道为“预设 + 自定义”两类来源：默认预设轨道（`src/track/presets.ts`，固定控制点、确定性输出、不随生成器版本漂移）；简单/复杂随机生成为“自定义”模式。新增预设只需在 `PRESET_TRACKS` 追加（id 发布后不可改，`presetId` 随 GLB 往返）。

### 存储、排行榜或 GLTF 导入导出
读 `references/storage-and-gltf.md`，然后修改 `src/storage/` 与 `src/track/gltf.ts`。

### 汽车模型 / 相机 / HUD / 页面
直接阅读 `src/car/createCar.ts`、`src/game/Game.ts`、`src/ui/`、`src/pages/`；保持模块边界：模型生成不依赖物理，物理状态由 `CarPhysics` 提供。
- 汽车碰撞判定为整车单一碰撞盒（`src/physics/vehicle.ts`：底盘 Box 与车身同宽，无轮位附加碰撞盒）；撞护栏立即回弹（0.35 × 法向冲击，最低 0.8m/s）并整体保留 80% 速度（`COLLISION_BOUNCE` / `COLLISION_SPEED_RETAIN`）。
- 小地图（`src/ui/minimap.ts`）：X 轴必须镜像（3D 追尾视角 +X 在屏幕左侧），否则左右转向在小地图上相反。
- 启动页背景预览：`src/ui/TrackPreview.ts`，重新生成/导入赛道或改色后调用 `setTrack`/`setColor` 同步。
- 自由镜头预览页：`#/preview`（`src/pages/PreviewPage.ts`），复用 `TrackPreview` 的 `freeCamera` 模式（OrbitControls：拖动旋转 / 右键平移 / 滚轮缩放）；支持 `setView('car' | 'scene')` 快速切换赛车/整个场景视角，首页背景预览使用 `initialView: 'car'`。
- 静态预览（无物理同步）时 `TrackPreview` 会把轮子放到贴地位置（`wheelRadius - CHASSIS_SPAWN_HEIGHT`），避免轮子悬在车身上方。
- 渲染光影共用管线 `src/render/lighting.ts`（Game 与 TrackPreview 必须都走它，不许各自配灯）：ACES 色管（`applyColorPipeline`）、天空渐变穹顶（`createSkyDome`，雾色=地平线色）、PMREM 环境贴图（`bakeEnvironment`，车金属反射；`scene.environmentIntensity=0.5`）、太阳按**纹素网格对齐**跟随（`createSunFollower`：焦点吸附 0.088m 网格根治阴影抖动；预览页可传视锥宽按 car/scene 视角切换）；改动色调/强度/曝光需两页同步评估。

## Validation

- `pnpm typecheck` 通过；`pnpm test`（vitest）通过。
- 可针对性运行：`pnpm test:track` / `test:physics` / `test:gltf` / `test:rules`。
- `pnpm build` 通过。
- 按 `docs/progress.md` 的人工验收清单做浏览器验证（持久化、清榜、GLB 往返、重生惩罚、暂停/返回、小地图）。
