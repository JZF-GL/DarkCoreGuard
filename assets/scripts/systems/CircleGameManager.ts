/**
 * 圆形中心防守模式的主控。承担三件事：
 * 1. 组装系统与 UI：全部运行时代码创建，不依赖 Prefab 与美术资源；
 * 2. 单帧驱动：按倍速推进波次 / 敌人 / 炮塔 / 弹道 / 技能 / 特效；
 * 3. 输入分发：升级卡面板 > 顶部 HUD，优先级固定且唯一。
 *
 * 与经典模式的 GameManager 完全独立，只在「弹道结算」「特效」「结算面板」「存档」上复用公共模块。
 */
import { _decorator, Component, EventTouch, Graphics, Input, input, Mask, Node, UIOpacity, UITransform, view } from 'cc';
import {
    CORE_HIT_RADIUS,
    PLAY_AREA_BOTTOM,
    PLAY_AREA_HALF_W,
    PLAY_AREA_TOP,
    RANGED_CORE_DAMAGE,
    SHIELD_PER_STACK,
    attackScaleOf,
    enemyXp,
} from '../config/CircleConfig';
import { CAMERA_ZOOM, CIRCLE_CENTER_Y, COLORS, HALF_H, HALF_W, START_BASE_HP, WORLD } from '../config/GameConfig';
import { MAX_LEVEL, levelDef } from '../config/CircleLevelConfig';
import { bus } from '../core/EventBus';
import { GameEvent, GamePhase } from '../core/GameEvents';
import { addGraphics, colorOf, createUiNode, drawCircle, drawLine, drawRect } from '../core/GraphicsUtil';
import { SaveData, loadSave, recordLevelStars, vibrateShort, writeSave } from '../platform/Platform';
import { BaseTurret } from '../entities/BaseTurret';
import { CircleEnemy } from '../entities/CircleEnemy';
import { BulletSystem } from './BulletSystem';
import { CircleEnemySystem } from './CircleEnemySystem';
import { CircleWaveSystem } from './CircleWaveSystem';
import { FxSystem } from './FxSystem';
import { SKILL_KINDS, SkillSystem } from './SkillSystem';
import { CardChoice, UpgradeCore, UpgradeSystem } from './UpgradeSystem';
import { CircleHud, CircleHudState } from '../ui/CircleHud';
import { SkillBar, SkillSlotState } from '../ui/SkillBar';
import { UpgradeCards } from '../ui/UpgradeCards';
import { ResultButton, ResultPanel } from '../ui/ResultPanel';

const { ccclass } = _decorator;

/** 倍速档位，循环切换 */
const SPEED_STEPS: number[] = [1, 2, 3];

/** 背景网格间距（屏幕像素；乘 WORLD 换算成世界单位后屏幕上仍是 60px） */
const GRID_STEP = 60 * WORLD;
/** 背景网格线颜色：只比底色亮一点点，做纹理不抢视觉 */
const GRID_COLOR = 0x243040;
/** 护盾相关的提示色，与「能量护盾」卡片同色 */
const SHIELD_COLOR = 0x64b5f6;
/** 核心被撞击时屏幕边缘红色微光的持续时间（秒） */
const EDGE_FLASH_TTL = 0.42;
/** 屏幕边缘微光的圈层数与线宽（屏幕像素） */
const EDGE_FLASH_LAYERS = 4;
const EDGE_FLASH_LINE = 10;
/** 最内层微光的透明度基准，越往外越淡 */
const EDGE_FLASH_ALPHA = 75;

/** 路由（ModeShell）实现该接口，主控通过它实现「下一关 / 返回首页」 */
export interface CircleHost {
    exitToHome(): void;
    startLevel(levelId: number): void;
}

/** 挂载前由路由写入的启动参数（addComponent 会立刻触发 onLoad，只能走静态字段传参） */
export interface CircleLaunch {
    levelId: number;
    host: CircleHost | null;
}

@ccclass('CircleGameManager')
export class CircleGameManager extends Component {
    /** 由 ModeShell 在 addComponent 之前设置 */
    static pendingLaunch: CircleLaunch | null = null;

