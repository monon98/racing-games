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

## 2026-08-12 生成器从零重做（用户选定 1C2A3A4B）
- 用户决策：简单=随机点+光滑曲线（不要求直线）；复杂=海拔区段；允许自交+重叠强制高度差；长度 1600~2600m。
- 简单赛道：星形随机控制点 + Catmull-Rom 闭环（光滑、不突左突右、自交重试，见 `loopSelfIntersects`）；不要求直线。
- 复杂赛道：**随机有机八字**（两片 Catmull-Rom 叶瓣中心交叉，`generateFigureEight`）或 lemniscate——均非圆环；海拔=区段平台 + 段界短坡（段界选低曲率点并避开交叉点，保证弯道平台与重叠处落在平台）；重叠处强制高度差（重叠对所在段高度不同，段界自动拆分同段重叠对）；邻点坡度直接钳制保证无断崖。
- 转向限速：|steering|>0.05 时最高时速衰减到 **50km/h**（渐入削减动力，`TURN_MAX_SPEED`）。
- 复活护栏失效修复：重生/出生点若与护栏体重叠会被顶穿；新增 `findSafeSpawnIndex`（跳过兜底平面）自动找附近无护栏重叠的安全落点，出生与重生都用它。
- 冒烟现共 49 项断言：新增“转向限速 ~50km/h”“重生点不与护栏重叠”“简单不突左突右/不自交”“重叠处高度差≥2m”“复杂始终有交叉（桥式）”。

## 2026-08-12 高速上坡不飞起（加重 + 牵引 + 空中钳制）
- 质量 550 → **750**；发动机力同步 5500 → **7500**（0-100 仍约 1.5s），倒车比例 0.64 → 0.65（保持旧正向加速档位）。
- 悬架阻尼加强：压缩 11 → **14**、回弹 4 → **6**（吸收上坡/过顶起伏）。
- 新增“空中垂直速度钳制” `MAX_AIR_UPWARD_SPEED = 3.5 m/s`：四轮离地时限制上升速度，高速过丘陵不再飞射（实测最大上升速度仅 0.02 m/s）。
- 发动机制动 35 → **50**（质量加重后保持松油能停）。
- 冒烟新增“no upward launch on hills（最大上升速度 < 1 m/s）”；现共 50 项断言。

## 2026-08-12 转向幅度 / 首页模式选择与卡片透明
- 转向最大角 0.65 → **0.8 rad（约 46°）**（`MAX_STEER`），打方向幅度更大。
- 首页“赛道模式”从“开始游戏”卡片移到“当前赛道”卡片，在**点击重新生成时生效**；选项去掉括号提示（仅“简单/复杂”）。
- 首页卡片半透明（`rgb(27 34 44 / 0.72)` + 背景模糊），3D 背景预览更清晰可见。

## 2026-08-12 GitHub Pages 部署配置
- `.github/workflows/deploy.yml`：push 到 main 或手动触发 → pnpm 安装/类型检查/构建 → `actions/configure-pages` + `upload-pages-artifact` + `deploy-pages` 发布。
- `vite.config.ts`：base 动态化——GitHub Actions 下按仓库名生成 `/racing-games/` 子路径，本地保持 `./`（hash 路由无需 404 处理）。
- `public/.nojekyll`：防止 GitHub Pages 用 Jekyll 处理站点。

## 2026-08-14 复杂赛道重做：随机 M×N 高度矩阵 + 可行驶斜坡
- 复杂模式不再是“双圆 8 / lemniscate + 海拔区段”，改为**网格车道**：随机生成 M 行（2/4/6） × N 列高度矩阵，每格是长方体区域（宽=车道间距、长=cellLen），偶数条车道由发卡弯连成闭环。
- 高度 0~6m、相邻格高差 ≤1.0m、格间 14m 平滑过渡 → 最大坡度约 7%（可行驶）；发卡弯两端高差由“沿行驶方向生成”天然 ≤1.0m。
- 格子数按“目标长度 − 发卡弯弧长”解析计算，缩放系数 ≈1，坡度不受缩放影响。
- 交叉净空保证：任何 XZ 贴近的异段路面高度差 ≥2m（隆起 3m、40 点宽、坡度 ≈9%），车能通过且相机不被遮挡。
- 冒烟新增：complex drivable slopes（<13%）、complex no cliffs、complex crossing clearance、多种子有效性；护栏防穿透与快速切换等改为平路调校项。

## 2026-08-14 测试迁移 vitest / 移除 idb
- 用 **vitest** 替代 `smoke/` 脚本：原冒烟断言迁移到 `tests/game.spec.ts`（`pnpm test`，约 24s 通过）。
- 移除 **idb** 依赖：`src/storage/db.ts` 改用原生 IndexedDB 包装（`indexedDB.open` + Promise 封装，行为不变）。

## 2026-08-14 逆行检测
- 修复“赛车反方向跑”：沿赛道反方向行驶（切线反向速度 > 2 m/s）时 HUD 显示闪烁“逆行中，请调头！”；持续 3s 自动重生（计时间/距离惩罚）。
- 实现：`src/game/Game.ts`（wrongWayTime 计时 + respawn('wrongway')）、`src/ui/hud.ts`（showWrongWay）。
- M3 范围：环境装饰（树/石头）、音效与光影、多文件 `.gltf+.bin` 导入、vitest/代码分割（见 `docs/roadmap.md`）。
- 驾驶手感调优参数（发动机力、悬架、转向）集中在 `src/physics/vehicle.ts` 顶部常量，改手感先动那里。
- 浏览器人工验收清单（持久化、清榜、GLB 往返、重生惩罚、暂停/返回、小地图）见 `docs/progress.md`。

## 2026-08-14 环境随机大小 / 满舵抖动 → 漂移失控
- 环境（树/石头）：改为多套材质 + 随机尺寸（树干粗细/高低、树冠锥形或球形、岩石大小/扁度/朝向），随机分布且避开路面（`src/track/environment.ts`）。
- 满舵 + 油门持续抖动：原“禁止侧滑”让车辆困在轻微振荡中。改为检测横摆率在 0.6s 窗口内方向翻转 ≥2 次（第二次抖动）即进入漂移失控：四轮 `frictionSlip` 3.2 → 2.4，HUD 显示“漂移失控中”，松开转向立即恢复（`src/physics/vehicle.ts` + `src/ui/hud.ts`）。
- 回归测试：满舵 + 油门 1.5s 应进入漂移，松开转向 0.5s 应恢复（`tests/game.spec.ts`）。
- 复杂赛道“生成卡死”已修复并单独提交（`4dd9a9e`）：随机 M×N 高度矩阵 + 哈密顿路径，去掉交叉轨道处理，最终坡度钳制 ≤12~13%。

## 2026-08-14 逆行判定 / 滑行 / 倒车转向限速
- 逆行判定改为“车头朝后 + 沿车头方向前进”：车头与切线点积 < -0.5 且 `forwardSpeed > 2 m/s` 持续 3s 才触发；倒车（车头朝前向后开）不再误判逆行。抽出纯函数 `isWrongWay`（`src/game/wrongWay.ts`）并补 5 组单元断言。
- 滑行手感：`linearDamping` 0.12 → **0.05**，单纯松油门用 `COAST_BRAKE=4` 缓慢滑行（实测 136→94 km/h @4s）；松油门但按住左右键用 `ENGINE_BRAKE=50` 快速降速（4s 到 0）；按后退键（倒车输入）在前进行驶时按刹车处理急速降速。
- 转向限速改为主动制动：由于阻尼调低后仅削动力无法把速度压到 50km/h，新增“超速转向时对四轮施加制动”（`src/physics/vehicle.ts`）。
- 倒车 + 转向：最高倒车速度压到 **10 km/h**（约 2.78 m/s，按 HUD 单位理解；若指 10 m/s 可再调），直线倒车仍为 8 m/s；新增回归测试。

