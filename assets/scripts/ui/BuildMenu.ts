/**
 * 底部操作条：默认状态显示波次进度与「立即开始」，点空格子显示建造菜单，点已有塔显示升级/出售菜单。
 * 所有可点击区域在执行时注册到 buttons 列表，由 handleTap 统一命中测试。
 */
import { Graphics, Label, Node } from 'cc';
import { COLORS } from '../config/GameConfig';
import { TOWER_DEFS, TOWER_ORDER, TowerType, towerDps, sellValue, towerStat, upgradeCost } from '../config/TowerConfig';
import { GamePhase } from '../core/GameEvents';
import { Rect, addGraphics, colorOf, createLabel, createUiNode, drawRect, makeRect, rectContains } from '../core/GraphicsUtil';
import { CellCoord } from '../core/Grid';
import { Tower } from '../entities/Tower';

export interface MenuState {
    gold: number;
    phase: GamePhase;
    prepTimer: number;
    enemyLeft: number;
    wave: number;
    waveTotal: number;
}

export interface MenuCallbacks {
    onBuild: (type: TowerType, col: number, row: number) => void;
    onUpgrade: (tower: Tower) => void;
    onSell: (tower: Tower) => void;
    onClose: () => void;
    onCallNextWave: () => void;
}

type Mode = 'default' | 'build' | 'tower';

const BAR_TOP = -520;
const BAR_BOTTOM = -640;

const CARD_W = 176;
const CARD_H = 100;
const CARD_Y = -580;
const CARD_X = [-250, -50, 150];
const CARD_CLOSE_RECT: Rect = makeRect(300, CARD_Y, 60, CARD_H);

const TITLE_Y = -540;

const UPGRADE_RECT: Rect = makeRect(-160, -597, 220, 56);
const SELL_RECT: Rect = makeRect(60, -597, 150, 56);
const CLOSE_RECT: Rect = makeRect(265, -597, 90, 56);
const CALL_RECT: Rect = makeRect(0, -600, 460, 58);

interface HitButton {
    rect: Rect;
    action: string;
    enabled: boolean;
}

export class BuildMenu {
    private root: Node;
    private chromeG: Graphics;
    private callbacks: MenuCallbacks;

    private mode: Mode = 'default';
    private cell: CellCoord | null = null;
    private tower: Tower | null = null;

    private titleLabel: Label;
    private cardName: Label[] = [];
    private cardCost: Label[] = [];
    private cardInfo: Label[] = [];
    private upgradeLabel: Label;
    private sellLabel: Label;
    private closeLabel: Label;
    private cardCloseLabel: Label;
    private callLabel: Label;

    private buttons: HitButton[] = [];
    private lastKey: string = '';

    constructor(parent: Node, callbacks: MenuCallbacks) {
        this.callbacks = callbacks;
        this.root = createUiNode('BuildMenu', parent);
        const chrome = createUiNode('Chrome', this.root);
        this.chromeG = addGraphics(chrome);

        this.titleLabel = createLabel(this.root, { size: 22, bold: true, color: COLORS.text, x: 0, y: TITLE_Y });
        for (let i = 0; i < TOWER_ORDER.length; i++) {
            const cx = CARD_X[i];
            this.cardName.push(createLabel(this.root, { size: 24, bold: true, x: cx, y: CARD_Y + 34 }));
            this.cardCost.push(createLabel(this.root, { size: 21, bold: true, x: cx, y: CARD_Y + 2 }));
            this.cardInfo.push(createLabel(this.root, { size: 17, color: COLORS.textDim, x: cx, y: CARD_Y - 32 }));
        }
        this.upgradeLabel = createLabel(this.root, { size: 22, bold: true, color: COLORS.text, x: UPGRADE_RECT.x + UPGRADE_RECT.w / 2, y: -597 });
        this.sellLabel = createLabel(this.root, { size: 22, bold: true, color: COLORS.gold, x: SELL_RECT.x + SELL_RECT.w / 2, y: -597 });
        this.closeLabel = createLabel(this.root, { size: 22, bold: true, color: COLORS.textDim, x: CLOSE_RECT.x + CLOSE_RECT.w / 2, y: -597 });
        this.cardCloseLabel = createLabel(this.root, { size: 26, bold: true, color: COLORS.textDim, x: CARD_CLOSE_RECT.x + CARD_CLOSE_RECT.w / 2, y: CARD_Y });
        this.callLabel = createLabel(this.root, { size: 24, bold: true, color: COLORS.text, x: 0, y: -600 });

        this.showDefault();
    }