    /** 战场世界容器：整块战场（背景 / 网格 / 敌人 / 炮塔 / 子弹 / 特效）都挂在它下面，
     *  整体缩放到 CAMERA_ZOOM —— 这就是「镜头抬高」，视野 = 屏幕尺寸 / CAMERA_ZOOM。
     *  容器内部一律使用世界单位，屏幕可见范围之外的坐标不会被渲染（另有矩形遮罩裁剪）。 */
    private world!: Node;

    private fx!: FxSystem;
    private enemies!: CircleEnemySystem;
    private bullets!: BulletSystem;
    private turret!: BaseTurret;
    private skills!: SkillSystem;
    private upgrades!: UpgradeSystem;
    private waves!: CircleWaveSystem;

    private hud!: CircleHud;
    private skillBar!: SkillBar;
    private cards!: UpgradeCards;
    private result!: ResultPanel;

    /** 核心被撞击时压在屏幕四周的红色微光（UI 层最底，盖不住任何控件） */
    private edgeNode!: Node;
    private edgeOpacity!: UIOpacity;
    /** 微光已播放时间；到 EDGE_FLASH_TTL 即隐藏 */
    private edgeLife: number = EDGE_FLASH_TTL;

    private save: SaveData = { bestWave: 0, circleBestWave: 0, playCount: 0, winCount: 0, levelStars: [] };

    /** 本局关卡序号（1 起）与路由回调 */
    private levelId: number = 1;
    private host: CircleHost | null = null;

    private coreHp: number = START_BASE_HP;
    /** 剩余护盾点数：1 点抵挡 1 点核心伤害 */
    private coreShield: number = 0;
    private over: boolean = false;
    private paused: boolean = false;
    private speedIndex: number = 0;
    /** 待选择的升级次数（一次击杀可能跨多级） */
    private pendingLevelUps: number = 0;

    private hudState: CircleHudState = {
        coreHp: 0,
        coreHpMax: START_BASE_HP,
        coreShield: 0,
        wave: 0,
        waveTotal: 0,
        phase: GamePhase.Prepare,
        prepTimer: 0,
        enemyLeft: 0,
        level: 1,
        xp: 0,
        xpNeed: 1,
        xpRatio: 0,
        paused: false,
        speedMul: 1,
    };

    /** 技能冷却条状态缓存，逐帧复用避免高频分配 */
    private skillStates: SkillSlotState[] = SKILL_KINDS.map((kind) => ({ kind, stacks: 0, remaining: 0, total: 0 }));

    /** 当前攻击区收缩比例（含「攻击范围」升级卡加成），索敌 / 命中共用 */
    private get attackScale(): number {
        return attackScaleOf(this.upgrades.rangeStacks);
    }

    /** 护盾上限 = 「能量护盾」卡层数 × 每层容量，用于换算护盾环的破碎进度 */
    private get shieldMax(): number {
        return this.upgrades.getStack('shield') * SHIELD_PER_STACK;
    }

    /** 「护盾 / 回血」两张卡作用于核心，通过这个回调对象注入给升级系统 */
    private coreEffects: UpgradeCore = {
        addShield: (amount: number): void => {
            this.coreShield += amount;
            this.turret.setShield(this.coreShield, this.shieldMax);
            this.fx.floatText(0, CIRCLE_CENTER_Y + 70, '护盾 +' + amount, SHIELD_COLOR);
        },
        healRatio: (ratio: number): void => {
            const heal = Math.max(1, Math.round(START_BASE_HP * ratio));
            this.coreHp = Math.min(START_BASE_HP, this.coreHp + heal);
            this.fx.floatText(0, CIRCLE_CENTER_Y + 70, '核心 +' + heal, COLORS.hp);
        },
    };

    // ---------- 生命周期 ----------

    onLoad(): void {
        const launch = CircleGameManager.pendingLaunch;
        CircleGameManager.pendingLaunch = null;
        this.levelId = Math.max(1, Math.min(MAX_LEVEL, Math.round(launch ? launch.levelId : 1)));
        this.host = launch ? launch.host : null;

        this.world = this.createWorldLayer();
        this.buildArena();
        this.buildSystems();
        this.buildUi();

        this.save = loadSave();
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        this.startGame();
    }

