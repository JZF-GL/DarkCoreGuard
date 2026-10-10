/**
 * 表现特效：爆炸扩散圈 + 金币飘字。
 * 两者都是纯 Graphics / Label 节点，内部做池化，避免战斗中频繁创建节点。
 */
import { Graphics, Label, Node, UIOpacity } from 'cc';
import { COLORS } from '../config/GameConfig';
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

const RING_TTL = 0.32;
const TEXT_TTL = 0.7;

export class FxSystem {
    private parent: Node;

    private rings: Ring[] = [];
    private texts: FloatText[] = [];

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
    }

    reset(): void {
        for (const r of this.rings) {
            r.node.active = false;
        }
        for (const f of this.texts) {
            f.node.active = false;
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