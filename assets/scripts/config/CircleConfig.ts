/**
 * 圆形中心防守模式的数值配置表。
 *
 * 与固定路径模式完全独立：不依赖 Grid / PATH_WAYPOINTS，怪物只在圆周上随机生成并向圆心移动。
 * 所有可调参数集中于此，改数值不动逻辑。
 */
import { CIRCLE_CENTER_Y, HALF_W, WORLD } from './GameConfig';

// ---------- 战场几何 ----------
//
// 单位说明：本文件的常量一律按「设计像素」书写（数值 = 屏幕上看到的大小），
// 末尾乘 WORLD 换成世界单位。整块战场挂在缩放 CAMERA_ZOOM 的容器里，
// 玩家实际视野 = 屏幕尺寸 / CAMERA_ZOOM，所以「抬镜头」这件事只由 CAMERA_ZOOM 一个数决定，
// 这里不需要再为每个物体单独写缩放系数。

/** 怪物出生圆周的半径，同时也是战场的实际范围。
 *  取得比「可玩区对角」还大，整圈落在画面之外：玩家看不到战场边缘，
 *  敌人是从屏幕外走进来的，视野里只有一片完整的战场。
 *  下限参考：圆心到可玩区最远角约 645px（屏幕像素），低于它圆环就会露进画面。
 *  调大 = 战场更辽阔、敌人推进更久，调小 = 敌人更快贴脸（但要保持在 645 以上）。 */
export const ARENA_RADIUS = 680 * WORLD;

/** 敌人贴到「核心」多少像素内算作突破，扣核心生命。
 *  它同时是画面上那圈红色危险区的半径：屏幕上比炮塔底座（18px）略大一圈，
 *  敌人撞上来时正好贴在炮塔外沿。调大 = 敌人提前停下，调小 = 敌人更贴近炮塔中心。 */
export const CORE_HIT_RADIUS = 20 * WORLD;

/**
 * 战斗可玩区：屏幕矩形扣掉顶部 HUD 与底部技能冷却条，只有中间这块才是真正的战场。
 * 敌人走出该矩形（或攻击区）外时不会被索敌 / 命中；子弹也以此为飞行边界。
 * 上边界对齐顶部 HUD 面板底边（屏幕 505px），下边界对齐底部技能条顶沿（屏幕 -425px），
 * 两侧与屏幕同宽。整块区域同时作为战斗内容的矩形遮罩（遮罩随镜头缩放，屏幕上仍是这块矩形）。
 */
export const PLAY_AREA_TOP = 505 * WORLD;
export const PLAY_AREA_BOTTOM = -425 * WORLD;
export const PLAY_AREA_HALF_W = HALF_W * WORLD;

/**
 * 炮塔攻击范围相对战场（可玩区）的比例基准：只覆盖靠内的这部分，
 * 外围剩下的部分是一条「无伤走廊」——敌人走进视野后必须先走完这段，
 * 才会进入索敌 / 命中 / 技能范围。开局就能先看到敌人推进，而不是一冒头就挨打。
 * 攻击区由可玩区以核心为中心等比收缩得到，因此四个方向的无伤走廊宽度一致（各 20%）。
 * 调大该值（趋近 1）则敌人一进屏就挨打，调小则更晚开火。
 * 「攻击范围」升级卡会在该基准上按 RANGE_PER_STACK 继续放大。
 */
export const ATTACK_SCALE = 0.8;

/** 「攻击范围」升级卡每级放大攻击区的比例 */
export const RANGE_PER_STACK = 0.03;
/** 「攻击范围」升级卡最多叠加层数（5 级 = +15%） */
export const RANGE_MAX_STACKS = 5;

/** 攻击区收缩比例（含「攻击范围」升级卡加成），rangeStacks 为攻击范围卡的层数 */
export function attackScaleOf(rangeStacks: number): number {
    const stacks = Math.max(0, Math.min(RANGE_MAX_STACKS, rangeStacks));
    return ATTACK_SCALE * (1 + RANGE_PER_STACK * stacks);
}

