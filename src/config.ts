// 全局游戏常量：所有尺寸/规则调整先改这里

/** 汽车尺寸（1 单位 = 1m） */
export const CAR = {
  width: 2.0,
  height: 1.4,
  length: 4.2,
  wheelRadius: 0.45,
} as const;

/** 赛道基础宽 = 车宽 × 该系数（原需求 3~4 个车身；用户后续要求加宽，先 5 倍再 6 倍） */
export const ROAD_WIDTH_MULTIPLIER = 6.0;

/** 弯道加宽：曲率(rad/m) × 该系数 = 宽度增量比例（封顶见下） */
export const CURVE_WIDEN_STRENGTH = 16;

/** 弯道加宽最大比例（最急弯处基础宽的 1+该值 倍） */
export const CURVE_WIDEN_MAX = 0.4;

/** 护栏高度 = 车高 × 该系数（原需求一半；用户后续要求调高，取 0.75） */
export const BARRIER_HEIGHT_FACTOR = 0.75;

export const BARRIER_THICKNESS = 0.55;

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

export const LEADERBOARD_SIZE = 10;

export const DEFAULT_PLAYER_NAME = '玩家';
export const DEFAULT_CAR_COLOR = '#e53935';

export const TRACK_VERSION = 1;
