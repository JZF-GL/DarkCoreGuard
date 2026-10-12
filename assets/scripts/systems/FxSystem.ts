/**
 * 表现特效：爆炸扩散圈 + 金币飘字 + 命中火星 + 玻璃破碎。
 * 全部是纯 Graphics / Label 节点，内部做池化，避免战斗中频繁创建节点。
 */
import { Graphics, Label, Node, UIOpacity } from 'cc';
import { COLORS, WORLD } from '../config/GameConfig';
import { colorOf, createLabel, createUiNode, addGraphics } from '../core/GraphicsUtil';

interface Ring {
    node: Node;
    g: Graphics;
    opacity: UIOpacity;
    life: number;
    ttl: number;
}

interface FloatText {
    node: Node;
    label: Label;
    opacity: UIOpacity;
    life: number;
    ttl: number;
    speedY: number;
}

/** 火星 / 碎片的单颗粒子 */
interface BurstParticle {
    /** 当前位置（相对爆点，世界单位） */
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** 火星：短线半长；碎片：楔形半径 */
    size: number;
    /** 碎片：原始扇区中心角（度） */
    angle: number;
    /** 碎片：自身已旋转的角度（度） */
    rot: number;
    /** 碎片：自转角速度（度/秒） */
    spin: number;
}

type BurstKind = 'spark' | 'shard';

/** 一簇粒子特效（火星或碎片），逐帧重绘，靠节点透明度整体淡出 */
interface Burst {
    node: Node;
    g: Graphics;
    opacity: UIOpacity;
    kind: BurstKind;
    life: number;
    ttl: number;
    /** 主体色 / 高光边色 */
    color: number;
    edge: number;
    parts: BurstParticle[];
}

const RING_TTL = 0.32;
const TEXT_TTL = 0.7;
const SPARK_TTL = 0.26;
const SHARD_TTL = 0.5;
/** 火星与碎片的空气阻力（1/秒）：越大减速越快、飞得越近 */
const SPARK_DRAG = 8;
const SHARD_DRAG = 6;
/** 破碎时把身体切成多少片楔形碎片（越多每片越小） */
const SHARD_PIECES = 7;
/** 每片碎片占的圆心角（度） */
const SHARD_SECTOR = 360 / SHARD_PIECES;
/** 每片碎片大小相对传入半径的随机区间（最小 + 随机跨度） */
const SHARD_SIZE_MIN = 0.55;
const SHARD_SIZE_RANGE = 0.75;
/** 碎片朝向的抖动比例（相对每片所占圆心角），避免排成整齐的扇形 */
const SHARD_ANGLE_JITTER = 0.35;
/** 碎片完全散开前保持不透明的时长比例，之后才开始淡出 */
const SHARD_FADE_START = 0.4;

/** 楔形碎片的重心（相对原圆心）：碎片绕自身重心自转才不会绕着原圆心甩出去 */
function shardCentroid(midDeg: number, radius: number): number[] {
    const half = (SHARD_SECTOR / 2) * (Math.PI / 180);
    const mid = midDeg * (Math.PI / 180);
    return [
        ((Math.cos(mid - half) + Math.cos(mid + half)) * radius) / 3,
        ((Math.sin(mid - half) + Math.sin(mid + half)) * radius) / 3,
    ];
}

export class FxSystem {
    private parent: Node;

    private rings: Ring[] = [];
    private texts: FloatText[] = [];
    private bursts: Burst[] = [];

    constructor(parent: Node) {
        this.parent = parent;
    }

    /** 爆炸扩散圈 */
    explosion(x: number, y: number, radius: number, color: number = COLORS.danger): void {
        const ring = this.obtainRing();
        ring.g.clear();
        ring.g.lineWidth = 5;
        ring.g.strokeColor = colorOf(color, 230);
        ring.g.circle(0, 0, radius);
        ring.g.stroke();
        ring.node.setPosition(x, y, 0);
        ring.node.setScale(0.35, 0.35, 1);
        ring.node.active = true;
        ring.opacity.opacity = 235;
        ring.life = 0;
        ring.ttl = RING_TTL;
    }

    /** 飘字（击杀奖励等） */
    floatText(x: number, y: number, text: string, color: number = COLORS.gold): void {
        const item = this.obtainText();
        item.label.string = text;
        item.label.color = colorOf(color);
        item.node.setPosition(x, y, 0);
        item.node.active = true;
        item.opacity.opacity = 255;
        item.life = 0;
        item.ttl = TEXT_TTL;
        item.speedY = 62;
    }