## 2026-08-14 复杂赛道改为“地形优先”方案
- 按用户选择实施“先二维矩阵生成高度图地形，再画轨道”：删除哈密顿路径与高架桥式地面；新增 `generateTerrain`（值噪声 + 平滑插值 + 相邻格高差钳制 1.2m/10m ≈12%，并强制山丘保证升降）。
- 复杂中心线改为复用星形控制点 + Catmull-Rom 的 2D 闭环，逐点双线性采样地形高度，最后钳制坡度 ≤12%；**不处理交叉轨道**。
- 地面：复杂模式用整片地形 mesh + `CANNON.Trimesh` 物理（车在真实地形上行驶）；道路左右边沿、护栏、环境树/石头均按地形高度摆放；路面材质加 polygonOffset 防 z-fighting。
- 回归调整：`MAX_AIR_UPWARD_SPEED` 3.5→**1.5** 且改为“任一车轮离地即钳制”（山脊不再飞射）；复杂模式“复活不翻车”允许正常爬坡高度；新增“地形高度场/轨道贴地/地面非平坦”断言。

## 2026-08-14 自定义对话框 / 倒车转向限速 / 护栏与整车碰撞
- 重新生成赛道的确认从原生 `window.confirm` 改为自定义对话框（`src/ui/confirmDialog.ts`，支持 Enter/Esc/点背景取消，danger 红色按钮样式），避免浏览器原生弹窗样式不一致。
- 倒车 + 左右键：最高速度改为 **10 m/s（HUD ≈36 km/h）**；倒车转向时动力同时给前后轮（不再原地打转），并对绝对速度钳制；直线倒车仍为 8 m/s。
- 护栏加大判定范围：厚度 0.55→**0.8m**、高度 0.75→**1.1 × 车高（1.54m）**、离路面边缘 0.08→0.05m。
- 整车碰撞：底盘碰撞盒加宽到与车身同宽，并在四个轮位新增碰撞盒（视觉轮子没有 cannon 碰撞体），护栏碰撞/红闪现在能覆盖整个车身与轮子。

## 2026-08-14 测试拆分 / 复杂赛道道路可见 / 起伏增强
- 测试拆分：`tests/game.spec.ts` 拆为 `track.spec.ts`、`physics.spec.ts`、`gltf.spec.ts`、`rules.spec.ts` + `helpers.ts`（共享 check/makeMeta/建车夹具）；新增 `pnpm test:track / test:physics / test:gltf / test:rules` 可针对性运行。
- 复杂赛道道路被地形遮挡（显示为绿色）：贴地路面统一抬高 `ROAD_TERRAIN_OFFSET = 0.05m`，配合 polygonOffset 彻底解决 z-fighting。
- 起伏感增强：地形高度 0~8m → **0~14m**，强制**双山丘**（更宽缓，sigma 90~150m，长坡式起伏而非跳台），相邻格坡度钳制 12% → **10%**。
- 抑制飞车：四轮全离地时上升速度上限 0.6 m/s + **3.2g 下压力**；野地高速直行仍允许 ≤2.5m 短暂离地（测试注释已说明）。

## 2026-08-14 赛道/赛车自由镜头预览页
- 新增 `#/preview` 预览页（`src/pages/PreviewPage.ts`）：加载当前活动赛道 + 当前颜色赛车，复用 `TrackPreview` 新增的 `freeCamera` 模式（three 自带 OrbitControls：左键旋转 / 右键平移 / 滚轮缩放，限制最大俯仰角防止穿地）。
- 首页“开始游戏”面板新增“赛道 / 赛车预览”入口按钮；返回首页按钮回到 `#/start`；异步加载赛道期间返回会安全取消创建。

## 2026-08-14 飞车重力 / 默认玩家名 / 首页来源
- 飞车行为改为**纯重力下落**：移除人工 3.2g 下压力与“任一车轮离地即钳制”逻辑；仅四轮全离地时把上升速度限制在 2 m/s 防极端弹射，下落完全交给重力。测试改为断言“飞起后出现明显向下速度且幅度有界”。
- 默认玩家名改为 `玩家 + 5 位随机字母数字`（`randomPlayerName`，去掉易混淆字符 I/O/0/1）：名称留空开始游戏、或本地无存档时自动生成。
- 首页底部新增来源链接（指向代码仓库）：https://github.com/monon98/racing-games （新窗口打开；部署访问仍为 Pages 地址）。

## 2026-08-14 预览页视角切换 / 首页背景=赛车视角
- 预览页（`#/preview`）顶部新增“赛车 / 整个场景”两个按钮：`TrackPreview.setView()` 快速切换取景——赛车视角以车为中心近距离观察，场景视角按赛道包围盒自动拉远俯视。
- 首页背景预览定位为“赛车视角”（`initialView: 'car'`，radius 26 / height 16）：以赛车为中心、车体更突出；预览页“赛车”按钮使用同款取景。

## 2026-08-14 倒车急停 / 预览朝向与起始线 / 预览按钮位置
- 倒车松开后快速归零：`throttle=0` 且车辆仍在倒车（forwardSpeed < -0.5）时改用 `ENGINE_BRAKE=50`（与前进缓慢滑行不同），新增回归测试。
- 预览页初始镜头改为从**车头方向**观察赛车（自由镜头 `car` 视角相机放在车头前方），不再看到车尾误以为“倒着”。
- 起始线抬高到路面之上（`p0.y + 0.12`），复杂赛道贴地路面不再与起始线共面，起始线完整显示。
- “赛道 / 赛车预览”按钮从“开始游戏”面板移到**“当前赛道”面板**的操作区；首页背景预览保持全屏背景不变（用户确认）。

## 2026-08-14 陡坡爬坡修复 / 预览轮子贴地
- 陡坡上不去、后溜、后轮离地翻车：根因是“防抬头”反扭矩用**绝对俯仰角**计算，爬坡时车身正常俯仰（约 7°）被误判为抬头，猛压车头把后轮压离地面。改为用接触轮子的地形法线平均值作为地面朝向，俯仰角相对地面计算——爬坡不再触发防抬头，平路急加速防前翻仍有效。
- 新增回归测试：复杂赛道最陡上坡段起步踩油门，断言能加速（3s 后 >3m/s）、不后溜（≤1m/s）、不翻车、爬坡中段轮子着地。
- 预览“四轮朝天”：静态预览没有物理同步，`buildCar` 的轮子初始位置（车体原点上方）未被覆盖。`TrackPreview` 现在把四个轮子放到贴地位置（`wheelLocalY = wheelRadius - CHASSIS_SPAWN_HEIGHT`），首页背景与预览页都正常。

