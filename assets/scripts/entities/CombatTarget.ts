/**
 * 可被弹道命中的目标抽象。
 *
 * 固定路径模式的 Enemy（沿折线路径采样）与圆形模式的 CircleEnemy（朝圆心直线移动）
 * 移动模型完全不同，但「被子弹命中、被范围伤害波及、被减速」的交互是一样的。
 * 把这一层抽出来，Bullet / BulletSystem 就能同时服务两种模式，不必写两套弹道逻辑。
 */
import { Node } from 'cc';

export interface CombatTarget {
    readonly node: Node;
    /** 是否仍然存活且可被命中 */
    readonly alive: boolean;
    /** 命中判定用的半径 */
    readonly hitRadius: number;
    /** 施加伤害，返回 true 表示本次伤害致死 */
    applyDamage(amount: number): boolean;
    /** 施加减速 */
    applySlow(rate: number, duration: number): void;
}

/**
 * 提供「圆形范围查询」的战斗目标集合。
 * 固定路径模式的 EnemySystem 与圆形模式的 CircleEnemySystem 都满足它，
 * 因此 BulletSystem 只依赖这个接口就能结算范围伤害。
 */
export interface TargetProvider {
    forEachInRange(x: number, y: number, range: number, callback: (target: CombatTarget, distance: number) => void): void;
}