    onDestroy(): void {
        bus.offTarget(this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    update(dt: number): void {
        const raw = Math.min(dt, 0.05);
        this.hud.update(raw);
        this.refreshUi();
        // 选卡面板会暂停战斗，但自动选择倒计时仍需按真实时间推进
        this.cards.tick(raw);
        // 边缘微光是纯表现，暂停时也让它把这一闪播完
        this.tickEdgeFlash(raw);

        // 结算 / 暂停 / 升级选卡期间不推进战斗
        if (this.over || this.paused || this.cards.isVisible) {
            return;
        }

        const step = raw * this.speedMul;
        this.waves.update(step);
        this.enemies.update(step);
        this.turret.update(step, this.findTarget, this.fireTurret);
        this.bullets.update(step);
        this.skills.update(step);
        this.fx.update(step);

        this.checkGameOver();
    }

    // ---------- 组装 ----------

    private buildArena(): void {
        const layer = createUiNode('Arena', this.world);
        const g = addGraphics(layer);
        // 整屏底色：世界尺度放大到远超屏幕，保证任何镜头高度下都不露黑边
        drawRect(g, -2000 * WORLD, -2000 * WORLD, 4000 * WORLD, 4000 * WORLD, COLORS.bg);
        // 背景网格：只铺在可玩区内，低对比度只作纹理
        this.drawBgGrid(g);

        // 出生圆周已放大到画面之外（见 ARENA_RADIUS），这里不再画战场边界圆：
        // 视野里只有底板与网格，看不到任何「边缘」。
        // 核心危险区：提示怪物逼近到什么程度会扣血
        drawCircle(g, 0, CIRCLE_CENTER_Y, CORE_HIT_RADIUS, 0x2a1f24, COLORS.danger, 3 * WORLD);
    }

    /** 背景网格：铺满可玩区（区外不铺），低对比度只作纹理 */
    private drawBgGrid(g: Graphics): void {
        for (let x = -PLAY_AREA_HALF_W; x <= PLAY_AREA_HALF_W; x += GRID_STEP) {
            drawLine(g, x, PLAY_AREA_BOTTOM, x, PLAY_AREA_TOP, GRID_COLOR, 2 * WORLD);
        }
        for (let y = PLAY_AREA_BOTTOM; y <= PLAY_AREA_TOP; y += GRID_STEP) {
            drawLine(g, -PLAY_AREA_HALF_W, y, PLAY_AREA_HALF_W, y, GRID_COLOR, 2 * WORLD);
        }
    }

    private buildSystems(): void {
        // 战斗内容统一挂在可玩区矩形遮罩下：区外的敌人 / 子弹 / 特效一律不渲染
        const battle = this.createBattleMask(this.world);
        const enemyLayer = createUiNode('Enemies', battle);
        const turretLayer = createUiNode('Turret', battle);
        const bulletLayer = createUiNode('Bullets', battle);
        const fxLayer = createUiNode('Fx', battle);

        this.fx = new FxSystem(fxLayer);
        this.enemies = new CircleEnemySystem(enemyLayer, {
            onKilled: (enemy) => this.handleKilled(enemy),
            onReachedCore: (enemy) => this.handleReachedCore(enemy),
            onRangedAttack: (enemy) => this.handleRangedAttack(enemy),
        });
        // TargetProvider 由 CircleEnemySystem 的结构直接满足（提供 forEachInRange）
        // 「子弹反弹」与攻击区比例都是随升级卡变化的运行期数值，用回调按需读取
        this.bullets = new BulletSystem(bulletLayer, this.enemies, this.fx, {
            getBounce: () => this.upgrades.bounceCount,
            getAttackScale: () => this.attackScale,
        });
        this.turret = new BaseTurret(turretLayer);
        this.skills = new SkillSystem(
            this.enemies,
            this.fx,
            () => this.waves.wave,
            () => this.attackScale,
        );
        this.upgrades = new UpgradeSystem(this.turret, this.skills, this.coreEffects);
        this.waves = new CircleWaveSystem(this.enemies, levelDef(this.levelId), {
            onWaveStarted: (wave, total) => this.hud.showBanner(wave >= total ? '最后一波！' : '第 ' + wave + ' 波'),
            onPhaseChanged: (phase) => this.onPhaseChanged(phase),
        });
    }

    /** 战场世界容器：整体缩放到 CAMERA_ZOOM，等价于把相机抬高 —— 视野变大、画面里的一切变小 */
    private createWorldLayer(): Node {
        const world = createUiNode('World', this.node);
        world.setScale(CAMERA_ZOOM, CAMERA_ZOOM, 1);
        return world;
    }

    /**
     * 可玩区矩形遮罩：把战斗内容裁到 PLAY_AREA 之内，避免玩家看到区外的怪物。
     *
     * 遮罩挂在世界容器下，因此尺寸 / 位置都用世界单位；渲染时随容器一起缩放，
     * 屏幕上裁出来的正好是「屏幕矩形扣掉 HUD 与技能条」的那块区域。
     * 遮罩矩形以节点自身原点为中心，所以遮罩节点必须落在可玩区中心，
     * 而其子节点一律以世界原点（= 屏幕中心）为基准，因此在遮罩下垫一层反向偏移的内容层，
     * 返回给调用方的就是这个内容层，子节点坐标重新等于世界坐标。
     */
    private createBattleMask(parent: Node): Node {
        const centerY = (PLAY_AREA_TOP + PLAY_AREA_BOTTOM) / 2;
        const node = createUiNode('BattleMask', parent, 0, centerY);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(PLAY_AREA_HALF_W * 2, PLAY_AREA_TOP - PLAY_AREA_BOTTOM);
        const mask = node.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;
        return createUiNode('BattleContent', node, 0, -centerY);
    }

    private buildUi(): void {
        const layer = createUiNode('Ui', this.node);
        // 屏幕边缘红色微光垫在所有 UI 之下：只在核心被撞击时一闪而过，不遮挡任何控件
        this.edgeNode = createUiNode('EdgeFlash', layer);
        const edgeG = addGraphics(this.edgeNode);
        for (let i = 0; i < EDGE_FLASH_LAYERS; i++) {
            const inset = i * EDGE_FLASH_LINE;
            edgeG.lineWidth = EDGE_FLASH_LINE;
            edgeG.strokeColor = colorOf(COLORS.danger, Math.round(EDGE_FLASH_ALPHA * (1 - i / EDGE_FLASH_LAYERS)));
            edgeG.rect(-HALF_W + inset, -HALF_H + inset, (HALF_W - inset) * 2, (HALF_H - inset) * 2);
            edgeG.stroke();
        }
        this.edgeOpacity = this.edgeNode.addComponent(UIOpacity);
        this.edgeNode.active = false;

        this.hud = new CircleHud(
            layer,
            () => this.togglePause(),
            () => this.toggleSpeed(),
        );
        this.skillBar = new SkillBar(layer);
        this.cards = new UpgradeCards(layer, (index) => this.handlePickCard(index));
        this.result = new ResultPanel(layer);
    }

    /** 核心被撞击：屏幕四周闪一下红色微光，随后迅速淡出 */
    private flashScreenEdge(): void {
        this.edgeLife = 0;
        this.edgeNode.active = true;
        this.edgeOpacity.opacity = 255;
    }

    private tickEdgeFlash(dt: number): void {
        if (!this.edgeNode.active) {
            return;
        }
        this.edgeLife += dt;
        const t = this.edgeLife / EDGE_FLASH_TTL;
        if (t >= 1) {
            this.edgeNode.active = false;
            return;
        }
        this.edgeOpacity.opacity = Math.round(255 * (1 - t) * (1 - t));
    }

    // ---------- 局内流程 ----------

    private startGame(): void {
        this.turret.reset();
        this.skills.reset();
        this.enemies.reset();
        this.bullets.reset();
        this.fx.reset();
        this.upgrades.reset();
        this.waves.reset();

        this.coreHp = START_BASE_HP;
        this.coreShield = 0;
        this.over = false;
        this.paused = false;
        this.speedIndex = 0;
        this.pendingLevelUps = 0;

        this.result.hide();
        this.cards.hide();
        this.edgeLife = EDGE_FLASH_TTL;
        this.edgeNode.active = false;
        this.refreshUi();

        const def = levelDef(this.levelId);
        this.hud.showBanner('第 ' + def.id + ' 关 · ' + def.name);
    }

    private checkGameOver(): void {
        if (this.waves.isOver) {
            this.finish(this.waves.phase === GamePhase.Won);
            return;
        }
        if (this.coreHp <= 0) {
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
        this.cards.hide();

        const wave = this.waves.wave;
        const def = levelDef(this.levelId);
        // 星级：满血通关 3 星，核心生命剩余超过 60% 得 2 星，其余通关 1 星；失败不给星
        const stars = win ? (this.coreHp >= START_BASE_HP ? 3 : this.coreHp > START_BASE_HP * 0.6 ? 2 : 1) : 0;

        this.save.playCount += 1;
        if (win) {
            this.save.winCount += 1;
        }
        if (wave > this.save.circleBestWave) {
            this.save.circleBestWave = wave;
        }
        const isNewRecord = recordLevelStars(this.save, this.levelId, stars);
        writeSave(this.save);

        this.result.show({
            win,
            stars,
            lines: [
                '第 ' + def.id + ' 关 · ' + def.name,
                '到达波次   ' + wave + ' / ' + this.waves.totalWaves,
                '核心剩余   ' + this.coreHp + ' / ' + START_BASE_HP + (isNewRecord ? '    新纪录' : ''),
            ],
            tip: win ? (this.levelId < MAX_LEVEL ? '下一关已解锁，继续推进' : '全部关卡已通关') : '核心被击破，重新布防试试',
            buttons: this.resultButtons(win),
        });
        vibrateShort();
        bus.emit(GameEvent.GameOver, { win, wave, bestWave: this.save.circleBestWave });
    }

    /** 结算按钮：胜利时给出「重试 / 下一关 / 返回首页」，失败只有「重试 / 返回首页」 */
    private resultButtons(win: boolean): ResultButton[] {
        const buttons: ResultButton[] = [{ label: '重试', color: 0x4fc3f7, onTap: () => this.startGame() }];
        if (win && this.levelId < MAX_LEVEL) {
            buttons.push({ label: '下一关', color: COLORS.selection, onTap: () => this.gotoLevel(this.levelId + 1) });
        }
        buttons.push({ label: '返回首页', color: 0x90a4ae, onTap: () => this.exitHome() });
        return buttons;
    }

    /** 切换到指定关卡：由路由重新挂载主控，保证关卡相关系统整体重建 */
    private gotoLevel(levelId: number): void {
        if (this.host) {
            this.host.startLevel(levelId);
        } else {
            this.startGame();
        }
    }

    private exitHome(): void {
        if (this.host) {
            this.host.exitToHome();
        }
    }

    private onPhaseChanged(phase: GamePhase): void {
        if (phase === GamePhase.Prepare && this.waves.wave > 0 && this.waves.wave < this.waves.totalWaves) {
            this.hud.showBanner('第 ' + (this.waves.wave + 1) + ' 波准备');
        }
    }

    // ---------- 战斗回调 ----------

    private findTarget = (x: number, y: number, range: number, dirDeg: number, toleranceDeg: number): CircleEnemy | null => {
        return this.enemies.findInSector(x, y, range, dirDeg, toleranceDeg, this.attackScale);
    };

    /** 中央炮塔发射直线弹：子弹沿炮口方向飞出，命中即结算，未命中飞出边界消失 */
    private fireTurret = (turret: BaseTurret, x: number, y: number, aimX: number, aimY: number): void => {
        this.bullets.fireLine(turret, x, y, aimX, aimY);
    };

    private handleKilled(enemy: CircleEnemy): void {
        const p = enemy.node.position;
        // 死亡：先铺一层原来的扩散波纹，再叠上白色玻璃碎片
        this.fx.explosion(p.x, p.y, enemy.hitRadius * 1.8, enemy.def.color);
        this.fx.shatter(p.x, p.y, enemy.hitRadius * 0.8, 0xffffff);
        const xp = enemyXp(enemy.def);
        this.fx.floatText(p.x, p.y + 24, '+' + xp + ' 经验', COLORS.selection);
        this.gainXp(xp);
    }

    private handleReachedCore(enemy: CircleEnemy): void {
        const p = enemy.node.position;
        this.fx.explosion(p.x, p.y, CORE_HIT_RADIUS, COLORS.danger);
        // 撞击反馈：炮塔外沿红闪 + 屏幕四周红闪
        this.turret.flashCore();
        this.flashScreenEdge();
        this.damageCore(enemy.def.baseDamage, p.x, p.y);
    }

    /** 远程敌人投掷命中：伤害固定为 RANGED_CORE_DAMAGE，不受敌人 baseDamage 影响 */
    private handleRangedAttack(enemy: CircleEnemy): void {
        const p = enemy.node.position;
        this.fx.explosion(p.x, p.y, enemy.hitRadius * 1.6, enemy.def.color);
        this.damageCore(RANGED_CORE_DAMAGE, p.x, p.y);
    }

    /** 核心扣血：护盾先按点抵扣，扣完才轮到核心生命 */
    private damageCore(damage: number, x: number, y: number): void {
        if (this.coreShield > 0) {
            const absorbed = Math.min(this.coreShield, damage);
            this.coreShield -= absorbed;
            damage -= absorbed;
            this.turret.setShield(this.coreShield, this.shieldMax);
            this.fx.floatText(x, y + 42, '护盾 -' + absorbed, SHIELD_COLOR);
            if (this.coreShield <= 0) {
                // 护盾被打空的瞬间：整圈像玻璃一样碎开（碎片取护盾半径的一半）
                this.fx.shatter(0, CIRCLE_CENTER_Y, this.turret.shieldRadius * 0.5, SHIELD_COLOR);
            }
        }
        if (damage > 0) {
            this.coreHp = Math.max(0, this.coreHp - damage);
            this.fx.floatText(x, y + 20, '-' + damage + ' 核心', COLORS.danger);
        }
    }

    // ---------- 经验与升级卡 ----------

    private gainXp(amount: number): void {
        const ups = this.upgrades.addXp(amount);
        if (ups <= 0) {
            return;
        }
        this.pendingLevelUps += ups;
        vibrateShort();
        this.showNextOffer();
    }

    /** 依次弹出升级卡；连升多级时每次选择后再弹下一组 */
    private showNextOffer(): void {
        if (this.pendingLevelUps <= 0 || this.over) {
            return;
        }
        const choices: CardChoice[] = this.upgrades.roll();
        if (choices.length === 0) {
            this.pendingLevelUps = 0;
            return;
        }
        this.cards.show(choices, this.upgrades.level, this.pendingLevelUps - 1);
    }

    private handlePickCard(choice: CardChoice): void {
        this.upgrades.apply(choice);
        this.hud.showBanner(choice.def.name, choice.def.color);
        this.cards.hide();
        this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
        if (this.pendingLevelUps > 0) {
            this.showNextOffer();
        }
        this.refreshUi();
    }

    // ---------- 交互 ----------

    private onTouchStart(event: EventTouch): void {
        // 升级卡 / 结算面板 / HUD 都在未缩放的 UI 层里，命中测试一律用屏幕像素坐标
        const ui = event.getUILocation();
        const visible = view.getVisibleSize();
        const x = ui.x - visible.width / 2;
        const y = ui.y - visible.height / 2;

        if (this.cards.handleTap(x, y)) {
            return;
        }
        if (this.result.handleTap(x, y)) {
            return;
        }
        this.hud.handleTap(x, y);
    }

    private togglePause(): void {
        if (this.over || this.cards.isVisible) {
            return;
        }
        this.paused = !this.paused;
    }

    private toggleSpeed(): void {
        this.speedIndex = (this.speedIndex + 1) % SPEED_STEPS.length;
    }

    private get speedMul(): number {
        return SPEED_STEPS[this.speedIndex];
    }

    // ---------- 状态刷新 ----------

    private refreshUi(): void {
        const s = this.hudState;
        s.coreHp = this.coreHp;
        s.coreHpMax = START_BASE_HP;
        s.coreShield = this.coreShield;
        s.wave = this.waves.wave;
        s.waveTotal = this.waves.totalWaves;
        s.phase = this.waves.phase;
        s.prepTimer = this.waves.prepTimer;
        s.enemyLeft = this.enemies.count + this.waves.pendingCount;
        s.level = this.upgrades.level;
        s.xp = this.upgrades.xp;
        s.xpNeed = this.upgrades.xpNeed;
        s.xpRatio = this.upgrades.xpRatio;
        s.paused = this.paused;
        s.speedMul = this.speedMul;
        this.hud.refresh(s);

        this.refreshSkillBar();
    }

    /** 把技能层数与冷却进度同步到底部冷却条 */
    private refreshSkillBar(): void {
        for (let i = 0; i < SKILL_KINDS.length; i++) {
            const kind = SKILL_KINDS[i];
            const state = this.skillStates[i];
            state.stacks = this.skills.getStacks(kind);
            state.remaining = this.skills.getCooldown(kind);
            state.total = this.skills.getCooldownTotal(kind);
        }
        this.skillBar.refresh(this.skillStates);
    }
}