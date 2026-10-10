/**
 * 全局数值常量与配色。所有可调参数集中在这里，方便策划改数值而不动逻辑。
 */

// ---------- 设计分辨率与布局 ----------
/** 设计分辨率宽（竖屏） */
export const DESIGN_WIDTH = 720;
/** 设计分辨率高（竖屏） */
export const DESIGN_HEIGHT = 1280;
/** 半宽，Canvas 局部坐标 x 范围 [-360, 360] */
export const HALF_W = DESIGN_WIDTH / 2;
/** 半高，Canvas 局部坐标 y 范围 [-640, 640] */
export const HALF_H = DESIGN_HEIGHT / 2;

/** 棋盘列数 */
export const GRID_COLS = 9;
/** 棋盘行数 */
export const GRID_ROWS = 13;
/** 单格边长（像素） */
export const CELL_SIZE = 80;
/** 棋盘纵向中心偏移：为顶部 HUD 与底部操作条留出空间 */
export const PLAYFIELD_CENTER_Y = 10;

/** 顶部 HUD 区域（Canvas 局部坐标） */
export const HUD_TOP = HALF_H;
export const HUD_BOTTOM = 540;
/** 底部操作条区域 */
export const BAR_TOP = -520;
export const BAR_BOTTOM = -HALF_H;

// ---------- 经济与胜负 ----------
/** 初始金币 */
export const START_GOLD = 150;
/** 基地初始生命 */
export const START_BASE_HP = 20;
/** 第一波准备时间（秒） */
export const FIRST_PREP_TIME = 5;
/** 波与波之间的准备时间（秒） */
export const BETWEEN_WAVE_PREP_TIME = 6;
/** 卖塔返还比例（按该塔累计投入计算） */
export const SELL_REFUND_RATE = 0.7;
/** 提前开始下一波，每秒剩余准备时间折算的金币 */
export const EARLY_CALL_GOLD_PER_SEC = 2;
/** 每波清完的基础奖励 */
export const WAVE_CLEAR_GOLD_BASE = 20;
/** 每波清完的阶梯奖励系数（第 n 波奖励 = BASE + n * PER_WAVE） */
export const WAVE_CLEAR_GOLD_PER_WAVE = 5;

// ---------- 战斗规则 ----------
/** 第 n 波敌人生命倍率 = 1 + HP_GROWTH_PER_WAVE * (n - 1) */
export const HP_GROWTH_PER_WAVE = 0.18;
/** 塔最高等级 */
export const MAX_TOWER_LEVEL = 3;
/** 升级费用系数：升级费用 = 造价 * UPGRADE_COST_RATE * 当前等级 */
export const UPGRADE_COST_RATE = 0.8;
/** 每级伤害提升（基于基础值线性叠加） */
export const UPGRADE_DAMAGE_PER_LEVEL = 0.25;
/** 每级射程提升 */
export const UPGRADE_RANGE_PER_LEVEL = 0.08;
/** 每级攻速提升 */
export const UPGRADE_FIRE_RATE_PER_LEVEL = 0.1;
/** 冰塔每级额外减速（百分点） */
export const FROST_SLOW_PER_LEVEL = 0.1;
/** 护甲最多把伤害减免到该比例 */
export const ARMOR_MIN_DAMAGE_RATE = 0.15;

// ---------- 存档 ----------
/** 本地存档 key */
export const SAVE_KEY = 'sdmini.save.v1';

// ---------- 配色（0xRRGGBB） ----------
export const COLORS = {
    /** 背景 */
    bg: 0x1b2430,
    /** 棋盘格线 */
    gridLine: 0x2c3a4c,
    /** 可建格（明） */
    buildable: 0x242e3b,
    /** 可建格（暗，棋盘交错） */
    buildableAlt: 0x202836,
    /** 路径 */
    path: 0x3a4a5e,
    /** 路径边缘描边 */
    pathEdge: 0x4c6076,
    /** HUD 背景 */
    hudBg: 0x141c26,
    /** 面板背景 */
    panelBg: 0x1a2531,
    /** 面板描边 */
    panelBorder: 0x33465c,
    /** 主文字 */
    text: 0xf2f6fa,
    /** 次要文字 */
    textDim: 0x93a5b8,
    /** 金币 */
    gold: 0xffc94d,
    /** 生命 */
    hp: 0x66bb6a,
    /** 危险 / 失败 */
    danger: 0xef5350,
    /** 选中高亮 */
    selection: 0x00e5a0,
    /** 遮罩 */
    overlay: 0x000000,
};