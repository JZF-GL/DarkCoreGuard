/**
 * 游戏主控。承担三件事：
 * 1. 组装系统与 UI：全部运行时代码创建，不依赖 Prefab、不依赖任何美术资源；
 * 2. 单帧驱动：按倍速推进各系统，暂停 / 结算后不再推进战斗逻辑；
 * 3. 输入分发：手动命中测试，优先级为 结算面板 > 底部操作条 > 顶部 HUD > 棋盘。
 */
import { _decorator, Component, EventTouch, Graphics, Input, input, Vec3, view } from 'cc';
import { COLORS, PLAYFIELD_CENTER_Y } from '../config/GameConfig';
import { TowerType } from '../config/TowerConfig';
import { bus } from '../core/EventBus';
import { GameEvent, GamePhase, WaveStartedPayload } from '../core/GameEvents';
import { addGraphics, colorOf, createUiNode, drawPolygon, drawRect } from '../core/GraphicsUtil';
import { Grid } from '../core/Grid';
import { SaveData, loadSave, vibrateShort, writeSave } from '../platform/Platform';
import { BuildMenu, MenuState } from '../ui/BuildMenu';
import { Hud, HudState } from '../ui/Hud';
import { ResultPanel } from '../ui/ResultPanel';
import { Tower } from '../entities/Tower';
import { BulletSystem } from './BulletSystem';
import { EconomySystem } from './EconomySystem';
import { EnemySystem } from './EnemySystem';
import { FxSystem } from './FxSystem';
import { TowerSystem } from './TowerSystem';
import { WaveSystem } from './WaveSystem';

const { ccclass } = _decorator;

/** 倍速档位，循环切换 */
const SPEED_STEPS: number[] = [1, 2, 3];

@ccclass('GameManager')
export class GameManager extends Component {
    private grid!: Grid;
    private economy!: EconomySystem;
    private fx!: FxSystem;
    private enemies!: EnemySystem;
    private bullets!: BulletSystem;
    private towers!: TowerSystem;
    private waves!: WaveSystem;

    private hud!: Hud;
    private menu!: BuildMenu;
    private result!: ResultPanel;

    private save: SaveData = { bestWave: 0, playCount: 0, winCount: 0 };

    private selected: Tower | null = null;
    private over: boolean = false;
    private paused: boolean = false;
    private speedIndex: number = 0;

    /** 复用状态对象，避免每帧产生垃圾 */
    private hudState: HudState = {
        gold: 0,
        baseHp: 0,
        wave: 0,
        waveTotal: 0,
        phase: GamePhase.Prepare,
        prepTimer: 0,
        enemyLeft: 0,
        paused: false,
        speedMul: 1,
    };
    private menuState: MenuState = {
        gold: 0,
        phase: GamePhase.Prepare,
        prepTimer: 0,
        enemyLeft: 0,
        wave: 0,
        waveTotal: 0,
    };

    // ---------- 生命周期 ----------

    onLoad(): void {
        this.grid = new Grid();

        this.buildBoard();
        this.buildSystems();
        this.buildUi();

        this.save = loadSave();
        bus.on(GameEvent.WaveStarted, this.onWaveStarted, this);
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);

