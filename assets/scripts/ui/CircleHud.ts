/**
 * 圆形防守模式的顶部 HUD：核心生命 / 波次 / 强度等级 + 经验条 + 暂停倍速 + 横幅提示。
 * 布局常量与命中矩形同源，drawChrome 与 handleTap 共用同一组常量。
 */
import { Graphics, Label, Node, UIOpacity } from 'cc';
import { COLORS } from '../config/GameConfig';
import { GamePhase } from '../core/GameEvents';
import { Rect, addGraphics, colorOf, createLabel, createUiNode, drawRect, makeRect, rectContains } from '../core/GraphicsUtil';

export interface CircleHudState {
    coreHp: number;
    coreHpMax: number;
    /** 剩余护盾点数，0 表示没有护盾 */
    coreShield: number;
    wave: number;
    waveTotal: number;
    phase: GamePhase;
    prepTimer: number;
    enemyLeft: number;
    level: number;
    xp: number;
    xpNeed: number;
    xpRatio: number;
    paused: boolean;
    speedMul: number;
}

const BAR_TOP = 640;
const BAR_BOTTOM = 505;
const CHIP_Y = 610;
const CHIP_W = 190;
const CHIP_H = 46;
const CHIP_X = [-240, 0, 240];

const BTN_Y = 562;
const BTN_H = 40;
const PAUSE_RECT: Rect = makeRect(305, BTN_Y, 64, BTN_H);
const SPEED_RECT: Rect = makeRect(225, BTN_Y, 64, BTN_H);

const XP_BAR_Y = 568;
const XP_BAR_H = 12;
const XP_BAR_LEFT = -340;
const XP_BAR_RIGHT = 100;

const STATUS_Y = 524;
const BANNER_TTL = 1.6;

export class CircleHud {
    private root: Node;
    private chromeG: Graphics;
    private xpG: Graphics;

    private hpLabel: Label;
    private waveLabel: Label;
    private levelLabel: Label;
    private statusLabel: Label;
    private pauseLabel: Label;
    private speedLabel: Label;

    private bannerLabel: Label;
    private bannerOpacity: UIOpacity;
    private bannerTimer: number = 0;

    private onTogglePause: () => void;
    private onToggleSpeed: () => void;

    constructor(parent: Node, onTogglePause: () => void, onToggleSpeed: () => void) {
        this.onTogglePause = onTogglePause;
        this.onToggleSpeed = onToggleSpeed;

        this.root = createUiNode('CircleHud', parent);
        const chrome = createUiNode('Chrome', this.root);
        this.chromeG = addGraphics(chrome);
        const xp = createUiNode('XpBar', this.root);
        this.xpG = addGraphics(xp);
        this.drawChrome();

        this.hpLabel = createLabel(this.root, { size: 25, bold: true, color: COLORS.hp, x: CHIP_X[0], y: CHIP_Y });
        this.waveLabel = createLabel(this.root, { size: 25, bold: true, color: COLORS.text, x: CHIP_X[1], y: CHIP_Y });
        this.levelLabel = createLabel(this.root, { size: 25, bold: true, color: COLORS.selection, x: CHIP_X[2], y: CHIP_Y });
        this.statusLabel = createLabel(this.root, { size: 20, color: COLORS.textDim, x: 0, y: STATUS_Y });
        this.pauseLabel = createLabel(this.root, { size: 21, bold: true, color: COLORS.text, x: PAUSE_RECT.x + PAUSE_RECT.w / 2, y: BTN_Y });
        this.speedLabel = createLabel(this.root, { size: 21, bold: true, color: COLORS.text, x: SPEED_RECT.x + SPEED_RECT.w / 2, y: BTN_Y });

        const banner = createUiNode('Banner', this.root, 0, 390);
        this.bannerOpacity = banner.addComponent(UIOpacity);
        this.bannerOpacity.opacity = 0;
        this.bannerLabel = createLabel(banner, { text: '', size: 50, bold: true, color: COLORS.text });
    }

    /** 显示一次横幅（波次开始 / 技能触发） */
    showBanner(text: string, color: number = COLORS.text): void {
        this.bannerLabel.string = text;
        this.bannerLabel.color = colorOf(color);
        this.bannerTimer = BANNER_TTL;
    }

