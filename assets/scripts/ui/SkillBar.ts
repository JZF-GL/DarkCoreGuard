/**
 * 底部「自动技能」冷却条。
 *
 * 圆形模式的四个自动技能（爆破 / 冰霜 / 眩晕 / 击退）解锁后在此显示：
 * 图标全部用 Graphics 程序化绘制（零美术资源），冷却期间覆盖一层扇形遮罩并显示剩余秒数。
 * 未解锁的技能不占位，已解锁的按数量居中排列。
 */
import { Graphics, Label, Node } from 'cc';
import { COLORS } from '../config/GameConfig';
import { addGraphics, colorOf, createLabel, createUiNode, drawCircle, drawLine, drawRect } from '../core/GraphicsUtil';
import { SKILL_COLORS, SKILL_KINDS, SkillKind } from '../systems/SkillSystem';

/** 单个技能槽边长 */
const SLOT_SIZE = 88;
/** 相邻槽间距 */
const SLOT_GAP = 22;
/** 图标区半径（略小于槽半径，避免溢出圆角） */
const ICON_R = 38;
/** 技能条中心 y：位于竞技场底部与屏幕底边之间的空地 */
const BAR_Y = -496;
/** 条头文字 y */
const HEADER_Y = BAR_Y + 62;
/** 技能名 y（相对于槽节点的局部坐标） */
const NAME_LOCAL_Y = -SLOT_SIZE / 2 - 16;

/** 技能中文短名 */
const SKILL_NAMES: Record<SkillKind, string> = {
    bomb: '爆破',
    frost: '冰霜',
    radar: '眩晕',
    wind: '击退',
};

export interface SkillSlotState {
    kind: SkillKind;
    /** 叠加层数，0 表示未解锁 */
    stacks: number;
    /** 剩余冷却（秒） */
    remaining: number;
    /** 冷却总时长（秒） */
    total: number;
}

interface Slot {
    root: Node;
    bg: Graphics;
    icon: Graphics;
    cd: Graphics;
    cdLabel: Label;
    stackLabel: Label;
    nameLabel: Label;
    /** 上次绘制的签名，未变化时跳过多余重绘 */
    sig: string;
}

export class SkillBar {
    private root: Node;
    private headerLabel: Label;
    private slots: Record<SkillKind, Slot>;

    constructor(parent: Node) {
        this.root = createUiNode('SkillBar', parent);
        this.headerLabel = createLabel(this.root, { text: '自动技能', size: 18, color: COLORS.textDim, x: 0, y: HEADER_Y });

        const slots = {} as Record<SkillKind, Slot>;
        for (const kind of SKILL_KINDS) {
            slots[kind] = this.createSlot(kind);
        }
        this.slots = slots;

        this.root.active = false;
    }

    /** 按技能状态刷新整条冷却条 */
    refresh(states: SkillSlotState[]): void {
        const order: SkillKind[] = [];
        const byKind = {} as Record<SkillKind, SkillSlotState>;
        for (const state of states) {
            if (state.stacks <= 0) {
                continue;
            }
            order.push(state.kind);
            byKind[state.kind] = state;
        }

        if (order.length === 0) {
            this.root.active = false;
            return;
        }
        this.root.active = true;

        const step = SLOT_SIZE + SLOT_GAP;
        for (let i = 0; i < order.length; i++) {
            const slot = this.slots[order[i]];
            slot.root.active = true;
            slot.root.setPosition((i - (order.length - 1) / 2) * step, BAR_Y, 0);
            this.applySlot(slot, byKind[order[i]]);
        }
        for (const kind of SKILL_KINDS) {
            if (!byKind[kind]) {
                this.slots[kind].root.active = false;
            }
        }
    }

    // ---------- 内部 ----------

    private createSlot(kind: SkillKind): Slot {
        const root = createUiNode('Skill_' + kind, this.root, 0, BAR_Y);
        const bg = addGraphics(createUiNode('Bg', root));
        const icon = addGraphics(createUiNode('Icon', root));
        const cd = addGraphics(createUiNode('Cd', root));
        const cdLabel = createLabel(root, { size: 26, bold: true, color: COLORS.text });
        const stackLabel = createLabel(root, {
            text: 'Lv1',
            size: 16,
            bold: true,
            color: COLORS.gold,
            align: 'right',
            x: SLOT_SIZE / 2 - 9,
            y: SLOT_SIZE / 2 - 14,
        });
        const nameLabel = createLabel(root, { text: SKILL_NAMES[kind], size: 18, color: COLORS.textDim, x: 0, y: NAME_LOCAL_Y });
        root.active = false;
        return { root, bg, icon, cd, cdLabel, stackLabel, nameLabel, sig: '' };
    }

