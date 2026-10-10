/**
 * 棋盘与路径。负责三件事：
 * 1. 网格坐标 <-> Canvas 局部坐标互转；
 * 2. 标记路径格（不可建塔）；
 * 3. 沿折线路径的「按距离取点」，敌人移动与索敌进度都基于它，固定路径无需寻路。
 */
import { Vec3 } from 'cc';
import { CELL_SIZE, GRID_COLS, GRID_ROWS, PLAYFIELD_CENTER_Y } from '../config/GameConfig';
import { PATH_WAYPOINTS } from '../config/LevelConfig';

export interface CellCoord {
    col: number;
    row: number;
}

export interface PathSample {
    x: number;
    y: number;
    /** 0..1 的路径进度 */
    progress: number;
}

function cellKey(col: number, row: number): number {
    // col 可能取到 -1 / 9，加偏移避免负数
    return row * 64 + (col + 8);
}

export class Grid {
    readonly cols: number = GRID_COLS;
    readonly rows: number = GRID_ROWS;
    readonly cell: number = CELL_SIZE;

    private pathCells: Set<number> = new Set();

    /** 路径路点的 Canvas 坐标 */
    readonly waypoints: Vec3[] = [];
    /** 每段长度 */
    private segmentLengths: number[] = [];
    /** 每段起点的累计长度 */
    private segmentOffsets: number[] = [];
    /** 路径总长度 */
    totalLength: number = 0;

    constructor() {
        this.buildPathCells();
        this.buildPathPolyline();
    }

    // ---------- 坐标换算 ----------

    /** 网格坐标 -> Canvas 局部坐标（格心） */
    cellToPos(col: number, row: number, out?: Vec3): Vec3 {
        const v = out ?? new Vec3();
        v.x = (col - (this.cols - 1) / 2) * this.cell;
        v.y = PLAYFIELD_CENTER_Y + (row - (this.rows - 1) / 2) * this.cell;
        v.z = 0;
        return v;
    }

    /** Canvas 局部坐标 -> 网格坐标，返回 null 表示不在棋盘内 */
    posToCell(x: number, y: number): CellCoord | null {
        const col = Math.round(x / this.cell + (this.cols - 1) / 2);
        const row = Math.round((y - PLAYFIELD_CENTER_Y) / this.cell + (this.rows - 1) / 2);
        if (!this.isInside(col, row)) {
            return null;
        }
        return { col, row };
    }

    isInside(col: number, row: number): boolean {
        return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
    }

    // ---------- 路径格 ----------

    private buildPathCells(): void {
        for (let i = 1; i < PATH_WAYPOINTS.length; i++) {
            const [c0, r0] = PATH_WAYPOINTS[i - 1];
            const [c1, r1] = PATH_WAYPOINTS[i];
            const dc = Math.sign(c1 - c0);
            const dr = Math.sign(r1 - r0);
            let c = c0;
            let r = r0;
            this.pathCells.add(cellKey(c, r));
            while (c !== c1 || r !== r1) {
                c += dc;
                r += dr;
                this.pathCells.add(cellKey(c, r));
            }
        }
    }

    isPath(col: number, row: number): boolean {
        return this.pathCells.has(cellKey(col, row));
    }

    /** 该格是否允许建塔 */
    isBuildable(col: number, row: number): boolean {
        return this.isInside(col, row) && !this.isPath(col, row);
    }

    /** 路径格数量，供文档/调试核对 */
    get pathCellCount(): number {
        let n = 0;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.isPath(c, r)) {
                    n++;
                }
            }
        }
        return n;
    }

    // ---------- 折线路径 ----------

    private buildPathPolyline(): void {
        for (let i = 0; i < PATH_WAYPOINTS.length; i++) {
            const [col, row] = PATH_WAYPOINTS[i];
            this.waypoints.push(this.cellToPos(col, row));
        }
        let offset = 0;
        for (let i = 1; i < this.waypoints.length; i++) {
            const a = this.waypoints[i - 1];
            const b = this.waypoints[i];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            this.segmentLengths.push(len);
            this.segmentOffsets.push(offset);
            offset += len;
        }
        this.totalLength = offset;
    }

    /**
     * 取路径上距离起点 d 像素处的坐标。
     * 超出范围时被夹紧在起点 / 终点。
     */
    sampleByDistance(d: number, out?: PathSample): PathSample {
        const res = out ?? { x: 0, y: 0, progress: 0 };
        const total = this.totalLength;
        if (total <= 0) {
            res.x = 0;
            res.y = 0;
            res.progress = 0;
            return res;
        }
        const dist = d < 0 ? 0 : d > total ? total : d;
        let index = this.segmentLengths.length - 1;
        for (let i = 0; i < this.segmentLengths.length; i++) {
            const segStart = this.segmentOffsets[i];
            if (dist <= segStart + this.segmentLengths[i]) {
                index = i;
                break;
            }
        }
        const a = this.waypoints[index];
        const b = this.waypoints[index + 1];
        const segLen = this.segmentLengths[index] || 1;
        const t = (dist - this.segmentOffsets[index]) / segLen;
        res.x = a.x + (b.x - a.x) * t;
        res.y = a.y + (b.y - a.y) * t;
        res.progress = dist / total;
        return res;
    }

    /** 像素距离 -> 0..1 进度 */
    progressOf(distance: number): number {
        return this.totalLength <= 0 ? 0 : Math.max(0, Math.min(1, distance / this.totalLength));
    }
}