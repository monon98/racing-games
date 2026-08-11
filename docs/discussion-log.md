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

### 轮子不显示 / 无法驾驶 / 转向无效 / 滑行过长（同日第二次修复）
- 现象：车上看不到轮子；WASD/方向键无法正常驾驶；左右键无效果；松油门后滑行距离长。
- 根因（三个独立问题）：
  1. 轮子视觉同步把物理的“世界坐标变换”赋给作为车体子节点的轮子，等于双重偏移 → 轮子被甩到车外看不见。修复：轮子改为场景直属子节点，直接使用物理世界变换（`src/game/Game.ts`）。
  2. 静态 Plane 地面旋转后未刷新 `updateAABB()`，broadphase 仍按“竖直面（z≤0）”包围盒剔除车头方向（z>0）的轮子射线 → 前轮永不触地，转向无抓地力、车身低头拖地。修复：平面四元数放入构造参数并调用 `updateAABB()`（`src/track/generator.ts`）。
  3. RaycastVehicle 在 right=X/forward=Z/up=Y 配置下正发动机力沿 -Z 推 → 车倒着开。修复：油门力取反（`src/physics/vehicle.ts`），并同步 `customSlidingRotationalSpeed` 符号。
- 滑行过长：给底盘加 `linearDamping 0.25 / angularDamping 0.3`，松油门时施加 90N 发动机制动。
- 回归防护：`pnpm smoke` 新增“四轮全部着地、踩油门前进、转向改变航向、松油 4s 减速”断言（simple/complex 均覆盖）。

## 2026-08-11 加宽赛道 / 前轮露出
- 赛道宽度：`ROAD_WIDTH_MULTIPLIER` 由 3.5 改为 **5.0**（赛道 10m，车宽 2m）。
- 前轮可见：轮距改为 `车宽/2 + 0.12`（视觉与物理连接点一致，轮子外露）；追尾相机降低到 3.15m。
- 修改位置：`src/config.ts`、`src/car/createCar.ts`、`src/physics/vehicle.ts`、`src/game/Game.ts`。

## 2026-08-11 转向反向 / 倒车限速 / 40km/h 前翻（同日第三次修复）
- 转向反向：键位映射翻转——左键 → steering=+1（左转），右键 → -1（`src/game/Game.ts` 的 `computeInput`）。
- 倒车限制：`REVERSE_FORCE_RATIO = 0.35`（倒车加速力约为前进的 1/3），`REVERSE_MAX_SPEED = 8 m/s`（约 29 km/h），达到限速后停止施加倒车力（`src/physics/vehicle.ts`）。
- 前翻根因（用实验脚本复现）：全油门加速时俯仰稳定（64km/h 仅 2°）；松油门后“发动机制动 + 阻尼”在轮地接触点产生俯仰力矩，车身持续低头，底盘前下角触地后触发前滚翻（松油 3s 内俯仰 2°→67°）。
- 前翻修复（`src/physics/vehicle.ts`）：
  - 底盘高度 0.45 → 0.36（重心更低、离地更高）；
  - 悬架刚度 30 → 45、行程 0.35 → 0.25、压缩阻尼 4 → 6.5、回弹阻尼 2.4 → 4.0；
  - 发动机制动 90 → 60；轮连接点 y -0.3 → -0.24。
- 复测：64km/h 松油后俯仰峰值 2.4°，平稳刹停。
- 回归防护：`pnpm smoke` 新增“全油门 2s + 松油 4s 不翻车（up.y > 0.5）”“倒车 1s 速度 < 4m/s”“倒车最高速度 < 8.5m/s”断言（simple/complex 均覆盖）。

## 2026-08-11 弯道脱轨无碰撞 / 到终点不结束（同日第四次修复）
- 弯道脱轨无碰撞，根因三处：
  1. 护栏太薄（0.35m）且 cannon-es 无 CCD，高速时车会穿透护栏。修复：护栏厚度 0.35 → 0.55（`src/config.ts`），护栏段长 ×1.4 让相邻段重叠、消除弯道外侧缝隙（`src/track/generator.ts`）。
  2. 物理子步实验结论：1/120s 子步会导致 RaycastVehicle 松油俯仰失稳翻车，恢复 1/60s 固定子步（`src/physics/vehicle.ts`，注释已记录）。
  3. 脱轨判定余量太宽（0.8m/0.6s），开下路面没有反应。收紧为 0.5m/0.4s（`src/config.ts`）。
