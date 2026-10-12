/**
 * 结算面板：胜利 / 失败覆盖层。
 *
 * 经典路径模式与圆形防守模式共用：经典模式 stars = 0（不显示星星），
 * 圆形模式显示本关拿到的星数，并按情形给出「重试 / 下一关 / 返回首页」按钮。
 */
import { Graphics, Label, Node } from 'cc';
import { COLORS } from '../config/GameConfig';
import {
    Rect,
    addGraphics,
    colorOf,
    createLabel,
    createUiNode,
    drawRect,
    drawStar,
    makeRect,
    rectContains,
} from '../core/GraphicsUtil';

const CARD_W = 600;
const CARD_H = 520;
const CARD_Y = 0;
const TITLE_Y = 192;
const STAR_Y = 96;
const STAR_GAP = 78;
const STAR_OUTER = 30;
const STAR_INNER = 13;
const LINES_Y = -8;
const TIP_Y = -112;
const BUTTON_Y = -206;
const BUTTON_W = 200;
const BUTTON_H = 78;

/** 最多同时展示的按钮数量（1~3 个横向排列） */
const BUTTON_SLOTS = 3;

/** 已获得的星色 */
const STAR_ON = 0xffc94d;
/** 未获得的星色 */
const STAR_OFF = 0x36404e;

export interface ResultButton {
    label: string;
    /** 按钮描边与文字颜色 */
    color: number;
    onTap: () => void;
}

export interface ResultConfig {
    win: boolean;
    /** 面板标题，缺省按胜负取「防守成功 / 防守失败」 */
    title?: string;
    /** 星级评价，0 表示不显示星星 */
    stars: number;
    /** 逐行展示的战绩文字 */
    lines: string[];
    /** 底部提示 */
    tip?: string;
    buttons: ResultButton[];
}

interface ButtonSlot {
    root: Node;
    g: Graphics;
    label: Label;
    rect: Rect;
    action: (() => void) | null;
}

export class ResultPanel {
    private root: Node;
    private chromeG: Graphics;
    private starG: Graphics;
    private titleLabel: Label;
    private linesLabel: Label;
    private tipLabel: Label;
    private buttons: ButtonSlot[] = [];

    private visible: boolean = false;

    constructor(parent: Node) {
        this.root = createUiNode('ResultPanel', parent);

        const chrome = createUiNode('Chrome', this.root);
        this.chromeG = addGraphics(chrome);
        this.drawChrome();

        const stars = createUiNode('Stars', this.root);
        this.starG = addGraphics(stars);

        this.titleLabel = createLabel(this.root, { size: 58, bold: true, x: 0, y: TITLE_Y });
        this.linesLabel = createLabel(this.root, { size: 25, color: COLORS.text, x: 0, y: LINES_Y });
        this.tipLabel = createLabel(this.root, { size: 21, color: COLORS.textDim, x: 0, y: TIP_Y });

        for (let i = 0; i < BUTTON_SLOTS; i++) {
            const node = createUiNode('Btn' + i, this.root);
            const g = addGraphics(node);
            const label = createLabel(node, { size: 25, bold: true, color: COLORS.text });
            this.buttons.push({ root: node, g, label, rect: makeRect(0, BUTTON_Y, BUTTON_W, BUTTON_H), action: null });
        }

        this.root.active = false;
    }

    get isVisible(): boolean {
        return this.visible;
    }

    show(config: ResultConfig): void {
        this.visible = true;
        this.root.active = true;
        this.titleLabel.string = config.title ?? (config.win ? '防守成功' : '防守失败');
        this.titleLabel.color = colorOf(config.win ? COLORS.hp : COLORS.danger);
        this.linesLabel.string = config.lines.join('\n');
        this.tipLabel.string = config.tip ?? '';
        this.drawStars(config.stars);
        this.layoutButtons(config.buttons);
    }

    hide(): void {
        this.visible = false;
        this.root.active = false;
    }

    /** 返回 true 表示点击已被面板消费 */
    handleTap(x: number, y: number): boolean {
        if (!this.visible) {
            return false;
        }
        for (const slot of this.buttons) {
            if (slot.action && rectContains(slot.rect, x, y)) {
                slot.action();
                return true;
            }
        }
        return true;
    }

    // ---------- 内部 ----------

    private drawStars(count: number): void {
        const g = this.starG;
        g.clear();
        if (count <= 0) {
            return;
        }
        const earned = Math.max(0, Math.min(3, count));
        for (let i = 0; i < 3; i++) {
            const x = (i - 1) * STAR_GAP;
            if (i < earned) {
                drawStar(g, x, STAR_Y, STAR_OUTER, STAR_INNER, STAR_ON, 0xffe9a8, 2);
            } else {
                drawStar(g, x, STAR_Y, STAR_OUTER, STAR_INNER, STAR_OFF);
            }
        }
    }

    /** 按按钮数量横向平分排列，1 个居中、2 个对称、3 个等距 */
    private layoutButtons(defs: ResultButton[]): void {
        const count = Math.min(BUTTON_SLOTS, defs.length);
        const xs = count <= 1 ? [0] : count === 2 ? [-112, 112] : [-196, 0, 196];
        for (let i = 0; i < BUTTON_SLOTS; i++) {
            const slot = this.buttons[i];
            if (i >= count) {
                slot.root.active = false;
                slot.action = null;
                continue;
            }
            const def = defs[i];
            slot.root.active = true;
            slot.root.setPosition(xs[i], BUTTON_Y, 0);
            slot.rect = makeRect(xs[i], BUTTON_Y, BUTTON_W, BUTTON_H);
            slot.action = def.onTap;
            slot.label.string = def.label;
            slot.label.color = colorOf(def.color);
            const g = slot.g;
            g.clear();
            drawRect(g, -BUTTON_W / 2, -BUTTON_H / 2, BUTTON_W, BUTTON_H, COLORS.panelBg, def.color, 3, 14);
        }
    }

    private drawChrome(): void {
        const g = this.chromeG;
        g.clear();
        g.fillColor = colorOf(COLORS.overlay, 165);
        g.rect(-2000, -2000, 4000, 4000);
        g.fill();
        drawRect(g, -CARD_W / 2, CARD_Y - CARD_H / 2, CARD_W, CARD_H, COLORS.panelBg, COLORS.panelBorder, 3, 20);
        drawRect(g, -CARD_W / 2 + 30, CARD_Y + 140, CARD_W - 60, 2, COLORS.panelBorder);
    }
}