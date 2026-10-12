/**
 * 关卡选择面板：圆形防守模式的 10 关入口。
 *
 * 网格布局（2 列 × 5 行），每张卡片显示关卡名与历史最高星数；
 * 通关一关才解锁下一关，未解锁的关卡灰显且不可点击。
 * 星数规则：满血通关 3 星，核心生命剩余超过 60% 得 2 星，其余通关 1 星。
 */
import { Graphics, Label, Node } from 'cc';
import { MAX_LEVEL, LEVELS } from '../config/CircleLevelConfig';
import { COLORS } from '../config/GameConfig';
import { MAX_STARS, SaveData, levelStarsOf, loadSave, totalStars } from '../platform/Platform';
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

const TITLE_Y = 580;
const SUBTITLE_Y = 516;

const CARD_W = 286;
const CARD_H = 148;
const CARD_X = [-152, 152];
const CARD_Y = [400, 232, 64, -104, -272];

const STAR_GAP = 38;
const STAR_OUTER = 15;
const STAR_INNER = 7;

const BACK_Y = -480;
const BACK_W = 250;
const BACK_H = 70;

const HINT_Y = -575;

const STAR_ON = 0xffc94d;
const STAR_OFF = 0x36404e;
/** 已解锁卡片的描边色：靠后的关卡颜色更暖，暗示难度递增 */
const UNLOCK_COLOR = 0x4fc3f7;
const LOCK_COLOR = 0x2c3a4c;

interface LevelSlot {
    g: Graphics;
    indexLabel: Label;
    nameLabel: Label;
    starG: Graphics;
}

export class LevelSelectPanel {
    private root: Node;
    private slots: LevelSlot[] = [];
    private backRect: Rect = makeRect(0, BACK_Y, BACK_W, BACK_H);
    private save: SaveData;

    private readonly onPick: (levelId: number) => void;
    private readonly onBack: () => void;

    constructor(parent: Node, onPick: (levelId: number) => void, onBack: () => void) {
        this.onPick = onPick;
        this.onBack = onBack;
        this.save = loadSave();
        this.root = createUiNode('LevelSelect', parent);

        const bg = createUiNode('Bg', this.root);
        drawRect(addGraphics(bg), -2000, -2000, 4000, 4000, COLORS.bg);

        createLabel(this.root, { text: '关卡选择', size: 48, bold: true, color: COLORS.text, x: 0, y: TITLE_Y });
        createLabel(this.root, {
            text:
                '累计星数  ' +
                totalStars(this.save, MAX_LEVEL) +
                ' / ' +
                MAX_LEVEL * MAX_STARS +
                '        满血 3 星 · 剩余超 60% 2 星 · 其余 1 星',
            size: 20,
            color: COLORS.textDim,
            x: 0,
            y: SUBTITLE_Y,
        });

        for (let i = 0; i < MAX_LEVEL; i++) {
            const col = i % CARD_X.length;
            const row = Math.floor(i / CARD_X.length);
            const node = createUiNode('Level' + i, this.root, CARD_X[col], CARD_Y[row]);
            const g = addGraphics(node);
            const stars = createUiNode('Stars', node);
            this.slots.push({
                g,
                indexLabel: createLabel(node, { size: 18, color: COLORS.textDim, align: 'left', x: -CARD_W / 2 + 20, y: 50 }),
                nameLabel: createLabel(node, { size: 26, bold: true, x: 0, y: 6 }),
                starG: addGraphics(stars),
            });
        }

        const back = createUiNode('Back', this.root);
        drawRect(addGraphics(back), -BACK_W / 2, BACK_Y - BACK_H / 2, BACK_W, BACK_H, COLORS.panelBg, COLORS.selection, 3, 14);
        createLabel(back, { text: '返回首页', size: 26, bold: true, color: COLORS.selection, x: 0, y: BACK_Y });

        createLabel(this.root, {
            text: '提示：通关一关即可解锁下一关',
            size: 18,
            color: COLORS.textDim,
            x: 0,
            y: HINT_Y,
        });

        this.refresh();
    }

    /** 返回 true 表示点击已被面板消费 */
    handleTap(x: number, y: number): boolean {
        if (rectContains(this.backRect, x, y)) {
            this.onBack();
            return true;
        }
        for (let i = 0; i < MAX_LEVEL; i++) {
            const col = i % CARD_X.length;
            const row = Math.floor(i / CARD_X.length);
            if (rectContains(makeRect(CARD_X[col], CARD_Y[row], CARD_W, CARD_H), x, y)) {
                if (this.isUnlocked(i + 1)) {
                    this.onPick(i + 1);
                }
                return true;
            }
        }
        return true;
    }

    // ---------- 内部 ----------

    /** 第 1 关默认解锁，其余关卡需上一关至少拿到 1 星 */
    private isUnlocked(levelId: number): boolean {
        return levelId <= 1 || levelStarsOf(this.save, levelId - 1) >= 1;
    }

    private refresh(): void {
        for (let i = 0; i < this.slots.length; i++) {
            const levelId = i + 1;
            const def = LEVELS[i];
            const slot = this.slots[i];
            const unlocked = this.isUnlocked(levelId);
            const border = unlocked ? UNLOCK_COLOR : LOCK_COLOR;
            const stars = levelStarsOf(this.save, levelId);

            slot.g.clear();
            drawRect(slot.g, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, COLORS.panelBg, border, 3, 16);
            drawRect(slot.g, -CARD_W / 2 + 6, -CARD_H / 2 + 12, 8, CARD_H - 24, border, undefined, 0, 4);

            slot.indexLabel.string = '第 ' + levelId + ' 关';
            slot.indexLabel.color = colorOf(unlocked ? COLORS.textDim : LOCK_COLOR);
            slot.nameLabel.string = unlocked ? def.name : '未解锁';
            slot.nameLabel.color = colorOf(unlocked ? COLORS.text : LOCK_COLOR);

            const g = slot.starG;
            g.clear();
            if (unlocked) {
                for (let s = 0; s < MAX_STARS; s++) {
                    const sx = (s - 1) * STAR_GAP;
                    if (s < stars) {
                        drawStar(g, sx, -46, STAR_OUTER, STAR_INNER, STAR_ON, 0xffe9a8, 2);
                    } else {
                        drawStar(g, sx, -46, STAR_OUTER, STAR_INNER, STAR_OFF);
                    }
                }
            } else {
                drawRect(g, -34, -52, 68, 4, LOCK_COLOR);
            }
        }
    }
}