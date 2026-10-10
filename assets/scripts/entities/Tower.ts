/**
 * 防御塔实体。底座为圆形（旋转时视觉不变），炮管随目标旋转。
 * 射程圈独立绘制，仅在选中时显示。
 */
import { Graphics, Node } from 'cc';
import { CELL_SIZE, COLORS } from '../config/GameConfig';
import { TowerDef, TowerStat, towerStat } from '../config/TowerConfig';
import { addGraphics, colorOf, createUiNode, drawCircle, drawRect } from '../core/GraphicsUtil';
import { IPoolable } from '../core/ObjectPool';
import { Enemy } from './Enemy';

/** 塔的绘制半径 */
const BASE_RADIUS = 26;

export class Tower implements IPoolable {
    readonly node: Node;

    private rotator: Node;
    private bodyG: Graphics;
    private rangeG: Graphics;

    def: TowerDef = null!;
    level: number = 1;
    col: number = 0;
    row: number = 0;

    private cooldown: number = 0;
    private selected: boolean = false;

    constructor(parent: Node) {
        this.node = createUiNode('Tower', parent);

        const range = createUiNode('Range', this.node);
        this.rangeG = addGraphics(range);
        range.active = false;

        this.rotator = createUiNode('Rotator', this.node);
        this.bodyG = addGraphics(this.rotator);

        this.node.active = false;
    }

    build(def: TowerDef, col: number, row: number, x: number, y: number): void {
        this.def = def;
        this.level = 1;
        this.col = col;
        this.row = row;
        this.cooldown = 0;
        this.selected = false;
        this.node.setPosition(x, y, 0);
        this.node.active = true;
        this.rangeG.node.active = false;
        this.rotator.angle = -90;
        this.drawBody();
        this.drawRange();
    }

    /** 当前等级的战斗属性 */
    get stat(): TowerStat {
        return towerStat(this.def, this.level);
    }

    /** 射程（像素） */
    get rangePx(): number {
        return this.stat.range * CELL_SIZE;
    }

    get isMaxLevel(): boolean {
        return this.level >= 3;
    }

    upgrade(): void {
        this.level++;
        this.drawBody();
        this.drawRange();
    }

    setSelected(value: boolean): void {
        if (this.selected === value) {
            return;
        }
        this.selected = value;
        this.rangeG.node.active = value;
        this.drawBody();
    }

    /**
     * 每帧更新：转向目标并在冷却结束时开火。
     * @param fire 开火回调，由 TowerSystem 注入（触发 BulletSystem）
     */
    update(dt: number, target: Enemy | null, fire: (tower: Tower, target: Enemy) => void): void {
        if (this.cooldown > 0) {
            this.cooldown -= dt;
        }
        if (!target || !target.alive) {
            return;
        }
        const p = this.node.position;
        const tp = target.node.position;
        this.rotator.angle = (Math.atan2(tp.y - p.y, tp.x - p.x) * 180) / Math.PI;
        if (this.cooldown <= 0) {
            this.cooldown = 1 / this.stat.fireRate;
            fire(this, target);
        }
    }

    onRelease(): void {
        this.node.active = false;
        this.selected = false;
        this.rangeG.node.active = false;
    }

    // ---------- 绘制 ----------

    private drawBody(): void {
        const g = this.bodyG;
        g.clear();
        const d = this.def;
        // 圆形底座（旋转不可见），选中时描边高亮
        drawCircle(g, 0, 0, BASE_RADIUS, d.color, this.selected ? COLORS.selection : d.barrelColor, this.selected ? 5 : 3);
        // 炮管
        drawRect(g, 10, -7, 22, 14, d.barrelColor, undefined, 0, 5);
        // 等级指示点
        const dot = 5;
        const gap = 4;
        const total = this.level * dot + (this.level - 1) * gap;
        let x = -total / 2 + dot / 2;
        for (let i = 0; i < this.level; i++) {
            drawCircle(g, x, BASE_RADIUS + 11, 3, COLORS.text);
            x += dot + gap;
        }
    }

    private drawRange(): void {
        const g = this.rangeG;
        g.clear();
        g.lineWidth = 3;
        g.strokeColor = colorOf(COLORS.selection, 200);
        g.fillColor = colorOf(COLORS.selection, 26);
        g.circle(0, 0, this.rangePx);
        g.fill();
        g.stroke();
    }
}