## 2026-08-14 陡坡后溜翻车分析：侧坡导致轮胎离地 → 道路走廊找平
- 分析确认：复杂赛道地形带侧向坡度时，路面左右边缘高度差最大 **1.90m**（83% 采样点超过 0.25m 悬架行程），刚性车身 + 有限悬架会让一侧轮胎离地，后轮失去驱动力 → 坡上无法前进、后溜、翻车。
- 选择“**保证路左右等高**”而非“车自适应变形”（后者需要大幅增加悬架行程，会明显改变操控与稳定性）。
- 实现：`generateTerrain` 增加**道路走廊找平**（`TERRAIN_FLATTEN_HALF=12m`）：把中心线两侧约 24m 内的地形压成“最近中心线点的高度”，消除侧坡；弯道外侧保留自然缓坡（视觉更自然）。
- 实测：轮距（±1.15m）处左右高度差从最大约 1.9m 降至 **0.087m**；新增回归断言 `wheel track is level on slopes (<0.15m)`，爬坡测试保持通过。

## 2026-10-20 文档同步（README + AGENTS.md）
- README 陈旧项修正：“双页面” → 三页面（含 `#/preview` 预览页）；复杂赛道描述由旧“八字/lemniscate + 海拔区段”改为“地形优先（高度图 0~14m + 道路走廊找平）”；护栏高 0.75 倍车高 → 1.1 倍（1.54m）；玩法补逆行判定与预览页操作；测试数量改为 34 用例（`it.each` 双模式参数化）/ 约 66 项断言；项目结构补 `game/` 且页面列表含预览页。
- `AGENTS.md` 架构清单补充 `src/game/` 与 `src/utils/`（与实际目录一致）。
- 其余文档（requirements / progress / roadmap / tech-stack / known-issues / discussion-log）与技能 references 已逐项核对，随最近提交同步，无需改动。

## 2026-10-20 碰撞立即回弹减速 / 整车缩小与单一碰撞盒
- 碰撞手感（用户要求一）：撞护栏后**立即回弹并适当减速**。实现：`onCollide` 在 step 中记录最强护栏接触（`contact.ni` 统一取从护栏指向车身的方向），step 后统一施加——法向分量重置为向外反弹速度 `max(0.35 × 冲击速度, 0.8 m/s)`，整体速度再保留 80%（`src/physics/vehicle.ts` 新常量 `COLLISION_BOUNCE=0.35`、`COLLISION_SPEED_RETAIN=0.8`、`COLLISION_MIN_IMPACT=1.2`）；低于 1.2m/s 的贴墙低速接触不回弹，避免持续抖动。`reset()` 清空待处理接触。
- 整车模型（用户要求二）：车辆整体缩小 2.0×1.4×4.2 → **1.7×1.2×3.6m**、轮径 0.45→**0.4**（`src/config.ts` 的 `CAR`），视觉细节（车高/灯/胎宽）同步微调；**删除 4 个轮位碰撞盒**，碰撞判定改为整车单一底盘 Box（以小车为一个完整模型判断）。
- 尺寸联动：赛道基础宽保持 12m → `ROAD_WIDTH_MULTIPLIER = 12/1.7`；护栏高 = 1.1 × 车高 = **1.32m**；`CHASSIS_SPAWN_HEIGHT` 1.1 → **1.05**（0.24 + 0.38 + 0.4 + 落差）；`TrackPreview` 静态轮位公式不变自适应。
- 爬坡测试适配：车身缩短后更早冲出最陡段、过脊弹跳进入 1s 快照（前轮悬架伸长无接触属正常飞起）；断言从"固定 i=59 快照 ≥3 轮"改为"爬坡启动段前 50 帧 ≥3 轮着地占比 ≥70%"，翻车/后溜/加速断言不变（`tests/physics.spec.ts`）。诊断方式：临时 spec 打印四轮 `isInContact/suspensionLength` + 俯仰/垂直速度，确认 1s 处前轮无接触为过脊弹跳而非爬坡失败。
- 测试同步：`track.spec.ts` 断言 wheelRadius=0.4、barrierHeight=1.32（roadWidth 12m 不变）。
- 本地 GLB 预设（public 目录方案，2026-10-22 定版）：用户要求“支持本地 glb 文件生成，在 public 目录下子目录”。`public/presets/` + `index.json` 清单（可空）；`src/track/localPresets.ts` 运行时读取清单并加载（`import.meta.env.BASE_URL` 兼容 Pages 子路径）；`gltf.ts` 重构出 `importTrackFromUrl` / `trackPackageFromGltf(metaOverride)`；`localPresetIdFor` 文件名派生稳定 ID（CJK 字符被剥除，建议 ASCII 文件名）；`loadLocalPresetTrack` 覆盖 meta `mode='preset' / presetId='local-*' / seed=0`（环境确定）；StartPage 预设下拉 data-local 项 + 重新生成激活（新 id 清榜），失败 toast 提示；目录/清单缺失 = 仅内置列表；新增 ID 派生单测（36 用例）。

## 2026-10-22 轨道预设制：预设轨道成为默认，随机生成归档为自定义
- 用户决策：之前的随机赛道生成归档为“自定义”模式；主玩法改为**预设轨道固定布局**，先支持一种预设，架构上直接支持多预设扩展。- 数据结构：`TrackMode` 扩为 `'preset' | 'simple' | 'complex'`；`TrackMeta` 新增 `presetId: string | null`（随 GLB `meta.presetId` 往返；旧文件/旧存档兼容，导入缺省回退）。
- 新模块 `src/track/presets.ts`：`PresetTrack` 接口 + `PRESET_TRACKS` 数组（首发「极光环道」aurora-ring，16 个控制点、目标 1800m、固定 seed 20260）+ `getPresetTrack`（无效 ID 回退第一个）+ `samplePresetCenterline`（Catmull-Rom 0.6 与简单模式同参）。
- 生成器：`generatePresetTrack` = 采样 → `scaleLoop` 到预设长度 → 自交即抛错（预设数据错误显式失败，不静默换形）；`buildTrack` 中 preset 走 simple 的平地管线（`meta.mode !== 'complex'`）。
- 启动页：模式下拉改“预设赛道（固定布局）/ 自定义 · 简单 / 自定义 · 复杂”，preset 模式显示预设下拉（数据驱动，后续加预设自动出现）；预设模式 seed 使用 `preset.seed`（环境稳定）；localStorage 新增 `racing.trackPreset`（默认极光环道）。
- 测试：新增预设用例（两次构建逐点一致/长度 1800±30/不自交/平地/路宽 12m/护栏存在；centerline 输入恒等 + 无效 presetId 回退）；spawn 安全点测试覆盖 preset；共 35 用例 / 74 断言。
- 文档与 skill 同步：README / AGENTS.md / requirements / roadmap / progress / `track-generation.md`（预设节）/ `storage-and-gltf.md`（settings 与 meta 往返）。

## 2026-10-22 本地文件预设：先加入后收回
- 用户决策（最终形态）：**取消**「本地文件预设」按钮与用户导入入口；本地预设定为**代码文件定义**（编辑 `src/track/presets.ts`，开发者维护），不对用户暴露 —— 保持预设“来源只有代码数据”的形式统一。
- 回退实施：
  - `StartPage.ts`：删除按钮/隐藏 input/`registerLocalPreset`/`activateLocalPreset`/`syncLocalPresetOption`；重新生成恢复为统一 `createNewTrack` 路径；信息面板恢复 `预设 · <名称>`；提示语恢复“重新生成/切换预设会清除当前赛道的排行榜”。
  - `db.ts`：移除 `presets` store 与 `loadLocalPreset/saveLocalPreset/deleteLocalPreset`；**DB_VERSION 2 → 3**，`onupgradeneeded` 里 `deleteObjectStore('presets')` 清理 v2 遗留（IndexedDB 不能用更小版本号打开，只能升版本清理）。
  - `types.ts` 删除 `LocalPresetEntry`；`settings.ts` 恢复仅校验内置预设 ID。
  - skill 与文档同步改回（track-generation / storage-and-gltf / requirements / progress / README）。
