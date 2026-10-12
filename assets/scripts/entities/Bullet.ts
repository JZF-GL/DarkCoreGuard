/**
 * 子弹实体。统一处理四种弹道：
 * - 追踪弹（箭塔 / 冰塔）：每帧朝目标当前位置飞行；
 * - 落点弹（经典模式炮塔）：朝发射瞬间锁定的落点直线飞行，命中后由 BulletSystem 结算范围伤害；
 * - 直线弹（圆形模式中央炮塔）：沿固定方向直线飞行，不追踪任何敌人，
 *   命中由 BulletSystem 用扫掠检测判定，未命中则撞到屏幕边缘后按边界反弹
 *   （反弹次数由「子弹反弹」升级卡决定），次数耗尽才消失。
 * 所有子弹从对象池复用。
 */
import { Graphics, Node } from 'cc';
import { PLAY_AREA_BOTTOM, PLAY_AREA_HALF_W, PLAY_AREA_TOP } from '../config/CircleConfig';
import { addGraphics, colorOf, createUiNode, drawCircle, drawPolygon, drawRect } from '../core/GraphicsUtil';
import { IPoolable } from '../core/ObjectPool';
import { CombatTarget } from './CombatTarget';

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
    /** 直线弹：沿 dirX/dirY 直线飞行，不追踪、越界即消失 */
    straight?: boolean;
    /** 直线弹的飞行方向（会被归一化） */
    dirX?: number;
    dirY?: number;
    /** 直线弹在屏幕边缘可反弹的次数（0 表示撞边即消失） */
    bounces?: number;
    target?: CombatTarget | null;
    destX?: number;
    destY?: number;
    explodeRadius?: number;
    explodeFalloff?: number;
    slowRate?: number;
    slowDuration?: number;
}

/** 子弹最长存活时间，防止目标死亡后子弹永久飞行 */
const MAX_LIFE = 3;
/**
 * 直线弹的飞行边界 = 战斗可玩区（屏幕矩形扣掉顶部 HUD 与底部技能条）。
 * 子弹撞到边界后：还有反弹次数就按边界做镜像反射并继续飞行，次数耗尽则消失，
 * 因此「子弹反弹」升级卡越高级，子弹越能在场内反复折返。
 */
