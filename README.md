# 极速赛道 Racing

基于 [three.js](https://threejs.org/) 的代码生成赛车游戏：赛道与汽车全部由代码实时生成，支持简单/复杂两种赛道模式、单圈计时排行榜、GLTF/GLB 导入导出、本地持久化与 GitHub Pages 部署。

## 特性

- **双页面**：启动页（设置、排行榜、赛道管理）+ 游戏页（HUD、小地图、暂停）。
- **赛道生成**（1600~2600m 随机）：
  - 简单模式：随机控制点 + Catmull-Rom 光滑闭环，不突左突右、不自交。
  - 复杂模式：随机有机八字 / lemniscate（非圆环、必有立体交叉），海拔采用“弯道平台 + 直道短坡”，重叠处强制高度差。
- **代码生成汽车**：同一模型函数仅按颜色区分，轮子转向/滚动由物理驱动；轮距外扩、相机视角可清晰看到前轮。
- **物理**：cannon-es 四轮悬架车辆；翻车/脱轨/坠落重生并计入时间与距离惩罚；高速上坡不飞起；转向时最高时速衰减到 50km/h。
- **数据**：IndexedDB 持久化赛道与排行榜（单活动赛道）；GLB 导出 / `.glb`、`.gltf` 导入；玩家名/颜色/模式存 localStorage。
- **部署**：内置 GitHub Pages 工作流。

## 技术栈

Vite 8 · TypeScript 7（strict）· three.js · cannon-es · idb · pnpm

## 快速开始

```bash
pnpm install
pnpm dev        # 开发服务器
pnpm typecheck  # 类型检查
pnpm test       # vitest 测试（赛道生成/物理/GLB 往返，约 50 项断言）
pnpm build      # 生产构建到 dist/
pnpm preview    # 预览生产构建
```

> 本机 PowerShell 下 `npm.ps1` 被执行策略禁用；pnpm 写入全局配置目录时需授权执行。

## 操作方式

| 按键 | 功能 |
| --- | --- |
| W / ↑ | 加速 |
| S / ↓ | 刹车 / 倒车 |
| A / ← 、D / → | 左右转向 |
| 空格 | 暂停 / 继续 |
| 返回首页按钮 | 回到启动页 |

## 玩法

- 单圈计时赛：完整一圈冲线后写入当前赛道排行榜（用时升序前 10）。
- 翻车（车身侧倾 >70° 持续 1s）、脱轨（偏离路面半宽 +0.5m 持续 0.4s）或坠落会重生到最近赛道点，并产生固定 +3s 时间惩罚与进度回退距离惩罚（均计入用时）。
- 转向时最高时速限制为 50km/h；发动机限速 200km/h（下坡可超速）。
- 重新生成赛道会清除当前赛道排行榜；导入外部赛道同样替换并清榜。

## 赛道生成规则

- 简单：随机点 + 光滑曲线，不要求直线，不突左突右，自交自动换种子重试。
- 复杂：随机有机八字 / lemniscate；海拔按区段平台（弯道水平）+ 段界短坡（坡在直道、无断崖）；重叠/交叉处强制高度差（桥式）。
- 护栏：按局部宽度端点对齐，跨弯心自动拆短段，杜绝横穿；护栏高 = 车高 0.75 倍。
- 赛道宽 = 车宽 × 6（12m），弯道按曲率最多加宽 40%。

## 项目结构

```text
src/
  pages/        启动页 / 游戏页（hash 路由）
  track/        赛道生成、GLTF/GLB 导入导出
  car/          汽车模型生成
  physics/      cannon-es 车辆与规则
  ui/           HUD、小地图、启动页 3D 背景预览
  storage/      IndexedDB 与 localStorage
  game/         游戏主循环、单圈进度
docs/           需求梳理 / 技术栈 / 路线图 / 进度 / 决策记录
.agents/skills/racing-game-dev/   项目技能（agent 协作规范）
tests/          vitest 测试套件
```

## 部署到 GitHub Pages

1. 推送仓库到 GitHub（仓库名建议保持 `racing-games`）。
2. 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
3. push 到 `main` 即自动构建发布（见 `.github/workflows/deploy.yml`），访问 `https://monon98.github.io/racing-games/`。

## 文档

- [需求梳理](docs/requirements.md)
- [技术栈](docs/tech-stack.md)
- [路线图](docs/roadmap.md)
- [进度记录](docs/progress.md)
- [决策与修改记录](docs/discussion-log.md)

## 许可

[MIT](LICENSE)
