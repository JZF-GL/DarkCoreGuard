/**
 * 圆形防守模式的敌人系统：圆周随机生成、向圆心推进、突破核心或被杀时离场。
 * 对外同时提供索敌（炮塔）与技能需要的批量操作（减速 / 眩晕 / 击退 / 范围伤害）。
 */
import { Node } from 'cc';
import { isInAttackArea } from '../config/CircleConfig';
import { EnemyDef } from '../config/EnemyConfig';
import { ObjectPool } from '../core/ObjectPool';
import { CircleEnemy } from '../entities/CircleEnemy';

export interface CircleEnemyListener {
    /** 击杀：用于结算经验与飘字 */
    onKilled(enemy: CircleEnemy): void;
    /** 突破核心：用于扣核心生命 */
    onReachedCore(enemy: CircleEnemy): void;
    /** 远程敌人对核心投掷一次：用于扣核心生命与飘字 */
    onRangedAttack(enemy: CircleEnemy): void;
}

export class CircleEnemySystem {
    private pool: ObjectPool<CircleEnemy>;
    private active: CircleEnemy[] = [];
    private listener: CircleEnemyListener;

    constructor(parent: Node, listener: CircleEnemyListener) {
        this.listener = listener;
        this.pool = new ObjectPool<CircleEnemy>(() => new CircleEnemy(parent), 120);
    }

    /** 在圆周随机角度生成一只敌人。speedMul 为所属关卡的速度倍率 */
    spawn(def: EnemyDef, hpScale: number, angle: number, speedMul: number = 1): CircleEnemy {
        const enemy = this.pool.get();
        enemy.spawn(def, hpScale, angle, speedMul);
        this.active.push(enemy);
        return enemy;
    }

    update(dt: number): void {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const enemy = this.active[i];
            enemy.update(dt);
            if (enemy.alive) {
                // 远程敌人走完射程后会定时投掷，这里把「已开火」的事件转发给主控扣核心血量
                if (enemy.consumeShot()) {
                    this.listener.onRangedAttack(enemy);
                }
                continue;
            }
            if (enemy.reachedCore) {
                this.listener.onReachedCore(enemy);
            } else {
                this.listener.onKilled(enemy);
            }
            this.active.splice(i, 1);
            this.pool.put(enemy);
        }
    }

    /**
     * 在指定方向扇区内找「最接近核心」的敌人。
     * @param dirDeg 扇区中心方向（度）
     * @param toleranceDeg 扇区半角（度），180 表示不限方向
     * @param attackScale 当前攻击区收缩比例（attackScaleOf），无伤走廊内的敌人不参与索敌
     * @param exclude 已被其他炮管锁定的敌人，跳过不选（多炮管目标分配用，避免扎堆）
     */
    findInSector(
        x: number,
        y: number,
        range: number,
        dirDeg: number,
        toleranceDeg: number,
        attackScale: number,
        exclude?: readonly CircleEnemy[],
    ): CircleEnemy | null {
        const rangeSq = range * range;
        const centerAngle = (dirDeg * Math.PI) / 180;
        const tolerance = (Math.min(180, toleranceDeg) * Math.PI) / 180;
        let best: CircleEnemy | null = null;
        for (const enemy of this.active) {
            if (!enemy.alive) {
                continue;
            }
            if (exclude && exclude.indexOf(enemy) >= 0) {
                continue;
            }
            const p = enemy.node.position;
            // 攻击区比可见范围小一圈：刚进屏的敌人先走一段无伤走廊，还不参与索敌
            if (!isInAttackArea(p.x, p.y, attackScale)) {
                continue;
            }
            const dx = p.x - x;
            const dy = p.y - y;
            if (dx * dx + dy * dy > rangeSq) {
                continue;
            }
            if (tolerance < Math.PI - 0.001) {
                let diff = Math.atan2(dy, dx) - centerAngle;
                while (diff > Math.PI) {
                    diff -= Math.PI * 2;
                }
                while (diff < -Math.PI) {
                    diff += Math.PI * 2;
                }
                if (Math.abs(diff) > tolerance) {
                    continue;
                }
            }
            // 越接近核心越优先
            if (!best || enemy.radius < best.radius) {
                best = enemy;
            }
        }
        return best;
    }

    /** 攻击区内距离核心最近的敌人（定时技能用它选定释放方向），没有则返回 null */
    findNearestToCore(attackScale: number): CircleEnemy | null {
        let best: CircleEnemy | null = null;
        for (const enemy of this.active) {
            if (!enemy.alive) {
                continue;
            }
            const p = enemy.node.position;
            if (!isInAttackArea(p.x, p.y, attackScale)) {
                continue;
            }
            if (!best || enemy.radius < best.radius) {
                best = enemy;
            }
        }
        return best;
    }

    /**
     * 判断攻击区内的敌人是否全部聚集在「单一方向」：
     * 收集所有敌人相对中心点的角度，若角分布跨度 ≤ sectorDeg 则视为同方向，
     * 返回其中最接近核心的敌人（供炮塔集火）。敌人分布在多个方向时返回 null。
     * @param cx,cy 中心点（通常为炮塔坐标）
     * @param attackScale 攻击区收缩比例（无伤走廊内的敌人不参与）
     * @param sectorDeg 单一方向的角分布阈值（度），如 30
     */
    findSingleDirection(cx: number, cy: number, attackScale: number, sectorDeg: number): CircleEnemy | null {
        const angles: number[] = [];
        let best: CircleEnemy | null = null;
        for (const enemy of this.active) {
            if (!enemy.alive) {
                continue;
            }
            const p = enemy.node.position;
            if (!isInAttackArea(p.x, p.y, attackScale)) {
                continue;
            }
            angles.push((Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI);
            if (!best || enemy.radius < best.radius) {
                best = enemy;
            }
        }
        if (!best || angles.length === 0) {
            return null;
        }
        if (angles.length === 1) {
            return best;
        }
        // 圆形角分布跨度：排序后找最大间隙，跨度 = 360° − 最大间隙
        const sorted = angles.slice().sort((a, b) => a - b);
        let maxGap = sorted[0] + 360 - sorted[sorted.length - 1];
        for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i] - sorted[i - 1];
            if (gap > maxGap) {
                maxGap = gap;
            }
        }
        const span = 360 - maxGap;
        return span <= sectorDeg ? best : null;
    }

    /** 对圆形范围内的敌人执行回调（范围伤害用） */
    forEachInRange(x: number, y: number, range: number, callback: (enemy: CircleEnemy, distance: number) => void): void {
        const rangeSq = range * range;
        for (const enemy of this.active) {
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

    /** 全场敌人（技能用），调用方不得在遍历中修改数组 */
    get all(): readonly CircleEnemy[] {
        return this.active;
    }

    /** 生成圆周上的随机角度 */
    static randomAngle(): number {
        return Math.random() * Math.PI * 2;
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