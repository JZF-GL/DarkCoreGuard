/**
 * 图鉴面板：技能宝典 + 敌人图鉴，两个 tab 分页展示。
 *
 *  - 技能宝典：列出所有升级卡（名称 / 说明 / 可叠加层数 / 是否定时技能）；
 *  - 敌人图鉴：列出所有敌人的外形（复用战斗中的绘制函数，保证外观一致）、特性与基础属性。
 *
 * 分页而非滚动，保持与项目其它面板一致的手动命中测试交互。
 */
import { Graphics, Label, Node } from 'cc';
import { CARD_DEFS, CardDef } from '../config/CircleConfig';
import { ENEMY_DEFS, ENEMY_ORDER, EnemyType } from '../config/EnemyConfig';
import { COLORS } from '../config/GameConfig';
import {
    Rect,
    addGraphics,
    colorOf,
    createLabel,
    createUiNode,
    drawRect,
    makeRect,
    rectContains,
} from '../core/GraphicsUtil';
import { drawEnemyBody } from '../entities/CircleEnemy';

export type CodexTab = 'skill' | 'enemy';

const TITLE_Y = 575;
const TAB_Y = 500;
const TAB_W = 232;
const TAB_H = 64;
const TAB_X = [-122, 122];

/** 每页展示的条目数 */
const ROWS_PER_PAGE = 4;
const ROW_W = 600;
const ROW_H = 160;
const ROW_Y = [330, 155, -20, -195];

const PAGER_Y = -370;
const PAGE_BTN_W = 150;
const PAGE_BTN_H = 62;
const PAGE_BTN_X = [-170, 170];

const BACK_Y = -490;
const BACK_W = 250;
const BACK_H = 70;

const SKILL_COLOR = 0x4fc3f7;
const ENEMY_COLOR = 0xffb74d;

export class CodexPanel {
    private root: Node;
    private listLayer: Node;
    private tabG: Graphics;
    private tabLabels: Label[] = [];
    private pageLabel: Label;
    private prevRect: Rect = makeRect(PAGE_BTN_X[0], PAGER_Y, PAGE_BTN_W, PAGE_BTN_H);
    private nextRect: Rect = makeRect(PAGE_BTN_X[1], PAGER_Y, PAGE_BTN_W, PAGE_BTN_H);
    private backRect: Rect = makeRect(0, BACK_Y, BACK_W, BACK_H);

    private tab: CodexTab;
    private page: number = 0;
    private readonly onBack: () => void;

    constructor(parent: Node, initialTab: CodexTab, onBack: () => void) {
        this.tab = initialTab;
        this.onBack = onBack;
        this.root = createUiNode('Codex', parent);

        const bg = createUiNode('Bg', this.root);
        drawRect(addGraphics(bg), -2000, -2000, 4000, 4000, COLORS.bg);

        createLabel(this.root, { text: '图 鉴', size: 48, bold: true, color: COLORS.text, x: 0, y: TITLE_Y });

        const tabLayer = createUiNode('Tabs', this.root);
        this.tabG = addGraphics(tabLayer);
        const tabInfos = [
            { text: '技能宝典', color: SKILL_COLOR },
            { text: '敌人图鉴', color: ENEMY_COLOR },
        ];
        for (let i = 0; i < tabInfos.length; i++) {
            this.tabLabels.push(
                createLabel(tabLayer, { text: tabInfos[i].text, size: 26, bold: true, x: TAB_X[i], y: TAB_Y }),
            );
        }
        this.drawTabs();

        this.listLayer = createUiNode('List', this.root);

        const pager = createUiNode('Pager', this.root);
        const pagerG = addGraphics(pager);
        drawRect(pagerG, this.prevRect.x, this.prevRect.y, PAGE_BTN_W, PAGE_BTN_H, COLORS.panelBg, COLORS.panelBorder, 3, 12);
        drawRect(pagerG, this.nextRect.x, this.nextRect.y, PAGE_BTN_W, PAGE_BTN_H, COLORS.panelBg, COLORS.panelBorder, 3, 12);
        createLabel(pager, { text: '上一页', size: 24, color: COLORS.text, x: PAGE_BTN_X[0], y: PAGER_Y });
        createLabel(pager, { text: '下一页', size: 24, color: COLORS.text, x: PAGE_BTN_X[1], y: PAGER_Y });
        this.pageLabel = createLabel(pager, { size: 22, color: COLORS.textDim, x: 0, y: PAGER_Y });

        const back = createUiNode('Back', this.root);
        drawRect(addGraphics(back), -BACK_W / 2, BACK_Y - BACK_H / 2, BACK_W, BACK_H, COLORS.panelBg, COLORS.selection, 3, 14);
        createLabel(back, { text: '返回首页', size: 26, bold: true, color: COLORS.selection, x: 0, y: BACK_Y });

        this.refresh();
    }

