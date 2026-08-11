# 进度记录（已完成 / 未完成）

> 每次里程碑或重大变更后更新本文件；浏览器人工验收项在实施机器上执行。

## 已完成
- [x] 需求梳理（`docs/requirements.md`，10 条原始需求映射 + 补充规则）
- [x] 技术栈分析与决策（`docs/tech-stack.md`：Vite 8 + TS 7 strict + three + cannon-es + idb + pnpm）
- [x] M0 规范与工程
  - [x] git 初始化；pnpm 固化（`packageManager` + `.npmrc`）
  - [x] `AGENTS.md` 项目规则
  - [x] 项目技能 `.agents/skills/racing-game-dev/`（SKILL.md + 3 份 references + agents/openai.yaml，`quick_validate.py` 通过）
  - [x] docs 四件套（requirements / tech-stack / roadmap / progress）
- [x] M1 最小可玩版（全部功能项，见 `docs/roadmap.md`）
- [x] M2 复杂赛道（分形噪声起伏 + 路面 Trimesh 物理）
- [x] 对话决策记录文档 `docs/discussion-log.md`（后续决策/问题/修改方式持续追加）
- [x] Bug 修复：开局即掉落（Plane 默认法线为竖直面，已旋转为水平）；`pnpm smoke` 新增“车辆不下坠”回归断言
- [x] 工程验证：`pnpm typecheck`、`pnpm build`、`pnpm smoke`（Node 冒烟：赛道生成/物理/GLB 往返）全部通过

## 未完成 / 待办
- [ ] 浏览器人工验收（本机运行 `pnpm dev` 后按清单逐项确认）：
  - [ ] 启动页各控件与排行榜展示
  - [ ] 完整跑一圈冲线 → 排行榜写入
  - [ ] 刷新后赛道/排行榜持久化
  - [ ] 重新生成赛道 → 确认弹窗 + 排行榜清除
  - [ ] 导出 .glb → 导入回游戏（含非法文件提示）
  - [ ] 翻车/脱轨重生与 +3s、距离惩罚显示
  - [ ] 空格暂停/恢复、返回首页按钮
  - [ ] 小地图与车辆位置一致
- [ ] M3 打磨与可选：环境装饰（树/石头）、音效与光影、多文件 `.gltf+.bin` 导入、vitest/代码分割

## 环境备注
- PowerShell 下 `npm.ps1` 被执行策略禁用；pnpm 写入 `AppData\Local\pnpm` 全局配置目录需授权执行。
- 本机未安装可用浏览器（Chrome/Edge/Playwright），浏览器验证需人工进行。