    // ---------- 模式切换 ----------

    showDefault(): void {
        this.mode = 'default';
        this.cell = null;
        this.tower = null;
        this.lastKey = '';
    }

    showBuild(cell: CellCoord): void {
        this.mode = 'build';
        this.cell = cell;
        this.tower = null;
        this.lastKey = '';
    }

    showTower(tower: Tower): void {
        this.mode = 'tower';
        this.tower = tower;
        this.cell = null;
        this.lastKey = '';
    }

    get isDefault(): boolean {
        return this.mode === 'default';
    }

    /** 每帧调用，内部做签名比对，只有状态变化时才重绘 */
    refresh(state: MenuState): void {
        const key = [
            this.mode,
            state.gold,
            state.phase,
            Math.ceil(state.prepTimer),
            state.enemyLeft,
            state.wave,
            this.tower ? this.tower.level : 0,
            this.cell ? this.cell.col + ',' + this.cell.row : '-',
        ].join('|');
        if (key === this.lastKey) {
            return;
        }
        this.lastKey = key;
        this.applyText(state);
        this.drawChrome(state);
    }

    /** 返回 true 表示点击已被底部条消费 */
    handleTap(x: number, y: number): boolean {
        for (const button of this.buttons) {
            if (!button.enabled || !rectContains(button.rect, x, y)) {
                continue;
            }
            this.dispatch(button.action);
            return true;
        }
        if (y <= BAR_TOP) {
            // 底部条区域整体吞掉点击
            return true;
        }
        return false;
    }

    // ---------- 内部 ----------

    private dispatch(action: string): void {
        if (action.indexOf('build:') === 0) {
            const type = action.slice('build:'.length) as TowerType;
            if (this.cell) {
                this.callbacks.onBuild(type, this.cell.col, this.cell.row);
            }
        } else if (action === 'upgrade') {
            if (this.tower) {
                this.callbacks.onUpgrade(this.tower);
            }
        } else if (action === 'sell') {
            if (this.tower) {
                this.callbacks.onSell(this.tower);
            }
        } else if (action === 'call') {
            this.callbacks.onCallNextWave();
        } else if (action === 'close') {
            this.callbacks.onClose();
        }
    }

    private setCardsVisible(visible: boolean): void {
        for (let i = 0; i < TOWER_ORDER.length; i++) {
            this.cardName[i].node.active = visible;
            this.cardCost[i].node.active = visible;
            this.cardInfo[i].node.active = visible;
        }
    }

    private applyText(state: MenuState): void {
        const showCards = this.mode === 'build';
        this.setCardsVisible(showCards);
        // 建造模式下卡片会占满整个底条（卡片本身已带名称与造价），标题会与卡片重叠，故隐藏
        this.titleLabel.node.active = !showCards;
        this.upgradeLabel.node.active = this.mode === 'tower';
        this.sellLabel.node.active = this.mode === 'tower';
        this.closeLabel.node.active = this.mode === 'tower';
        this.cardCloseLabel.node.active = showCards;
        this.callLabel.node.active = this.mode === 'default' && state.phase === GamePhase.Prepare;

        if (this.mode === 'default') {
            if (state.phase === GamePhase.Prepare) {
                const wait = Math.max(0, Math.ceil(state.prepTimer));
                const bonus = Math.floor(state.prepTimer) * 2;
                this.titleLabel.string = '下一波倒计时 ' + wait + 's';
                this.callLabel.string = '立即开始  +' + bonus;
                this.callLabel.color = colorOf(COLORS.text);
            } else if (state.phase === GamePhase.Won) {
                this.titleLabel.string = '全部波次已清空';
            } else if (state.phase === GamePhase.Lost) {
                this.titleLabel.string = '基地已失守';
            } else {
                this.titleLabel.string =
                    '第 ' + state.wave + '/' + state.waveTotal + ' 波进行中 · 场上剩余 ' + state.enemyLeft + ' 只';
            }
        } else if (this.mode === 'build') {
            this.titleLabel.string = '选择要建造的防御塔';
            for (let i = 0; i < TOWER_ORDER.length; i++) {
                const def = TOWER_DEFS[TOWER_ORDER[i]];
                const afford = state.gold >= def.cost;
                this.cardName[i].string = def.name;
                this.cardName[i].color = colorOf(afford ? def.color : COLORS.textDim);
                this.cardCost[i].string = '造价 ' + def.cost;
                this.cardCost[i].color = colorOf(afford ? COLORS.gold : COLORS.danger);
                this.cardInfo[i].string = 'DPS ' + towerDps(def, 1).toFixed(1) + ' · ' + def.range.toFixed(1) + '格';
            }
        } else if (this.mode === 'tower' && this.tower) {
            const tower = this.tower;
            const stat = towerStat(tower.def, tower.level);
            this.titleLabel.string =
                tower.def.name +
                ' Lv.' +
                tower.level +
                ' · 伤害 ' +
                stat.damage.toFixed(0) +
                ' · DPS ' +
                towerDps(tower.def, tower.level).toFixed(1) +
                ' · 射程 ' +
                stat.range.toFixed(1) +
                '格';
            const cost = upgradeCost(tower.def, tower.level);
            if (cost < 0) {
                this.upgradeLabel.string = '已达最高等级';
                this.upgradeLabel.color = colorOf(COLORS.textDim);
            } else {
                this.upgradeLabel.string = '升级 ' + cost;
                this.upgradeLabel.color = colorOf(state.gold >= cost ? COLORS.text : COLORS.danger);
            }
            this.sellLabel.string = '出售 +' + sellValue(tower.def, tower.level);
            this.closeLabel.string = '关闭';
        }
    }