- 预设模式即时生效（2026-10-22 用户决策）：预设布局固定，无需“重新生成”——**预设模式隐藏「重新生成赛道」按钮**（仅自定义模式显示）；预设下拉选中或切到预设模式立即激活（`activatePreset`：已是该预设则直接提示；清榜前确认，取消/加载失败回退下拉与存档到当前赛道预设）。激活逻辑重构为通用 `applyTrack`（新 id → `replaceActiveTrack` → 刷新 UI）。提示语更新为“切换预设 / 重新生成会清除当前赛道的排行榜”。
- 修复：`.btn { display:inline-block }` 会覆盖 `hidden` 属性的默认 `display:none`，导致预设模式下「重新生成赛道」按钮仍然显示；CSS 增加 `.btn[hidden] { display:none !important }`（与之前 `.field[hidden]` 同类问题，教训：凡是被 CSS 赋 display 的元素，`hidden` 一律要显式处理）。
- 操纵体验重做（2026-10-23 实施，romise A+B+C）：调研结论与实现——
  - 速度敏感转向 `maxSteerAt(speed)`（0.65→0.12 rad，STEER_FALLOFF_SPEED=45 m/s 二次 ease-out）：高速不再一点就画龙。
  - 移除旧 50km/h 过弯截断（`TURN_MAX_SPEED` 及动力 taper/四轮 ramp 刹车全部删除）：高速可保持动量过弯。
  - 转向回正 3/s → 5.5/s：出弯干脆。
  - 防抬头 PD 调整（阈值 0.04→0.03、90000→160000、D 4000→8000、上限 15000→20000）：**根因发现——满油门时前轮在 pitch≈0.023 rad 即悬垂落空，旧阈值 0.04 来不及压制，高速满舵完全没有转向力**（前轮 c0/f0 实测）。过强版本（0.015/260000/8000/24000）会与后驱扭矩纠缠，在 complex 复活点产生俯仰震荡（up.y 跌到 0.33），0.03/160000/8000/20000 折中通过全部既有测试。
  - frictionSlip 3.2 静态 → 帧级动态：前轴（转向）10、后轴（驱动）3.2，前轴按侧偏角 0.2→0.5 rad 滚动衰减到 5.5。**实证**：cannon-es `maximp = suspensionForce×dt×frictionSlip`，3.2 与默认 10.5 相比转向响应严重不足（k≈0.09 时满舵完全无转向）；且后轴降抓地在稳态弯完全不改变平衡（后轮冲量需求只有几何切向量级，不担侧向力，纯推头）。
  - 侧滑抑制加门槛 `CENTERING_SLIP_LIMIT=0.25` rad：大侧偏（漂移/甩尾/回弹）时不强拉车身回直。
  - 漂移判定从「横摆率 0.6s 内翻转 ≥2 次」改为侧偏角状态机（进入 0.35 / 退出 0.15 / 最低 8 m/s，迟滞）；并澄清：**cannon-es 冲量轮胎稳态过弯车身贴轨迹、侧偏角≈0，自发甩尾不存在**，真实侧偏仅在瞬态（撞墙回弹、大转角切换、颠簸）出现，drift 标志本身可靠。测试断言随之改为稳态满舵不甩飞 + 松手回正。
  - 调试方法沉淀：`debugWheelStates()`（接触/悬架力/侧向冲量/滑移标记）、`maxSteerAt()`/`getSlipAngle()` 公开接口；曾用 `node:fs` 把逐帧状态写文件绕过 vitest 静默输出。
  - 教训：物理调参必须逐帧 dump（位置/接触矩阵/skidInfo/sideImpulse）而不是靠猜；多个“看似不相关”的测试失败可能在同一根因（前轮离地）。
- 教训：`hidden` 属性会被 `.field { display:flex }` 覆盖（本次 council 修复 `.field[hidden]`）；IndexedDB store 的增删必须通过版本升级完成，谨慎规划版本号一次性到位。

## 2026-10-22 本地文件预设
- 用户决策：保持代码内预设形式不变，**额外**支持把本地 `.glb/.gltf` 文件注册为预设（可以没有本地预设）。
- 存储：IndexedDB 升 v2，新增 `presets` store（keyPath `id`，单槽位：`saveLocalPreset` 执行 clear+put，重复导入即替换）；入口 `LocalPresetEntry = { id: 'local-<uuid>', fileName, createdAt, pkg }`（`src/types.ts`）。
- 交互：首页「本地文件预设」按钮 → `importTrackFromFile` 校验 → 注册 → 预设下拉自动追加「本地预设 · <文件名>」（`data-local` 标记，可随时被替换或移除）；与“导入赛道”（直接作为当前赛道使用）并存、语义分离。
- 激活：预设下拉选中本地项后点「重新生成」→ `activateLocalPreset` 把存档包复制为新 `meta.id` 后 `replaceActiveTrack`（与重新生成一致的清榜语义）；不自动激活，避免误清榜。
- 兜底：无本地预设时下拉仅显示内置列表；localStorage 残留 `local-*` ID 但条目已被删时回落到第一个内置预设（`syncLocalPresetOption`）；`getPresetTrack` 对 `local-*` 未知 ID 仍回退首内置（生成器级兜底）。
- 「当前赛道」信息面板对本地预设显示 `预设 · 本地文件`。

## 2026-10-23 操纵修复：油门+满舵侧翻 / S 变向迟钝（用户实机试驾反馈）
- 用户反馈两个问题（上一轮重做 69d2d80 后）：①同时按前进和转向会翻车；②转弯不能 S 形变向。
- **根因 1（侧翻）**：前轴 `GRIP_FRONT=10` → 横向加速度实测 ≈2.8g，超整车倾翻阈值（≈1.8g：重心 0.55m / 半轮距 1.0m），“油门+满舵”必侧翻；转向手感的大头收益其实来自防抬头 PD 修复（前轮不再离地），不需要那么高抓地。定稿 `GRIP_FRONT=5`（≈1.4g）、`GRIP_FRONT_SLIDING=3.3`、`rollInfluence 0.08→0.05`。中间试验值：4.5（响应偏弱）、6（≈1.7g 更灵敏但复杂地形组合下裕度小）。
- **根因 2（旋转动力学失真）**：`angularDamping=1.0` 在 cannon-es 里是 `pow(1-1, dt)=0`——**每步直接清零角速度**（node_modules/cannon-es.js L12824 `applyDamping` 实锤），旋转动力学被人为冻结：S 变向迟钝、翻车被“永不旋转”掩盖、俯仰行为失真。降低后真实动力学暴露全部问题，按复杂地形表现取 **0.75**（0.4/0.5 在斜坡上侧翻、后溜、倒车失控；1.0 失真不可回）。
- **新发现（S 甩尾的第二根源）**：固定回正 5.5/s 在 49m/s 松键后转向角滞留 0.25s+，前轮冲量借 yaw 惯量把车甩进大侧偏（slip 0.965、松手 1s 收不回来）。打角/回正速率都改为随速度自适应（`+8×(speed/45)`，45m/s 时打角 15/s、回正 13.5/s）。
- **新增滚转稳定器（街机防翻辅助）**：接地（≥1 轮）且 `up.y<0.97` 时沿车头方向施加反侧倾力矩 `min(30000, 160000×roll+12000×rollRate)`（roll=asin(车身右轴.y)），空中不介入——兜底山坡瞬态侧翻。
- **防抬头 PD 重做**：抬角度数改带符号 `asin(forward·groundNormal)`——acos 版在越过 90° 后把已翻过头的车继续往旋转方向推（复杂赛道坡顶冲出后空翻，py 发散到 -11 rad/s）；接地轮 <2 时启用空中加强版上限 `PITCH_COUNTER_AIR_MAX=48000`（坡顶仅 1 轮接触 + 悬架弹射 ≈3 万 N·m 压过地面版 20000 上限）。PD 阈值 0.03 与“过强版与后驱扭矩纠缠”教训不变。
- **回归测试**：新增“全油门+满舵从静止转圈不翻车”与“行进中 S 变向横摆反向+不翻车”（it.each 双模式、带护栏与游戏内一致）；调试教训：`it.each` 失败标题的 mode 前缀要与实际输出对照确认（本次曾误把 complex 失败当 simple 分析，靠打印 start 坐标实锤）。

