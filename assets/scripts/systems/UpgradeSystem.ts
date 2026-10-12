/**
 * 升级系统：经验累积 → 自动升级 → 抽取三张升级卡 → 玩家选择其一 → 立即生效。
 *
 * 这里只负责「数值与叠加次数」，不涉及任何绘制；卡片的展示与点击交给 ui/UpgradeCards。
 * 卡片的实际效果被路由到三个去处：中央炮塔（弹道数量 / 攻速 / 攻击力）、
 * 技能系统（定时自动技能）、核心（护盾 / 回血，通过注入的 UpgradeCore 回调）。
 */
import {
    CARD_CHOICES,
    CARD_DEFS,
    CardDef,
    HEAL_RATIO,
    MAX_AUTO_SKILLS,
    SHIELD_PER_STACK,
    levelXp,
} from '../config/CircleConfig';
import { BaseTurret } from '../entities/BaseTurret';
import { SkillKind, SkillSystem } from './SkillSystem';

/** 展示给玩家的一张候选卡 */
export interface CardChoice {
    def: CardDef;
    /** 已有的叠加层数（选择后变为 stacks + 1） */
    stacks: number;
}

/** 核心（基地）侧的卡片效果，由 CircleGameManager 实现并注入 */
export interface UpgradeCore {
    /** 增加护盾容量 */
    addShield(amount: number): void;
    /** 按最大生命的比例回血 */
    healRatio(ratio: number): void;
}

/** 卡片 id -> 技能种类 */
const SKILL_BY_CARD: Record<string, SkillKind> = {
    sk_bomb: 'bomb',
    sk_frost: 'frost',
    sk_radar: 'radar',
    sk_wind: 'wind',
};

export class UpgradeSystem {
    /** 炮塔强度等级（1 起），每级抽一次卡 */
    level: number = 1;
    /** 当前等级内已积累的经验 */
    xp: number = 0;

    private stacks: Record<string, number> = {};

    private turret: BaseTurret;
    private skills: SkillSystem;
    private core: UpgradeCore;

    constructor(turret: BaseTurret, skills: SkillSystem, core: UpgradeCore) {
        this.turret = turret;
        this.skills = skills;
        this.core = core;
    }

    /** 升到下一级所需经验 */
    get xpNeed(): number {
        return levelXp(this.level);
    }

    /** 0..1 的经验条进度 */
    get xpRatio(): number {
        const need = this.xpNeed;
        return need <= 0 ? 1 : Math.max(0, Math.min(1, this.xp / need));
    }

    getStack(id: string): number {
        return this.stacks[id] ?? 0;
    }

    /** 「攻击范围」卡的层数，供 attackScaleOf() 换算当前攻击区比例 */
    get rangeStacks(): number {
        return this.getStack('range');
    }

    /** 「子弹反弹」卡的层数 = 子弹在屏幕边缘最多反弹的次数 */
    get bounceCount(): number {
        return this.getStack('pb_bounce');
    }

    /** 已解锁的定时自动技能数量（叠加技能卡不会增加该计数） */
    get unlockedSkillCount(): number {
        let count = 0;
        for (const def of CARD_DEFS) {
            if (def.skill && this.getStack(def.id) > 0) {
                count++;
            }
        }
        return count;
    }

    /**
     * 增加经验，返回本次跨过的等级数（0 表示未升级）。
     * 连续跨级时返回值 > 1，调用方需要连续弹出多组卡片。
     */
    addXp(amount: number): number {
        if (amount <= 0) {
            return 0;
        }
        this.xp += amount;
        let ups = 0;
        let need = this.xpNeed;
        while (this.xp >= need) {
            this.xp -= need;
            this.level++;
            ups++;
            need = this.xpNeed;
        }
        return ups;
    }

    /** 抽取候选卡：按权重随机且不重复，最多 CARD_CHOICES 张 */
    roll(): CardChoice[] {
        // 定时自动技能已有 MAX_AUTO_SKILLS 条时，不再提供任何技能卡
        const skillsFull = this.unlockedSkillCount >= MAX_AUTO_SKILLS;
        const pool: CardChoice[] = [];
        for (const def of CARD_DEFS) {
            if (def.weight <= 0) {
                continue;
            }
            if (def.skill && skillsFull) {
                continue;
            }
            const stacks = this.getStack(def.id);
            if (stacks >= def.maxStacks) {
                continue;
            }
            pool.push({ def, stacks });
        }

        const result: CardChoice[] = [];
        const want = Math.min(CARD_CHOICES, pool.length);
        for (let i = 0; i < want; i++) {
            let total = 0;
            for (const item of pool) {
                total += item.def.weight;
            }
            let roll = Math.random() * total;
            let picked = pool.length - 1;
            for (let j = 0; j < pool.length; j++) {
                roll -= pool[j].def.weight;
                if (roll <= 0) {
                    picked = j;
                    break;
                }
            }
            result.push(pool[picked]);
            pool.splice(picked, 1);
        }
        return result;
    }

    /** 应用一张卡 */
    apply(choice: CardChoice): void {
        const def = choice.def;
        this.stacks[def.id] = this.getStack(def.id) + 1;
        const stacks = this.stacks[def.id];

        switch (def.kind) {
            case 'pb_distinct':
                this.turret.setProjectiles(this.turret.projectileCount + 1);
                break;
            case 'pb_same':
                this.turret.setSameLanes(this.turret.laneCount + 1);
                break;
            case 'aspd':
                this.turret.aspdLevel++;
                break;
            case 'power':
                this.turret.powerLevel++;
                break;
            case 'pb_bounce':
                // 反弹次数直接由层数决定，子弹发射时读取 bounceCount
                break;
            case 'range':
                // 攻击范围由 rangeStacks 换算，无需在此改动炮塔实例
                break;
            case 'shield':
                this.core.addShield(SHIELD_PER_STACK);
                break;
            case 'heal':
                this.core.healRatio(HEAL_RATIO);
                break;
            default: {
                const kind = SKILL_BY_CARD[def.id];
                if (kind) {
                    this.skills.setStacks(kind, stacks);
                }
                break;
            }
        }
    }

    reset(): void {
        this.level = 1;
        this.xp = 0;
        this.stacks = {};
        this.turret.reset();
        this.skills.reset();
    }

    /** 当前构筑摘要（HUD 展示用） */
    summary(): string {
        const parts: string[] = [];
        parts.push('异向 ' + this.turret.projectileCount);
        parts.push('同向 ' + this.turret.laneCount);
        for (const def of CARD_DEFS) {
            if (!def.skill) {
                continue;
            }
            const stacks = this.getStack(def.id);
            if (stacks > 0) {
                parts.push(def.name + stacks);
            }
        }
        return parts.join(' · ');
    }
}