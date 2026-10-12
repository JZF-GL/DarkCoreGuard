/**
 * 子弹系统：发射、飞行推进与命中结算。
 * 单体弹直接对目标结算；炮塔的炮弹落点结算范围伤害，并按距离做伤害衰减。
 * 直线弹（圆形模式中央炮塔）不追踪目标，命中改为「逐帧扫掠检测」：
 * 子弹每帧位移构成一条短线段，取线段上最先碰到的敌人。
 */
import { Node } from 'cc';
import { isInAttackArea } from '../config/CircleConfig';
import { CELL_SIZE } from '../config/GameConfig';
import { ObjectPool } from '../core/ObjectPool';
import { Bullet, BulletKind } from '../entities/Bullet';
import { CombatTarget, TargetProvider } from '../entities/CombatTarget';
import { FxSystem } from './FxSystem';

/** 扫掠检测粗筛时为「目标半径」预留的余量，覆盖最大的敌人 */
const TARGET_RADIUS_PAD = 60;

/** 弹道的发射者：塔与中央炮塔都满足这个最小契约 */
export interface BulletSource {
    readonly node: Node;
    readonly bulletKind: BulletKind;
    readonly bulletSpeed: number;
    readonly bulletRadius: number;
    readonly bulletColor: number;
    readonly explodeRadius: number;
    readonly explodeFalloff: number;
    readonly bulletDamage: number;
    readonly bulletSlowRate: number;
    readonly bulletSlowDuration: number;
}

/** 圆形模式专有的运行期数值来源；经典模式不传，走缺省值 */
export interface BulletSystemOptions {
    /** 「子弹反弹」卡的层数 = 子弹在屏幕边缘可反弹的次数，缺省 0（撞边即消失） */
    getBounce?: () => number;
    /** 当前攻击区收缩比例（attackScaleOf），缺省 1 即可玩区全区 */
    getAttackScale?: () => number;
}

export class BulletSystem {
    private pool: ObjectPool<Bullet>;
    private active: Bullet[] = [];

    private enemies: TargetProvider;
    private fx: FxSystem;
    private getBounce: () => number;
    private getAttackScale: () => number;

    constructor(parent: Node, enemies: TargetProvider, fx: FxSystem, options: BulletSystemOptions = {}) {
        this.enemies = enemies;
        this.fx = fx;
        this.getBounce = options.getBounce ?? (() => 0);
        this.getAttackScale = options.getAttackScale ?? (() => 1);
        this.pool = new ObjectPool<Bullet>(() => new Bullet(parent), 140);
    }

    /**
     * 发起一次追踪/落点射击。接受任何满足 BulletSource 的发射者（塔 / 技能），
     * 追踪弹每帧修正方向，落点弹飞抵锁定坐标后由 resolveHit 结算范围伤害。
     */
    fire(source: BulletSource, originX: number, originY: number, target: CombatTarget): void {
        const isArea = source.explodeRadius > 0;
        const bullet = this.pool.get();
        bullet.fire({
            kind: source.bulletKind,
            x: originX,
            y: originY,
            speed: source.bulletSpeed,
            damage: source.bulletDamage,
            radius: source.bulletRadius,
            color: source.bulletColor,
            homing: !isArea,
            target,
            destX: target.node.position.x,
            destY: target.node.position.y,
            explodeRadius: source.explodeRadius,
            explodeFalloff: source.explodeFalloff,
            slowRate: source.bulletSlowRate,
            slowDuration: source.bulletSlowDuration,
        });
        this.active.push(bullet);
    }

    /**
     * 发起一次直线射击：子弹沿 origin → aim 的方向直线飞出，不追踪敌人，
     * 命中路径上第一个敌人即结算并消失；未命中则撞到屏幕边缘后按边界反弹，
     * 反弹次数用尽才消失（次数由「子弹反弹」升级卡决定，未解锁时为 0）。
     */
    fireLine(source: BulletSource, originX: number, originY: number, aimX: number, aimY: number): void {
        const dx = aimX - originX;
        const dy = aimY - originY;
        const len = Math.hypot(dx, dy) || 1;
        const bullet = this.pool.get();
        bullet.fire({
            kind: source.bulletKind,
            x: originX,
            y: originY,
            speed: source.bulletSpeed,
            damage: source.bulletDamage,
            radius: source.bulletRadius,
            color: source.bulletColor,
            homing: false,
            straight: true,
            dirX: dx / len,
            dirY: dy / len,
            bounces: this.getBounce(),
            explodeRadius: source.explodeRadius,
            explodeFalloff: source.explodeFalloff,
            slowRate: source.bulletSlowRate,
            slowDuration: source.bulletSlowDuration,
        });
        this.active.push(bullet);
    }