    private applySlot(slot: Slot, state: SkillSlotState): void {
        // p 为「剩余冷却比例」：1 表示刚触发，0 表示已就绪
        const p = state.total > 0 ? Math.max(0, Math.min(1, state.remaining / state.total)) : 0;
        const cdText = p > 0 ? String(Math.ceil(state.remaining)) : '';
        const sig = state.stacks + '|' + cdText + '|' + Math.round(p * 60);
        if (sig === slot.sig) {
            return;
        }
        slot.sig = sig;

        const color = SKILL_COLORS[state.kind];

        slot.bg.clear();
        drawRect(slot.bg, -SLOT_SIZE / 2, -SLOT_SIZE / 2, SLOT_SIZE, SLOT_SIZE, COLORS.panelBg, color, 3, 16);

        slot.icon.clear();
        this.drawIcon(slot.icon, state.kind, color);

        slot.cd.clear();
        if (p > 0.001) {
            slot.cd.fillColor = colorOf(COLORS.overlay, 150);
            // 从正上方顺时针铺开剩余冷却的扇形
            this.wedge(slot.cd, ICON_R, Math.PI / 2 - p * Math.PI * 2, Math.PI / 2);
        }

        slot.cdLabel.string = cdText;
        slot.cdLabel.node.active = p > 0;
        slot.stackLabel.string = 'Lv' + state.stacks;
    }

    /** 以 (0,0) 为顶点的扇形填充 */
    private wedge(g: Graphics, r: number, from: number, to: number): void {
        const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 0.15));
        g.moveTo(0, 0);
        for (let i = 0; i <= steps; i++) {
            const a = from + (to - from) * (i / steps);
            g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.close();
        g.fill();
    }

    private strokePath(g: Graphics, pts: number[][], color: number, lineWidth: number): void {
        g.lineWidth = lineWidth;
        g.strokeColor = colorOf(color);
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
            g.lineTo(pts[i][0], pts[i][1]);
        }
        g.stroke();
    }

    /** 四个技能的矢量图标 */
    private drawIcon(g: Graphics, kind: SkillKind, color: number): void {
        switch (kind) {
            case 'bomb':
                // 弹体 + 引线 + 火花
                drawCircle(g, -1, -4, 15, color);
                drawLine(g, 8, 6, 15, 15, color, 4);
                drawCircle(g, 17, 18, 4, color);
                break;
            case 'frost':
                // 六向雪花，每根主枝再分出两段小枝
                this.drawSnowflake(g, color);
                break;
            case 'radar':
                // 同心环 + 扫描线 + 中心点
                drawCircle(g, 0, 0, 18, undefined, color, 3);
                drawCircle(g, 0, 0, 10, undefined, color, 2);
                drawLine(g, 0, 0, Math.cos(Math.PI / 4) * 17, Math.sin(Math.PI / 4) * 17, color, 3);
                drawCircle(g, 0, 0, 4, color);
                break;
            default:
                // 三道右端上卷的气流
                this.drawGust(g, 9, -15, 3, 5, color);
                this.drawGust(g, 0, -18, 7, 6, color);
                this.drawGust(g, -9, -12, 1, 5, color);
                break;
        }
    }

    private drawSnowflake(g: Graphics, color: number): void {
        const r = 18;
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i + Math.PI / 2;
            drawLine(g, 0, 0, Math.cos(a) * r, Math.sin(a) * r, color, 3);
            const bx = Math.cos(a) * r * 0.6;
            const by = Math.sin(a) * r * 0.6;
            for (const side of [-1, 1]) {
                const ba = a + side * 0.7;
                drawLine(g, bx, by, bx + Math.cos(ba) * 8, by + Math.sin(ba) * 8, color, 2);
            }
        }
    }

    /** 一道水平气流：横线 + 右端上卷的半圆钩 */
    private drawGust(g: Graphics, y: number, x0: number, x1: number, r: number, color: number): void {
        const pts: number[][] = [
            [x0, y],
            [x1, y],
        ];
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
            const a = -Math.PI / 2 + (Math.PI / 2) * (i / steps);
            pts.push([x1 + Math.cos(a) * r, y + r + Math.sin(a) * r]);
        }
        this.strokePath(g, pts, color, 3);
    }
}