## 2026-10-23 四轮驱动（用户要求“能不能改成四驱”）
- 实施：前轴每轮在原后驱力基础上**叠加** `force × FRONT_DRIVE_RATIO`（0.5，即前轴总驱动力 ≈ 后轴一半，后偏四驱），倒车+转向保持旧逻辑四轮全给满力（10 m/s 上限行为不变）。
- **关键实验（对照迭代）**：先做“总力守恒”版（前/后各拿一半、四轮总和等于原 2×ENGINE_FORCE）——0-100 反而从 1.5s 慢到 2.3s。逐帧 dump 发现直线全油门时前轮几乎全程悬空（chain=[0011]、前悬架力 0，悬架伸长到行程极限）；再用 `FRONT_DRIVE_RATIO=0` 对照证实**前轮抬起是纯后驱时代就存在的固有现象**（急加速重心后移/惯性俯仰力矩压空前轮），旧 1.5s 加速本来就是纯后轮在推。守恒版在前轮不接地时只剩一半动力。改为叠加版后 0-100/极速恢复。
- 顺带修复潜在 bug：cannon 的 `wheel.engineForce` 跨帧残留，旧代码只在“倒车+转向”帧写前轮，之后的前进帧漏设会让残余动力延续；现在每帧四轮都设置。
- 回归测试 `simple: AWD drives all four wheels (front = half share, additive); reverse+turn boosts to full`：四轮驱动 + 前轴半份额 + 倒车转向满力 + 无跨帧残留；S 变向测试入口速度从 120 帧降到 80 帧（~28m/s）——满舵 S 在 40m/s+ 横向滑出路面撞护栏贴墙属正常物理，四驱让车在弯里保速更快更早贴墙，不能作为“S 不响应”判据。
- **教训重犯**：用 PowerShell `-replace | Set-Content` 改 CJK 注释导致 UTF-8 乱码（vehicle.ts 靠 `git checkout --` 恢复重做）；`Add-Content` 追加中文日志同样按 ANSI 写入变 GBK 乱码（0d8e252 提交内的 discussion-log 追加段即坏），靠取 69d2d80 父提交 + node fs 以 UTF-8 重建。**中文文件一律用 edit/write 工具或 node fs，禁止 PowerShell 管道改写。**

## 2026-10-25 驾驶手感包批 1（用户选定六项，本批 = 手感 D+E + 前轮贴地 + 空中姿态）
- 油门缓入 `THROTTLE_RAMP_RATE = 14/s`（松开回零 ×2.5 = 35/s）；AWD 引擎力回归测试为适配缓入，改为“30 帧先把平滑踏板推满再读各轮发动机力”。
- 刹车偏置：前轮 ×0.6 / 后轮 ×1.4（总容量守恒 4×brake），压制急刹点头。
- **squat 调参长跑（前轮贴地）**：
  1. 对照起点：纯后驱时代直线全油门，前轮几乎全程悬空（接地率 ≈17.5% = 21/120）。
  2. 第一方案“后轴差分压缩阻尼 14→20”：接地率纹丝不动，且 complex 起步段冲击缓冲变差（spawn 野地反复颠飞，80 帧只冲到 10.6 m/s）→ **撤销**。定性原因：压缩阻尼是瞬态粘性项，对 sustained squat 的**静态平衡**无效。
  3. 第二方案“抗 squat 前馈反扭矩 = FACTOR × 总驱动力（沿车体 right 轴施加低头力矩）”：0.35（57/120）→ 0.45（52/90）→ 0.55（过阈）；但 **0.55 在斜坡翻车**：前轴压力位移 ΔF = counter/轴距 = 4645N > 后轴静载 ≈3800N → 两后轮被压到**完全离地**，后驱失效只剩前轴 4125N，爬坡抓地不足 → 倒滑 −9 m/s；且倒滑时 fwdSpeed<30 的速度门仍然常开 → 死循环。
  4. 终稿：FACTOR=0.45 + **速度门 fwdSpeed<30**（squat 只在起步/中速大油门真实发生；不设门时高速满舵稳态过弯的 steady slip 从 0.3 限值翻倍到 0.63，两个系数皆如此）+ **ATI_SQUAT_MAX=12000 结构上限**（ΔF ≤ 4510N，任何工况永不卸空后轴）。
  5. 回归测试：前 90 帧（与门窗口一致）前轮接地率 ≥49/90（实测 52）。
- **空中姿态**：`AIR_ANGULAR_DAMPING = 1.2/s`（四轮全离地时按比例衰减角速度）——坡顶空中防抬头 PD 的 bang-bang 振荡被缓住，落地更顺；不影响抛物线。
- 连带测试语义修正（行为语义变化，非 bug）：①稳态满舵过弯用例改**速度门**（拉到 38.5 m/s ≈138km/h 再进弯——四驱+抗 squat 后同帧数冲得更快，判据必须同速同判）；②complex“飞起必须下落”改**双保险**（maxAir>0.4 时谷速须 <−1；否则由 maxAir<4.5 的“无界飞行”兜底——重力若失效 maxAir 会先爆，安全语义不弱化）；③S-switch 入口 90 帧 / 阈 >18（complex 起步段野地颠簸，实测入口 19.1）。
- 门禁：typecheck / 44 用例 / build 全过。
- **教训第三次**：PowerShell 管道改写 CJK 源文件（`-replace | Set-Content -Encoding UTF8`）写入 BOM（内容未坏，node 清理）——统一用 edit/write 工具或 node fs 处理含中文的文件。