    private drawChrome(state: MenuState): void {
        const g = this.chromeG;
        g.clear();
        this.buttons = [];

        // 底条背景
        drawRect(g, -1000, BAR_BOTTOM, 2000, BAR_TOP - BAR_BOTTOM, COLORS.hudBg);
        drawRect(g, -1000, BAR_TOP - 3, 2000, 3, COLORS.gridLine);

        const gold = state.gold;

        if (this.mode === 'build') {
            for (let i = 0; i < TOWER_ORDER.length; i++) {
                const def = TOWER_DEFS[TOWER_ORDER[i]];
                const afford = gold >= def.cost;
                const x = CARD_X[i] - CARD_W / 2;
                const y = CARD_Y - CARD_H / 2;
                drawRect(g, x, y, CARD_W, CARD_H, COLORS.panelBg, afford ? def.color : COLORS.panelBorder, 3, 12);
                drawRect(g, x + 14, y + CARD_H - 9, CARD_W - 28, 4, afford ? def.color : COLORS.panelBorder);
                this.buttons.push({ rect: makeRect(CARD_X[i], CARD_Y, CARD_W, CARD_H), action: 'build:' + def.type, enabled: afford });
            }
            drawRect(g, CARD_CLOSE_RECT.x, CARD_CLOSE_RECT.y, CARD_CLOSE_RECT.w, CARD_CLOSE_RECT.h, COLORS.panelBg, COLORS.panelBorder, 2, 12);
            this.buttons.push({ rect: CARD_CLOSE_RECT, action: 'close', enabled: true });
        } else if (this.mode === 'tower' && this.tower) {
            const cost = upgradeCost(this.tower.def, this.tower.level);
            const canUpgrade = cost >= 0 && gold >= cost;
            drawRect(g, UPGRADE_RECT.x, UPGRADE_RECT.y, UPGRADE_RECT.w, UPGRADE_RECT.h, COLORS.panelBg, canUpgrade ? COLORS.selection : COLORS.panelBorder, 3, 12);
            this.buttons.push({ rect: UPGRADE_RECT, action: 'upgrade', enabled: canUpgrade });

            drawRect(g, SELL_RECT.x, SELL_RECT.y, SELL_RECT.w, SELL_RECT.h, COLORS.panelBg, COLORS.gold, 2, 12);
            this.buttons.push({ rect: SELL_RECT, action: 'sell', enabled: true });

            drawRect(g, CLOSE_RECT.x, CLOSE_RECT.y, CLOSE_RECT.w, CLOSE_RECT.h, COLORS.panelBg, COLORS.panelBorder, 2, 12);
            this.buttons.push({ rect: CLOSE_RECT, action: 'close', enabled: true });
        } else if (state.phase === GamePhase.Prepare) {
            drawRect(g, CALL_RECT.x, CALL_RECT.y, CALL_RECT.w, CALL_RECT.h, COLORS.panelBg, COLORS.selection, 3, 12);
            this.buttons.push({ rect: CALL_RECT, action: 'call', enabled: true });
        }
    }
}