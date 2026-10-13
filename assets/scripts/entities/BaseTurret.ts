/**
 * 中央基础炮塔。
 *
 * 与固定路径模式的 Tower 不同：它不占格、不能建多个，而是固定在圆心，
 * 由「异向弹道」决定同时覆盖多少个方向（每个方向一条炮管、独立冷却与索敌），
 * 由「同向弹道」决定每条炮管对同一目标一次打出几发。
 *
 * 它实现 BulletSource，因此直接复用 BulletSystem 的弹道表现。
 */
import { Graphics, Node, UIOpacity } from 'cc';
import { CIRCLE_CENTER_Y, COLORS, WORLD } from '../config/GameConfig';
import { BARREL_MAX, SPREAD_PER_LANE_DEG, TURRET_RANGE, TurretStat, projectileDamageMul, turretStat } from '../config/CircleConfig';
import { addGraphics, colorOf, createUiNode, drawCircle, drawRect } from '../core/GraphicsUtil';
import { BulletKind } from './Bullet';
import { CircleEnemy } from './CircleEnemy';

// 炮塔各圈的屏幕半径（px）：按「设计像素」书写、乘 WORLD 换成世界单位。
// 战场容器缩放到 CAMERA_ZOOM，所以屏幕上看到的就是这里的数值。
// 想改炮塔外观直接改下面这几个半径；炮管粗细、核心圆、线宽会按底座半径的比例自动跟随。

/** 底座半径（屏幕 21px → 直径 42px） */
const BASE_RADIUS_PX = 21;
/** 底座最外圈细光环半径（屏幕 25px → 直径 50px） */
const HALO_RADIUS_PX = 25;
/** 炮口到圆心的距离，同时也是炮管末端的半径（屏幕 26px → 直径 52px） */
const MUZZLE_OFFSET_PX = 26;
/** 护盾光环半径（屏幕 31px → 直径 62px），套在炮管末端之外 */
const SHIELD_RADIUS_PX = 31;

/** 内部细节的几何基准：炮管、核心圆、线宽都按「底座半径 = 22」的比例书写，
 *  再由 S 换算到实际底座尺寸，所以改上面的半径时这些细节会等比缩放。 */
const DESIGN_BASE = 22;
const S = (BASE_RADIUS_PX * WORLD) / DESIGN_BASE;

const BASE_RADIUS = BASE_RADIUS_PX * WORLD;
const HALO_RADIUS = HALO_RADIUS_PX * WORLD;
/** 炮口到圆心的距离：子弹从这里射出，避免从炮塔内部穿出 */
const MUZZLE_OFFSET = MUZZLE_OFFSET_PX * WORLD;
const SHIELD_RADIUS = SHIELD_RADIUS_PX * WORLD;

/** 瞄准参考距离：只用来确定方向，长度本身不参与计算 */
const AIM_DIST = 600;
/** 炮管几何：内起点半径、厚度、圆角与描边；长度自动补齐到炮口，末端正好落在 MUZZLE_OFFSET 上 */
const BARREL_INNER = 9 * S;
const BARREL_THICK = 8 * S;
const BARREL_RADIUS = 4 * S;
const BARREL_LINE = 2 * S;
const BARREL_LENGTH = Math.max(BARREL_THICK, MUZZLE_OFFSET - BARREL_INNER);
const MUZZLE_RADIUS = 3.5 * S;
/** 护盾光环配色，与「能量护盾」卡片同色 */
const SHIELD_COLOR = 0x64b5f6;
/** 护盾光环呼吸的幅度与频率 */
const SHIELD_PULSE_AMP = 0.06;
const SHIELD_PULSE_SPEED = 4;
/** 护盾被打空时环上的裂纹条数 */
const SHIELD_MAX_CRACKS = 10;
/** 炮塔被撞击后的红色微光持续时间（秒） */
const FLASH_TTL = 0.36;

interface Barrel {
    /** 炮管节点，绕自身原点旋转 */
    node: Node;
    g: Graphics;
    /** 该炮管的基准朝向（度），异向弹道按圆周均分 */
    baseAngle: number;
    /** 当前实际朝向（度），用于平滑插值 */
    currentAngle: number;
    /** 开火冷却剩余秒数 */
    cooldown: number;
}