## 2026-10-25 高速碰撞加固（known-issues #1 批 2）
- **复现实验先行**：最小独立场景（水平 Plane + 直墙 Box，不经轨道生成器），依次实测：①55 m/s（≈200km/h 极速）全油门正撞；②15° 浅角 45 m/s 贴墙蹭行；③双段护栏 0.01m 接缝正冲；④45° 斜冲护栏箱体边缘角。
- **结论**：四工况在当前引擎下**全部接住**——穿透 0.00m、垂直弹跳 ≤2.6 m/s、无翻车、无穿墙。历史“穿墙/异常弹跳”大概率是旧引擎状态的问题；2026-10-20 的“立即沿法线回弹 + 保留 80% 速度”和后续稳定器已覆盖主要工况。
- 已实施：护栏**碰撞盒**向路外方向额外加厚 `BARRIER_COLLIDER_DEPTH_EXTRA = 0.8`（总深 0.8 → 1.6m）——重点是**前内侧面位置与可见面严格不变**（碰撞反馈位置零漂移），只向外扩隐形体积；机理：高速每步位移 ≈0.92m，更深的碰撞体外侧让“第一步没接住”的接触体在下一步依然重叠，求解器持续修正。物理子步保持 1/60（120Hz 全局加密会在松油时俯仰失稳，教训在案；若真实轨道仍偶发穿墙，下一步才考虑“速度相关子步加密”，需把闭环控制全部搬进子步内施加——current 帧-级力矩会被 cannon 每步清零稀释）。
- 测试：新增 `tests/barrier-collision.spec.ts` 四场景固化（穿透 <1m、弹跳 <4~6m/s、upMin>0.6）；vitest 排错记录：cannon-es 的 Body 上 `shape` 属性不是最高效路径，`shapes[0]` 才是数组（曾报 undefined）。
- known-issues #1 状态改为“2026-10-25 大幅缓解”，遗留不确定性（复杂地形贴坡护栏组合）由人工试驾继续盯。
- 门禁：typecheck / 46 用例 / build 全过。

## 2026-10-25 音效（用户选定六项中的批 3）
- src/audio/engine.ts（零新依赖，WebAudio 纯合成）：①引擎声——双锯齿轻微失谐 + 三角次低音 → 低通（750→2650Hz 随负载开合）→ 引擎增益；音高 60Hz（怠速）→ ≈225Hz（极速，speedNorm 线性）× 油门 +20%；音量 = 0.05 + 0.05×速度 + 0.06×油门（封顶 0.17）。②碰撞闷响——带通白噪爆点（140-360Hz 随冲击），峰值 min(0.5, 0.08+impact×0.012)，0.22s 指数衰减；在 onBarrierCollide（≥6 m/s 冲击阈值同震动反馈）内触发。③漂移啸叫——2100Hz 带通循环噪声，随 drift 状态淡入淡出。
- 接线：Game 构造（首页“开始游戏”**用户手势链路内**）audio.init()（浏览器 autoplay 政策要求）；tick 活动分支 update(speed, throttle, drifting)；空格暂停/结算面板 setPaused(true)（引擎+啸叫自动静音，暂停不再空鸣）；撞墙回调 impact()；dispose ctx.close()。
- 静音按钮：HUD 右上 🔊/🔇（hud-back 左侧，right:118px），状态存 localStorage racing-audio-muted，刷新保持。
- vitest 兼容：AudioContext 不存在时（node 环境）全方法 no-op，readMutedPref 有 typeof + try/catch 守卫——实例化不炸（46 用例仍绿）。
- 门禁：typecheck / 46 用例 / build 全过。浏览器人工验收项：进入游戏听到引擎声随速度/油门变化、撞护栏有闷响+画面震动、漂移有啸叫、🔊 按钮可静音、刷新静音状态保持。

## 2026-10-25 代码分割（用户选定六项中的批 4）
- vite 8 = rolldown 内核，分块用 **advancedChunks**（不是 rollup 的 manualChunks 语义）；groups 按 node_modules 路径匹配：vendor-three / vendor-cannon 两个独立包。
- 结果：主入口 55.3KB（gzip 19.2KB，原 >500kB）、vendor-cannon 99.0KB（gzip 28.7KB）、vendor-three 666.3KB（gzip 169.0KB，库本体）；chunkSizeWarningLimit 调至 750 —— vendor-three 独立成包后“>500kB”警告对它已无 actionable 意义（进一步只剩路由级动态 import，游戏单页无意义）。
- middleware 依赖顺序：index.html 直接引用入口 JS，三个包并行下载；vendor 包内容随依赖版本变化才失效缓存，长期缓存友好。
- 门禁：build 无警告 / typecheck / 46 用例全过。

## 2026-10-25 更多预设赛道（用户选定六项中的批 5）
- 新增两条官方预设（控制点数据，首页下拉数据驱动自动出现）：
  1. 落日余晖 sunfall-sweep（seed 31415，length 1800m）：13 点大半径高速环道，西侧 [−250,10]→[−180,60]→[−230,130] 一组顺滑回旋弯。
  2. 回旋花廊 windmill-corridor（seed 27182，length 1400m）：13 点双发卡回旋（x≈±90 缩进）+ 底部直道 [60,−150]→[−60,−150]，紧凑技术环。
- 设计经验：Catmull-Rom(0.6) 对控制点序列的平滑让“发卡钩形”不自交——本组控制点实测最大逐步航向变化 0.079rad（1.2m 采样），远低于 simple 轨 0.3rad 的 zigzag 判据；scaleLoop 把采样环精确缩放到 length（1800/1400 命中 ±0m）。
- 实测指标驱动了永久断言阈值：非邻接最近间距 42（极光）/34（余晖）/32（花廊）m → 断言 >25m 留裕度（可拦未来误改自交/贴环）；长度 |total−target|<1m；两次构建前 30 点逐位一致（确定性）；静止 30 帧 ≥3 轮接地冒烟。
- track.spec.ts 新增 describe('preset tracks')：registry 1 条（id/名字唯一、aurora 仍为默认回退）+ it.each 每预设 5 检查；排错记录：track.spec 此前未导入 createCarRig，补 import 后 11/11 绿。
- 门禁：typecheck / 50 用例 / build 全过。人工验收项（浏览器）：首页下拉出三条预设、选择后进场布局正确、各预设计时与排行榜隔离（presetId 区分）。

## 2026-10-25 光影细化（用户追加选定）
- 共享管线 src/render/lighting.ts：Game 与 TrackPreview 都改为同源配置，阻止两页观感漂移。
- 色彩管线：ACESFilmic + 曝光 1.05（原 NoToneMapping 直出，高亮无 rolloff）；太阳暖色 0xfff2e0 强度 2.0、半球 0xbfd9ff/0x6d7f66 按管线重配（原 1.6/1.05 是无色管数值）；scene.environmentIntensity = 0.5（three r163+ 的全局环境强度，车身 metalness 0.55 从死黑获得天光反射）。
- 天空穹顶：96×48 球体 + 逐顶点渐变色（天顶 0x427fd4 → 地平线 0xcfe9ff；下半球向 0x87a86d 地色），内置 MeshBasicMaterial 保证走 three 的色调映射与 sRGB 输出链路（自写 ShaderMaterial 不含 tonemapping/colorspace chunk 会绕过管线——坑：自定义 shader 直出颜色与内置材质色调不一致）；fog:false + frustumCulled false + renderOrder −1。雾色 = 地平线色，远处物体渐隐与天际无缝。
- 太阳纹素对齐（根治移车阴影边缘亚像素抖动——此前只“跟随”未“对齐”）：
  1. 光空间正交基由恒定光轴 SUN_OFFSET=(120,180,80) 推导（X = UP×viewDir，Y = viewDir×X）；焦点在 X/Y 轴上投影值吸附到 texel = 视锥宽/2048（默认 180/2048 ≈ 0.088m）网格，Z（深度轴）不吸附。
  2. 光位置 = 吸附后焦点 + SUN_OFFSET（偏移向量恒定 ⇒ 相机屏幕轴逐帧位移保持整纹素平移，贴图内容不再在纹素间漂移）。
  3. 支持 update(focus, frustumSize?) 动态视锥：预览页 car 近景 110m、scene 全景 max(400, radius×1.6+80)——同一视角内保持恒定网格才稳定；texel 随视锥重算，切换后 grid 一次性重排（可接受）。
  4. bias −0.0002 / normalBias 0.05 防 acne 与光漏；near 10 / far 800 覆盖背后树石投影。
