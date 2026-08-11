# 物理与规则（physics-and-rules）

入口：`src/physics/vehicle.ts`（车辆）、`src/game/Game.ts`（规则）。

## 车辆（cannon-es RaycastVehicle）
- 底盘：`Box(0.95, 0.45, 2.05)`，质量 550，角阻尼 0.12。
- 四轮：半径 0.35，悬架刚度 30、restLength 0.32、frictionSlip 2.1、rollInfluence 0.08；前轮 z=+1.554、后轮 z=-1.554，x=±0.94。
- 控制：`throttle` 施加于后轮（±3200N），`brake` 施加四轮（≤170），转向最大 0.55rad、按 6/s 平滑。
- 视觉同步：`getWheelTransform(i)` 返回含转向/自旋的轮子世界变换，直接赋给轮子 mesh。

## 地面物理注意事项
- cannon-es `Plane` 的默认局部法线是 `(0,0,1)`（竖直面），用作水平地面必须 `body.quaternion.setFromEuler(-Math.PI/2, 0, 0)`，否则车辆直接坠落（曾发生“开局即掉落”bug）。
- 复杂模式地面用路面顶点构建 `CANNON.Trimesh`（与视觉完全贴合），另加 y=-30 的水平 Plane 兜底。

## 检测与重生（src/config.ts 有全部阈值）
- 翻车：车身上向量与竖直夹角 > 70° 持续 1s → `respawn('flip')`，`flips+1`（仅记录不展示）。
- 脱轨：水平距离中心线 > 半宽 + 0.8m 持续 0.6s → `respawn('offtrack')`。
- 坠落：y < -8 → `respawn('offtrack')`。
- 重生：放置到最近中心线点上方 0.5m、朝向切线；`lastS` 重置为重生点弧长。

## 惩罚公式
- 时间惩罚：每次重生 `+3000ms`。
- 距离惩罚：`max(0, lastS - 重生点弧长)` 累加（进度回退距离，米）。
- 单圈用时 = 墙钟耗时 + 时间惩罚 + 距离惩罚 × 0.1s/m，均计入排行榜。

## 冲线
- 进度：弧长 s 增量处理回绕（超过半圈视为跨越起点）；`completedDistance > 0.7 × totalLength` 且 s 从尾部跨到头部才冲线。
- 冲线后写入 `LeaderboardEntry`（含 flips，不展示）并显示结算浮层。
