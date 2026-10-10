/**
 * 敌人系统：管理场上所有敌人的生命周期，并对外提供索敌查询。
 * 敌人节点全部来自对象池；死亡与抵达终点在此统一结算。
 */
import { Node } from 'cc';
import { COLORS } from '../config/GameConfig';
import { EnemyDef } from '../config/EnemyConfig';
import { Grid } from '../core/Grid';
import { ObjectPool } from '../core/ObjectPool';
import { Enemy } from '../entities/Enemy';
import { EconomySystem } from './EconomySystem';
import { FxSystem } from './FxSystem';

export class EnemySystem {
    private pool: ObjectPool<Enemy>;
    private active: Enemy[] = [];
    private economy: EconomySystem;
    private fx: FxSystem;

    constructor(parent: Node, grid: Grid, economy: EconomySystem, fx: FxSystem) {
        this.economy = economy;
        this.fx = fx;
        this.pool = new ObjectPool<Enemy>(() => new Enemy(parent, grid), 80);
    }

    spawn(def: EnemyDef, hpScale: number): Enemy {
        const enemy = this.pool.get();
        enemy.spawn(def, hpScale);
        this.active.push(enemy);
        return enemy;
    }

    /** 推进移动 + 结算离场 */
    update(dt: number): void {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const enemy = this.active[i];
            enemy.update(dt);
            if (enemy.alive) {
                continue;
            }
            const ex = enemy.node.position.x;
            const ey = enemy.node.position.y;
            if (enemy.reachedEnd) {
                this.economy.damageBase(enemy.def.baseDamage);
            } else {
                this.economy.earn(enemy.def.reward);
                this.fx.floatText(ex, ey + 22, '+' + enemy.def.reward, COLORS.gold);
            }
            this.active.splice(i, 1);
            this.pool.put(enemy);
        }
    }

    /**
     * 找出射程内距基地最近的敌人（路径进度最大）。
     * 这是本作唯一的索敌策略，简单且行为可预期。
     */
    findTarget(x: number, y: number, range: number): Enemy | null {
        const rangeSq = range * range;
        let best: Enemy | null = null;
        let bestProgress = -1;
        for (let i = 0; i < this.active.length; i++) {
            const enemy = this.active[i];
            if (!enemy.alive) {
                continue;
            }
            const p = enemy.node.position;
            const dx = p.x - x;
            const dy = p.y - y;
            if (dx * dx + dy * dy > rangeSq) {
                continue;
            }
            const progress = enemy.progress;
            if (progress > bestProgress) {
                bestProgress = progress;
                best = enemy;
            }
        }
        return best;
    }

    /** 对圆形范围内的所有敌人执行回调（炮塔范围伤害用） */
    forEachInRange(x: number, y: number, range: number, callback: (enemy: Enemy, distance: number) => void): void {
        const rangeSq = range * range;
        for (let i = 0; i < this.active.length; i++) {
            const enemy = this.active[i];
            if (!enemy.alive) {
                continue;
            }
            const p = enemy.node.position;
            const dx = p.x - x;
            const dy = p.y - y;
            const distSq = dx * dx + dy * dy;
            if (distSq > rangeSq) {
                continue;
            }
            callback(enemy, Math.sqrt(distSq));
        }
    }

    get count(): number {
        return this.active.length;
    }

    reset(): void {
        for (const enemy of this.active) {
            this.pool.put(enemy);
        }
        this.active.length = 0;
    }
}