- 接收标记补漏：起终点线此前漏 receiveShadow（car 阴影不落在白色横线上）。
- 排错记录：①update 的 frustumSize 语义首版把全宽当半宽用（测试“frustum applied”抓住）；②lighting.spec 首版有草稿残留断言，重写为整纹素步进 / 吸附误差 ≤texel/2 / 幂等 / 视锥切换四检查 + 穹顶材质断言。
- 门禁：typecheck / 52 用例（含新增 lighting.spec 2 条）/ build 全过。浏览器人工验收项：ACES 色调观感是否合口味（可调 exposure）、车漆反射效果、移动中车影不再抖动、预览页与游戏页观感一致。

## 2026-10-25 验收反馈批：转向顺滑 + 曝光调暗
- 用户实驾两点反馈：①"色调太亮"；②"左右向控制不够顺滑"。
- **曝光**：toneMappingExposure 1.05 → 0.85。原则：全局明暗只动曝光这一个旋钮（光强/环境强度都先不动），便于下次反馈归因——若还偏亮/偏暗继续微调此值。
- **转向梯形速度曲线**（替换指数平滑，src/physics/vehicle.ts trackSteer）：
  - 旧指数式两个毛病：起步一帧吃 11.7% 满锁（7/s×dt，0.076 rad，键盘点按"猛一拽"）；收敛带长尾（率达 15/s 也只是快起来了，回正 5.5/s 过零段最慢——"松手黏、换向发滞"）。
  - 新跟踪器每帧三约束：v ≤ VMAX(=4.2×(1+1.3·t)，t=speed/45) 匀速中段；|Δv| ≤ 38·dt 软启动（首帧位移 ~0.005 rad，比旧值柔和 ~15×）；v ≤ √(2·38·剩余角) 二次制动→零过冲贴齐。全锁 0.65rad 静止 ~0.26s 到位；高速（45m/s）vmax ~9.7，目标角小（0.12rad）近乎即时——沿用旧设计动机：转向角不在前轮冲量上滞留（yaw 惯量甩尾根源，2026-10-23 教训）。
  - 打角/回正/换向共用同一跟踪器：换向过零恒速，不再"越接近 0 越慢"。
  - reset() 顺带清 steerVel（新状态），steerCurrent 保持旧行为不额外清零（不影响重生判据）。
- **测试教训（本次踩的第三个数值容差坑）**：换向单调性用 1e-9 容差首轮失败——真凶不是回跳，是静止残留速度（±0.0002 m/s）使 target=maxSteerAt(fwdSpeed) 微移 ±1e-6，跟踪器如实追贴造成 ±1e-6 的"上升"。纯数学离线仿真（node 直接跑算法）先验证是单调的，再对比装备版本定位到目标抖动。诊断顺序：先纯算法复现 → 再上 rig。容差原则：判"真卡顿"（≥1e-3 级跳变）用 1e-4。
- 新增 tests/steer-feel.spec.ts 2 用例：①梯形画像（软启动 <0.012 rad、步长 ≤ vmax·dt、9-20 帧到全锁、零过冲）②换向单调过零 1-14 帧 + 回正 ~0.3s 收敛无尾。S 换向/稳态过弯/转向衰减等既有判据全部复跑通过（梯形只会更快过零，不踩线）。
- 门禁：typecheck / 54 用例（+steer-feel 2）/ build 全绿。
- 浏览器人工验收：打角起手是否"跟手不发呆"、连续左右切换是否顺畅、松手回正是否干脆不拖滑；亮度是否合适（偏暗可 0.9 折中）。

## 2026-10-26 满舵十字路口可达性
- 用户反馈："最大转角需要能正常过十字路口"。解读：12m 路宽、90° 直角弯（十字/T 口），满舵应在实用车速下走得进去且不失控。
- 先测后调（最小独立场景、水平地面、无护栏/轨道；速度保持器钉速 + 满舵转 8s，末 2s 取 v/yawRate 均值）：
  - 调参前：5.3m/s→5.4m、8.3→6.1m、10.3→6.6m、13.7→7.6m（这一档都干净）；但目标 20m/s 时速度塌到 ~14.3 并出现 yawRate 2.6+ 的陀螺式自转——满舵干净上限 ≈14 m/s（50km/h）。
  - 为什么不是"更大转角"：中高速横向需求 v²/R 早已超出轮胎能力（后轴 3.2 + 前轴滑移衰减 3.3），继续加角只会滑得更宽、更早自旋。减小弯路正确的杠杆是"深弯保持前轴咬合 + 后轴抗自旋 + 低中速少丢角"。
- 三处调参（src/physics/vehicle.ts）：
  1. maxSteerAt 衰减曲线 二次 ease-out → 幂 1.7：低速 8.3m/s 角度 0.472→0.504（+7%）、中速 19.4m/s 0.29→0.34（+18%）、高速端点 0.12 不动（200km/h 稳定性红线不碰）。
  2. GRIP_FRONT_SLIDING 3.3→3.8：前轴深滑不丢咬合——欠转甩出主因；0.5+ 侧偏仍显著弱化，防失控。
  3. GRIP_REAR 3.2→3.5：压住满舵中速的陀螺自转；漂移阈值/进入行为不动。
  - 调参后：11.1m/s→6.5m、13.6→7.2m、14.6→7.5m、16.6→8.2m 全部干净（yawRate ≤2.03、upMin 1.000）；干净满舵上限 14.6→16.6 m/s（50→60km/h）。20m/s+ 满舵仍保持不住（掉速/自旋属物理上限，玩家需先刹车）——这正是"十字路口要减速通过"的真实行为。
- 永久回归 tests/crossing.spec.ts（最小独立场景，不依赖真实轨道）：①40km/h 级 11m/s：稳态 ≥10.2、半径 ≤8m、yawRate ≤2.0、不打翻；②60km/h 级 17m/s：稳态 ≥15.5、半径 ≤9m、yawRate ≤2.2。阈值留 ~10% 余量（实测 6.5/8.2）。
- 兼容性：既有 56 用例（S 换向、稳态 38.5m/s 过弯、转向衰减端点、翻车回归等）全部复跑通过——maxSteerAt(0)=0.65 与 maxSteerAt(45)=0.12 端点不变，S 换向判据不受影响。
- 门禁：typecheck / 56 用例（+crossing 2）/ build 全绿。浏览器人工验收：60km/h 左右进 90° 弯满舵是否可控贴线、深弯是否还有推头甩出、日常小弯是否更跟手。

