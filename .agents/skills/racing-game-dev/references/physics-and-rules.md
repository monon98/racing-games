# 物理与规则（physics-and-rules）

入口：`src/physics/vehicle.ts`（车辆）、`src/game/Game.ts`（规则）。

## 车辆（cannon-es RaycastVehicle）
- 底盘：`Box(0.95, 0.36, 2.05)` 下偏 0.08m，质量 **750**，线性阻尼 0.12、角阻尼 1.0（低重心、高离地，抗飞起）。
- 四轮：半径 0.45，悬架刚度 45、restLength 0.38、行程 0.25、压缩阻尼 **14**、回弹阻尼 **6**、frictionSlip 3.2、rollInfluence 0.08；前轮 z=+1.554、后轮 z=-1.554，x=±1.15（轮距外扩），连接点 y=-0.24。
- 控制：`throttle` 施加于后轮（±7500N，正向取反，0-100km/h 约 1.5s），`brake` 施加四轮（≤55），转向最大 0.8rad（约 46°）、按住按 7/s 打角、松键按 3/s 缓慢回中。
- 倒车限制：加速力 ×0.65，最高倒车速度 8 m/s；松油门且不踩刹车时施加 50N 发动机制动。
- 漂移失控（2026-08-14）：满舵（|steering|>0.5）+ 油门时检测横摆率，0.6s 窗口内方向翻转 ≥2 次（第二次抖动）即进入漂移：所有轮 `frictionSlip` 由 3.2 降为 2.4（侧滑/抓地下降），HUD 显示“漂移失控中”；松开转向立即恢复抓地。用于替代“禁止侧滑”导致满舵抖动无出口的问题。
- 空中钳制：四轮离地时上升速度 ≤ 3.5 m/s（`MAX_AIR_UPWARD_SPEED`），高速上坡/过顶不飞射。
- 极速：发动机限速 200km/h（接近上限渐入削减动力）；**下坡允许超速**（不自动刹车）。
- 视觉同步：`getWheelTransform(i)` 返回含转向/自旋的轮子世界变换，直接赋给轮子 mesh。

## 地面物理注意事项
- cannon-es `Plane` 的默认局部法线是 `(0,0,1)`（竖直面），用作水平地面必须 `body.quaternion.setFromEuler(-Math.PI/2, 0, 0)`，否则车辆直接坠落（曾发生“开局即掉落”bug）。
- 旋转后的静态地面必须把四元数放进 Body 构造参数并调用 `body.updateAABB()`：不刷新 AABB 时 broadphase 会按旧包围盒剔除部分轮子射线（曾导致前轮永不触地、转向无效）。
- 复杂模式地面用路面顶点构建 `CANNON.Trimesh`（与视觉完全贴合），另加 y=-30 的水平 Plane 兜底。

## 车辆坐标与手感
- RaycastVehicle 轴配置：right=X(0)、forward=Z(2)、up=Y(1)；该配置下正发动机力沿 -Z 推，因此代码里油门力取反（正油门 = +Z 前进），`customSlidingRotationalSpeed=30` 保持滑动时轮子转向一致。
- 底盘 `linearDamping 0.12 / angularDamping 1.0`；松油门且不踩刹车时施加 50N 发动机制动，避免无阻力滑行。
- 轮子必须作为场景直属子节点并直接应用 `getWheelTransform` 的世界变换（作为车体子节点会双重偏移导致轮子消失）。

## 检测与重生（src/config.ts 有全部阈值）
- 翻车：车身上向量与竖直夹角 > 70° 持续 1s → `respawn('flip')`，`flips+1`（仅记录不展示）。
- 脱轨：水平距离中心线 > 半宽 + 0.5m 持续 0.4s → `respawn('offtrack')`。
- 坠落：y < -8 → `respawn('offtrack')`。
- 重生：放置到最近中心线点上方 `CHASSIS_SPAWN_HEIGHT`（1.1m，约为静止离地高度）、朝向切线；`lastS` 重置为重生点弧长。
- 护栏：厚度 0.55m、段长 ×1.4 重叠（防弯道缝隙）；物理固定子步必须保持 1/60s（120Hz 会导致松油俯仰失稳翻车）。撞护栏（法向冲击 > 6 m/s）触发镜头震动 + 红闪反馈（`onBarrierCollide`）。
- 护栏高度 0.75 × 车高（1.05m）；护栏段按“两端采样点的实际路面边缘”对齐（随弯道加宽）。

## 惩罚公式
- 时间惩罚：每次重生 `+3000ms`。
- 距离惩罚：`max(0, lastS - 重生点弧长)` 累加（进度回退距离，米）。
- 单圈用时 = 墙钟耗时 + 时间惩罚 + 距离惩罚 × 0.1s/m，均计入排行榜。

## 冲线
- 进度：弧长 s 增量处理回绕（超过半圈视为跨越起点）；用纯函数 `updateLapProgress`（`src/game/lapProgress.ts`）先判断冲线、再更新 `lastS`（顺序颠倒会导致永不冲线）；`completedDistance > 0.7 × totalLength` 且 s 从尾部跨到头部才冲线。
- 冲线后写入 `LeaderboardEntry`（含 flips，不展示）并显示结算浮层。