    update(dt: number): void {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const bullet = this.active[i];

            if (bullet.isStraight) {
                // 直线弹：记录移动前坐标，移动后对「走过的线段」做扫掠检测
                const x0 = bullet.node.position.x;
                const y0 = bullet.node.position.y;
                const expired = bullet.update(dt);
                const pos = bullet.node.position;
                // 命中判定先于越界判断：子弹越界的这一帧仍可能擦到屏幕边缘处的敌人
                const hit = this.findPathHit(x0, y0, pos.x, pos.y, bullet.radiusPx);
                if (hit) {
                    bullet.markHit(hit);
                    this.resolveHit(bullet);
                    this.recycle(i, bullet);
                    continue;
                }
                if (expired) {
                    // 未命中任何敌人，飞出屏幕边缘消失
                    this.recycle(i, bullet);
                }
                continue;
            }

            if (!bullet.update(dt)) {
                continue;
            }
            this.resolveHit(bullet);
            this.recycle(i, bullet);
        }
    }

    /**
     * 扫掠命中检测：取线段 (x0,y0)-(x1,y1) 上最先碰到（投影位置最靠前）的敌人。
     * 先用 forEachInRange 以线段中点为心粗筛，再做「点到线段距离」精判。
     */
    private findPathHit(x0: number, y0: number, x1: number, y1: number, bulletRadius: number): CombatTarget | null {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const segLen = Math.hypot(dx, dy);
        if (segLen <= 0.0001) {
            return null;
        }
        const midX = (x0 + x1) / 2;
        const midY = (y0 + y1) / 2;
        const queryRadius = segLen / 2 + bulletRadius + TARGET_RADIUS_PAD;
        const segLenSq = segLen * segLen;

        let best: CombatTarget | null = null;
        let bestT = Infinity;
        const attackScale = this.getAttackScale();
        this.enemies.forEachInRange(midX, midY, queryRadius, (target) => {
            const p = target.node.position;
            // 与炮塔索敌同一口径：无伤走廊内的敌人不吃伤害
            if (!isInAttackArea(p.x, p.y, attackScale)) {
                return;
            }
            const t = ((p.x - x0) * dx + (p.y - y0) * dy) / segLenSq;
            const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
            const cx = x0 + dx * clamped;
            const cy = y0 + dy * clamped;
            const dist = Math.hypot(p.x - cx, p.y - cy);
            if (dist > bulletRadius + target.hitRadius) {
                return;
            }
            if (t < bestT) {
                bestT = t;
                best = target;
            }
        });
        return best;
    }

    private recycle(index: number, bullet: Bullet): void {
        this.active.splice(index, 1);
        this.pool.put(bullet);
    }

    private resolveHit(bullet: Bullet): void {
        if (bullet.explodeRadius > 0) {
            const radius = bullet.explodeRadius * CELL_SIZE;
            const x = bullet.node.position.x;
            const y = bullet.node.position.y;
            this.fx.explosion(x, y, radius, bullet.color);
            const minFactor = bullet.explodeFalloff;
            this.enemies.forEachInRange(x, y, radius, (enemy, distance) => {
                // 中心 100% 伤害，边缘衰减到 explodeFalloff
                const t = radius > 0 ? distance / radius : 0;
                const factor = 1 - (1 - minFactor) * t;
                enemy.applyDamage(bullet.damage * factor);
            });
            return;
        }
        const target = bullet.target;
        if (target && target.alive) {
            const p = bullet.node.position;
            // 命中火星：以弹道方向为中心在命中点溅开
            this.fx.sparks(p.x, p.y, bullet.headingDeg);
            target.applyDamage(bullet.damage);
            if (bullet.slowRate > 0) {
                target.applySlow(bullet.slowRate, bullet.slowDuration);
            }
        }
    }

    reset(): void {
        for (const bullet of this.active) {
            this.pool.put(bullet);
        }
        this.active.length = 0;
    }
}