- 新增碰撞反馈：撞护栏（法向冲击 > 6 m/s）触发镜头震动 + 红色闪屏（`src/physics/vehicle.ts` 的 `onBarrierCollide` + `src/game/Game.ts` + `src/styles.css`）。
- 到终点不结束，根因：冲线判断 `lastS > 0.85L && s < 0.15L` 在判断前已把 `lastS` 更新为 `s`，条件永不成立（死代码）。修复：提取纯函数 `updateLapProgress`（`src/game/lapProgress.ts`），先判冲线再更新 `lastS`。
- 回归防护：`pnpm smoke` 新增“冲线检测/中途不冲线/倒退不累计进度”“高速右转不穿护栏（横向距离 < 护栏线 +1.2m）”断言。

## 2026-08-11 倒车加速度 / 刹车前翻（同日第五次修复）
- 倒车加速度调大：`REVERSE_FORCE_RATIO` 0.35 → 0.5（倒车约 5.8 m/s²，约为前进的一半），最高倒车速度仍 8 m/s（`src/physics/vehicle.ts`）。
- 刹车前翻：实验复现“58km/h 按刹车键 → 0.7s 内俯仰 68° 前翻”。根因是急刹（约 2.4g）在轮地接触点产生强烈点头力矩。修复：`BRAKE_FORCE` 170 → 70、`angularDamping` 0.3 → 0.7、`dampingCompression` 6.5 → 9.5。
- 复测：58km/h 急刹俯仰峰值 10.9°，约 2.8s 平稳刹停；松油（发动机制动）与急刹都不再前翻。
- 回归防护：`pnpm smoke` 新增“急刹不翻（up.y > 0.6）”断言（simple/complex 均覆盖）。

## 2026-08-11 赛车模型优化 / 赛道再加宽（同日第六次调整）
- 赛车模型：车身/座舱/尾翼整体降低（车身 0.55→0.42、座舱 1.02→0.78），造型更流线；追尾相机降到 2.65m、拉近到 7.6m、前视 4m，前轮转向状态清晰可见（`src/car/createCar.ts`、`src/game/Game.ts`）。
- 赛道再加宽：`ROAD_WIDTH_MULTIPLIER` 5 → 6（基础宽 12m）。
- 弯道按转角加宽：`computeHalfWidths` 按相邻切线航向差估算曲率，宽度因子 = 1 + min(0.4, 曲率×16)，并做平滑；路面、护栏、起终点线、脱轨判定全部跟随局部宽度（`BuiltTrack.halfWidths`，`src/track/generator.ts` + `src/game/Game.ts`）。
- 回归防护：`pnpm smoke` 新增“基础宽 12m”“弯道半宽大于基础半宽”断言，护栏防穿透测试改用最大局部半宽。

