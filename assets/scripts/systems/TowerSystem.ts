/**
 * 塔系统：管理建塔位占用、建造 / 升级 / 出售，以及每帧的索敌与开火。
 */
import { Node } from 'cc';
import { TOWER_DEFS, TowerType, sellValue, upgradeCost } from '../config/TowerConfig';
import { Grid } from '../core/Grid';
import { ObjectPool } from '../core/ObjectPool';
import { Enemy } from '../entities/Enemy';
import { Tower } from '../entities/Tower';
import { BulletSystem } from './BulletSystem';
import { EconomySystem } from './EconomySystem';
import { EnemySystem } from './EnemySystem';

function cellKey(col: number, row: number): number {
    return row * 64 + col;
}

export class TowerSystem {
    readonly towers: Tower[] = [];

    private pool: ObjectPool<Tower>;
    private occupied: Map<number, Tower> = new Map();
    private grid: Grid;
    private enemies: EnemySystem;
    private bullets: BulletSystem;
    private economy: EconomySystem;

    /** 复用一个开火回调，避免每帧新建闭包 */
    private readonly fireFn = (tower: Tower, target: Enemy): void => {
        this.bullets.fire(tower, target);
    };

    constructor(parent: Node, grid: Grid, enemies: EnemySystem, bullets: BulletSystem, economy: EconomySystem) {
        this.grid = grid;
        this.enemies = enemies;
        this.bullets = bullets;
        this.economy = economy;
        this.pool = new ObjectPool<Tower>(() => new Tower(parent), 40);
    }

    /** 该格是否可以建塔（界内、非路径、未被占用） */
    canBuild(col: number, row: number): boolean {
        return this.grid.isBuildable(col, row) && !this.occupied.has(cellKey(col, row));
    }

    getAt(col: number, row: number): Tower | null {
        const tower = this.occupied.get(cellKey(col, row));
        return tower ?? null;
    }

    /** 建造。金币不足或位置非法返回 null */
    build(type: TowerType, col: number, row: number): Tower | null {
        if (!this.canBuild(col, row)) {
            return null;
        }
        const def = TOWER_DEFS[type];
        if (!this.economy.spend(def.cost)) {
            return null;
        }
        const pos = this.grid.cellToPos(col, row);
        const tower = this.pool.get();
        tower.build(def, col, row, pos.x, pos.y);
        this.towers.push(tower);
        this.occupied.set(cellKey(col, row), tower);
        return tower;
    }

    /** 升级。满级或金币不足返回 false */
    upgrade(tower: Tower): boolean {
        if (!tower || tower.isMaxLevel) {
            return false;
        }
        const cost = upgradeCost(tower.def, tower.level);
        if (cost < 0 || !this.economy.spend(cost)) {
            return false;
        }
        tower.upgrade();
        return true;
    }

    /** 出售，返还累计投入的一部分 */
    sell(tower: Tower): number {
        if (!tower) {
            return 0;
        }
        const refund = sellValue(tower.def, tower.level);
        this.removeTower(tower);
        this.economy.earn(refund);
        return refund;
    }

    /** 从场上移除（不返还金币），用于重开一局 */
    private removeTower(tower: Tower): void {
        const index = this.towers.indexOf(tower);
        if (index >= 0) {
            this.towers.splice(index, 1);
        }
        this.occupied.delete(cellKey(tower.col, tower.row));
        this.pool.put(tower);
    }

    update(dt: number): void {
        for (let i = 0; i < this.towers.length; i++) {
            const tower = this.towers[i];
            const pos = tower.node.position;
            const target = this.enemies.findTarget(pos.x, pos.y, tower.rangePx);
            tower.update(dt, target, this.fireFn);
        }
    }

    reset(): void {
        for (let i = this.towers.length - 1; i >= 0; i--) {
            this.removeTower(this.towers[i]);
        }
        this.towers.length = 0;
        this.occupied.clear();
    }
}