/**
 * 升级三选一卡片面板。
 *
 * 强度升级时覆盖全屏，强制玩家从三张卡中选一张（不能关闭、不能跳过）。
 * 卡片横向排列，每张只显示卡片名称与一个程序化绘制的图标。
 * 候选不足三张时只渲染实际数量。
 * 若玩家长时间不选，倒计时结束后自动随机选择一张，避免卡住战斗节奏。
 */
import { Graphics, Label, Node } from 'cc';
import { CardKind } from '../config/CircleConfig';
import { COLORS } from '../config/GameConfig';
import { Rect, addGraphics, colorOf, createLabel, createUiNode, drawCircle, drawLine, drawPolygon, drawRect, drawStar, makeRect, rectContains } from '../core/GraphicsUtil';
import { CardChoice } from '../systems/UpgradeSystem';

const CARD_W = 200;
const CARD_H = 260;
/** 三张卡片横向排列的 x 坐标 */
const CARD_X = [-220, 0, 220];
const CARD_Y = -30;

const TITLE_Y = 200;
const SUBTITLE_Y = 150;

/** 自动选择倒计时（秒）：超时未选则随机挑一张 */
const AUTO_PICK_SECONDS = 10;

/** 图标在卡片内的中心 y（高于卡片中心，名称在下方） */
const ICON_CY = 40;
/** 图标基准半径（屏幕像素） */
const ICON_R = 32;
/** 名称在卡片内的 y */
const NAME_Y = -85;

interface Slot {
    g: Graphics;
    name: Label;
}

export class UpgradeCards {
    private root: Node;
    private titleLabel: Label;
    private subtitleLabel: Label;
    private slots: Slot[] = [];
    private choices: CardChoice[] = [];
    private visible: boolean = false;

    /** 自动选择剩余秒数 */
    private autoTimer: number = 0;
    /** 副标题的固定部分，倒计时数字拼在其后 */
    private subtitleBase: string = '';
    /** 已渲染的倒计时整秒，避免每帧重建字符串 */
    private shownSecond: number = -1;

    private onPick: (choice: CardChoice) => void;

    constructor(parent: Node, onPick: (choice: CardChoice) => void) {
        this.onPick = onPick;
        this.root = createUiNode('UpgradeCards', parent);

        // 全屏遮罩（覆盖宽屏黑边）
        const chrome = createUiNode('Chrome', this.root);
        const chromeG = addGraphics(chrome);
        chromeG.fillColor = colorOf(COLORS.overlay, 200);
        chromeG.rect(-2000, -2000, 4000, 4000);
        chromeG.fill();

        this.titleLabel = createLabel(this.root, { size: 44, bold: true, color: COLORS.text, x: 0, y: TITLE_Y });
        this.subtitleLabel = createLabel(this.root, { size: 22, color: COLORS.textDim, x: 0, y: SUBTITLE_Y });

        for (let i = 0; i < CARD_X.length; i++) {
            const layer = createUiNode('Card' + i, this.root, CARD_X[i], CARD_Y);
            const g = addGraphics(layer);
            const name = createLabel(layer, { size: 28, bold: true, color: COLORS.text, x: 0, y: NAME_Y });
            this.slots.push({ g, name });
        }

        this.root.active = false;
    }

    get isVisible(): boolean {
        return this.visible;
    }

    /**
     * 展示候选卡。
     * @param choices 候选卡片（1~3 张）
     * @param level 当前强度等级
     * @param remaining 除本次之外还剩几次升级（连升时 > 0）
     */
    show(choices: CardChoice[], level: number, remaining: number): void {
        this.choices = choices;
        this.visible = true;
        this.root.active = true;

        this.titleLabel.string = '强度升级  Lv.' + level;
        this.subtitleBase = remaining > 0 ? '选择一项强化（还有 ' + remaining + ' 次升级待选）' : '选择一项强化';

        this.autoTimer = AUTO_PICK_SECONDS;
        this.shownSecond = -1;
        this.refreshSubtitle();

        for (let i = 0; i < this.slots.length; i++) {
            const slot = this.slots[i];
            const choice = choices[i];
            const active = !!choice;
            slot.g.node.active = active;
            slot.name.node.active = active;
            if (!choice) {
                continue;
            }
            this.drawSlot(slot, choice);
        }
    }

