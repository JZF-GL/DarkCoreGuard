/**
 * 敌人实体。自带 Graphics 绘制本体与血条，从对象池复用。
 * 移动完全依赖 Grid 的折线路径采样，不涉及寻路。
 */
import { Graphics, Node } from 'cc';
import { ARMOR_MIN_DAMAGE_RATE, CELL_SIZE, COLORS } from '../config/GameConfig';
import { EnemyDef, EnemyShape } from '../config/EnemyConfig';
import { addGraphics, colorOf, createUiNode, drawCircle, drawPolygon, drawRect } from '../core/GraphicsUtil';
import { Grid, PathSample } from '../core/Grid';
import { IPoolable } from '../core/ObjectPool';

/** 减速状态下的描边色，与冰塔同色 */
const SLOW_RING = 0x81d4fa;

export class Enemy implements IPoolable {
    readonly node: Node;

    private bodyG: Graphics;
    private barG: Graphics;
    private grid: Grid;

    def: EnemyDef = null!;
    hp: number = 0;
    maxHp: number = 0;
    armor: number = 0;
    /** 沿路径走过的像素距离 */
    distance: number = 0;
    /** 是否存活（死亡或抵达终点后为 false） */
    alive: boolean = false;
    /** 是否因为抵达终点而消失 */
    reachedEnd: boolean = false;

    private slowFactor: number = 0;
    private slowTimer: number = 0;

    private static readonly _sample: PathSample = { x: 0, y: 0, progress: 0 };

    constructor(parent: Node, grid: Grid) {
        this.grid = grid;
        this.node = createUiNode('Enemy', parent);
        const body = createUiNode('Body', this.node);
        this.bodyG = addGraphics(body);
        const bar = createUiNode('HpBar', this.node);
        this.barG = addGraphics(bar);
        this.node.active = false;
    }

    /** 从池中取出并初始化 */
    spawn(def: EnemyDef, hpScale: number): void {
        this.def = def;
        this.maxHp = Math.max(1, Math.round(def.hp * hpScale));
        this.hp = this.maxHp;
        this.armor = def.armor;
        this.distance = 0;
        this.alive = true;
        this.reachedEnd = false;
        this.slowFactor = 0;
        this.slowTimer = 0;

        this.drawBody();
        this.drawHpBar();

        const p = this.grid.sampleByDistance(0, Enemy._sample);
        this.node.setPosition(p.x, p.y, 0);
        this.node.active = true;
    }

    /** 每帧推进。到达终点时 alive 置 false 且 reachedEnd 置 true */
    update(dt: number): void {
        if (!this.alive) {
            return;
        }
        let speed = this.def.speed * CELL_SIZE;
        if (this.slowTimer > 0) {
            this.slowTimer -= dt;
            if (this.slowTimer <= 0) {
                this.slowTimer = 0;
                this.slowFactor = 0;
                this.drawBody();
            } else {
                speed *= 1 - this.slowFactor;
            }
        }
        this.distance += speed * dt;
        if (this.distance >= this.grid.totalLength) {
            this.distance = this.grid.totalLength;
            this.alive = false;
            this.reachedEnd = true;
        }
        const p = this.grid.sampleByDistance(this.distance, Enemy._sample);
        this.node.setPosition(p.x, p.y, 0);
    }

    /** 施加伤害。返回 true 表示本次伤害导致死亡 */
    applyDamage(amount: number): boolean {
        if (!this.alive) {
            return false;
        }
        const real = Math.max(amount - this.armor, amount * ARMOR_MIN_DAMAGE_RATE);
        this.hp -= real;
        if (this.hp <= 0) {
            this.hp = 0;
            this.alive = false;
            this.drawHpBar();
            return true;
        }
        this.drawHpBar();
        return false;
    }

    /** 施加减速（取更强的减速效果，时间刷新为较长者） */
    applySlow(rate: number, duration: number): void {
        if (!this.alive || rate <= 0) {
            return;
        }
        const wasSlowed = this.slowTimer > 0;
        this.slowFactor = Math.max(this.slowFactor, rate);
        this.slowTimer = Math.max(this.slowTimer, duration);
        if (!wasSlowed) {
            this.drawBody();
        }
    }

    /** 0..1 的路径进度，用于索敌「最靠近基地」 */
    get progress(): number {
        return this.grid.progressOf(this.distance);
    }

    onRelease(): void {
        this.alive = false;
        this.node.active = false;
    }

    // ---------- 绘制 ----------

    private drawBody(): void {
        const g = this.bodyG;
        g.clear();
        const r = this.def.radius;
        const fill = this.def.color;
        const ring = this.slowTimer > 0 ? SLOW_RING : 0x2b3644;

        const shape: EnemyShape = this.def.shape;
        if (shape === 'circle') {
            drawCircle(g, 0, 0, r, fill, ring, 3);
        } else if (shape === 'square') {
            drawRect(g, -r, -r, r * 2, r * 2, fill, ring, 3, 5);
        } else {
            drawPolygon(
                g,
                [
                    [0, r],
                    [-r * 0.92, -r * 0.7],
                    [r * 0.92, -r * 0.7],
                ],
                fill,
                ring,
                3,
            );
        }
        // 减速标识：内部小雪花点
        if (this.slowTimer > 0) {
            drawCircle(g, 0, 0, r * 0.32, SLOW_RING);
        }
    }

    private drawHpBar(): void {
        const g = this.barG;
        g.clear();
        const r = this.def ? this.def.radius : 18;
        const w = Math.round(r * 2);
        const h = 5;
        const x = -w / 2;
        const y = r + 9;
        const ratio = this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0;
        g.fillColor = colorOf(0x0d1218, 220);
        g.roundRect(x - 1, y - 1, w + 2, h + 2, 3);
        g.fill();
        if (ratio > 0) {
            const color = ratio > 0.5 ? COLORS.hp : ratio > 0.25 ? COLORS.gold : COLORS.danger;
            g.fillColor = colorOf(color);
            g.roundRect(x, y, Math.max(3, w * ratio), h, 2);
            g.fill();
        }
    }
}