    /** 返回 true 表示点击已被面板消费 */
    handleTap(x: number, y: number): boolean {
        if (rectContains(makeRect(TAB_X[0], TAB_Y, TAB_W, TAB_H), x, y)) {
            this.switchTab('skill');
            return true;
        }
        if (rectContains(makeRect(TAB_X[1], TAB_Y, TAB_W, TAB_H), x, y)) {
            this.switchTab('enemy');
            return true;
        }
        if (rectContains(this.prevRect, x, y)) {
            this.turnPage(-1);
            return true;
        }
        if (rectContains(this.nextRect, x, y)) {
            this.turnPage(1);
            return true;
        }
        if (rectContains(this.backRect, x, y)) {
            this.onBack();
            return true;
        }
        return true;
    }

    // ---------- 内部 ----------

    private switchTab(tab: CodexTab): void {
        if (this.tab === tab) {
            return;
        }
        this.tab = tab;
        this.page = 0;
        this.drawTabs();
        this.refresh();
    }

    private turnPage(delta: number): void {
        const next = this.page + delta;
        if (next < 0 || next > this.maxPage) {
            return;
        }
        this.page = next;
        this.refresh();
    }

    private get itemCount(): number {
        return this.tab === 'skill' ? CARD_DEFS.length : ENEMY_ORDER.length;
    }

    private get maxPage(): number {
        return Math.max(0, Math.ceil(this.itemCount / ROWS_PER_PAGE) - 1);
    }

    private refresh(): void {
        this.pageLabel.string = '第 ' + (this.page + 1) + ' / ' + (this.maxPage + 1) + ' 页';
        this.listLayer.destroyAllChildren();
        if (this.tab === 'skill') {
            this.buildSkillRows();
        } else {
            this.buildEnemyRows();
        }
    }

    private buildSkillRows(): void {
        for (let i = 0; i < ROWS_PER_PAGE; i++) {
            const def: CardDef | undefined = CARD_DEFS[this.page * ROWS_PER_PAGE + i];
            if (!def) {
                break;
            }
            const y = ROW_Y[i];
            const row = createUiNode('Skill' + i, this.listLayer, 0, y);
            const g = addGraphics(row);
            this.drawRowBg(g, def.color, def.skill);

            const left = -ROW_W / 2 + 40;
            const right = ROW_W / 2 - 30;
            createLabel(row, { text: def.name, size: 28, bold: true, color: def.color, align: 'left', x: left, y: 48 });
            createLabel(row, {
                text: (def.skill ? '定时技能' : '强化') + '  ·  最多 ' + def.maxStacks + ' 层',
                size: 18,
                color: COLORS.textDim,
                align: 'right',
                x: right,
                y: 48,
            });
            createLabel(row, { text: def.desc, size: 20, color: COLORS.text, align: 'left', x: left, y: -10 });
        }
    }

    private buildEnemyRows(): void {
        for (let i = 0; i < ROWS_PER_PAGE; i++) {
            const type: EnemyType | undefined = ENEMY_ORDER[this.page * ROWS_PER_PAGE + i];
            if (!type) {
                break;
            }
            const def = ENEMY_DEFS[type];
            const y = ROW_Y[i];
            const row = createUiNode('Enemy' + i, this.listLayer, 0, y);
            const g = addGraphics(row);
            this.drawRowBg(g, def.color, false);

            // 图标单独一个节点，复用战斗中的绘制函数，图鉴里的外形与实战完全一致
            const icon = createUiNode('Icon', row, -ROW_W / 2 + 64, 0);
            drawEnemyBody(addGraphics(icon), def, 30);

            const left = -ROW_W / 2 + 108;
            const right = ROW_W / 2 - 30;
            createLabel(row, { text: def.name, size: 28, bold: true, color: def.color, align: 'left', x: left, y: 48 });
            createLabel(row, {
                text:
                    '生命 ' + def.hp + '   速度 ' + def.speed.toFixed(1) + '   护甲 ' + def.armor + '   伤害 ' + def.baseDamage,
                size: 19,
                color: COLORS.textDim,
                align: 'right',
                x: right,
                y: 48,
            });
            createLabel(row, { text: def.trait, size: 19, color: COLORS.text, align: 'left', x: left, y: -14 });
        }
    }

    private drawRowBg(g: Graphics, color: number, skill: boolean): void {
        const x = -ROW_W / 2;
        const y = -ROW_H / 2;
        drawRect(g, x, y, ROW_W, ROW_H, COLORS.panelBg, color, 2, 14);
        drawRect(g, x + 6, y + 12, 8, ROW_H - 24, color, undefined, 0, 4);
        if (skill) {
            // 定时技能额外描一层同色细边，与常驻强化区分
            drawRect(g, x + 2, y + 2, ROW_W - 4, ROW_H - 4, undefined, color, 1, 12);
        }
    }

    private drawTabs(): void {
        const g = this.tabG;
        g.clear();
        const colors = [SKILL_COLOR, ENEMY_COLOR];
        for (let i = 0; i < 2; i++) {
            const active = (i === 0 && this.tab === 'skill') || (i === 1 && this.tab === 'enemy');
            const border = active ? colors[i] : COLORS.panelBorder;
            drawRect(g, TAB_X[i] - TAB_W / 2, TAB_Y - TAB_H / 2, TAB_W, TAB_H, active ? COLORS.panelBg : COLORS.bg, border, 3, 12);
            this.tabLabels[i].color = colorOf(active ? colors[i] : COLORS.textDim);
        }
    }
}