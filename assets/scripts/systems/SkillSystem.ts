/**
 * 技能系统：定时自动触发的范围效果，由升级卡解锁与强化。
 *
 * 四个技能都是「每隔一段时间自动触发」，不占用玩家操作。
 * 释放方式统一为「扇形」：每次触发先在攻击区内挑出最接近核心的敌人，
 * 以「核心 → 该敌人」的方向为中心，只作用于 SKILL_SECTOR_DEG（30°）的扇形内，
 * 无伤走廊里的敌人不会被波及。因此技能的收益取决于敌人的分布，而不是无脑清场。
 *   bomb  范围爆破：对扇形内敌人造成伤害
 *   frost 冰霜减速：扇形内敌人移动大幅减慢
 *   radar 雷达眩晕：扇形内敌人短时间内停止移动
 *   wind  风向击退：把扇形内敌人沿半径向外吹，并附加短暂减速
 */
import { CIRCLE_CENTER_Y, COLORS } from '../config/GameConfig';
import { SKILL_SECTOR_DEG, SKILL_TUNING, TURRET_RANGE, isInAttackArea, periodic } from '../config/CircleConfig';
import { CircleEnemy } from '../entities/CircleEnemy';
import { CircleEnemySystem } from './CircleEnemySystem';
import { FxSystem } from './FxSystem';

export type SkillKind = 'bomb' | 'frost' | 'radar' | 'wind';

const SKILL_COLORS: Record<SkillKind, number> = {
    bomb: 0xef5350,
    frost: 0x81d4fa,
    radar: 0xb388ff,
    wind: 0x26c6da,
};

export { SKILL_COLORS };

export const SKILL_KINDS: SkillKind[] = ['bomb', 'frost', 'radar', 'wind'];

interface SkillState {
    /** 叠加层数，0 表示未解锁 */
    stacks: number;
    /** 距离下次触发的剩余秒数 */
    timer: number;
}

export class SkillSystem {
    private skills: Record<SkillKind, SkillState> = {
        bomb: { stacks: 0, timer: 0 },
        frost: { stacks: 0, timer: 0 },
        radar: { stacks: 0, timer: 0 },
        wind: { stacks: 0, timer: 0 },
    };

    private enemies: CircleEnemySystem;
    private fx: FxSystem;
    /** 由 GameManager 注入，炸弹伤害随波次成长 */
    private getWave: () => number;
    /** 由 GameManager 注入，返回当前攻击区收缩比例（attackScaleOf） */
    private getAttackScale: () => number;
    /** 扇形取敌的复用数组，避免每次触发都分配 */
    private sector: CircleEnemy[] = [];

    constructor(enemies: CircleEnemySystem, fx: FxSystem, getWave: () => number, getAttackScale: () => number) {
        this.enemies = enemies;
        this.fx = fx;
        this.getWave = getWave;
        this.getAttackScale = getAttackScale;
    }

    /** 返回某技能的当前层数 */
    getStacks(kind: SkillKind): number {
        return this.skills[kind].stacks;
    }

    /** 某技能距离下次触发的剩余秒数，未解锁返回 0（供冷却条显示） */
    getCooldown(kind: SkillKind): number {
        const state = this.skills[kind];
        return state.stacks > 0 ? Math.max(0, state.timer) : 0;
    }

    /** 某技能的触发间隔（即一次完整冷却时长），未解锁返回 0 */
    getCooldownTotal(kind: SkillKind): number {
        return this.skills[kind].stacks > 0 ? this.intervalOf(kind) : 0;
    }

    /** 设置技能层数（升级卡选择后由 UpgradeSystem 调用） */
    setStacks(kind: SkillKind, stacks: number): void {
        const state = this.skills[kind];
        const wasLocked = state.stacks === 0;
        state.stacks = Math.max(0, stacks);
        if (state.stacks > 0 && wasLocked) {
            // 刚解锁时先给一小段延迟，避免同一帧爆发
            state.timer = this.intervalOf(kind) * 0.6;
        }
        if (state.stacks === 0) {
            state.timer = 0;
        }
    }

    reset(): void {
        for (const kind of SKILL_KINDS) {
            this.skills[kind].stacks = 0;
            this.skills[kind].timer = 0;
        }
    }

    update(dt: number): void {
        for (const kind of SKILL_KINDS) {
            const state = this.skills[kind];
            if (state.stacks <= 0) {
                continue;
            }
            state.timer -= dt;
            if (state.timer > 0) {
                continue;
            }
            state.timer = this.intervalOf(kind);
            this.cast(kind, state.stacks);
        }
    }

    // ---------- 触发间隔 ----------

    private intervalOf(kind: SkillKind): number {
        const stacks = Math.max(1, this.skills[kind].stacks);
        switch (kind) {
            case 'bomb':
                return periodic(SKILL_TUNING.bomb.intervalBase, SKILL_TUNING.bomb.intervalPerStack, SKILL_TUNING.bomb.intervalMin, stacks);
            case 'frost':
                return periodic(SKILL_TUNING.frost.intervalBase, SKILL_TUNING.frost.intervalPerStack, SKILL_TUNING.frost.intervalMin, stacks);
            case 'radar':
                return periodic(SKILL_TUNING.radar.intervalBase, SKILL_TUNING.radar.intervalPerStack, SKILL_TUNING.radar.intervalMin, stacks);
            default:
                return periodic(SKILL_TUNING.wind.intervalBase, SKILL_TUNING.wind.intervalPerStack, SKILL_TUNING.wind.intervalMin, stacks);
        }
    }

