/**
 * 结算面板：胜利 / 失败覆盖层，显示本局战绩与历史最佳，并提供重开按钮。
 */
import { Graphics, Label, Node } from 'cc';
import { COLORS } from '../config/GameConfig';
import { Rect, addGraphics, colorOf, createLabel, createUiNode, drawRect, makeRect, rectContains } from '../core/GraphicsUtil';

const CARD_W = 580;
const CARD_H = 460;
const CARD_Y = 20;
const RESTART_RECT: Rect = makeRect(0, -160, 300, 84);

export class ResultPanel {
    private root: Node;
    private chromeG: Graphics;
    private titleLabel: Label;
    private statsLabel: Label;
    private tipLabel: Label;
    private buttonLabel: Label;

    private visible: boolean = false;
    private onRestart: () => void;

    constructor(parent: Node, onRestart: () => void) {
        this.onRestart = onRestart;
        this.root = createUiNode('ResultPanel', parent);
        // 遮罩覆盖整个可视区（含宽屏黑边）
        const chrome = createUiNode('Chrome', this.root);
        this.chromeG = addGraphics(chrome);
        this.drawChrome();

        this.titleLabel = createLabel(this.root, { size: 58, bold: true, x: 0, y: CARD_Y + 150 });
        this.statsLabel = createLabel(this.root, { size: 26, color: COLORS.text, x: 0, y: CARD_Y + 30 });
        this.tipLabel = createLabel(this.root, { size: 21, color: COLORS.textDim, x: 0, y: CARD_Y - 70 });
        this.buttonLabel = createLabel(this.root, { size: 26, bold: true, color: COLORS.text, x: 0, y: -160 });

        this.root.active = false;
    }

    get isVisible(): boolean {
        return this.visible;
    }

    show(win: boolean, wave: number, waveTotal: number, bestWave: number, playCount: number, winCount: number): void {
        this.visible = true;
        this.root.active = true;
        this.titleLabel.string = win ? '防守成功' : '防守失败';
        this.titleLabel.color = colorOf(win ? COLORS.hp : COLORS.danger);
        this.statsLabel.string =
            '到达波次   ' + wave + ' / ' + waveTotal + '\n历史最佳   ' + bestWave + '\n累计开局   ' + playCount + '    通关   ' + winCount;
        this.tipLabel.string = win ? '全部 10 波敌人已被清空' : '基地生命归零，重新布防试试';
        this.buttonLabel.string = '再来一局';
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
        if (rectContains(RESTART_RECT, x, y)) {
            this.onRestart();
        }
        return true;
    }

    private drawChrome(): void {
        const g = this.chromeG;
        g.clear();
        g.fillColor = colorOf(COLORS.overlay, 165);
        g.rect(-2000, -2000, 4000, 4000);
        g.fill();
        drawRect(g, -CARD_W / 2, CARD_Y - CARD_H / 2, CARD_W, CARD_H, COLORS.panelBg, COLORS.panelBorder, 3, 20);
        drawRect(g, -CARD_W / 2 + 30, CARD_Y + 60, CARD_W - 60, 2, COLORS.panelBorder);
        drawRect(g, RESTART_RECT.x, RESTART_RECT.y, RESTART_RECT.w, RESTART_RECT.h, COLORS.panelBg, COLORS.selection, 3, 14);
    }
}