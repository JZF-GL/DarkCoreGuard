/**
 * 圆形防守模式的敌人。与固定路径模式的 Enemy 不同：
 * 从圆周随机角度生成，沿半径直线向圆心推进，走到核心附近即视为突破。
 *
 * 坐标系：圆心位于 (0, CIRCLE_CENTER_Y)，节点的局部坐标 = 圆心 + (cosθ, sinθ) * radius。
 */
import { Color, Graphics, Node } from 'cc';
import { ARMOR_MIN_DAMAGE_RATE, CELL_SIZE, CIRCLE_CENTER_Y, WORLD } from '../config/GameConfig';
import { ARENA_RADIUS, CORE_HIT_RADIUS } from '../config/CircleConfig';
import { EnemyDef } from '../config/EnemyConfig';
import { addGraphics, colorOf, createUiNode, drawCircle } from '../core/GraphicsUtil';
import { IPoolable } from '../core/ObjectPool';
import { CombatTarget } from './CombatTarget';

/** 减速状态下的描边色，与冰霜技能同色 */
const SLOW_RING = 0x81d4fa;
/** 眩晕状态下的描边色，与雷达技能同色 */
const STUN_RING = 0xb388ff;
/** 镂空内胆色：比背景更深的近黑色，填在霓虹描边里才有「空」的感觉 */
const HOLLOW_FILL = 0x0a1016;
/** 灯芯线宽相对半径的比例，三层描边都以它为基准 */
const NEON_WIDTH_RATIO = 0.16;
/** 三层描边：外层柔光的宽度倍数 + 透明度，中层本色，最内层最细最亮 */
const NEON_GLOW_WIDE = 3.4;
const NEON_GLOW_MID = 2.1;
const NEON_ALPHA_WIDE = 38;
const NEON_ALPHA_MID = 110;
/** 灯光的渐变背景：同形状向外扩几层、每层相对半径的增量与单层透明度。
 *  层数叠加后越靠内越亮，形成向外淡出的光晕。 */
const NEON_HALO_STEPS = 4;
const NEON_HALO_SPREAD = 0.22;
const NEON_HALO_ALPHA = 26;
/** 玻璃裂纹的高光色：断口泛冷白，与冰霜技能的蓝不同调 */
const CRACK_COLOR = 0xdfefff;
/** 裂纹底下的深色断口，让亮线从本体上「浮」出来 */
const CRACK_SHADOW = 0x04070b;
/** 血量见底时的裂纹条数 */
const MAX_CRACKS = 9;
/** 血量比例高于它时身体还完好；低于之后越低裂纹越多 */
const CRACK_START_RATIO = 0.85;
/** 每条裂纹由几段折线组成 */
const CRACK_SEGS = 4;

/** 稳定伪随机：同一颗敌人的同一条裂纹每次重绘都落在同一位置，不会闪烁 */
function crackNoise(seed: number, i: number, k: number): number {
    const v = Math.sin(seed * 12.9898 + i * 78.233 + k * 37.719) * 43758.5453;
    return v - Math.floor(v);
}

/** 击退的速度衰减系数（1/秒）。越大推得越快、过渡越短；越小越"飘"。
 *  初速度 = 击退距离 × 该系数，速度按 e^(-k·t) 衰减，
 *  于是总位移 ∫v dt 恰好等于击退距离，只是被摊开在约 0.4 秒里完成。 */
const PUSH_DECAY = 7;

/** 正多边形顶点：从正上方开始顺时针分布 */
function regularPolygon(sides: number, r: number): number[][] {
    const points: number[][] = [];
    for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
        points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return points;
}

/**
 * 绘制敌人外形（霓虹镂空风）。战斗中的敌人与敌人图鉴共用，保证两处外观完全一致。
 *
 * 画法：先在背后叠几层同形状的低透明度填充当灯光的渐变背景，再用近黑深色把本体填成
 * 「镂空」，最后沿同一条路径叠三层描边 —— 最外层宽而暗（柔光）、中层本色、
 * 最内层最细最亮（灯芯），整体读起来像一根发光的霓虹灯管。
 */