const BOUND_LEFT = -PLAY_AREA_HALF_W;
const BOUND_RIGHT = PLAY_AREA_HALF_W;
const BOUND_BOTTOM = PLAY_AREA_BOTTOM;
const BOUND_TOP = PLAY_AREA_TOP;

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
    target: CombatTarget | null = null;
    homing: boolean = true;
    /** 直线弹标记：不追踪目标，沿 dirX/dirY 飞向边缘 */
    straight: boolean = false;
    alive: boolean = false;

    private dirX: number = 1;
    private dirY: number = 0;
    /** 剩余反弹次数 */
    private bounces: number = 0;
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

    /** 是否为直线飞行弹（BulletSystem 需对其实施扫掠命中检测） */
    get isStraight(): boolean {
        return this.straight;
    }

    /** 弹体判定半径（供扫掠检测使用） */
    get radiusPx(): number {
        return this.radius;
    }

    /** 当前飞行方向（度）：命中火星沿用弹道朝向，火星才会顺着打击方向溅开 */
    get headingDeg(): number {
        return (Math.atan2(this.dirY, this.dirX) * 180) / Math.PI;
    }

    fire(opts: BulletOptions): void {
        this.kind = opts.kind;
        this.speed = opts.speed;
        this.damage = opts.damage;
        this.radius = opts.radius;
        this.color = opts.color;
        this.homing = opts.homing;
        this.straight = opts.straight ?? false;
        this.bounces = Math.max(0, opts.bounces ?? 0);
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

        // 直线弹方向：优先用显式给定方向，否则由「当前点 → 目标点」推得
        let dx = opts.dirX ?? 0;
        let dy = opts.dirY ?? 0;
        if (dx === 0 && dy === 0) {
            dx = this.destX - opts.x;
            dy = this.destY - opts.y;
        }
        const len = Math.hypot(dx, dy) || 1;
        this.dirX = dx / len;
        this.dirY = dy / len;
        this.node.angle = (Math.atan2(this.dirY, this.dirX) * 180) / Math.PI;

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

        const cx = this.node.position.x;
        const cy = this.node.position.y;

        if (this.straight) {
            // 直线弹：固定方向飞行，不因敌人移动而转向；撞到屏幕边缘按边界镜像反射
            const step = this.speed * dt;
            let nx = cx + this.dirX * step;
            let ny = cy + this.dirY * step;
            let bounced = false;

            if (nx < BOUND_LEFT) {
                nx = BOUND_LEFT;
                this.dirX = -this.dirX;
                bounced = true;
            } else if (nx > BOUND_RIGHT) {
                nx = BOUND_RIGHT;
                this.dirX = -this.dirX;
                bounced = true;
            }
            if (ny < BOUND_BOTTOM) {
                ny = BOUND_BOTTOM;
                this.dirY = -this.dirY;
                bounced = true;
            } else if (ny > BOUND_TOP) {
                ny = BOUND_TOP;
                this.dirY = -this.dirY;
                bounced = true;
            }

            if (bounced) {
                if (this.bounces <= 0) {
                    // 反弹次数耗尽：贴边消失
                    this.alive = false;
                    this.target = null;
                    return true;
                }
                this.bounces--;
                this.node.angle = (Math.atan2(this.dirY, this.dirX) * 180) / Math.PI;
            }

            this.node.setPosition(nx, ny, 0);
            if (this.life > MAX_LIFE) {
                this.alive = false;
                this.target = null;
                return true;
            }
            return false;
        }

        if (this.homing && this.target && this.target.alive) {
            this.destX = this.target.node.position.x;
            this.destY = this.target.node.position.y;
        }

        const dx = this.destX - cx;
        const dy = this.destY - cy;
        const dist = Math.hypot(dx, dy);
        const step = this.speed * dt;
        const hitRadius = this.homing && this.target ? Math.max(6, this.target.hitRadius * 0.6) : 8;

        if (dist <= step + hitRadius || this.life > MAX_LIFE) {
            this.node.setPosition(this.destX, this.destY, 0);
            this.alive = false;
            return true;
        }

        this.node.setPosition(cx + (dx / dist) * step, cy + (dy / dist) * step, 0);
        this.node.angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        return false;
    }

    /**
     * 直线弹命中目标：记录目标并终止飞行，交由 BulletSystem 结算。
     * 命中后 target 不再为 null，因此 resolveHit 会走单体伤害分支。
     */
    markHit(target: CombatTarget): void {
        this.target = target;
        this.alive = false;
    }

    onRelease(): void {
        this.alive = false;
        this.homing = true;
        this.straight = false;
        this.target = null;
        this.dirX = 1;
        this.dirY = 0;
        this.bounces = 0;
        this.node.active = false;
    }

    private draw(): void {
        const g = this.g;
        g.clear();
        const r = this.radius;
        // 中央炮塔的直线弹画成霓虹光条（节点已按飞行方向旋转，本地 +x 即弹道方向）
        if (this.straight) {
            this.drawNeonBar(g, r);
            return;
        }
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

    /**
     * 直线弹的霓虹光条：长度为原圆形弹的直径（2r），宽度收窄到约 1/3。
     * 没有模糊效果，用「外发光 → 中层 → 高亮核心」三层同心圆角矩形叠加模拟霓虹灯：
     * 最外层是弹体色的低透明度光晕，最内层接近白色，形成中间炽亮、边缘泛光的效果。
     */
    private drawNeonBar(g: Graphics, r: number): void {
        const layers: number[][] = [
            // [半宽, 透明度, 颜色]
            [3.5, 60, this.color],
            [2.2, 130, this.color],
            [1.3, 255, 0xffffff],
        ];
        for (let i = 0; i < layers.length; i++) {
            const halfW = layers[i][0];
            g.fillColor = colorOf(layers[i][2], layers[i][1]);
            g.roundRect(-r, -halfW, r * 2, halfW * 2, halfW);
            g.fill();
        }
    }
}