## 2026-10-27 文档盘点与简历物料
- 用户要求：更新文档文件、提炼简历要点、记录不足。
- README 事实校准：预设改三条（极光环道 1.8km 默认 / 落日余晖 1.8km / 回旋花廊 1.4km）；测试 35→56 用例（8 spec）；依赖列删除 idb；修正"转向时最高时速 50km/h"旧描述（限速墙早已移除）；补音效（WebAudio 合成 + 静音）、光影（ACES/天空穹顶/PMREM/纹素对齐）与四驱/手感/梯形转向要点；目录结构补 render/ 与 audio/；文档索引补 known-issues 与 resume-highlights。
- roadmap：M3 勾选音效/光影/代码分割；新增"反馈迭代（2026-10-25~10-27）"小节；三条预设从待办移入已完成；仅剩多文件 gltf+bin 与录像回放。
- tech-stack：测试行改为 8 spec 56 用例；新增音效（WebAudio 纯合成）与渲染（ACES/PMREM/纹素对齐阴影 + vendor 分块）选型行。
- known-issues 新增 #5「工程与体验层面的不足」：人工验收未闭环、无移动端/触屏、CI 只跑 typecheck+build 未跑测试、玩法广度（回放/多文件导入/编辑器）、音画简化、物理近似与性能架构。
- 新增 docs/resume-highlights.md：一句话定位、技术栈、9 条量化简历要点、数据一览表、不足记录、三个面试讲述故事（阴影纹素对齐 / 梯形转向与测试容差定位 / 先测后调过十字路口）。
- 数字口径：源码 28 文件 4,475 行；测试 8 spec 56 用例 1,313 行；主入口 55KB（gzip 19KB）；预设 1800/1800/1400m；满舵稳态半径 6.5/7.5/8.2m @ 11.1/14.6/16.6 m/s。
- 门禁：本次仅文档改动，仍跑 typecheck / test / build 确认无破坏后提交。

## 2026-10-28 终点停音与静音按钮居中
- 用户验收反馈两条：①终点后声音应该停止；②声音按钮图标没有居中。
- 停音根因复盘：`Game.finish()` 确实调用了 `audio.setPaused(true)`，但 `setPaused` 只写 `this.paused` 标志；真正把 `engineGain` / `driftGain` 推向 0 的是每帧 `update()` 里的 `silent` 分支，而结算后 `tick()` 不再调用 `audio.update()`（暂停同理），于是循环音停留在最后一帧的增益（引擎低鸣 + 可能的漂移啸叫）一直播下去。
  - 修复（src/audio/engine.ts）：`setPaused(true)` 时直接用 `setTargetAtTime(0, t, 0.06)` 把两条循环音增益推向 0，不依赖下一帧；`setPaused(false)` 不动增益，交给下一帧 `update()` 按当前车速/油门淡入，避免恢复瞬间先静音再跳变。暂停与终点共用该路径，一并修掉暂停态的潜伏问题。
  - 一次性音（碰撞 `impact()`）不受影响：它本来就是 `src.stop()` 自动结束，且 `paused || muted` 时直接 return。
- 图标不居中根因：`#hud-audio` 复用 `.btn`，而 `.btn` 为 `display:inline-block; padding:10px 16px`；在 44px 定宽里左右内边距吃掉 32px，只剩 12px 内容区，emoji 字形被挤偏且垂直方向受行高与默认基线影响。
  - 修复（src/styles.css）：`.hud-audio` 改为 `inline-flex` + `align-items:center` + `justify-content:center` + `padding:0` + `line-height:1`，显式 `width:44px; height:42px`（与「返回首页」按钮视觉同高）。
- dev server（5199）实测 DOM：`display:flex`、`alignItems:center`、`justifyContent:center`、`padding:0px`、`lineHeight:18px`、尺寸 44×42、文本 🔊——布局层面已居中；像素级截图受环境限制（需要可见桌面窗口）未能采集，最终观感由用户本机确认。
- 门禁：typecheck / 56 用例 / build 全绿（改动仅音频与 CSS，无测试影响）。
- 附注：dev server 控制台仍见 `THREE.Clock` 弃用提示（建议 `THREE.Timer`）与 WebGL `X4122` 精度告警（驱动/shader 编译期噪声，不影响运行），记为后续可选清理项。

## 2026-10-28 护栏加高 + 轨道判定加宽 + 出轨后碰撞失效修复
- 用户反馈：①加高轨道（护栏）高度；②轨道宽度 UI 可不变，但加大判定；③车出轨一次后，车与轨道的碰撞判断失效，反复出轨。
- 复现（最小物理场景，`windmill-corridor` 发卡弯 idx 720）：先把车瞬移到路外 20m 模拟第一次脱轨，满舵全油门 23 帧后按 `findSafeSpawnIndex` 重生；随后 12 秒内每约 128 帧再次脱轨，共 6 次，末速约 14.8m/s，`onBarrierCollide` 触发 **0** 次——车直接从护栏位置穿出。
- 根因：**静态护栏 Body 的 AABB 从未按世界坐标刷新**。`new CANNON.Body({ shape })` 在构造时 `addShape → updateMassProperties → updateAABB`，此时 `position` 仍是原点；随后代码才 `body.position.set(...)` / `quaternion.setFromEuler(...)`。静态体不 integrate，`aabbNeedsUpdate` 保持 false，AABB 永远停在原点。
  - `SAPBroadphase` 用 `aabb.lowerBound.x` 排序、用 `checkBounds`（position ± boundingRadius）提前 break；AABB 在原点导致排序错位，pair 循环在错误位置提前结束，护栏 pair 根本不会进入 narrowphase。
  - 实测：护栏 body 491 位置 `(-140.62, 0.66, -78.58)`，AABB 却是 `lower=(-1.2,-0.66,-1.69) / upper=(1.2,0.66,1.69)`；`chassisIdx=1`、`barrier491Idx=493`，pair 循环 `breakAt=2`；穿墙帧 `aabbOverlap=false`、`worldContacts=0`。把护栏 `updateAABB()` 提前后，同一路径在 11-12m/s 被护栏接住并回弹。
- 修复：
  1. `buildBarriers()` 两处（跨点长段 / 弯心短段）在设置 position/quaternion 后显式 `body.updateAABB()`；`CarPhysics.addGround()` 再做一次防御性 `updateAABB()`。
  2. `BARRIER_HEIGHT_FACTOR` 1.1 → 1.5（护栏 1.32 → **1.8m**）。
  3. `BARRIER_COLLIDER_DEPTH_EXTRA` 0.8 → 1.2，并把半厚公式从 `t/2 + extra` 改为 `t/2 + extra/2`（中心仍外移 `extra/2`）。旧公式内侧面实际侵入路面 0.35m，与“只向外加厚”注释相反；新公式内侧面与可见内侧面重合，纯向外扩，等效行驶宽度每侧回补 0.35m。
  4. `OFFTRACK_MARGIN` 0.5 → **1.2m**（视觉路面/护栏宽度不动），满足“宽度 UI 不变、判定加宽”。
  5. `CarPhysics.reset()` 清零 `steerCurrent`（旧实现只清 `steerVel`，重生时仍按方向键会带着满舵出弯）、刷新底盘 AABB 并 `wakeUp()`；`Game` 出生朝向从 `tangents[0]` 改为实际安全出生点 `tangents[startIdx]`。
- 回归防护：
  - `tests/track.spec.ts`：barrierHeight 断言改 1.8；新增三预设“护栏 AABB 必须包含旋转后的 8 个角点且围绕 body 位置”。
  - 新增 `tests/barrier-respawn.spec.ts`：发卡弯先冲出赛道一次 → 重生 → 满舵全油门 3 秒，要求重生后 `steerCurrent=0`、护栏碰撞 >0、脱轨重生 0 次、横向越界始终小于加宽后的判定余量。
- 门禁：`pnpm typecheck` / 58 用例 / `pnpm build` 全绿。实机手感与护栏高度观感仍需用户本机浏览器验收。

