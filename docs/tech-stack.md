# 技术栈与选型

| 领域 | 选择 | 理由 |
| --- | --- | --- |
| 包管理 | pnpm 11.17 | 已锁定 `packageManager` + `.npmrc package-manager-strict`；速度快、磁盘占用低 |
| 构建 | Vite 8 + TypeScript 7（strict） | 现代浏览器目标、秒级冷启动、原生 TS 优先 |
| UI | 原生 TS + DOM | 三个页面（启动/游戏/预览），避免框架依赖；3D 游戏循环不受 React 渲染干扰 |
| 3D | three.js 0.185（WebGLRenderer） | 需求指定的基础库 |
| 物理 | cannon-es 0.20 | 纯 JS 刚体物理，内置 RaycastVehicle 悬架车辆；翻车/碰撞足够真实，集成简单 |
| 持久化 | 原生 IndexedDB（已移除 idb 依赖）+ localStorage | 赛道包（含 GLB Blob）与排行榜存 IndexedDB；玩家名/颜色/模式存 localStorage |
| 赛道格式 | GLTF 2.0（.glb 导出；.glb/.gltf 导入） | 中心线等赛道数据写入 userData/extras 随 GLB 单文件往返 |
| 小地图 | 2D Canvas | 俯视投影绘制赛道轮廓+车辆，比第二视角 3D 渲染更轻、更清晰 |
| 路由 | hash 路由 | `#/start` / `#/game` / `#/preview`，无需服务器配置，静态部署即可 |
| 测试 | vitest | 拆分为 track/physics/gltf/rules 四个 spec + helpers；`pnpm test` 全量，`pnpm test:track/physics/gltf/rules` 针对性运行 |
