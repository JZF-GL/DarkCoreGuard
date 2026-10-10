/**
 * 子弹实体。统一处理三种弹道：
 * - 追踪弹（箭塔 / 冰塔）：每帧朝目标当前位置飞行；
 * - 抛物线弹（炮塔）：朝发射瞬间锁定的落点直线飞行，命中后由 BulletSystem 结算范围伤害。
 * 所有子弹从对象池复用。
 */
import { Graphics, Node } from 'cc';
import { addGraphics, createUiNode, drawCircle, drawPolygon, drawRect } from '../core/GraphicsUtil';
import { IPoolable } from '../core/ObjectPool';
import { Enemy } from './Enemy';

export type BulletKind = 'arrow' | 'cannon' | 'frost';

export interface BulletOptions {
    kind: BulletKind;
    x: number;
    y: number;
    /** 像素/秒 */
    speed: number;
    damage: number;
    radius: number;
    color: number;
    /** 是否追踪目标 */
    homing: boolean;
    target?: Enemy | null;
    destX?: number;
    destY?: number;
    explodeRadius?: number;
    explodeFalloff?: number;
    slowRate?: number;
    slowDuration?: number;
}

/** 子弹最长存活时间，防止目标死亡后子弹永久飞行 */
const MAX_LIFE = 3;

export class Bullet implements IPoolable {
    readonly node: Node;

    private g: Graphics;

    kind: BulletKind = 'arrow';
    speed: number = 0;
    damage: number = 0;
    explodeRadius: number = 0;
    explodeFalloff: number = 1;
    slowRate: number = 0;
    slowDuration: number = 0;
    target: Enemy | null = null;
    homing: boolean = true;
    alive: boolean = false;

    private destX: number = 0;
    private destY: number = 0;
    private radius: number = 6;
    /** 弹体颜色，爆炸特效沿用该颜色 */
    color: number = 0xffffff;
    private life: number = 0;

    constructor(parent: Node) {
        this.node = createUiNode('Bullet', parent);
        this.g = addGraphics(this.node);
        this.node.active = false;
    }

    fire(opts: BulletOptions): void {
        this.kind = opts.kind;
        this.speed = opts.speed;
        this.damage = opts.damage;
        this.radius = opts.radius;
        this.color = opts.color;
        this.homing = opts.homing;
        this.target = opts.target ?? null;
        this.explodeRadius = opts.explodeRadius ?? 0;
        this.explodeFalloff = opts.explodeFalloff ?? 1;
        this.slowRate = opts.slowRate ?? 0;
        this.slowDuration = opts.slowDuration ?? 0;
        this.life = 0;
        this.alive = true;

        const dest = this.homing && this.target ? this.target.node.position : null;
        this.destX = opts.destX ?? (dest ? dest.x : opts.x);
        this.destY = opts.destY ?? (dest ? dest.y : opts.y);

        this.node.setPosition(opts.x, opts.y, 0);
        this.node.active = true;
        this.draw();
    }

    /** 返回 true 表示本帧命中（或超时消失），调用方需要回收 */
    update(dt: number): boolean {
        if (!this.alive) {
            return false;
        }
        this.life += dt;

        if (this.homing && this.target && this.target.alive) {
            this.destX = this.target.node.position.x;
            this.destY = this.target.node.position.y;
        }

        const cx = this.node.position.x;
        const cy = this.node.position.y;
        const dx = this.destX - cx;
        const dy = this.destY - cy;
        const dist = Math.hypot(dx, dy);
        const step = this.speed * dt;
        const hitRadius = this.homing && this.target ? Math.max(6, this.target.def.radius * 0.6) : 8;

        if (dist <= step + hitRadius || this.life > MAX_LIFE) {
            this.node.setPosition(this.destX, this.destY, 0);
            this.alive = false;
            return true;
        }

        this.node.setPosition(cx + (dx / dist) * step, cy + (dy / dist) * step, 0);
        this.node.angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        return false;
    }

    onRelease(): void {
        this.alive = false;
        this.target = null;
        this.node.active = false;
    }

    private draw(): void {
        const g = this.g;
        g.clear();
        const r = this.radius;
        if (this.kind === 'cannon') {
            drawCircle(g, 0, 0, r, 0x2b3644, this.color, 4);
        } else if (this.kind === 'frost') {
            drawPolygon(
                g,
                [
                    [r, 0],
                    [0, r * 0.85],
                    [-r, 0],
                    [0, -r * 0.85],
                ],
                this.color,
            );
        } else {
            drawRect(g, -r * 1.7, -r * 0.5, r * 3.4, r, this.color, undefined, 0, 3);
        }
    }
}