/**
 * 是否在炮塔攻击区内 —— 炮塔索敌、子弹命中、技能生效的统一判定口径。
 * 注意与「可玩区」的区别：可玩区是敌人可见范围（同时是矩形遮罩），比攻击区大一圈，
 * 两者之间的地带敌人能走能看，但不会被打到。
 * @param scale 攻击区收缩比例，由 attackScaleOf() 计算，调用方逐帧传入
 */
export function isInAttackArea(x: number, y: number, scale: number, margin: number = 0): boolean {
    const top = CIRCLE_CENTER_Y + (PLAY_AREA_TOP - CIRCLE_CENTER_Y) * scale;
    const bottom = CIRCLE_CENTER_Y + (PLAY_AREA_BOTTOM - CIRCLE_CENTER_Y) * scale;
    const halfW = PLAY_AREA_HALF_W * scale;
    return x >= -halfW - margin && x <= halfW + margin && y >= bottom - margin && y <= top + margin;
}

// ---------- 基础炮塔 ----------

export interface TurretStat {
    /** 单发伤害 */
    damage: number;
    /** 开火间隔（秒） */
    fireInterval: number;
    /** 弹速（像素/秒） */
    projSpeed: number;
    /** 单发爆炸半径（像素），0 表示单体 */
    explodeRadius: number;
}

/** 炮塔基础数值（1 级伤害 / 1 级攻速下） */
export const TURRET_BASE_DAMAGE = 18;
export const TURRET_BASE_FIRE_INTERVAL = 0.5;
export const TURRET_PROJ_SPEED = 760;

/** 每级「攻击力量」的伤害增幅 */
export const POWER_PER_LEVEL = 0.22;
/** 每级「攻击速度」的间隔缩减（间隔 = 基础 / (1 + rate * (lv - 1))） */
export const ASPD_PER_LEVEL = 0.12;

export function turretStat(powerLevel: number, aspdLevel: number): TurretStat {
    const power = Math.max(1, powerLevel);
    const aspd = Math.max(1, aspdLevel);
    return {
        damage: TURRET_BASE_DAMAGE * (1 + POWER_PER_LEVEL * (power - 1)),
        fireInterval: TURRET_BASE_FIRE_INTERVAL / (1 + ASPD_PER_LEVEL * (aspd - 1)),
        projSpeed: TURRET_PROJ_SPEED,
        explodeRadius: 0,
    };
}

// ---------- 弹道 ----------

/**
 * 「弹道扩充」（异向弹道 +1）的攻击力代价：多条异向弹道能同时覆盖更多方向，
 * 为避免无脑堆弹道，前 4 次扩充每次让炮塔攻击力下降 10%（累减，最多 −40%），
 * 第 5 次及以后不再有代价。倍率只作用在伤害上，不影响攻速。
 */
export const PB_DISTINCT_DAMAGE_PENALTY = 0.1;
/** 需要付出攻击力代价的扩充次数 */
export const PB_DISTINCT_PENALTY_STEPS = 4;

/** 当前异向弹道数量对应的攻击力倍率（projectiles = 1 时返回 1） */
export function projectileDamageMul(projectiles: number): number {
    const expansions = Math.min(PB_DISTINCT_PENALTY_STEPS, Math.max(0, projectiles - 1));
    return 1 - PB_DISTINCT_DAMAGE_PENALTY * expansions;
}

/** 单个方向上的弹道槽位角度间隔（度）。异向弹道按 360/n 均匀分布 */
export const BARREL_MAX = 12;
/** 同向弹道的相邻两发之间的角度差（度）：2 发时即 −3° / +3°，呈扇形展开 */
export const SPREAD_PER_LANE_DEG = 6;
/** 炮塔索敌半径。真正的限制是攻击区矩形（可玩区 × ATTACK_SCALE），
 *  此处仅作粗筛上限，取值大于圆心到可玩区四角的距离即可（同时用作范围技能的波纹半径）。 */
export const TURRET_RANGE = ARENA_RADIUS + 100 * WORLD;

