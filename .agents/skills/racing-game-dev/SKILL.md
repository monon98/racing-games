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
- 尺寸比例固定：车宽 2.0m、车高 1.4m、赛道基础宽 = 6 × 车宽（12.0m），弯道按曲率最多再加宽 40%，护栏高 = 0.75 × 车高（1.05m），1 单位 = 1m。
- 单活动赛道：IndexedDB 只存一条，重新生成/导入会清除旧排行榜；排行榜为单圈计时升序前 10。
- 汽车与赛道必须代码生成；汽车同一模型函数只接受颜色参数。
- 每个里程碑完成后更新 `docs/progress.md`；需求变化先更新 `docs/requirements.md`。

## Workflows

### 赛道生成或物理调整
读 `references/track-generation.md` 与 `references/physics-and-rules.md`，然后修改 `src/track/generator.ts`、`src/physics/vehicle.ts`、`src/game/Game.ts`。

### 存储、排行榜或 GLTF 导入导出
读 `references/storage-and-gltf.md`，然后修改 `src/storage/` 与 `src/track/gltf.ts`。

### 汽车模型 / 相机 / HUD / 页面
直接阅读 `src/car/createCar.ts`、`src/game/Game.ts`、`src/ui/`、`src/pages/`；保持模块边界：模型生成不依赖物理，物理状态由 `CarPhysics` 提供。
- 小地图（`src/ui/minimap.ts`）：X 轴必须镜像（3D 追尾视角 +X 在屏幕左侧），否则左右转向在小地图上相反。
- 启动页背景预览：`src/ui/TrackPreview.ts`，重新生成/导入赛道或改色后调用 `setTrack`/`setColor` 同步。
- 自由镜头预览页：`#/preview`（`src/pages/PreviewPage.ts`），复用 `TrackPreview` 的 `freeCamera` 模式（OrbitControls：拖动旋转 / 右键平移 / 滚轮缩放）。

## Validation

- `pnpm typecheck` 通过；`pnpm test`（vitest）通过。
- `pnpm build` 通过。
- 按 `docs/progress.md` 的人工验收清单做浏览器验证（持久化、清榜、GLB 往返、重生惩罚、暂停/返回、小地图）。