/** 炮管旋转过渡速度：每秒最多追赶的角度（度/秒），值越大转得越快 */
const TURN_DEG_PER_SEC = 360;
/** 炮管是否已对准目标的阈值（度）：角度差 ≤ 该值时才允许开火 */
const AIM_TOLERANCE_DEG = 2;

/** 独敌集火：攻击区内只剩一只敌人时，最多几根炮管同时攻击它 */
const LONE_MAX_GUNS = 2;
/** 独敌集火时两根炮管瞄准方向的总间隔（度）：主攻/副攻各偏一半，避免炮管完全重叠。
 *  该角度下两发子弹在攻击区最远角仍都能命中（子弹半径 + 敌人命中半径 覆盖横向偏差），想更明显可加大。 */
const LONE_AIM_SEP_DEG = 4;

/** 两个角度的最短角距（0~180 度） */
function angDist(a: number, b: number): number {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

/** 索敌回调：返回指定方向扇区内「最接近核心」的敌人。exclude 为已被其他炮管锁定的敌人，需要跳过 */
export type TurretFinder = (
    x: number,
    y: number,
    range: number,
    dirDeg: number,
    toleranceDeg: number,
    exclude?: readonly CircleEnemy[],
) => CircleEnemy | null;

/**
 * 开火回调。传入炮口坐标与瞄准点，由调用方向 BulletSystem 发起直线射击。
 * 由 BaseTurret 决定每发弹道的角度偏移（同向弹道呈扇形展开）。
 */
export type TurretFire = (turret: BaseTurret, x: number, y: number, aimX: number, aimY: number) => void;

export class BaseTurret {
    readonly node: Node;

    private baseG: Graphics;
    private barrelLayer: Node;
    private barrels: Barrel[] = [];

    /** 护盾光环：仅在持有核心护盾时显示 */
    private shieldNode: Node;
    private shieldG: Graphics;
    private shieldOn: boolean = false;
    /** 光环呼吸相位 */
    private shieldPhase: number = 0;
    /** 护盾剩余点数与上限，用来换算环上裂纹的疏密 */
    private shieldPoints: number = 0;
    private shieldMax: number = 0;

    /** 被敌人撞击时罩在炮塔外沿的一层红色微光 */
    private flashNode: Node;
    private flashG: Graphics;
    private flashOpacity: UIOpacity;
    /** 微光已播放的时间 */
    private flashLife: number = FLASH_TTL;

    /** 攻击力量等级 */
    powerLevel: number = 1;
    /** 攻击速度等级 */
    aspdLevel: number = 1;
    /** 异向弹道数量 */
    private projectiles: number = 1;
    /** 同向弹道数量 */
    private sameLanes: number = 1;

    constructor(parent: Node) {
        this.node = createUiNode('BaseTurret', parent, 0, CIRCLE_CENTER_Y);
        const base = createUiNode('Base', this.node);
        this.baseG = addGraphics(base);
        this.barrelLayer = createUiNode('Barrels', this.node);
        this.rebuildBarrels();
        this.drawBase();
        // 护盾光环画在炮管之上，套住整座炮塔的外沿
        this.shieldNode = createUiNode('Shield', this.node);
        this.shieldG = addGraphics(this.shieldNode);
        this.drawShield();
        this.shieldNode.active = false;
        // 撞击微光画在最上层，一闪而过
        this.flashNode = createUiNode('Flash', this.node);
        this.flashG = addGraphics(this.flashNode);
        this.flashOpacity = this.flashNode.addComponent(UIOpacity);
        this.drawFlash();
        this.flashNode.active = false;
    }

    get stat(): TurretStat {
        return turretStat(this.powerLevel, this.aspdLevel);
    }

    get projectileCount(): number {
        return this.projectiles;
    }

    get laneCount(): number {
        return this.sameLanes;
    }

    setProjectiles(count: number): void {
        const next = Math.max(1, Math.min(BARREL_MAX, count));
        if (next === this.projectiles) {
            return;
        }
        this.projectiles = next;
        this.rebuildBarrels();
    }

    setSameLanes(count: number): void {
        this.sameLanes = Math.max(1, count);
    }

    // ---------- BulletSource ----------

    get bulletKind(): BulletKind {
        return 'cannon';
    }

    get bulletSpeed(): number {
        return this.stat.projSpeed;
    }

    /** 霓虹条半径：按屏幕像素写（9px），换算成世界单位后仍保持同样的观感 */
    get bulletRadius(): number {
        return 9 * WORLD;
    }

    get bulletColor(): number {
        return 0x7ef0ff;
    }

    get explodeRadius(): number {
        return this.stat.explodeRadius;
    }

    get explodeFalloff(): number {
        return 1;
    }

    get bulletDamage(): number {
        // 「弹道扩充」前 4 次每次都让攻击力下降 10%（见 projectileDamageMul），
        // 代价只落在伤害上，攻速不受影响
        return this.stat.damage * projectileDamageMul(this.projectiles);
    }

    get bulletSlowRate(): number {
        return 0;
    }

    get bulletSlowDuration(): number {
        return 0;
    }

    // ---------- 生命周期 ----------

    reset(): void {
        this.powerLevel = 1;
        this.aspdLevel = 1;
        this.sameLanes = 1;
        this.projectiles = 1;
        this.rebuildBarrels();
        this.drawBase();
        this.setShield(0);
    }

    /**
     * 核心护盾状态更新（选到「能量护盾」或被敌人打掉时调用）。
     * 点数 > 0 时点亮炮塔外圈的护盾光环，并按「已损失比例」在环上画出玻璃裂纹；
     * 归零则整圈消失 —— 破碎的特效由主控播放（它才知道碎片该有多大）。
     * @param points 剩余护盾点数
     * @param max 护盾上限（= 护盾卡层数 × 每层容量），用来算破碎进度
     */
    setShield(points: number, max: number = 0): void {
        this.shieldPoints = Math.max(0, points);
        this.shieldMax = Math.max(0, max);
        const on = this.shieldPoints > 0;
        if (!on) {
            this.shieldOn = false;
            this.shieldNode.active = false;
            return;
        }
        if (!this.shieldOn) {
            this.shieldOn = true;
            this.shieldNode.active = true;
            this.shieldPhase = 0;
            this.shieldNode.setScale(1, 1, 1);
        }
        // 点数变了就重绘，裂纹随损失比例增加
        this.drawShield();
    }

    /** 护盾光环半径（世界单位）：主控在护盾破碎时用它决定碎片大小 */
    get shieldRadius(): number {
        return SHIELD_RADIUS;
    }

    /** 敌人撞到核心：炮塔外沿闪一下红色微光 */
    flashCore(): void {
        this.flashLife = 0;
        this.flashNode.active = true;
        this.flashNode.setScale(1, 1, 1);
        this.flashOpacity.opacity = 255;
    }

    /** 每帧：每条炮管独立索敌与开火。focus 为「单一方向」集火目标（攻击区内所有敌人角分布 ≤30° 时返回最近核心的敌人），无则各炮管走各自扇区索敌 */
    update(dt: number, find: TurretFinder, fire: TurretFire, focus: CircleEnemy | null = null): void {
        if (this.shieldOn) {
            this.shieldPhase += dt;
            const s = 1 + SHIELD_PULSE_AMP * Math.sin(this.shieldPhase * SHIELD_PULSE_SPEED);
            this.shieldNode.setScale(s, s, 1);
        }
        if (this.flashNode.active) {
            this.flashLife += dt;
            const t = this.flashLife / FLASH_TTL;
            if (t >= 1) {
                this.flashNode.active = false;
            } else {
                // 往外扩一圈同时迅速变淡，读起来是「被撞了一下」
                const s = 1 + 0.45 * t;
                this.flashNode.setScale(s, s, 1);
                this.flashOpacity.opacity = Math.round(255 * (1 - t) * (1 - t));
            }
        }

        const center = this.node.position;
        const range = TURRET_RANGE;
        const tolerance = Math.min(180, (180 / this.projectiles) * 1.2);

        // 单一方向集火：攻击区内所有敌人角分布 ≤30° 时，按「基准朝向离敌人方向最近」点名主攻与副攻，
        // 两者的瞄准方向以敌人真实方向为中心左右各偏 LONE_AIM_SEP_DEG/2，
        // 炮管不会完全重叠，两发子弹又都能落在敌人身上。
        let focusDeg = 0;
        let claimed: number[] | null = null;
        // 本帧已被锁定的敌人：后续炮管选目标时跳过，避免多根炮管堆在同一目标上
        const locked: CircleEnemy[] = [];
        if (focus && focus.alive) {
            const lp = focus.node.position;
            focusDeg = (Math.atan2(lp.y - center.y, lp.x - center.x) * 180) / Math.PI;
            claimed = this.barrels
                .map((b, i) => ({ i, d: angDist(b.baseAngle, focusDeg) }))
                .sort((a, b) => a.d - b.d)
                .slice(0, Math.min(LONE_MAX_GUNS, this.barrels.length))
                .map((o) => o.i);
            locked.push(focus);
        }

        for (let bi = 0; bi < this.barrels.length; bi++) {
            const barrel = this.barrels[bi];
            if (barrel.cooldown > 0) {
                barrel.cooldown -= dt;
            }

            // 目标角度：被集火点名的炮管按名次左右分开瞄准，其余炮管走各自扇区索敌
            let targetDeg: number | null = null;
            const rank = claimed ? claimed.indexOf(bi) : -1;
            if (rank >= 0) {
                const half = claimed.length > 1 ? LONE_AIM_SEP_DEG / 2 : 0;
                targetDeg = focusDeg + (rank === 0 ? -half : half);
            } else {
                // 先在自己扇区里找，排除已被其他炮管锁定的敌人
                let target = find(center.x, center.y, range, barrel.baseAngle, tolerance, locked);
                if (!target) {
                    // 本扇区没有可打的目标：退化为全场索敌补位，让空闲炮管去管别的方向
                    target = find(center.x, center.y, range, 0, 180, locked);
                }
                if (target && target.alive) {
                    locked.push(target);
                    const tp = target.node.position;
                    targetDeg = (Math.atan2(tp.y - center.y, tp.x - center.x) * 180) / Math.PI;
                }
            }
            if (targetDeg === null) {
                // 无目标时不回正，保持最后瞄准的角度
                continue;
            }

            // 最短路径插值：把角度差归一化到 (-180, 180]
            let diff = targetDeg - barrel.currentAngle;
            while (diff > 180) diff -= 360;
            while (diff <= -180) diff += 360;
            const absDiff = Math.abs(diff);
            const step = Math.min(absDiff, TURN_DEG_PER_SEC * dt);
            barrel.currentAngle += Math.sign(diff) * step;
            barrel.node.angle = barrel.currentAngle;

            if (barrel.cooldown > 0) {
                continue;
            }
            // 炮管未对准目标则暂不开火，继续旋转
            if (absDiff > AIM_TOLERANCE_DEG) {
                continue;
            }
            barrel.cooldown = this.stat.fireInterval;

            // 用当前插值后的角度射击，保证炮管朝向与弹道方向一致
            const lanes = this.sameLanes;
            for (let lane = 0; lane < lanes; lane++) {
                const offsetDeg = (lane - (lanes - 1) / 2) * SPREAD_PER_LANE_DEG;
                const rad = ((barrel.currentAngle + offsetDeg) * Math.PI) / 180;
                const ux = Math.cos(rad);
                const uy = Math.sin(rad);
                fire(
                    this,
                    center.x + ux * MUZZLE_OFFSET,
                    center.y + uy * MUZZLE_OFFSET,
                    center.x + ux * AIM_DIST,
                    center.y + uy * AIM_DIST,
                );
            }
        }
    }

    // ---------- 绘制 ----------

    private rebuildBarrels(): void {
        this.barrelLayer.removeAllChildren();
        this.barrels = [];
        for (let i = 0; i < this.projectiles; i++) {
            const node = createUiNode('Barrel', this.barrelLayer);
            const g = addGraphics(node);
            const baseAngle = -90 + (360 / this.projectiles) * i;
            node.angle = baseAngle;
            this.drawBarrel(g);
            this.barrels.push({ node, g, baseAngle, currentAngle: baseAngle, cooldown: 0 });
        }
    }

    private drawBarrel(g: Graphics): void {
        g.clear();
        // 炮管：从底座边缘伸出的圆角矩形 + 炮口 + 根部圆点
        drawRect(g, BARREL_INNER, -BARREL_THICK / 2, BARREL_LENGTH, BARREL_THICK, COLORS.panelBorder, 0x7ef0ff, BARREL_LINE, BARREL_RADIUS);
        drawCircle(g, BARREL_INNER + BARREL_LENGTH, 0, MUZZLE_RADIUS, 0x7ef0ff);
        // 炮管根部圆点（比炮口稍大，固定在底座边缘）
        const ROOT_RADIUS = 5 * S;
        drawCircle(g, BARREL_INNER, 0, ROOT_RADIUS, 0x2b6a78, 0x7ef0ff, 2 * S);
    }

    private drawBase(): void {
        const g = this.baseG;
        g.clear();
        // 外圈光环
        drawCircle(g, 0, 0, HALO_RADIUS, undefined, 0x2b6a78, 3 * S);
        // 底座
        drawCircle(g, 0, 0, BASE_RADIUS, COLORS.panelBg, 0x7ef0ff, 4 * S);
        // 核心（调大，让根部更醒目）
        drawCircle(g, 0, 0, 12 * S, 0x7ef0ff);
        drawCircle(g, 0, 0, 6 * S, COLORS.text);
    }

    /** 护盾光环：外层柔光 + 内层实环，两层同心叠出霓虹质感（绘制一次，靠节点缩放做呼吸）；
     *  被打掉的点数越多，环上的玻璃裂纹越多（重绘由 setShield 触发） */
    private drawShield(): void {
        const g = this.shieldG;
        g.clear();
        g.lineWidth = 9 * S;
        g.strokeColor = colorOf(SHIELD_COLOR, 60);
        g.circle(0, 0, SHIELD_RADIUS);
        g.stroke();
        g.lineWidth = 4 * S;
        g.strokeColor = colorOf(SHIELD_COLOR, 130);
        g.circle(0, 0, SHIELD_RADIUS);
        g.stroke();
        g.lineWidth = 2 * S;
        g.strokeColor = colorOf(0xd7ecff, 240);
        g.circle(0, 0, SHIELD_RADIUS);
        g.stroke();
        this.drawShieldCracks(g);
    }

    /** 护盾裂纹：被打掉越多，环上的裂痕越多越亮，像护盾正一点点碎开 */
    private drawShieldCracks(g: Graphics): void {
        const max = this.shieldMax > 0 ? this.shieldMax : this.shieldPoints;
        const broken = max > 0 ? 1 - this.shieldPoints / max : 0;
        if (broken <= 0) {
            return;
        }
        const count = Math.max(1, Math.round(broken * SHIELD_MAX_CRACKS));
        g.lineWidth = 2 * S;
        g.strokeColor = colorOf(0xdff2ff, Math.round(120 + 135 * broken));
        for (let i = 0; i < count; i++) {
            // 黄金角铺开，裂痕不会挤在一处
            const a = ((i * 137.5) % 360) * (Math.PI / 180);
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const outer = SHIELD_RADIUS + 4 * S;
            // 一条横穿环带的折线，看起来像环被磕裂
            g.moveTo(ca * outer, sa * outer);
            const kink = a + 0.24;
            g.lineTo(Math.cos(kink) * SHIELD_RADIUS, Math.sin(kink) * SHIELD_RADIUS);
            const inner = SHIELD_RADIUS - 6 * S;
            g.lineTo(ca * inner, sa * inner);
        }
        g.stroke();
    }

    /** 撞击微光：外沿一圈较粗的红晕 + 一层高光，闪一下即散 */
    private drawFlash(): void {
        const g = this.flashG;
        g.clear();
        g.lineWidth = 7 * S;
        g.strokeColor = colorOf(COLORS.danger, 150);
        g.circle(0, 0, HALO_RADIUS);
        g.stroke();
        g.lineWidth = 3 * S;
        g.strokeColor = colorOf(0xffd0cc, 220);
        g.circle(0, 0, HALO_RADIUS);
        g.stroke();
    }
}
