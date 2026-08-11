# AGENTS.md — 极速赛道 Racing 项目规则

## 项目
基于 three.js 的代码生成赛车游戏：Vite + 原生 TypeScript + cannon-es 物理 + IndexedDB（idb）持久化。

## 包管理
- 一律使用 `pnpm`（本机 PowerShell 下 `npm.ps1` 被执行策略禁用；pnpm 写入全局配置目录需授权执行）。
- 常用命令：`pnpm dev`、`pnpm typecheck`、`pnpm build`、`pnpm preview`。

## 技术约束
- TypeScript `strict` 模式；公共数据优先定义类型（见 `src/types.ts`）。
- 依赖锁定为 three、cannon-es、idb；未经用户批准不得引入 UI 框架或其他新依赖。
- 单位约定：1 单位 = 1m；赛道宽 = 5 × 车宽（10m，用户要求加宽）；护栏高 = 车高一半。
- 汽车与赛道必须代码生成，同一汽车模型函数仅通过颜色参数区分。

## 架构
- `src/track/`：赛道代码生成（中心线/路面/护栏/地面）与 GLTF/GLB 导入导出。
- `src/car/`：汽车模型生成（含轮子）。
- `src/physics/`：cannon-es 车辆、碰撞、翻车/脱轨检测、重生惩罚。
- `src/storage/`：IndexedDB（赛道包 + 排行榜）与 localStorage（玩家名/颜色/模式）。
- `src/ui/`：HUD、2D 俯视小地图。
- `src/pages/`：启动页与游戏页，hash 路由（`#/start`、`#/game`）。
- 常量集中在 `src/config.ts`，改动前先查这里。

## 规则
- 每个里程碑完成或状态变化后，更新 `docs/progress.md`（已完成/未完成清单）。
- 对话中确认的决策、发现的问题与修改方式，追加记录到 `docs/discussion-log.md`。
- 需求变化先更新 `docs/requirements.md`，再改代码。
- 提交/交付前必须通过 `pnpm typecheck` 与 `pnpm build`。
- 涉及赛道格式、物理规则或存储结构的变更，同步更新 `.agents/skills/racing-game-dev/`。
