/**
 * 程序化绘制与 UI 节点工具。
 * 本项目零美术资源，所有图形（背景 / 路径 / 塔 / 敌人 / 血条 / 面板）都用 Graphics 绘制，
 * 所有文案使用系统字体的 Label，因此包体极小、天然适配微信小游戏。
 */
import { Color, Graphics, Label, Layers, Node, UITransform } from 'cc';

/** 0xRRGGBB -> cc.Color */
export function colorOf(hex: number, alpha: number = 255): Color {
    return new Color((hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, alpha);
}

/**
 * 创建一个 UI 层节点。必须显式设置 UI_2D layer，否则相机的 visibility 可能过滤掉该节点。
 */
export function createUiNode(name: string, parent: Node, x: number = 0, y: number = 0): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y, 0);
    return node;
}

export function addGraphics(node: Node): Graphics {
    return node.addComponent(Graphics);
}

/** 矩形（可选圆角） */
export function drawRect(
    g: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    fill?: number,
    stroke?: number,
    lineWidth: number = 2,
    radius: number = 0,
): void {
    g.lineWidth = lineWidth;
    if (fill !== undefined) {
        g.fillColor = colorOf(fill);
    }
    if (stroke !== undefined) {
        g.strokeColor = colorOf(stroke);
    }
    if (radius > 0) {
        g.roundRect(x, y, w, h, radius);
    } else {
        g.rect(x, y, w, h);
    }
    if (fill !== undefined) {
        g.fill();
    }
    if (stroke !== undefined) {
        g.stroke();
    }
}

export function drawCircle(
    g: Graphics,
    x: number,
    y: number,
    r: number,
    fill?: number,
    stroke?: number,
    lineWidth: number = 2,
): void {
    g.lineWidth = lineWidth;
    if (fill !== undefined) {
        g.fillColor = colorOf(fill);
    }
    if (stroke !== undefined) {
        g.strokeColor = colorOf(stroke);
    }
    g.circle(x, y, r);
    if (fill !== undefined) {
        g.fill();
    }
    if (stroke !== undefined) {
        g.stroke();
    }
}

export function drawLine(
    g: Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number,
    lineWidth: number = 2,
): void {
    g.lineWidth = lineWidth;
    g.strokeColor = colorOf(color);
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
}

export function drawPolygon(g: Graphics, points: number[][], fill?: number, stroke?: number, lineWidth: number = 2): void {
    if (points.length < 3) {
        return;
    }
    g.lineWidth = lineWidth;
    if (fill !== undefined) {
        g.fillColor = colorOf(fill);
    }
    if (stroke !== undefined) {
        g.strokeColor = colorOf(stroke);
    }
    g.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
        g.lineTo(points[i][0], points[i][1]);
    }
    g.close();
    if (fill !== undefined) {
        g.fill();
    }
    if (stroke !== undefined) {
        g.stroke();
    }
}

export type TextAlign = 'left' | 'center' | 'right';

/** 五角星的十个顶点：外/内半径交替，从正上方开始 */
export function starPoints(cx: number, cy: number, outer: number, inner: number): number[][] {
    const points: number[][] = [];
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + (Math.PI * i) / 5;
        points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return points;
}

/** 五角星（关卡星级评价用） */
export function drawStar(
    g: Graphics,
    cx: number,
    cy: number,
    outer: number,
    inner: number,
    fill?: number,
    stroke?: number,
    lineWidth: number = 2,
): void {
    drawPolygon(g, starPoints(cx, cy, outer, inner), fill, stroke, lineWidth);
}

export interface LabelOptions {
    text?: string;
    size?: number;
    color?: number;
    bold?: boolean;
    align?: TextAlign;
    x?: number;
    y?: number;
}

/**
 * 创建系统字体 Label。锚点随对齐方式调整，便于按固定左边/右边定位动态文本。
 */
export function createLabel(parent: Node, opts: LabelOptions = {}): Label {
    const size = opts.size ?? 24;
    const align: TextAlign = opts.align ?? 'center';
    const node = createUiNode('Label', parent, opts.x ?? 0, opts.y ?? 0);
    const label = node.addComponent(Label);
    label.useSystemFont = true;
    label.fontFamily = 'Arial';
    label.fontSize = size;
    label.lineHeight = Math.round(size * 1.25);
    label.color = colorOf(opts.color ?? 0xffffff);
    label.horizontalAlign =
        align === 'left' ? Label.HorizontalAlign.LEFT : align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.NONE;
    label.isBold = !!opts.bold;
    label.string = opts.text ?? '';
    const ui = node.getComponent(UITransform)!;
    ui.setAnchorPoint(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
    return label;
}

/** 简单矩形区域，用于手动命中测试（本项目不使用引擎 UI 事件系统） */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export function rectContains(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function makeRect(cx: number, cy: number, w: number, h: number): Rect {
    return { x: cx - w / 2, y: cy - h / 2, w, h };
}