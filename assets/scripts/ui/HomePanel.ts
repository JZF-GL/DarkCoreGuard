/**
 * 首页：游戏启动后的第一屏。
 *
 * 经典路径模式暂时隐藏，唯一入口是「圆形防守」，点进去先选关卡。
 * 底部常驻两个入口：「技能宝典」查看所有升级卡，「敌人图鉴」查看敌人属性与特性。
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
    makeRect,
    rectContains,
} from '../core/GraphicsUtil';

const TITLE_Y = 452;
const SUBTITLE_Y = 388;

/** 主入口卡片（圆形防守） */
const MAIN_W = 560;
const MAIN_H = 200;
const MAIN_Y = 170;

/** 底部两个次级入口 */
const SUB_W = 262;
const SUB_H = 150;
const SUB_Y = -260;
const SUB_X = [-146, 146];

const HINT_Y = -520;

/** 主色：圆形防守沿用炮塔红 */
const MAIN_COLOR = 0xef5350;
/** 技能宝典配色 */
const SKILL_COLOR = 0x4fc3f7;
/** 敌人图鉴配色 */
const ENEMY_COLOR = 0xffb74d;

export interface HomeCallbacks {
    /** 开始游戏（进入关卡选择） */
    onStart: () => void;
    /** 打开图鉴，'skill' 为技能宝典，'enemy' 为敌人图鉴 */
    onCodex: (tab: 'skill' | 'enemy') => void;
}

interface SubSlot {
    g: Graphics;
    title: Label;
    desc: Label;
}

export class HomePanel {
    private root: Node;
    private mainG: Graphics;
    private subs: SubSlot[] = [];
    private onStart: () => void;
    private onCodex: (tab: 'skill' | 'enemy') => void;

    constructor(parent: Node, callbacks: HomeCallbacks) {
        this.onStart = callbacks.onStart;
        this.onCodex = callbacks.onCodex;
        this.root = createUiNode('Home', parent);

        const bg = createUiNode('Bg', this.root);
        drawRect(addGraphics(bg), -2000, -2000, 4000, 4000, COLORS.bg);

        createLabel(this.root, { text: 'SDMini 塔防', size: 64, bold: true, color: COLORS.text, x: 0, y: TITLE_Y });
        createLabel(this.root, { text: '圆形防守 · 10 关挑战', size: 24, color: COLORS.textDim, x: 0, y: SUBTITLE_Y });

        const main = createUiNode('Main', this.root, 0, MAIN_Y);
        this.mainG = addGraphics(main);
        createLabel(main, { text: '开始游戏', size: 44, bold: true, color: MAIN_COLOR, x: 0, y: 34 });
        createLabel(main, {
            text: '圆心单塔，敌人四面围攻\n击杀升级三选一，逐关推进',
            size: 21,
            color: COLORS.textDim,
            x: 0,
            y: -36,
        });

        const subInfos = [
            { title: '技能宝典', desc: '12 张升级卡\n效果与叠加上限', color: SKILL_COLOR },
            { title: '敌人图鉴', desc: '6 种敌人\n属性 · 特性 · 弱点', color: ENEMY_COLOR },
        ];
        for (let i = 0; i < subInfos.length; i++) {
            const layer = createUiNode('Sub' + i, this.root, SUB_X[i], SUB_Y);
            const g = addGraphics(layer);
            const title = createLabel(layer, { text: subInfos[i].title, size: 30, bold: true, color: subInfos[i].color, x: 0, y: 34 });
            const desc = createLabel(layer, { text: subInfos[i].desc, size: 19, color: COLORS.textDim, x: 0, y: -24 });
            this.subs.push({ g, title, desc });
        }

        createLabel(this.root, {
            text: '提示：战斗中右上角可暂停 / 切换倍速',
            size: 18,
            color: COLORS.textDim,
            x: 0,
            y: HINT_Y,
        });

        this.drawCards();
    }

    /** 返回 true 表示点击已被面板消费 */
    handleTap(x: number, y: number): boolean {
        if (rectContains(makeRect(0, MAIN_Y, MAIN_W, MAIN_H), x, y)) {
            this.onStart();
            return true;
        }
        for (let i = 0; i < SUB_X.length; i++) {
            const rect: Rect = makeRect(SUB_X[i], SUB_Y, SUB_W, SUB_H);
            if (rectContains(rect, x, y)) {
                this.onCodex(i === 0 ? 'skill' : 'enemy');
                return true;
            }
        }
        return true;
    }

    private drawCards(): void {
        const g = this.mainG;
        drawRect(g, -MAIN_W / 2, -MAIN_H / 2, MAIN_W, MAIN_H, COLORS.panelBg, MAIN_COLOR, 3, 18);
        drawRect(g, -MAIN_W / 2 + 8, -MAIN_H / 2 + 14, 10, MAIN_H - 28, MAIN_COLOR, undefined, 0, 5);
        // 右侧箭头，暗示可点击
        const ax = MAIN_W / 2 - 44;
        g.fillColor = colorOf(MAIN_COLOR);
        g.moveTo(ax, 14);
        g.lineTo(ax, -14);
        g.lineTo(ax + 22, 0);
        g.close();
        g.fill();

        const colors = [SKILL_COLOR, ENEMY_COLOR];
        for (let i = 0; i < this.subs.length; i++) {
            const sg = this.subs[i].g;
            drawRect(sg, -SUB_W / 2, -SUB_H / 2, SUB_W, SUB_H, COLORS.panelBg, colors[i], 3, 16);
            drawRect(sg, -SUB_W / 2 + 6, -SUB_H / 2 + 12, 8, SUB_H - 24, colors[i], undefined, 0, 4);
        }
    }
}