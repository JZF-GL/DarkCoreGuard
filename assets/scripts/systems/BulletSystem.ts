/**
 * 子弹系统：发射、飞行推进与命中结算。
 * 单体弹直接对目标结算；炮塔的炮弹落点结算范围伤害，并按距离做伤害衰减。
 */
import { Node } from 'cc';
import { CELL_SIZE } from '../config/GameConfig';
import { ObjectPool } from '../core/ObjectPool';
import { Bullet } from '../entities/Bullet';
import { Enemy } from '../entities/Enemy';
import { Tower } from '../entities/Tower';
import { EnemySystem } from './EnemySystem';
import { FxSystem } from './FxSystem';

export class BulletSystem {
    private pool: ObjectPool<Bullet>;
    private active: Bullet[] = [];

    private enemies: EnemySystem;
    private fx: FxSystem;

    constructor(parent: Node, enemies: EnemySystem, fx: FxSystem) {
        this.enemies = enemies;
        this.fx = fx;
        this.pool = new ObjectPool<Bullet>(() => new Bullet(parent), 140);
    }

    /** 由 TowerSystem 在塔冷却结束时调用 */
    fire(tower: Tower, target: Enemy): void {
        const def = tower.def;
        const stat = tower.stat;
        const origin = tower.node.position;
        const isArea = def.explodeRadius > 0;
        const bullet = this.pool.get();
        bullet.fire({
            kind: def.type,
            x: origin.x,
            y: origin.y,
            speed: def.bulletSpeed,
            damage: stat.damage,
            radius: def.bulletRadius,
            color: def.type === 'cannon' ? def.color : def.barrelColor,
            homing: !isArea,
            target,
            destX: target.node.position.x,
            destY: target.node.position.y,
            explodeRadius: def.explodeRadius,
            explodeFalloff: def.explodeFalloff,
            slowRate: stat.slowRate,
            slowDuration: def.slowDuration,
        });
        this.active.push(bullet);
    }

    update(dt: number): void {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const bullet = this.active[i];
            if (!bullet.update(dt)) {
                continue;
            }
            this.resolveHit(bullet);
            this.active.splice(i, 1);
            this.pool.put(bullet);
        }
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