        this.startGame();
    }

    onDestroy(): void {
        bus.offTarget(this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    update(dt: number): void {
        // 单帧步长封顶，避免切后台回来出现巨大 dt 导致敌人瞬移穿墙
        const raw = Math.min(dt, 0.05);
        this.hud.update(raw);
        this.refreshUi();

        if (this.over || this.paused) {
            return;
        }
        const step = raw * this.speedMul;
        this.waves.update(step);
        this.enemies.update(step);
        this.towers.update(step);
        this.bullets.update(step);
        this.fx.update(step);

        this.checkGameOver();
    }

    // ---------- 组装 ----------

    /** 静态棋盘：底色、路径格、可建格、路径折线、入口与基地标记 */
    private buildBoard(): void {
        const layer = createUiNode('Board', this.node);
        const g = addGraphics(layer);
        const grid = this.grid;
        const cell = grid.cell;
        const boardW = grid.cols * cell;
        const boardH = grid.rows * cell;
        const left = -boardW / 2;
        const right = boardW / 2;
        const bottom = PLAYFIELD_CENTER_Y - boardH / 2;

        // 整屏底色：横向 / 纵向都放大，保证宽屏设备不露黑边
        drawRect(g, -2000, -2000, 4000, 4000, COLORS.bg);

        // 逐格填充，路径格与可建格区分，可建格做棋盘交错便于数格子
        const pos = new Vec3();
        for (let row = 0; row < grid.rows; row++) {
            for (let col = 0; col < grid.cols; col++) {
                grid.cellToPos(col, row, pos);
                const isPath = grid.isPath(col, row);
                const fill = isPath ? COLORS.path : (row + col) % 2 === 0 ? COLORS.buildable : COLORS.buildableAlt;
                drawRect(g, pos.x - cell / 2 + 2, pos.y - cell / 2 + 2, cell - 4, cell - 4, fill, undefined, 0, 6);
            }
        }

        // 路径中心线：把格状路径串成一条连续的「跑道」
        const pts = grid.waypoints;
        g.lineWidth = 14;
        g.strokeColor = colorOf(COLORS.pathEdge, 150);
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            g.lineTo(pts[i].x, pts[i].y);
        }
        g.stroke();

        // 棋盘外框
        drawRect(g, left, bottom, boardW, boardH, undefined, COLORS.gridLine, 3, 8);

        // 入口（左侧，敌人出现）
        const startY = pts[0].y;
        drawPolygon(
            g,
            [
                [left + 8, startY + 17],
                [left + 8, startY - 17],
                [left + 36, startY],
            ],
            COLORS.danger,
        );

        // 基地（右侧，漏怪扣血）
        const endY = pts[pts.length - 1].y;
        drawRect(g, right - 36, endY - 22, 30, 44, COLORS.hp, COLORS.text, 2, 6);
    }

    private buildSystems(): void {
        const enemyLayer = createUiNode('Enemies', this.node);
        const towerLayer = createUiNode('Towers', this.node);
        const bulletLayer = createUiNode('Bullets', this.node);
        const fxLayer = createUiNode('Fx', this.node);

        this.economy = new EconomySystem();
        this.fx = new FxSystem(fxLayer);
        this.enemies = new EnemySystem(enemyLayer, this.grid, this.economy, this.fx);
        this.bullets = new BulletSystem(bulletLayer, this.enemies, this.fx);
        this.towers = new TowerSystem(towerLayer, this.grid, this.enemies, this.bullets, this.economy);
        this.waves = new WaveSystem(this.enemies, this.economy);
    }

    private buildUi(): void {
        const layer = createUiNode('Ui', this.node);
        this.hud = new Hud(
            layer,
            () => this.togglePause(),
            () => this.toggleSpeed(),
        );
        this.menu = new BuildMenu(layer, {
            onBuild: (type: TowerType, col: number, row: number) => this.handleBuild(type, col, row),
            onUpgrade: (tower: Tower) => this.handleUpgrade(tower),
            onSell: (tower: Tower) => this.handleSell(tower),
            onClose: () => this.handleCloseMenu(),
            onCallNextWave: () => this.handleCallNextWave(),
        });
        this.result = new ResultPanel(layer, () => this.startGame());
    }

    // ---------- 局内流程 ----------

    /** 开新一局（首次进入与结算后重开都走这里） */
    private startGame(): void {
        this.clearSelection();
        this.towers.reset();
        this.bullets.reset();
        this.enemies.reset();
        this.fx.reset();
        this.economy.reset();
        this.waves.reset();

        this.result.hide();
        this.menu.showDefault();
        this.over = false;
        this.paused = false;
        this.speedIndex = 0;
        this.refreshUi();
    }

    private checkGameOver(): void {
        if (this.waves.isOver) {
            this.finish(this.waves.phase === GamePhase.Won);
            return;
        }
        if (this.economy.isDead) {
            this.waves.setLost();
            this.finish(false);
        }
    }

    private finish(win: boolean): void {
        if (this.over) {
            return;
        }
        this.over = true;
        this.paused = false;
        this.clearSelection();
        this.menu.showDefault();

        const wave = this.waves.wave;
        this.save.playCount += 1;
        if (win) {
            this.save.winCount += 1;
        }
        if (wave > this.save.bestWave) {
            this.save.bestWave = wave;
        }
        writeSave(this.save);

        this.result.show(win, wave, this.waves.totalWaves, this.save.bestWave, this.save.playCount, this.save.winCount);
        vibrateShort();
        bus.emit(GameEvent.GameOver, { win, wave, bestWave: this.save.bestWave });
    }

    // ---------- 交互 ----------

    private onTouchStart(event: EventTouch): void {
        // 统一换算成「以屏幕中心为原点」的坐标：GameRoot 挂在 Canvas 锚点上，
        // 而 Canvas 由引擎对齐到屏幕中心，所以减去可见区一半即可，不依赖引擎内部实现。
        const ui = event.getUILocation();
        const visible = view.getVisibleSize();
        const x = ui.x - visible.width / 2;
        const y = ui.y - visible.height / 2;

        if (this.result.handleTap(x, y)) {
            return;
        }
        if (this.menu.handleTap(x, y)) {
            return;
        }
        if (this.hud.handleTap(x, y)) {
            return;
        }
        this.handleBoardTap(x, y);
    }

    private handleBoardTap(x: number, y: number): void {
        if (this.over) {
            return;
        }
        const cell = this.grid.posToCell(x, y);
        if (!cell) {
            this.clearSelection();
            this.menu.showDefault();
            return;
        }
        const tower = this.towers.getAt(cell.col, cell.row);
        if (tower) {
            this.selectTower(tower);
            this.menu.showTower(tower);
            return;
        }
        if (this.towers.canBuild(cell.col, cell.row)) {
            this.clearSelection();
            this.menu.showBuild(cell);
            return;
        }
        // 点到了路径格
        this.clearSelection();
        this.menu.showDefault();
    }

    private handleBuild(type: TowerType, col: number, row: number): void {
        if (this.over) {
            return;
        }
        const tower = this.towers.build(type, col, row);
        if (!tower) {
            return;
        }
        vibrateShort();
        this.selectTower(tower);
        this.menu.showTower(tower);
    }

    private handleUpgrade(tower: Tower): void {
        if (this.over) {
            return;
        }
        if (this.towers.upgrade(tower)) {
            vibrateShort();
        }
    }

    private handleSell(tower: Tower): void {
        if (this.over) {
            return;
        }
        // 先取坐标：出售后塔节点会被回收
        const x = tower.node.position.x;
        const y = tower.node.position.y;
        const refund = this.towers.sell(tower);
        if (refund > 0) {
            this.fx.floatText(x, y + 24, '+' + refund, COLORS.gold);
        }
        this.clearSelection();
        this.menu.showDefault();
    }

    private handleCloseMenu(): void {
        this.clearSelection();
        this.menu.showDefault();
    }

    private handleCallNextWave(): void {
        if (this.over) {
            return;
        }
        this.waves.callNextWave();
    }

    private togglePause(): void {
        if (this.over) {
            return;
        }
        this.paused = !this.paused;
    }

    private toggleSpeed(): void {
        this.speedIndex = (this.speedIndex + 1) % SPEED_STEPS.length;
    }

    private selectTower(tower: Tower): void {
        if (this.selected === tower) {
            return;
        }
        this.clearSelection();
        this.selected = tower;
        tower.setSelected(true);
    }

    private clearSelection(): void {
        if (this.selected) {
            this.selected.setSelected(false);
            this.selected = null;
        }
    }

    private get speedMul(): number {
        return SPEED_STEPS[this.speedIndex];
    }

    // ---------- 状态刷新 ----------

    private onWaveStarted(payload: WaveStartedPayload): void {
        this.hud.showBanner(payload.wave >= payload.total ? '最后一波！' : '第 ' + payload.wave + ' 波');
    }

    private refreshUi(): void {
        const s = this.hudState;
        s.gold = this.economy.gold;
        s.baseHp = this.economy.baseHp;
        s.wave = this.waves.wave;
        s.waveTotal = this.waves.totalWaves;
        s.phase = this.waves.phase;
        s.prepTimer = this.waves.prepTimer;
        s.enemyLeft = this.enemies.count + this.waves.pendingCount;
        s.paused = this.paused;
        s.speedMul = this.speedMul;
        this.hud.refresh(s);

        const m = this.menuState;
        m.gold = s.gold;
        m.phase = s.phase;
        m.prepTimer = s.prepTimer;
        m.enemyLeft = s.enemyLeft;
        m.wave = s.wave;
        m.waveTotal = s.waveTotal;
        this.menu.refresh(m);
    }
}