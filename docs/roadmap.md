# 路线图

## M0 规范与工程（已完成）
- [x] git 初始化、Vite + TS 脚手架、pnpm 固化（packageManager/.npmrc）
- [x] AGENTS.md 项目规则
- [x] 项目技能 `.agents/skills/racing-game-dev/`（SKILL.md + references + openai.yaml + 校验通过）
- [x] docs 四件套（requirements / tech-stack / roadmap / progress）

## M1 最小可玩版（已完成）
- [x] 启动页：玩家名称、汽车颜色、赛道模式、开始游戏、排行榜、重新生成（清榜确认）、导入/导出
- [x] 赛道初始化自动生成（简单平面）并写入 IndexedDB；单活动赛道
- [x] 汽车代码生成 + 颜色；轮子转动（物理驱动）+ 前轮转向
- [x] cannon-es RaycastVehicle 车辆 + 护栏/地面碰撞
- [x] 翻车/脱轨/坠落检测 → 重生 + 时间/距离惩罚（计入用时）
- [x] 游戏页：追尾相机、速度/计时/惩罚 HUD、2D 俯视小地图、空格暂停、返回首页
- [x] 单圈计时冲线结算 → 排行榜写入
- [x] GLB 导出 / .glb、.gltf 导入（含赛道数据校验）

## M2 复杂赛道（已完成）
- [x] 分形噪声高度场生成起伏中心线/路面/地面
- [x] 复杂模式物理：路面 Trimesh + 兜底平面
- [x] 脱轨/翻车判定适配 3D 起伏（基于最近中心线投影）

## M3 打磨与可选（待确认后实施）
- [ ] 环境装饰（树/石头等）
- [ ] 音效、更丰富光影/阴影优化
- [ ] 多文件 `.gltf + .bin` 导入
- [ ] 自动化测试（vitest）、性能/包体优化（代码分割）
