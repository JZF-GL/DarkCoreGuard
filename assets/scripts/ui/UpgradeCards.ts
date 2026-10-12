/**
 * 升级三选一卡片面板。
 *
 * 强度升级时覆盖全屏，强制玩家从三张卡中选一张（不能关闭、不能跳过）。
 * 卡片按需显示：候选不足三张时只渲染实际数量。
 * 若玩家长时间不选，倒计时结束后自动随机选择一张，避免卡住战斗节奏。
 */
import { Graphics, Label, Node } from 'cc';
import { COLORS } from '../config/GameConfig';
import { Rect, addGraphics, colorOf, createLabel, createUiNode, drawRect, makeRect, rectContains } from '../core/GraphicsUtil';
import { CardChoice } from '../systems/UpgradeSystem';

const CARD_W = 600;
const CARD_H = 190;
const CARD_Y = [250, 30, -190];
const CARD_X = 0;

const TITLE_Y = 450;
const SUBTITLE_Y = 396;

/** 自动选择倒计时（秒）：超时未选则随机挑一张 */
const AUTO_PICK_SECONDS = 10;

interface Slot {
    g: Graphics;
    name: Label;
    desc: Label;
    tag: Label;
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

        for (let i = 0; i < CARD_Y.length; i++) {
            const layer = createUiNode('Card' + i, this.root, CARD_X, CARD_Y[i]);
            const g = addGraphics(layer);
            const left = -CARD_W / 2 + 44;
            const name = createLabel(layer, { size: 34, bold: true, color: COLORS.text, align: 'left', x: left, y: 52 });
            const desc = createLabel(layer, { size: 21, color: COLORS.textDim, align: 'left', x: left, y: -16 });
            const tag = createLabel(layer, { size: 20, bold: true, color: COLORS.selection, align: 'right', x: CARD_W / 2 - 30, y: 52 });
            this.slots.push({ g, name, desc, tag });
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
            slot.desc.node.active = active;
            slot.tag.node.active = active;
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
            const rect: Rect = makeRect(CARD_X, CARD_Y[i], CARD_W, CARD_H);
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
        drawRect(g, x, y, CARD_W, CARD_H, COLORS.panelBg, def.color, 3, 16);
        // 左侧色条
        drawRect(g, x + 8, y + 12, 10, CARD_H - 24, def.color, undefined, 0, 5);

        slot.name.string = def.name;
        slot.name.color = colorOf(def.color);
        slot.desc.string = def.desc;
        slot.desc.color = colorOf(COLORS.textDim);

        const next = choice.stacks + 1;
        if (def.skill) {
            slot.tag.string = choice.stacks === 0 ? '新解锁' : 'Lv.' + choice.stacks + ' → Lv.' + next;
        } else {
            slot.tag.string = 'Lv.' + choice.stacks + ' → Lv.' + next;
        }
        slot.tag.color = colorOf(COLORS.selection);
    }
}