export function drawEnemyBody(g: Graphics, def: EnemyDef, r: number): void {
    const core = mixWhite(def.color, 0.55);
    const w = Math.max(1.6, r * NEON_WIDTH_RATIO);

    // 灯光的渐变背景：同形状由外向内叠若干层低透明度填充，
    // 越靠内叠的层数越多、越亮，于是形成向外淡出的光晕
    for (let i = NEON_HALO_STEPS; i >= 1; i--) {
        traceEnemyPath(g, def, r * (1 + i * NEON_HALO_SPREAD));
        g.fillColor = colorOf(def.color, NEON_HALO_ALPHA);
        g.fill();
    }

    // 镂空内胆：把光晕的内侧盖回深色，只在本体之外留下光
    traceEnemyPath(g, def, r);
    g.fillColor = colorOf(HOLLOW_FILL, 235);
    g.fill();

    // 三层霓虹描边：由外向内越来越细、越来越亮
    strokeEnemyPath(g, def, r, w * NEON_GLOW_WIDE, colorOf(def.color, NEON_ALPHA_WIDE));
    strokeEnemyPath(g, def, r, w * NEON_GLOW_MID, colorOf(def.color, NEON_ALPHA_MID));
    strokeEnemyPath(g, def, r, w, colorOf(core, 255));

    if (def.shape === 'circle' && def.pattern === 'rune') {
        // 圆形躯体里叠一层菱形符文，用灯芯色细描边与普通圆形兵区分
        g.lineWidth = Math.max(1.2, w * 0.7);
        g.strokeColor = colorOf(core, 235);
        tracePoints(g, [
            [0, r * 0.55],
            [-r * 0.5, 0],
            [0, -r * 0.55],
            [r * 0.5, 0],
        ]);
        g.stroke();
        g.fillColor = colorOf(core, 255);
        g.circle(0, 0, r * 0.2);
        g.fill();
    }
}

/** 把敌人外形描进当前路径（只建路径，不 fill / stroke） */
function traceEnemyPath(g: Graphics, def: EnemyDef, r: number): void {
    switch (def.shape) {
        case 'circle':
            g.circle(0, 0, r);
            break;
        case 'square':
            g.roundRect(-r, -r, r * 2, r * 2, Math.max(2, r * 0.2));
            break;
        case 'triangle':
            tracePoints(g, [
                [0, r],
                [-r * 0.92, -r * 0.7],
                [r * 0.92, -r * 0.7],
            ]);
            break;
        case 'pentagon':
            tracePoints(g, regularPolygon(5, r));
            break;
        default:
            tracePoints(g, regularPolygon(6, r));
            break;
    }
}

function tracePoints(g: Graphics, points: number[][]): void {
    g.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
        g.lineTo(points[i][0], points[i][1]);
    }
    g.close();
}

/** 同一外形描一层霓虹：每层都重新描一遍路径，保证粗细与颜色只作用在这一层上 */
function strokeEnemyPath(g: Graphics, def: EnemyDef, r: number, width: number, color: Color): void {
    g.lineWidth = width;
    g.strokeColor = color;
    traceEnemyPath(g, def, r);
    g.stroke();
}

/** 本色朝白色插值，得到霓虹灯芯的高亮色 */
function mixWhite(hex: number, t: number): number {
    const m = (v: number): number => Math.round(v + (255 - v) * t);
    return (m((hex >> 16) & 0xff) << 16) | (m((hex >> 8) & 0xff) << 8) | m(hex & 0xff);
}

export class CircleEnemy implements CombatTarget, IPoolable {
    readonly node: Node;

    private bodyG: Graphics;
    /** 状态标记与玻璃裂纹的独立图层：与霓虹外形的路径分开，互不干扰 */
    private detailG: Graphics;

    def: EnemyDef = null!;
    hp: number = 0;
    maxHp: number = 0;
    armor: number = 0;
    /** 距圆心的像素距离 */
    radius: number = 0;
    /** 生成角度（弧度），仅用于表现 */
    angle: number = 0;
    alive: boolean = false;
    /** 是否因为突破核心而离场 */
    reachedCore: boolean = false;