// ---------- 经验与升级 ----------
//
// 数值口径（单关 12 波，168 只怪）：
//   每只怪经验 ≈ 基础生命 / XP_PER_HP，与波次无关；
//   升级需求 levelXp(n) = XP_BASE * (1 + XP_GROWTH * (n - 1))，随等级线性变贵。
// 当前参数下全清约 652 经验，满击杀可到 Lv16（15 次升级），80% 击杀率约 Lv14，
// 大致是「每波 1 次出头」的节奏。改这三个常数后务必复核总经验与可达等级，
// 上限参考所有卡片可叠加次数之和（约 65，技能类受 MAX_AUTO_SKILLS 限制只算 3 条），
// 超过就会出现「升级了却无卡可选」。

/** 1 级升 2 级所需经验 */
export const XP_BASE = 10;
/** 每级经验增长系数：levelXp(n) = XP_BASE * (1 + GROWTH * (n - 1)) */
export const XP_GROWTH = 0.42;
/** 每击杀一只怪物的经验 = 敌人基础生命 / 该常数（约 grunt 3 / runner 2 / tank 11） */
export const XP_PER_HP = 20;
/** 升级卡一次出现的张数 */
export const CARD_CHOICES = 3;

/** 升到下一级所需经验（level 为当前等级，从 1 起） */
export function levelXp(level: number): number {
    return Math.round(XP_BASE * (1 + XP_GROWTH * (level - 1)));
}

/** 击杀奖励经验：与敌人生命正相关，重甲怪给得更多 */
export function enemyXp(def: { hp: number }): number {
    return Math.max(1, Math.round(def.hp / XP_PER_HP));
}

// ---------- 升级卡 ----------

export type CardKind =
    | 'pb_distinct'
    | 'pb_same'
    | 'pb_bounce'
    | 'aspd'
    | 'power'
    | 'range'
    | 'shield'
    | 'heal'
    | 'sk_frost'
    | 'sk_bomb'
    | 'sk_radar'
    | 'sk_wind';

export interface CardDef {
    /** 稳定 id，用于记录叠加次数 */
    id: string;
    kind: CardKind;
    /** 卡片标题 */
    name: string;
    /** 卡片说明（可换行） */
    desc: string;
    /** 主色 */
    color: number;
    /** 随机抽取权重，0 表示永不出现 */
    weight: number;
    /** 最多可叠加次数，达到后不再出现 */
    maxStacks: number;
    /** 是否属于「技能」类（用于卡片分组展示） */
    skill: boolean;
}