    // ---------- 扇形取敌 ----------

    /**
     * 选定本次释放的方向（弧度）：攻击区内最接近核心的敌人所在方向。
     * 没有可打的目标时返回 null，本次触发直接作废。
     */
    private pickDirection(): number | null {
        const target = this.enemies.findNearestToCore(this.getAttackScale());
        if (!target) {
            return null;
        }
        const p = target.node.position;
        return Math.atan2(p.y - CIRCLE_CENTER_Y, p.x);
    }

    /** 收集以 dir 为中心、SKILL_SECTOR_DEG 扇形内且位于攻击区的敌人（复用数组） */
    private collectInSector(dir: number): readonly CircleEnemy[] {
        const out = this.sector;
        out.length = 0;
        const half = (SKILL_SECTOR_DEG * Math.PI) / 360;
        const attackScale = this.getAttackScale();
        const targets = this.enemies.all;
        for (let i = 0; i < targets.length; i++) {
            const enemy = targets[i];
            if (!enemy.alive) {
                continue;
            }
            const p = enemy.node.position;
            if (!isInAttackArea(p.x, p.y, attackScale)) {
                continue;
            }
            let diff = Math.atan2(p.y - CIRCLE_CENTER_Y, p.x) - dir;
            while (diff > Math.PI) {
                diff -= Math.PI * 2;
            }
            while (diff < -Math.PI) {
                diff += Math.PI * 2;
            }
            if (Math.abs(diff) > half) {
                continue;
            }
            out.push(enemy);
        }
        return out;
    }

    /** 扇形释放的方向表现：沿释放方向铺一串冲击波，读起来像一条定向光束 */
    private fxSector(dir: number, color: number): void {
        const reach = TURRET_RANGE * 0.5;
        for (let i = 1; i <= 4; i++) {
            const d = (reach * i) / 4;
            this.fx.explosion(Math.cos(dir) * d, CIRCLE_CENTER_Y + Math.sin(dir) * d, 74, color);
        }
    }

    // ---------- 四个技能 ----------

    private cast(kind: SkillKind, stacks: number): void {
        switch (kind) {
            case 'bomb':
                this.castBomb(stacks);
                break;
            case 'frost':
                this.castFrost(stacks);
                break;
            case 'radar':
                this.castRadar(stacks);
                break;
            default:
                this.castWind(stacks);
                break;
        }
    }

    private castBomb(stacks: number): void {
        const dir = this.pickDirection();
        if (dir === null) {
            return;
        }
        const tuning = SKILL_TUNING.bomb;
        const damage = (tuning.damageBase + tuning.damagePerStack * (stacks - 1)) * (1 + tuning.damagePerWave * (this.getWave() - 1));
        this.fxSector(dir, SKILL_COLORS.bomb);
        const targets = this.collectInSector(dir);
        for (let i = 0; i < targets.length; i++) {
            const enemy = targets[i];
            const p = enemy.node.position;
            this.fx.explosion(p.x, p.y, enemy.hitRadius * 2.4, SKILL_COLORS.bomb);
            enemy.applyDamage(damage);
        }
    }

    private castFrost(stacks: number): void {
        const dir = this.pickDirection();
        if (dir === null) {
            return;
        }
        const tuning = SKILL_TUNING.frost;
        const duration = tuning.durationBase + tuning.durationPerStack * (stacks - 1);
        this.fxSector(dir, SKILL_COLORS.frost);
        const targets = this.collectInSector(dir);
        for (let i = 0; i < targets.length; i++) {
            const enemy = targets[i];
            const p = enemy.node.position;
            enemy.applySlow(tuning.slowRate, duration);
            this.fx.explosion(p.x, p.y, enemy.hitRadius * 1.8, SKILL_COLORS.frost);
        }
    }

    private castRadar(stacks: number): void {
        const dir = this.pickDirection();
        if (dir === null) {
            return;
        }
        const tuning = SKILL_TUNING.radar;
        const duration = tuning.durationBase + tuning.durationPerStack * (stacks - 1);
        this.fxSector(dir, SKILL_COLORS.radar);
        const targets = this.collectInSector(dir);
        for (let i = 0; i < targets.length; i++) {
            const enemy = targets[i];
            const p = enemy.node.position;
            enemy.applyStun(duration);
            this.fx.explosion(p.x, p.y, enemy.hitRadius * 2.2, SKILL_COLORS.radar);
        }
    }

    private castWind(stacks: number): void {
        const dir = this.pickDirection();
        if (dir === null) {
            return;
        }
        const tuning = SKILL_TUNING.wind;
        const push = tuning.pushBase + tuning.pushPerStack * (stacks - 1);
        this.fxSector(dir, SKILL_COLORS.wind);
        this.fx.floatText(Math.cos(dir) * 120, CIRCLE_CENTER_Y + Math.sin(dir) * 120 + 60, '狂风！', COLORS.text);
        const targets = this.collectInSector(dir);
        for (let i = 0; i < targets.length; i++) {
            const enemy = targets[i];
            enemy.pushBack(push);
            enemy.applySlow(0.3, tuning.slowDuration);
        }
    }
}