    private slowFactor: number = 0;
    private slowTimer: number = 0;
    private stunTimer: number = 0;
    /** 击退的剩余向外速度（世界单位/秒），逐帧衰减，推完自动归零 */
    private pushSpeed: number = 0;
    /** 出场缩放进场进度 0..1 */
    private growTimer: number = 0;
    /** 本关速度倍率（由关卡配置决定） */
    private speedMul: number = 1;
    /** 远程敌人的开火倒计时 */
    private fireTimer: number = 0;
    /** 有一次待结算的远程投掷需要主控扣核心血量 */
    private pendingShot: boolean = false;
    /** 玻璃裂纹的随机种子：每颗敌人出生时确定，保证裂纹形状稳定 */
    private seed: number = 0;

    constructor(parent: Node) {
        this.node = createUiNode('CircleEnemy', parent);
        const body = createUiNode('Body', this.node);
        this.bodyG = addGraphics(body);
        const detail = createUiNode('Detail', this.node);
        this.detailG = addGraphics(detail);
        this.node.active = false;
    }

    /** 从池中取出并初始化。angle 为圆周角度（弧度），speedMul 为本关速度倍率 */
    spawn(def: EnemyDef, hpScale: number, angle: number, speedMul: number = 1): void {
        this.def = def;
        this.maxHp = Math.max(1, Math.round(def.hp * hpScale));
        this.hp = this.maxHp;
        this.armor = def.armor;
        this.speedMul = speedMul;
        // 出生在圆周上，向圆心推进
        this.radius = ARENA_RADIUS;
        this.angle = angle;
        this.alive = true;
        this.reachedCore = false;
        this.slowFactor = 0;
        this.slowTimer = 0;
        this.stunTimer = 0;
        this.pushSpeed = 0;
        this.fireTimer = def.attackInterval ?? 0;
        this.pendingShot = false;
        this.seed = Math.random() * 1000;

        this.drawBody();
        this.applyPosition();

        // 出场缩放动画：从 0.4 放大到 1，给「从边缘冒出来」的观感
        this.node.setScale(0.4, 0.4, 1);
        this.node.active = true;
        this.growTimer = 0;
    }

    update(dt: number): void {
        if (!this.alive) {
            return;
        }
        // 出场缩放进场
        if (this.growTimer < 1) {
            this.growTimer = Math.min(1, this.growTimer + dt * 5);
            const s = 0.4 + 0.6 * this.growTimer;
            this.node.setScale(s, s, 1);
        }

        let speed = this.def.speed * this.speedMul * CELL_SIZE;
        if (this.stunTimer > 0) {
            this.stunTimer -= dt;
            speed = 0;
        } else if (this.slowTimer > 0) {
            this.slowTimer -= dt;
            if (this.slowTimer <= 0) {
                this.slowTimer = 0;
                this.slowFactor = 0;
                this.drawBody();
            } else {
                speed *= 1 - this.slowFactor;
            }
        }

        // 远程敌人：走到射程就停下，改为定期向核心投掷（眩晕期间停火）
        const attackRange = this.def.attackRange ?? 0;
        if (attackRange > 0 && this.radius <= attackRange) {
            speed = 0;
            if (this.stunTimer <= 0) {
                this.fireTimer -= dt;
                if (this.fireTimer <= 0) {
                    this.fireTimer = this.def.attackInterval ?? 2;
                    this.pendingShot = true;
                }
            }
        }

        this.radius -= speed * dt;

        // 击退：把「推出」摊成一段平滑位移，而不是瞬间跳到目标位置。
        // 速度按 e^(-k·t) 衰减，总位移等于击退距离；眩晕 / 减速期间照样会被吹退。
        if (this.pushSpeed > 0) {
            this.radius += this.pushSpeed * dt;
            this.pushSpeed *= Math.exp(-PUSH_DECAY * dt);
            if (this.pushSpeed < 1) {
                this.pushSpeed = 0;
            }
            this.radius = Math.min(ARENA_RADIUS, this.radius);
        }

        if (this.radius <= CORE_HIT_RADIUS) {
            this.radius = CORE_HIT_RADIUS;
            this.alive = false;
            this.reachedCore = true;
        }
        this.applyPosition();
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
            this.drawBody();
            return true;
        }
        this.drawBody();
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

    /** 眩晕：一段时间内完全停止移动 */
    applyStun(duration: number): void {
        if (!this.alive || duration <= 0) {
            return;
        }
        const wasStunned = this.stunTimer > 0;
        this.stunTimer = Math.max(this.stunTimer, duration);
        if (!wasStunned) {
            this.drawBody();
        }
    }