    /**
     * 推进自动选择倒计时。面板隐藏时不做任何事。
     * 倒计时归零则随机选一张并触发 onPick（调用方负责隐藏并继续后续升级）。
     */
    tick(dt: number): void {
        if (!this.visible || this.choices.length === 0) {
            return;
        }
        this.autoTimer -= dt;
        if (this.autoTimer > 0) {
            this.refreshSubtitle();
            return;
        }
        const index = Math.floor(Math.random() * this.choices.length);
        this.onPick(this.choices[index]);
    }

    private refreshSubtitle(): void {
        const left = Math.max(0, Math.ceil(this.autoTimer));
        if (left === this.shownSecond) {
            return;
        }
        this.shownSecond = left;
        this.subtitleLabel.string = this.subtitleBase + '（' + left + 's 后自动选择）';
    }

    hide(): void {
        this.visible = false;
        this.autoTimer = 0;
        this.root.active = false;
    }

    /** 返回 true 表示点击已被面板消费（面板显示时吞掉所有点击） */
    handleTap(x: number, y: number): boolean {
        if (!this.visible) {
            return false;
        }
        for (let i = 0; i < this.choices.length; i++) {
            const rect: Rect = makeRect(CARD_X[i], CARD_Y, CARD_W, CARD_H);
            if (rectContains(rect, x, y)) {
                this.onPick(this.choices[i]);
                return true;
            }
        }
        return true;
    }

    private drawSlot(slot: Slot, choice: CardChoice): void {
        const def = choice.def;
        const g = slot.g;
        g.clear();

        const x = -CARD_W / 2;
        const y = -CARD_H / 2;
        // 卡片背景 + 颜色描边
        drawRect(g, x, y, CARD_W, CARD_H, COLORS.panelBg, def.color, 3, 16);
        // 顶部色条
        drawRect(g, x + 10, y + CARD_H - 18, CARD_W - 20, 8, def.color, undefined, 0, 4);

        // 图标
        this.drawCardIcon(g, def.kind, 0, ICON_CY, def.color);

        // 名称
        slot.name.string = def.name;
        slot.name.color = colorOf(def.color);
    }

    /** 在 (x1,y1) → (x2,y2) 画一条带箭头的线 */
    private drawArrow(g: Graphics, x1: number, y1: number, x2: number, y2: number, color: number, lw: number): void {
        drawLine(g, x1, y1, x2, y2, color, lw);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const ah = 10;
        const spread = 0.45;
        drawLine(g, x2, y2, x2 - ah * Math.cos(angle - spread), y2 - ah * Math.sin(angle - spread), color, lw);
        drawLine(g, x2, y2, x2 - ah * Math.cos(angle + spread), y2 - ah * Math.sin(angle + spread), color, lw);
    }

