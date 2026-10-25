// 全局游戏常量：所有尺寸/规则调整先改这里

/** 汽车尺寸（1 单位 = 1m）。2026-10-20 用户要求整车缩小以简化碰撞模型（原 2.0×1.4×4.2） */
export const CAR = {
  width: 1.7,
  height: 1.2,
  length: 3.6,
  wheelRadius: 0.4,
} as const;

/** 赛道基础宽 = 车宽 × 该系数（保持基础宽 12m：12 / 1.7；历史为 3.5 → 5 → 6 × 2.0m 车宽） */
export const ROAD_WIDTH_MULTIPLIER = 120 / 17;

/** 弯道加宽：曲率(rad/m) × 该系数 = 宽度增量比例（封顶见下） */
export const CURVE_WIDEN_STRENGTH = 16;

/** 弯道加宽最大比例（最急弯处基础宽的 1+该值 倍） */
export const CURVE_WIDEN_MAX = 0.4;

/** 护栏高度 = 车高 × 该系数（原需求一半；用户后续要求调高，取 1.1 → 1.54m；车缩小后 1.32m） */
export const BARRIER_HEIGHT_FACTOR = 1.1;

/** 护栏厚度（加大碰撞判定范围，防高速穿透） */
export const BARRIER_THICKNESS = 0.8;

/** 护栏**碰撞盒**向远离路面方向额外加厚的深度（可见面与前内侧面不变）：
 *  高速 55m/s 下每物理步位移 ≈0.92m，更深的外侧碰撞体让未接住的接触面在下一步仍保持重叠，
 *  求解器持续修正而不是让车身滑过薄体；纯隐形体积（埋在路外），不改变碰撞反馈位置。 */
export const BARRIER_COLLIDER_DEPTH_EXTRA = 0.8;

/** 每次重生固定时间惩罚（ms） */
export const TIME_PENALTY_MS = 3000;

/** 距离惩罚折算秒数（秒/米） */
export const DISTANCE_PENALTY_SEC_PER_M = 0.1;

/** 翻车判定：车身上向量与竖直方向夹角（度） */
export const FLIP_ANGLE_DEG = 70;

/** 翻车持续判定时间（ms） */
export const FLIP_HOLD_MS = 1000;

/** 脱轨判定：超出路面半宽后的额外余量（m） */
export const OFFTRACK_MARGIN = 0.5;

/** 脱轨持续判定时间（ms） */
export const OFFTRACK_HOLD_MS = 400;

/** 逆行判定：车头与切线方向点积小于该值视为“车头朝后” */
export const WRONG_WAY_HEADING_DOT = -0.5;

/** 逆行判定：车头朝后且沿车头方向前进速度（m/s）超过该值才触发（倒车不受影响） */
export const WRONG_WAY_SPEED = 2;

/** 逆行持续判定时间（ms） */
export const WRONG_WAY_HOLD_MS = 3000;

export const LEADERBOARD_SIZE = 10;

export const DEFAULT_CAR_COLOR = '#e53935';

export const TRACK_VERSION = 1;