    /** 击退：沿半径向外推回一段距离。不是瞬移，而是给一个向外的初速度，
     *  由 update 逐帧平滑衰减推进（总位移仍等于 distance），不会超过出生圆周。 */
    pushBack(distance: number): void {
        if (!this.alive || distance <= 0) {
            return;
        }
        // 取较大值：短时间内被多次击退不会叠成一次超级位移
        this.pushSpeed = Math.max(this.pushSpeed, distance * PUSH_DECAY);
    }

    /** 命中判定半径（实现 CombatTarget）。世界单位，与绘制尺寸一致；
     *  屏幕上的实际大小 = 该值 × CAMERA_ZOOM，由战场容器统一缩放。 */
    get hitRadius(): number {
        return this.def.radius;
    }

    /** 实际绘制半径（世界单位）：配置半径 */
    private get bodyRadius(): number {
        return this.def.radius;
    }

    /** 取出一次待结算的远程投掷（由 CircleEnemySystem 转发给主控扣核心血量） */
    consumeShot(): boolean {
        if (!this.pendingShot) {
            return false;
        }
        this.pendingShot = false;
        return true;
    }

    onRelease(): void {
        this.alive = false;
        this.node.active = false;
    }

    // ---------- 内部 ----------

    private applyPosition(): void {
        this.node.setPosition(Math.cos(this.angle) * this.radius, CIRCLE_CENTER_Y + Math.sin(this.angle) * this.radius, 0);
    }

    private drawBody(): void {
        const r = this.bodyRadius;
        this.bodyG.clear();
        drawEnemyBody(this.bodyG, this.def, r);

        // 状态标记与裂纹画在独立图层上，不参与霓虹外形的绘制路径
        const d = this.detailG;
        d.clear();
        if (this.stunTimer > 0) {
            drawCircle(d, 0, 0, r * 0.4, STUN_RING);
        } else if (this.slowTimer > 0) {
            drawCircle(d, 0, 0, r * 0.32, SLOW_RING);
        }
        this.drawCracks(d, r);
    }

    /** 当前血量比例（0..1），玻璃裂纹的疏密由它决定 */
    get hpRatio(): number {
        return this.maxHp > 0 ? Math.max(0, Math.min(1, this.hp / this.maxHp)) : 0;
    }

    /**
     * 玻璃裂纹：血量越低裂痕越多、越亮，代替原来的血条。
     * 每条裂纹都从身体边缘朝内部折线延伸，折点由 seed 决定的稳定伪随机给出，
     * 因此同一颗敌人的裂纹形状在多次重绘之间保持一致，不会闪烁。
     */
    private drawCracks(g: Graphics, r: number): void {
        const t = (CRACK_START_RATIO - this.hpRatio) / CRACK_START_RATIO;
        if (t <= 0) {
            return;
        }
        const clamped = Math.min(1, t);
        const count = Math.max(1, Math.ceil(clamped * MAX_CRACKS));
        const alpha = Math.round(130 + 125 * clamped);

        // 两遍描边：先用深色宽线画出断口，再压一条亮线，裂纹才有「裂开」的厚度。
        // 两遍的折线完全一致，先画的不会被后画的盖掉。
        for (let pass = 0; pass < 2; pass++) {
            g.lineWidth = pass === 0 ? 4 * WORLD : 2.4 * WORLD;
            g.strokeColor = pass === 0 ? colorOf(CRACK_SHADOW, 210) : colorOf(CRACK_COLOR, alpha);
            for (let i = 0; i < count; i++) {
                // 黄金角分布，裂纹不会挤在一处
                let a = ((this.seed * 360 + i * 137.5) % 360) * (Math.PI / 180);
                // 从本体边缘一路裂到接近圆心
                let rr = r * (0.98 + 0.02 * crackNoise(this.seed, i, 0));
                g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
                for (let k = 1; k <= CRACK_SEGS; k++) {
                    rr -= (r * 0.88) / CRACK_SEGS;
                    a += (crackNoise(this.seed, i, k) - 0.5) * 1.1;
                    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
                }
            }
            // 同一遍的所有裂纹合成一次描边，避免逐条 stroke 重复提交路径
            g.stroke();
        }
    }
}