## 2026-08-11 复活下落/加速后翻/满舵震动/加速度/小地图/背景预览（第七、八次调整，合并记录）
- 复活下落 + 按住前进翻车：出生/复活高度原来用“路面+0.5m”，但静止离地高度约 1.07m → 轮子埋在路面下 0.57m，悬架猛弹后再砸地，按住 W 就翻。修复：统一 `CHASSIS_SPAWN_HEIGHT = 1.1`（`src/physics/vehicle.ts` + `src/game/Game.ts`）。
- 加速超过 80 后翻：大扭矩作用在后轮触地点，前轮离地后动力不减形成“抬头轮”。修复：前轮持续离地 80ms 才把动力降到 0.2 倍（防抬头），带延时避免满舵时瞬时离地引起动力抖动。
- 松开左右键侧滑：改为只衰减**水平**侧向速度（不动垂直分量），松键后行驶方向快速回正。
- 满舵不转向 + 车身震动：46° 满舵过大导致前轮侧滑、转向反而变弱。修复：`MAX_STEER` 0.8 → 0.65（37°）、转向速率 9 → 7、松键按 3/s 缓慢回中。
- 加速度/极速：`ENGINE_FORCE` 3200 → 2000 → 2700 → **3500**（0→100km/h 约 2.5s）；线性阻尼 **0.12**；防抬头延时 150ms、离地后动力降到 0.35 倍（保留起步爆发）；发动机限速 200km/h（接近上限渐入削减动力，在 0.98×上限处切断），**下坡允许超速**（不自动刹车）。
- 刹车防前翻：动力提升后高速急刹点头更深，`BRAKE_FORCE` 70 → **55**、`angularDamping` 0.7 → **0.8**、`dampingCompression` 9.5 → **11**、重心下移 0.10m。
- 轮子放大：`wheelRadius` 0.35 → 0.45，胎宽 0.42；车身落到轮顶高度附近（不再悬浮）；轮距 ±1.15。
- 护栏：高度 0.5 → 0.75 倍车高（1.05m）；改为按“每段两端采样点的实际路面边缘”对齐（`src/track/generator.ts` 的 `buildBarriers`）。
- 小地图镜像修复：小地图 X 轴与 3D 追尾视角互为镜像（3D 视角 +X 在屏幕左侧），导致“左转右转相反、不像俯视图”。修复：`toScreen` X 轴镜像 + 车头朝向线同步（`src/ui/minimap.ts`）；3D 转向本身无误。
- 启动页预览改背景：`src/ui/TrackPreview.ts` 全屏 3D 轨道环绕（赛道 + 车，颜色实时同步，重新生成/导入后自动更新）；相机以车为中心（半径 60m）取景，车体清晰可见；遮罩调亮到 0.42~0.58，轨道与车不会被盖没。
- 回归防护：`pnpm smoke` 新增“复活按住前进不弹跳不翻车”“满舵稳定”“0-100km/h 约 3.5s（平路）”“平路极速 144~202km/h”断言；`0-100` 与极速断言限定平路模式（复杂赛道有坡、下坡可超速，不属于调校目标）。

## 2026-08-12 赛道生成规则重做 / 加速度 / 阴影（第九次调整）
- 简单赛道新规则：凸多边形 + 圆角（保证至少一条 ≥100m 长直线；弯道为光滑圆弧且保持趋势）；长度 1200~2200m 随机（`src/track/generator.ts` 的 `generatePolygonLoop`）。
- 复杂赛道新规则：布局随机（lemniscate 八字 / 多边形圆角，见 `generateComplexTrack`）；高度=“弯道平台（不倾斜）+ 直道上尽量短的坡实现水平差（可连续）”（`assignElevation`：曲率 >0.006 视为弯道区域并分配 0/3/6 平台高度，直线段用随高差加长的短坡连接，坡长 ≥18m、坡度 ≤0.25）；复杂赛道至少有 2 个平台区域（按最高曲率点兜底强制）。
- 加速度：`ENGINE_FORCE` 3500 → **4300**（0-100km/h 约 2s）；防抬头改为“俯仰角 >0.1rad 渐减动力 + 俯仰角速度阻尼”（高速不再后翻）。
- 阴影抖动：平行光与阴影相机跟随车辆（保持偏移）、阴影范围收窄到 ±90m、`PCFShadowMap` 替代 PCFSoft（`src/game/Game.ts`）。
- 冒烟新增断言：简单赛道长直线、复杂赛道弯道平坦/短坡存在/无断崖/布局多样（6 种子中八字与多边形均出现）；防翻与 0-100 断言限定平路（复杂高架短坡高速弹飞属真实物理）。
- M3 范围：环境装饰（树/石头）、音效与光影、多文件 `.gltf+.bin` 导入、vitest/代码分割（见 `docs/roadmap.md`）。
- 驾驶手感调优参数（发动机力、悬架、转向）集中在 `src/physics/vehicle.ts` 顶部常量，改手感先动那里。
- 浏览器人工验收清单（持久化、清榜、GLB 往返、重生惩罚、暂停/返回、小地图）见 `docs/progress.md`。