export const CARD_DEFS: CardDef[] = [
    {
        id: 'pb_distinct',
        kind: 'pb_distinct',
        name: '弹道扩充',
        desc: '异向弹道 +1\n可同时攻击更多方向\n前 4 次每次攻击力 −10%',
        color: 0x4fc3f7,
        weight: 10,
        maxStacks: 8,
        skill: false,
    },
    {
        id: 'pb_same',
        kind: 'pb_same',
        name: '同向齐射',
        desc: '同向弹道 +1\n同一目标多打一发',
        color: 0x29b6f6,
        weight: 10,
        maxStacks: 8,
        skill: false,
    },
    {
        id: 'pb_bounce',
        kind: 'pb_bounce',
        name: '子弹反弹',
        desc: '子弹碰到屏幕边缘反弹\n每级 +1 次（最多 5 次）',
        color: 0x4dd0e1,
        weight: 8,
        maxStacks: 5,
        skill: false,
    },
    {
        id: 'aspd',
        kind: 'aspd',
        name: '攻速强化',
        desc: '攻击速度 +12%',
        color: 0x66bb6a,
        weight: 10,
        maxStacks: 12,
        skill: false,
    },
    {
        id: 'power',
        kind: 'power',
        name: '攻击力量',
        desc: '单发伤害 +22%',
        color: 0xffb74d,
        weight: 10,
        maxStacks: 12,
        skill: false,
    },
    {
        id: 'range',
        kind: 'range',
        name: '攻击范围',
        desc: '攻击范围 +3%\n最多叠加 5 级（+15%）',
        color: 0x9ccc65,
        weight: 8,
        maxStacks: RANGE_MAX_STACKS,
        skill: false,
    },
    {
        id: 'shield',
        kind: 'shield',
        name: '能量护盾',
        desc: '核心获得护盾\n每级可抵挡 5 点伤害',
        color: 0x64b5f6,
        weight: 7,
        maxStacks: 3,
        skill: false,
    },
    {
        id: 'heal',
        kind: 'heal',
        name: '恢复血量',
        desc: '核心立即恢复 20% 生命',
        color: 0x81c784,
        weight: 7,
        maxStacks: 3,
        skill: false,
    },
    {
        id: 'sk_bomb',
        kind: 'sk_bomb',
        name: '范围爆破',
        desc: '每隔数秒朝最近敌人方向\n引爆 30° 扇形范围',
        color: 0xef5350,
        weight: 5,
        maxStacks: 3,
        skill: true,
    },
    {
        id: 'sk_frost',
        kind: 'sk_frost',
        name: '冰霜减速',
        desc: '每隔数秒朝最近敌人方向\n冰冻 30° 扇形内的敌人',
        color: 0x81d4fa,
        weight: 5,
        maxStacks: 3,
        skill: true,
    },
    {
        id: 'sk_radar',
        kind: 'sk_radar',
        name: '雷达眩晕',
        desc: '每隔数秒朝最近敌人方向\n眩晕 30° 扇形内的敌人',
        color: 0xb388ff,
        weight: 5,
        maxStacks: 3,
        skill: true,
    },
    {
        id: 'sk_wind',
        kind: 'sk_wind',
        name: '风向击退',
        desc: '每隔数秒朝最近敌人方向\n吹退 30° 扇形内的敌人',
        color: 0x26c6da,
        weight: 5,
        maxStacks: 3,
        skill: true,
    },
];

// ---------- 卡片的数值效果 ----------

/** 「能量护盾」每级提供的护盾容量（点，1 点 = 抵挡 1 点核心伤害） */
export const SHIELD_PER_STACK = 5;
/** 「恢复血量」每次恢复的核心生命比例 */
export const HEAL_RATIO = 0.2;

/** 定时自动技能的作用扇形角度（度）：以选定方向为中心左右各一半 */
export const SKILL_SECTOR_DEG = 30;
/** 同时最多可解锁的定时自动技能数量，达到上限后不再出现技能卡 */
export const MAX_AUTO_SKILLS = 3;

// ---------- 技能数值 ----------

/** 每隔 interval 秒触发一次，叠加会缩短间隔并增强效果 */
function periodic(base: number, perStack: number, min: number, stacks: number): number {
    return Math.max(min, base + perStack * (stacks - 1));
}

export const SKILL_TUNING = {
    bomb: {
        intervalBase: 6,
        intervalPerStack: -0.8,
        intervalMin: 3.2,
        /** 单次爆破伤害：作用范围已从全场收窄为 30° 扇形，基数同步下调 */
        damageBase: 50,
        damagePerStack: 40,
        /** 伤害随波次增长 */
        damagePerWave: 0.18,
    },
    frost: {
        intervalBase: 6.5,
        intervalPerStack: -0.7,
        intervalMin: 3.5,
        slowRate: 0.45,
        durationBase: 2.6,
        durationPerStack: 0.5,
    },
    radar: {
        intervalBase: 8,
        intervalPerStack: -0.9,
        intervalMin: 4.5,
        durationBase: 1.5,
        durationPerStack: 0.35,
    },
    wind: {
        intervalBase: 5,
        intervalPerStack: -0.6,
        intervalMin: 2.8,
        pushBase: 120,
        pushPerStack: 35,
        /** 击退后额外的减速时间，避免被吹回去又瞬间冲回来 */
        slowDuration: 0.8,
    },
} as const;

export { periodic };

// ---------- 敌人数值 ----------

/** 圆形模式的敌人生命额外倍率（单塔防守，整体血量下调）；再乘以每关的 hpMul */
export const CIRCLE_ENEMY_HP_MUL = 0.7;

/** 远程敌人（六角投手）单次投掷对核心造成的伤害 */
export const RANGED_CORE_DAMAGE = 1;