    update(dt: number): void {
        if (this.bannerTimer <= 0) {
            return;
        }
        this.bannerTimer -= dt;
        if (this.bannerTimer <= 0) {
            this.bannerTimer = 0;
            this.bannerOpacity.opacity = 0;
            return;
        }
        const t = this.bannerTimer / BANNER_TTL;
        this.bannerOpacity.opacity = Math.round(255 * Math.min(1, t * 2.2));
    }

    refresh(state: CircleHudState): void {
        // 护盾余量跟在核心生命后面，没有护盾时不占位
        this.hpLabel.string = state.coreShield > 0 ? '核心 ' + state.coreHp + ' +' + state.coreShield : '核心 ' + state.coreHp;
        this.waveLabel.string = '波次 ' + state.wave + '/' + state.waveTotal;
        this.levelLabel.string = 'Lv.' + state.level + '  ' + state.xp + '/' + state.xpNeed;
        this.pauseLabel.string = state.paused ? '继续' : '暂停';
        this.speedLabel.string = state.speedMul + 'x';

        if (state.phase === GamePhase.Prepare) {
            const wait = Math.max(0, Math.ceil(state.prepTimer));
            this.statusLabel.string = state.wave <= 0 ? '准备防守 · ' + wait + 's 后首波来袭' : '准备中 · ' + wait + 's 后出怪';
        } else if (state.phase === GamePhase.Won) {
            this.statusLabel.string = '全部 12 波清空，防守成功';
        } else if (state.phase === GamePhase.Lost) {
            this.statusLabel.string = '核心被突破';
        } else {
            this.statusLabel.string = '第 ' + state.wave + ' 波进行中 · 场上剩余 ' + state.enemyLeft + ' 只';
        }

        this.drawXpBar(state.xpRatio);
    }

    /** 返回 true 表示点击已被 HUD 消费 */
    handleTap(x: number, y: number): boolean {
        if (rectContains(SPEED_RECT, x, y)) {
            this.onToggleSpeed();
            return true;
        }
        if (rectContains(PAUSE_RECT, x, y)) {
            this.onTogglePause();
            return true;
        }
        if (y >= BAR_BOTTOM) {
            return true;
        }
        return false;
    }

    // ---------- 绘制 ----------

    private drawChrome(): void {
        const g = this.chromeG;
        g.clear();
        drawRect(g, -1000, BAR_BOTTOM, 2000, BAR_TOP - BAR_BOTTOM, COLORS.hudBg);
        drawRect(g, -1000, BAR_BOTTOM, 2000, 3, COLORS.gridLine);

        const accents = [COLORS.hp, COLORS.text, COLORS.selection];
        for (let i = 0; i < CHIP_X.length; i++) {
            const cx = CHIP_X[i];
            drawRect(g, cx - CHIP_W / 2, CHIP_Y - CHIP_H / 2, CHIP_W, CHIP_H, COLORS.panelBg, COLORS.panelBorder, 2, 12);
            drawRect(g, cx - CHIP_W / 2 + 16, CHIP_Y - CHIP_H / 2 + 5, CHIP_W - 32, 3, accents[i]);
        }

        drawRect(g, PAUSE_RECT.x, PAUSE_RECT.y, PAUSE_RECT.w, PAUSE_RECT.h, COLORS.panelBg, COLORS.panelBorder, 2, 10);
        drawRect(g, SPEED_RECT.x, SPEED_RECT.y, SPEED_RECT.w, SPEED_RECT.h, COLORS.panelBg, COLORS.panelBorder, 2, 10);
    }

    private drawXpBar(ratio: number): void {
        const g = this.xpG;
        g.clear();
        const w = XP_BAR_RIGHT - XP_BAR_LEFT;
        drawRect(g, XP_BAR_LEFT, XP_BAR_Y - XP_BAR_H / 2, w, XP_BAR_H, COLORS.panelBg, COLORS.panelBorder, 2, 6);
        const fill = Math.max(0, Math.min(1, ratio)) * (w - 6);
        if (fill > 2) {
            drawRect(g, XP_BAR_LEFT + 3, XP_BAR_Y - XP_BAR_H / 2 + 3, fill, XP_BAR_H - 6, COLORS.selection, undefined, 0, 3);
        }
    }
}