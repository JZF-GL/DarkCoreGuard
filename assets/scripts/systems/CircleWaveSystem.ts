/**
 * 圆形防守模式的波次系统：波次表由关卡配置（LevelConfig）程序化生成，不同关卡波数不同。
 *
 *   Prepare  --倒计时结束（或玩家点「立即开始」）-->  Spawning
 *   Spawning --本波怪物全部出生--> Fighting --场上清空--> Prepare（或 Won）
 *
 * 与固定路径模式的 WaveSystem 逻辑同构，但敌人从圆周随机角度生成，且没有金币奖励概念
 * （本模式的成长完全走经验 / 升级卡），因此独立实现而不强行复用。
 */
import { CircleWaveDef, LevelDef, levelHpScale, levelWaves } from '../config/CircleLevelConfig';
import { ENEMY_DEFS, EnemyType } from '../config/EnemyConfig';
import { GamePhase } from '../core/GameEvents';
import { CircleEnemySystem } from './CircleEnemySystem';

/** 第一波准备时间（秒） */
const FIRST_PREP = 6;
/** 波与波之间的准备时间（秒） */
const BETWEEN_PREP = 3;

interface GroupState {
    enemy: EnemyType;
    count: number;
    interval: number;
    spawned: number;
    timer: number;
}

export interface CircleWaveListener {
    onWaveStarted(wave: number, total: number): void;
    onPhaseChanged(phase: GamePhase): void;
}

export class CircleWaveSystem {
    phase: GamePhase = GamePhase.Prepare;
    wave: number = 0;
    prepTimer: number = FIRST_PREP;

    /** 本关的关卡定义与程序化生成的波次表 */
    readonly def: LevelDef;
    private waves: CircleWaveDef[];
    private groups: GroupState[] = [];
    private enemies: CircleEnemySystem;
    private listener: CircleWaveListener;

    constructor(enemies: CircleEnemySystem, def: LevelDef, listener: CircleWaveListener) {
        this.enemies = enemies;
        this.listener = listener;
        this.def = def;
        this.waves = levelWaves(def);
    }

    get totalWaves(): number {
        return this.def.waves;
    }

    /** 本波尚未出场的怪物数量 */
    get pendingCount(): number {
        let count = 0;
        for (const state of this.groups) {
            count += Math.max(0, state.count - state.spawned);
        }
        return count;
    }

    get isOver(): boolean {
        return this.phase === GamePhase.Won || this.phase === GamePhase.Lost;
    }

    reset(): void {
        this.phase = GamePhase.Prepare;
        this.wave = 0;
        this.prepTimer = FIRST_PREP;
        this.groups = [];
        this.listener.onPhaseChanged(this.phase);
    }

    /** 提前开始下一波。仅在准备阶段可用，返回跳过的准备秒数 */
    callNextWave(): number {
        if (this.phase !== GamePhase.Prepare || this.wave >= this.totalWaves) {
            return 0;
        }
        const skipped = Math.floor(this.prepTimer);
        this.beginWave();
        return skipped;
    }

    update(dt: number): void {
        if (this.isOver) {
            return;
        }
        if (this.phase === GamePhase.Prepare) {
            this.prepTimer -= dt;
            if (this.prepTimer <= 0) {
                this.prepTimer = 0;
                this.beginWave();
            }
            return;
        }
        this.updateSpawning(dt);
        this.checkWaveClear();
    }

    setLost(): void {
        if (this.isOver) {
            return;
        }
        this.phase = GamePhase.Lost;
        this.listener.onPhaseChanged(this.phase);
    }

    // ---------- 内部 ----------

    private beginWave(): void {
        this.wave++;
        const def = this.waves[this.wave - 1];
        this.groups = def.groups.map((group) => ({
            enemy: group.enemy,
            count: group.count,
            interval: group.interval,
            spawned: 0,
            timer: group.delay,
        }));
        this.phase = GamePhase.Spawning;
        this.prepTimer = 0;
        this.listener.onWaveStarted(this.wave, this.totalWaves);
        this.listener.onPhaseChanged(this.phase);
    }

    private updateSpawning(dt: number): void {
        const hpScale = levelHpScale(this.def, this.wave);
        for (const state of this.groups) {
            if (state.spawned >= state.count) {
                continue;
            }
            state.timer -= dt;
            while (state.timer <= 0 && state.spawned < state.count) {
                this.enemies.spawn(ENEMY_DEFS[state.enemy], hpScale, CircleEnemySystem.randomAngle(), this.def.speedMul);
                state.spawned++;
                state.timer += state.interval;
            }
        }
    }

    private checkWaveClear(): void {
        if (this.pendingCount > 0) {
            return;
        }
        if (this.enemies.count > 0) {
            if (this.phase === GamePhase.Spawning) {
                this.phase = GamePhase.Fighting;
                this.listener.onPhaseChanged(this.phase);
            }
            return;
        }
        this.completeWave();
    }

    private completeWave(): void {
        this.groups = [];
        if (this.wave >= this.totalWaves) {
            this.phase = GamePhase.Won;
            this.listener.onPhaseChanged(this.phase);
            return;
        }
        this.phase = GamePhase.Prepare;
        this.prepTimer = BETWEEN_PREP;
        this.listener.onPhaseChanged(this.phase);
    }
}