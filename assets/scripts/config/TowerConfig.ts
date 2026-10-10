/**
 * 塔的数值配置表。新增塔种只需在 TOWER_DEFS 中增加一条并加入 TOWER_ORDER，
 * 不需要改动任何系统逻辑，属于数据驱动设计。
 */
import {
    FROST_SLOW_PER_LEVEL,
    MAX_TOWER_LEVEL,
    UPGRADE_COST_RATE,
    UPGRADE_DAMAGE_PER_LEVEL,
    UPGRADE_FIRE_RATE_PER_LEVEL,
    UPGRADE_RANGE_PER_LEVEL,
    SELL_REFUND_RATE,
} from './GameConfig';

export type TowerType = 'arrow' | 'cannon' | 'frost';

export interface TowerDef {
    type: TowerType;
    /** 显示名 */
    name: string;
    /** 建造费用 */
    cost: number;
    /** 1 级伤害 */
    damage: number;
    /** 1 级攻速（次/秒） */
    fireRate: number;
    /** 1 级射程（格） */
    range: number;
    /** 子弹飞行速度（像素/秒） */
    bulletSpeed: number;
    /** 子弹绘制半径 */
    bulletRadius: number;
    /** 爆炸半径（格），0 表示单体伤害 */
    explodeRadius: number;
    /** 爆炸边缘伤害系数 */
    explodeFalloff: number;
    /** 减速比例，0 表示无减速 */
    slowRate: number;
    /** 减速持续时间（秒） */
    slowDuration: number;
    /** 主体颜色 */
    color: number;
    /** 炮管 / 细节颜色 */
    barrelColor: number;
}

export const TOWER_DEFS: Record<TowerType, TowerDef> = {
    arrow: {
        type: 'arrow',
        name: '箭塔',
        cost: 50,
        damage: 12,
        fireRate: 1.2,
        range: 2.2,
        bulletSpeed: 600,
        bulletRadius: 6,
        explodeRadius: 0,
        explodeFalloff: 1,
        slowRate: 0,
        slowDuration: 0,
        color: 0x4fc3f7,
        barrelColor: 0xe1f5fe,
    },
    cannon: {
        type: 'cannon',
        name: '炮塔',
        cost: 100,
        damage: 30,
        fireRate: 0.5,
        range: 1.8,
        bulletSpeed: 420,
        bulletRadius: 10,
        explodeRadius: 0.9,
        explodeFalloff: 0.5,
        slowRate: 0,
        slowDuration: 0,
        color: 0xff7043,
        barrelColor: 0x4e342e,
    },
    frost: {
        type: 'frost',
        name: '冰塔',
        cost: 75,
        damage: 5,
        fireRate: 0.8,
        range: 2.6,
        bulletSpeed: 500,
        bulletRadius: 8,
        explodeRadius: 0,
        explodeFalloff: 1,
        slowRate: 0.35,
        slowDuration: 1.5,
        color: 0x81d4fa,
        barrelColor: 0xe1f5fe,
    },
};

/** 建造菜单中的展示顺序 */
export const TOWER_ORDER: TowerType[] = ['arrow', 'cannon', 'frost'];

/** 某个等级下的实际战斗属性 */
export interface TowerStat {
    damage: number;
    range: number;
    fireRate: number;
    slowRate: number;
}

/** 计算指定等级的属性（线性叠加，口径见 docs/02-数值设计表.md） */
export function towerStat(def: TowerDef, level: number): TowerStat {
    const lv = Math.max(1, Math.min(MAX_TOWER_LEVEL, level));
    const bonus = lv - 1;
    return {
        damage: Math.round(def.damage * (1 + UPGRADE_DAMAGE_PER_LEVEL * bonus) * 100) / 100,
        range: def.range * (1 + UPGRADE_RANGE_PER_LEVEL * bonus),
        fireRate: def.fireRate * (1 + UPGRADE_FIRE_RATE_PER_LEVEL * bonus),
        slowRate: def.slowRate > 0 ? def.slowRate + FROST_SLOW_PER_LEVEL * bonus : 0,
    };
}

/** 每秒输出（理论值，未计护甲） */
export function towerDps(def: TowerDef, level: number): number {
    const stat = towerStat(def, level);
    return Math.round(stat.damage * stat.fireRate * 10) / 10;
}

/** 从 level 升到 level+1 的费用；已满级返回 -1 */
export function upgradeCost(def: TowerDef, level: number): number {
    if (level >= MAX_TOWER_LEVEL) {
        return -1;
    }
    return Math.floor(def.cost * UPGRADE_COST_RATE * level);
}

/** 该塔累计投入的金币（建造 + 全部升级） */
export function totalInvested(def: TowerDef, level: number): number {
    let total = def.cost;
    for (let lv = 1; lv < level; lv++) {
        total += upgradeCost(def, lv);
    }
    return total;
}

/** 出售返还金额 */
export function sellValue(def: TowerDef, level: number): number {
    return Math.floor(totalInvested(def, level) * SELL_REFUND_RATE);
}