    /**
     * 根据卡片类型绘制图标。
     * 所有图标以 (cx, cy) 为中心，半径约 ICON_R，使用卡片主色。
     */
    private drawCardIcon(g: Graphics, kind: CardKind, cx: number, cy: number, color: number): void {
        const R = ICON_R;
        const lw = 3;

        switch (kind) {
            case 'pb_distinct': {
                // 三条从底部分散射出的箭头
                const bx = cx, by = cy + R * 0.7;
                const tips: number[][] = [
                    [cx - R * 0.9, cy - R * 0.5],
                    [cx, cy - R],
                    [cx + R * 0.9, cy - R * 0.5],
                ];
                for (const [tx, ty] of tips) {
                    this.drawArrow(g, bx, by, tx, ty, color, lw);
                }
                break;
            }
            case 'pb_same': {
                // 三条平行向上箭头
                const xs = [-R * 0.5, 0, R * 0.5];
                for (const dx of xs) {
                    this.drawArrow(g, cx + dx, cy + R * 0.7, cx + dx, cy - R * 0.7, color, lw);
                }
                break;
            }
            case 'pb_bounce': {
                // V 形弹道 + 反弹墙面
                drawLine(g, cx - R * 0.8, cy + R * 0.6, cx, cy - R * 0.2, color, lw);
                drawLine(g, cx, cy - R * 0.2, cx + R * 0.8, cy + R * 0.6, color, lw);
                drawLine(g, cx, cy - R * 0.65, cx, cy + R * 0.05, color, lw);
                drawCircle(g, cx, cy - R * 0.2, 3, color);
                break;
            }
            case 'aspd': {
                // 闪电（填充多边形）
                const pts: number[][] = [
                    [cx - R * 0.15, cy + R],
                    [cx + R * 0.3, cy + R * 0.15],
                    [cx + R * 0.05, cy + R * 0.15],
                    [cx + R * 0.25, cy - R],
                    [cx - R * 0.3, cy - R * 0.15],
                    [cx - R * 0.05, cy - R * 0.15],
                ];
                drawPolygon(g, pts, color);
                break;
            }
            case 'power': {
                // 五角星爆发（填充）
                drawStar(g, cx, cy, R, R * 0.4, color);
                break;
            }
            case 'range': {
                // 同心圆 + 十字准星
                drawCircle(g, cx, cy, R * 0.85, undefined, color, lw);
                drawCircle(g, cx, cy, R * 0.45, undefined, color, lw);
                drawCircle(g, cx, cy, 2, color);
                drawLine(g, cx, cy + R, cx, cy + R * 0.55, color, lw);
                drawLine(g, cx, cy - R, cx, cy - R * 0.55, color, lw);
                drawLine(g, cx - R, cy, cx - R * 0.55, cy, color, lw);
                drawLine(g, cx + R, cy, cx + R * 0.55, cy, color, lw);
                break;
            }
            case 'shield': {
                // 盾牌（半透明填充 + 描边）
                g.fillColor = colorOf(color, 60);
                g.lineWidth = lw;
                g.strokeColor = colorOf(color);
                g.moveTo(cx, cy + R);
                g.lineTo(cx + R * 0.7, cy + R * 0.5);
                g.lineTo(cx + R * 0.7, cy - R * 0.2);
                g.lineTo(cx, cy - R);
                g.lineTo(cx - R * 0.7, cy - R * 0.2);
                g.lineTo(cx - R * 0.7, cy + R * 0.5);
                g.close();
                g.fill();
                g.stroke();
                break;
            }
            case 'heal': {
                // 医疗十字（填充）
                const t = R * 0.28;
                const s = R * 0.85;
                g.fillColor = colorOf(color, 80);
                g.lineWidth = lw;
                g.strokeColor = colorOf(color);
                g.rect(cx - s, cy - t, s * 2, t * 2);
                g.rect(cx - t, cy - s, t * 2, s * 2);
                g.fill();
                g.stroke();
                break;
            }
            case 'sk_bomb': {
                // 八角爆炸星（填充）
                const pts: number[][] = [];
                for (let i = 0; i < 16; i++) {
                    const r = i % 2 === 0 ? R : R * 0.35;
                    const a = -Math.PI / 2 + (Math.PI * i) / 8;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                drawPolygon(g, pts, color);
                break;
            }
            case 'sk_frost': {
                // 雪花：三条主线 + 分支
                const angles: number[] = [];
                const tips: number[][] = [];
                for (let i = 0; i < 6; i++) {
                    const a = -Math.PI / 2 + (Math.PI * i) / 3;
                    angles.push(a);
                    tips.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
                }
                for (let i = 0; i < 3; i++) {
                    drawLine(g, tips[i][0], tips[i][1], tips[i + 3][0], tips[i + 3][1], color, lw);
                }
                const branchLen = R * 0.25;
                const branchPos = 0.7;
                for (let i = 0; i < 6; i++) {
                    const a = angles[i];
                    const px = cx + Math.cos(a) * R * branchPos;
                    const py = cy + Math.sin(a) * R * branchPos;
                    for (const sign of [-1, 1]) {
                        const ba = a + sign * Math.PI / 3;
                        drawLine(g, px, py, px + branchLen * Math.cos(ba), py + branchLen * Math.sin(ba), color, lw);
                    }
                }
                break;
            }
            case 'sk_radar': {
                // 雷达波（同心弧线）
                g.lineWidth = lw;
                g.strokeColor = colorOf(color);
                g.arc(cx, cy, R * 0.9, -90, 90, false);
                g.stroke();
                g.arc(cx, cy, R * 0.55, -90, 90, false);
                g.stroke();
                drawCircle(g, cx, cy, 3, color);
                break;
            }
            case 'sk_wind': {
                // 三条风线 + 箭头
                const ys = [R * 0.6, 0, -R * 0.6];
                const lens = [R * 0.7, R, R * 0.5];
                for (let i = 0; i < 3; i++) {
                    const y = cy + ys[i];
                    const len = lens[i];
                    this.drawArrow(g, cx - len, y, cx + len * 0.8, y, color, lw);
                }
                break;
            }
        }
    }
}
