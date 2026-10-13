/**
 * 圆形防守模式 HUD。
 *
 * 顶部条：关卡 / 波次 + 暂停倍速按钮 + 状态文字 + 横幅提示。
 * 底部条：核心血量条与经验条（血条样式，进度填充 + 文字内嵌），
 * 位于技能冷却条下方、屏幕最底端。
 * 布局常量与命中矩形同源，drawChrome 与 handleTap 共用同一组常量。
 */
import { Graphics, Label, Node, UIOpacity } from 'cc';
import { COLORS } from '../config/GameConfig';
import { GamePhase } from '../core/GameEvents';
import { Rect, addGraphics, colorOf, createLabel, createUiNode, drawRect, makeRect, rectContains } from '../core/GraphicsUtil';

export interface CircleHudState {
    /** 当前关卡序号（1 起） */
    stage: number;
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

// ---------- 顶部条 ----------
const BAR_TOP = 640;
const BAR_BOTTOM = 505;
const CHIP_Y = 610;
const CHIP_W = 190;
const CHIP_H = 46;
const CHIP_X = [-240, -50];

const BTN_Y = 562;
const BTN_H = 40;
const PAUSE_RECT: Rect = makeRect(305, BTN_Y, 64, BTN_H);
const SPEED_RECT: Rect = makeRect(225, BTN_Y, 64, BTN_H);

const STATUS_Y = 524;

// ---------- 底部状态条（血条样式） ----------
/** 状态条左右边界 */
const STAT_LEFT = -330;
const STAT_RIGHT = 330;
/** 核心血量条：中心 y 与高度 */
const HP_BAR_Y = -578;
const HP_BAR_H = 26;
/** 经验条：中心 y 与高度 */
const XP_BAR_Y = -614;
const XP_BAR_H = 20;

const BANNER_TTL = 1.6;

export class CircleHud {
    private root: Node;
    private chromeG: Graphics;
    private statG: Graphics;

    private stageLabel: Label;
    private waveLabel: Label;
    private statusLabel: Label;
    private pauseLabel: Label;
    private speedLabel: Label;
    private hpBarLabel: Label;
    private xpBarLabel: Label;

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
        const stat = createUiNode('StatBars', this.root);
        this.statG = addGraphics(stat);
        this.drawChrome();

        this.stageLabel = createLabel(this.root, { size: 25, bold: true, color: COLORS.text, x: CHIP_X[0], y: CHIP_Y });
        this.waveLabel = createLabel(this.root, { size: 25, bold: true, color: COLORS.text, x: CHIP_X[1], y: CHIP_Y });
        this.statusLabel = createLabel(this.root, { size: 20, color: COLORS.textDim, x: 0, y: STATUS_Y });
        this.pauseLabel = createLabel(this.root, { size: 21, bold: true, color: COLORS.text, x: PAUSE_RECT.x + PAUSE_RECT.w / 2, y: BTN_Y });
        this.speedLabel = createLabel(this.root, { size: 21, bold: true, color: COLORS.text, x: SPEED_RECT.x + SPEED_RECT.w / 2, y: BTN_Y });
        // 血条内的文字（居中嵌在进度条上）
        this.hpBarLabel = createLabel(this.root, { size: 16, bold: true, color: COLORS.text, x: 0, y: HP_BAR_Y });
        this.xpBarLabel = createLabel(this.root, { size: 14, color: COLORS.text, x: 0, y: XP_BAR_Y });

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
        this.stageLabel.string = '第 ' + state.stage + ' 关';
        this.waveLabel.string = '波次 ' + state.wave + '/' + state.waveTotal;
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

        // 血条文字：护盾余量跟在核心生命后面，没有护盾时不占位
        this.hpBarLabel.string =
            state.coreShield > 0 ? '核心 ' + state.coreHp + '/' + state.coreHpMax + '  盾 +' + state.coreShield : '核心 ' + state.coreHp + '/' + state.coreHpMax;
        this.xpBarLabel.string = 'Lv.' + state.level + '  ' + state.xp + '/' + state.xpNeed;

        this.drawStatBars(state);
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
        if (y >= BAR_BOTTOM || y <= XP_BAR_Y - XP_BAR_H) {
            return true;
        }
        return false;
    }

    // ---------- 绘制 ----------

    private drawChrome(): void {
        const g = this.chromeG;
        g.clear();
        // 顶部背景条
        drawRect(g, -1000, BAR_BOTTOM, 2000, BAR_TOP - BAR_BOTTOM, COLORS.hudBg);
        drawRect(g, -1000, BAR_BOTTOM, 2000, 3, COLORS.gridLine);

        const accents = [COLORS.selection, COLORS.text];
        for (let i = 0; i < CHIP_X.length; i++) {
            const cx = CHIP_X[i];
            drawRect(g, cx - CHIP_W / 2, CHIP_Y - CHIP_H / 2, CHIP_W, CHIP_H, COLORS.panelBg, COLORS.panelBorder, 2, 12);
            drawRect(g, cx - CHIP_W / 2 + 16, CHIP_Y - CHIP_H / 2 + 5, CHIP_W - 32, 3, accents[i]);
        }

        drawRect(g, PAUSE_RECT.x, PAUSE_RECT.y, PAUSE_RECT.w, PAUSE_RECT.h, COLORS.panelBg, COLORS.panelBorder, 2, 10);
        drawRect(g, SPEED_RECT.x, SPEED_RECT.y, SPEED_RECT.w, SPEED_RECT.h, COLORS.panelBg, COLORS.panelBorder, 2, 10);
    }

    /** 底部两条状态条：进度填充 + 内嵌文字（静态框低频重绘，填充每次刷新） */
    private drawStatBars(state: CircleHudState): void {
        const g = this.statG;
        g.clear();

        // 核心血量条
        const hpW = STAT_RIGHT - STAT_LEFT;
        drawRect(g, STAT_LEFT, HP_BAR_Y - HP_BAR_H / 2, hpW, HP_BAR_H, COLORS.panelBg, COLORS.panelBorder, 2, 8);
        const hpRatio = state.coreHpMax > 0 ? Math.max(0, Math.min(1, state.coreHp / state.coreHpMax)) : 0;
        const hpFill = hpRatio * (hpW - 6);
        if (hpFill > 2) {
            drawRect(g, STAT_LEFT + 3, HP_BAR_Y - HP_BAR_H / 2 + 3, hpFill, HP_BAR_H - 6, COLORS.hp, undefined, 0, 6);
        }

        // 经验条
        const xpW = STAT_RIGHT - STAT_LEFT;
        drawRect(g, STAT_LEFT, XP_BAR_Y - XP_BAR_H / 2, xpW, XP_BAR_H, COLORS.panelBg, COLORS.panelBorder, 2, 8);
        const xpFill = Math.max(0, Math.min(1, state.xpRatio)) * (xpW - 6);
        if (xpFill > 2) {
            drawRect(g, STAT_LEFT + 3, XP_BAR_Y - XP_BAR_H / 2 + 3, xpFill, XP_BAR_H - 6, COLORS.selection, undefined, 0, 6);
        }
    }
}
