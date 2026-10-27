# AGENTS.md — 极速赛道 Racing 项目规则

## 项目
基于 three.js 的代码生成赛车游戏：Vite + 原生 TypeScript + cannon-es 物理 + 原生 IndexedDB 持久化。

## 包管理
- 一律使用 `pnpm`（本机 PowerShell 下 `npm.ps1` 被执行策略禁用；pnpm 写入全局配置目录需授权执行）。
- 常用命令：`pnpm dev`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm preview`。

## 技术约束
- TypeScript `strict` 模式；公共数据优先定义类型（见 `src/types.ts`）。
- 依赖锁定为 three、cannon-es；未经用户批准不得引入 UI 框架或其他新依赖。
- 单位约定：1 单位 = 1m；车 1.7×1.2×3.6m（整车单一碰撞盒），赛道基础宽保持 12m（`ROAD_WIDTH_MULTIPLIER = 12/1.7`），弯道按曲率最多再加宽 40%；护栏高 = 1.5 × 车高（1.8m）。静态碰撞体设置 position/quaternion 后必须 `updateAABB()`（否则 SAPBroadphase 会漏碰撞对）。
- 汽车与赛道必须代码生成，同一汽车模型函数仅通过颜色参数区分。

## 架构
- `src/track/`：预设轨道数据（`presets.ts`）、赛道代码生成（中心线/路面/护栏/地面）与 GLTF/GLB 导入导出。默认来源为预设轨道；随机生成（简单/复杂）作为"自定义"模式保留。
- `src/car/`：汽车模型生成（含轮子）。
- `src/physics/`：cannon-es 车辆、碰撞、翻车/脱轨检测、重生惩罚。
- `src/storage/`：IndexedDB（赛道包 + 排行榜）与 localStorage（玩家名/颜色/模式）。
- `src/ui/`：HUD、2D 俯视小地图。
- `src/game/`：游戏主循环（Game）、单圈进度（lapProgress）、逆行判定（wrongWay）。
- `src/utils/`：格式化与随机工具。
- `src/pages/`：启动页、游戏页与预览页，hash 路由（`#/start`、`#/game`、`#/preview`）。
- 常量集中在 `src/config.ts`，改动前先查这里。

## 规则
- 每个里程碑完成或状态变化后，更新 `docs/progress.md`（已完成/未完成清单）。
- 对话中确认的决策、发现的问题与修改方式，追加记录到 `docs/discussion-log.md`。
- 需求变化先更新 `docs/requirements.md`，再改代码。
- 提交/交付前必须通过 `pnpm typecheck`、`pnpm test` 与 `pnpm build`。
- 涉及赛道格式、物理规则或存储结构的变更，同步更新 `.agents/skills/racing-game-dev/`。