    /**
     * 命中火星：在命中点朝弹道方向溅开一小簇亮点，像金属被砸出的火星。
     * @param dirDeg 弹道方向（度），火星以该方向为中心呈扇形溅开
     */
    sparks(x: number, y: number, dirDeg: number, color: number = COLORS.gold): void {
        const parts: BurstParticle[] = [];
        const count = 7;
        for (let i = 0; i < count; i++) {
            // 以弹道方向为中心 ±55° 溅开，再叠随机速度，避免每次形状都一样
            const deg = dirDeg + (Math.random() * 2 - 1) * 55;
            const rad = (deg * Math.PI) / 180;
            const speed = (140 + Math.random() * 260) * WORLD;
            parts.push({
                x: 0,
                y: 0,
                vx: Math.cos(rad) * speed,
                vy: Math.sin(rad) * speed,
                size: (2 + Math.random() * 3.5) * WORLD,
                angle: 0,
                rot: 0,
                spin: 0,
            });
        }
        this.launchBurst('spark', x, y, SPARK_TTL, color, 0xfff3c4, parts);
    }

    /**
     * 玻璃破碎：把身体按圆周切成若干楔形碎片，每片的大小随机（0.55~1.3 倍传入半径）。
     * 各片从原位向外飞散、自转，先保持形状再整体淡出 —— 碎得开、散得不远。
     */
    shatter(x: number, y: number, radius: number, color: number, edge: number = 0xdfefff): void {
        const parts: BurstParticle[] = [];
        for (let i = 0; i < SHARD_PIECES; i++) {
            // 每片的大小与朝向都带随机，看起来才像真的碎开，而不是同一块复制出来的
            const mid = SHARD_SECTOR * (i + 0.5) + (Math.random() - 0.5) * SHARD_SECTOR * SHARD_ANGLE_JITTER;
            const size = radius * (SHARD_SIZE_MIN + Math.random() * SHARD_SIZE_RANGE);
            const c = shardCentroid(mid, size);
            const rad = (mid * Math.PI) / 180;
            // 初速度压得比较低，配合较大的阻力，碎片只在原地附近散开
            const speed = (90 + Math.random() * 50) * WORLD;
            parts.push({
                // 初始就摆在自己的重心上，t=0 时所有碎片大致拼成原形
                x: c[0],
                y: c[1],
                vx: Math.cos(rad) * speed,
                vy: Math.sin(rad) * speed,
                size,
                angle: mid,
                rot: 0,
                spin: (Math.random() * 2 - 1) * 320,
            });
        }
        this.launchBurst('shard', x, y, SHARD_TTL, color, edge, parts);
    }

    update(dt: number): void {
        for (let i = this.rings.length - 1; i >= 0; i--) {
            const r = this.rings[i];
            if (!r.node.active) {
                continue;
            }
            r.life += dt;
            const t = r.life / r.ttl;
            if (t >= 1) {
                r.node.active = false;
                continue;
            }
            const scale = 0.35 + 0.65 * t;
            r.node.setScale(scale, scale, 1);
            r.opacity.opacity = Math.round(235 * (1 - t));
        }
        for (let i = this.texts.length - 1; i >= 0; i--) {
            const f = this.texts[i];
            if (!f.node.active) {
                continue;
            }
            f.life += dt;
            const t = f.life / f.ttl;
            if (t >= 1) {
                f.node.active = false;
                continue;
            }
            const p = f.node.position;
            f.node.setPosition(p.x, p.y + f.speedY * dt, 0);
            f.opacity.opacity = Math.round(255 * (1 - t * t));
        }
        for (let i = this.bursts.length - 1; i >= 0; i--) {
            const b = this.bursts[i];
            if (!b.node.active) {
                continue;
            }
            b.life += dt;
            const t = b.life / b.ttl;
            if (t >= 1) {
                b.node.active = false;
                continue;
            }
            const drag = b.kind === 'spark' ? SPARK_DRAG : SHARD_DRAG;
            const damp = Math.exp(-drag * dt);
            for (const p of b.parts) {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vx *= damp;
                p.vy *= damp;
                p.rot += p.spin * dt;
            }
            // 碎片先保持一会儿、把形状交代清楚，再过渡到淡出；火星则直接淡出
            const fadeStart = b.kind === 'shard' ? SHARD_FADE_START : 0;
            const fade = t <= fadeStart ? 1 : 1 - (t - fadeStart) / (1 - fadeStart);
            b.opacity.opacity = Math.round(255 * fade * fade);
            this.drawBurst(b, t);
        }
    }

