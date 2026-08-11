# 对话决策与修改记录

> 用途：记录后续开发中对话里主动提及的问题、确认的决策，以及对应的修改方式/位置，避免跨会话丢失上下文。新增决策、问题或修复请按以下格式**追加**记录。

## 2026-08-11 初始规划确认

| 决策项 | 结论 | 修改方式（位置） |
| --- | --- | --- |
| UI 技术栈 | Vite + 原生 TypeScript（无框架） | `src/pages/`、`src/game/Game.ts`；约束见 `AGENTS.md` |
| 物理方案 | cannon-es（RaycastVehicle 悬架车辆） | `src/physics/vehicle.ts` |
| 赛道存储 | 单活动赛道（只保留一条） | `src/storage/db.ts` 的 `replaceActiveTrack`（替换并清旧榜） |
| 排行榜口径 | 一局单圈计时；翻车次数等数据记录但不展示 | `src/game/Game.ts` 的 `finish()`、`LeaderboardEntry.flips` |
| 复杂赛道 | 二期再做（当前 M2 已实现） | `src/track/generator.ts` + `src/track/noise.ts` |
| 规则/技能位置 | 项目内：`AGENTS.md` + `.agents/skills/racing-game-dev/` | 根目录与 `.agents/skills/` |
| 包管理器 | pnpm 并写入全局配置 | `package.json` 的 `packageManager` + `.npmrc`；PowerShell 下需授权执行 |
| 赛道宽度 | 3~4 个车身（取 3.5） | `src/config.ts` 的 `ROAD_WIDTH_MULTIPLIER = 3.5` |

## 2026-08-11 Bug 修复记录

### 开局即掉落（赛道无有效物理地面）
- 现象：进入游戏后车辆立刻下落，无法停在路面上。
- 根因：cannon-es `Plane` 默认局部法线为 `(0,0,1)`（竖直面），简单模式地面与复杂模式兜底平面未旋转，物理上不是水平地面。
- 修改方式：`src/track/generator.ts` 中两个 Plane 物理体执行 `quaternion.setFromEuler(-Math.PI / 2, 0, 0)`，使法线朝上。
- 回归防护：`smoke/smoke.ts` 新增“车辆 2 秒内不下坠”断言（simple/complex 均覆盖），以后改物理时跑 `pnpm smoke` 即可拦截同类问题。

## 后续待讨论
- M3 范围：环境装饰（树/石头）、音效与光影、多文件 `.gltf+.bin` 导入、vitest/代码分割（见 `docs/roadmap.md`）。
- 驾驶手感调优参数（发动机力、悬架、转向）集中在 `src/physics/vehicle.ts` 顶部常量，改手感先动那里。
- 浏览器人工验收清单（持久化、清榜、GLB 往返、重生惩罚、暂停/返回、小地图）见 `docs/progress.md`。