    reset(): void {
        for (const r of this.rings) {
            r.node.active = false;
        }
        for (const f of this.texts) {
            f.node.active = false;
        }
        for (const b of this.bursts) {
            b.node.active = false;
        }
    }

    // ---------- 粒子特效 ----------

    /** 装填并点亮一簇粒子；碎片与火星共用同一套池与更新逻辑 */
    private launchBurst(kind: BurstKind, x: number, y: number, ttl: number, color: number, edge: number, parts: BurstParticle[]): void {
        const burst = this.obtainBurst();
        burst.kind = kind;
        burst.life = 0;
        burst.ttl = ttl;
        burst.color = color;
        burst.edge = edge;
        burst.parts = parts;
        burst.node.setPosition(x, y, 0);
        burst.node.setScale(1, 1, 1);
        burst.node.active = true;
        burst.opacity.opacity = 255;
        this.drawBurst(burst, 0);
    }

    private drawBurst(b: Burst, t: number): void {
        const g = b.g;
        g.clear();
        const fade = 1 - t;
        if (b.kind === 'spark') {
            // 火星：沿速度方向的一条短线，越接近消失越短越细
            for (const p of b.parts) {
                const speed = Math.hypot(p.vx, p.vy);
                if (speed < 1) {
                    continue;
                }
                const ux = p.vx / speed;
                const uy = p.vy / speed;
                const len = p.size * (0.35 + 0.65 * fade);
                g.lineWidth = 1 + 2 * WORLD * fade;
                g.strokeColor = colorOf(t < 0.3 ? b.edge : b.color, 255);
                g.moveTo(p.x - ux * len, p.y - uy * len);
                g.lineTo(p.x + ux * len, p.y + uy * len);
                g.stroke();
            }
            return;
        }
        // 碎片：重建原始楔形（相对自身重心），按 rot 自转后平移到当前位置
        const half = (SHARD_SECTOR / 2) * (Math.PI / 180);
        for (const p of b.parts) {
            const c = shardCentroid(p.angle, p.size);
            const rot = (p.rot * Math.PI) / 180;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            const a0 = (p.angle * Math.PI) / 180 - half;
            const a1 = (p.angle * Math.PI) / 180 + half;
            const local = [
                [0, 0],
                [Math.cos(a0) * p.size, Math.sin(a0) * p.size],
                [Math.cos(a1) * p.size, Math.sin(a1) * p.size],
            ];
            g.lineWidth = 1.6 * WORLD;
            // 碎片整体压到半透明，碎掉时不会太抢眼
            g.fillColor = colorOf(b.color, 118);
            g.strokeColor = colorOf(b.edge, 110);
            for (let k = 0; k < 3; k++) {
                const lx = local[k][0] - c[0];
                const ly = local[k][1] - c[1];
                const px = p.x + lx * cos - ly * sin;
                const py = p.y + lx * sin + ly * cos;
                if (k === 0) {
                    g.moveTo(px, py);
                } else {
                    g.lineTo(px, py);
                }
            }
            g.close();
            g.fill();
            g.stroke();
        }
    }

    // ---------- 池 ----------

    private obtainRing(): Ring {
        for (const r of this.rings) {
            if (!r.node.active) {
                return r;
            }
        }
        const node = createUiNode('Explosion', this.parent);
        const g = addGraphics(node);
        const opacity = node.addComponent(UIOpacity);
        const ring: Ring = { node, g, opacity, life: 0, ttl: RING_TTL };
        node.active = false;
        this.rings.push(ring);
        return ring;
    }

    private obtainBurst(): Burst {
        for (const b of this.bursts) {
            if (!b.node.active) {
                return b;
            }
        }
        const node = createUiNode('Burst', this.parent);
        const g = addGraphics(node);
        const opacity = node.addComponent(UIOpacity);
        const burst: Burst = {
            node,
            g,
            opacity,
            kind: 'spark',
            life: 0,
            ttl: SPARK_TTL,
            color: COLORS.gold,
            edge: 0xfff3c4,
            parts: [],
        };
        node.active = false;
        this.bursts.push(burst);
        return burst;
    }

    private obtainText(): FloatText {
        for (const f of this.texts) {
            if (!f.node.active) {
                return f;
            }
        }
        const node = createUiNode('FloatText', this.parent);
        const opacity = node.addComponent(UIOpacity);
        const label = createLabel(node, { text: '', size: 26, bold: true });
        const item: FloatText = { node, label, opacity, life: 0, ttl: TEXT_TTL, speedY: 62 };
        node.active = false;
        this.texts.push(item);
        return item;
    }
}