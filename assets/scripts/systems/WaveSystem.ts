/**
 * 波次系统：单局节奏的状态机。
 *
 *   Prepare  --准备倒计时结束 / 玩家点「立即开始」-->  Spawning
 *   Spawning --本波怪物全部出生--> Fighting --场上清空--> Prepare（或 Won）
 *
 * 失败的判定不在这里，由 GameManager 监听基地生命。
 */
import {
    BETWEEN_WAVE_PREP_TIME,
    EARLY_CALL_GOLD_PER_SEC,
    FIRST_PREP_TIME,
    WAVE_CLEAR_GOLD_BASE,
    WAVE_CLEAR_GOLD_PER_WAVE,
} from '../config/GameConfig';
import { ENEMY_DEFS } from '../config/EnemyConfig';
import { TOTAL_WAVES, WAVES, WaveGroup, waveHpScale } from '../config/LevelConfig';
import { bus } from '../core/EventBus';
import { GameEvent, GamePhase } from '../core/GameEvents';
import { EconomySystem } from './EconomySystem';
import { EnemySystem } from './EnemySystem';

interface GroupState {
    group: WaveGroup;
    spawned: number;
    /** 距离下次出怪的倒计时（首次为配置的 delay） */
    timer: number;
}

export class WaveSystem {
    phase: GamePhase = GamePhase.Prepare;
    /** 当前波次（1 起），0 表示还没开始 */
    wave: number = 0;
    /** 准备阶段剩余秒数 */
    prepTimer: number = FIRST_PREP_TIME;

    private groups: GroupState[] = [];
    private enemies: EnemySystem;
    private economy: EconomySystem;

    constructor(enemies: EnemySystem, economy: EconomySystem) {
        this.enemies = enemies;
        this.economy = economy;
    }

    get totalWaves(): number {
        return TOTAL_WAVES;
    }

    /** 本波尚未出场的怪物数量 */
    get pendingCount(): number {
        let count = 0;
        for (const state of this.groups) {
            count += Math.max(0, state.group.count - state.spawned);
        }
        return count;
    }

    get isOver(): boolean {
        return this.phase === GamePhase.Won || this.phase === GamePhase.Lost;
    }

    /** 开新一局 */
    reset(): void {
        this.phase = GamePhase.Prepare;
        this.wave = 0;
        this.prepTimer = FIRST_PREP_TIME;
        this.groups = [];
        bus.emit(GameEvent.PhaseChanged, { phase: this.phase, wave: this.wave });
    }

    /**
     * 提前开始下一波，返回获得的奖励金币。
     * 仅在准备阶段可用；奖励 = 剩余秒数（向下取整）× 每秒折算金币。
     */
    callNextWave(): number {
        if (this.phase !== GamePhase.Prepare || this.wave >= TOTAL_WAVES) {
            return 0;
        }
        const bonus = Math.floor(this.prepTimer) * EARLY_CALL_GOLD_PER_SEC;
        this.economy.earn(bonus);
        this.beginWave();
        return bonus;
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

    /** 标记失败 */
    setLost(): void {
        if (this.isOver) {
            return;
        }
        this.phase = GamePhase.Lost;
        bus.emit(GameEvent.PhaseChanged, { phase: this.phase, wave: this.wave });
    }

    // ---------- 内部 ----------

    private beginWave(): void {
        this.wave++;
        const def = WAVES[this.wave - 1];
        this.groups = def.groups.map((group) => ({ group, spawned: 0, timer: group.delay }));
        this.phase = GamePhase.Spawning;
        this.prepTimer = 0;
        bus.emit(GameEvent.WaveStarted, { wave: this.wave, total: TOTAL_WAVES });
        bus.emit(GameEvent.PhaseChanged, { phase: this.phase, wave: this.wave });
    }

    private updateSpawning(dt: number): void {
        const hpScale = waveHpScale(this.wave);
        for (const state of this.groups) {
            if (state.spawned >= state.group.count) {
                continue;
            }
            state.timer -= dt;
            while (state.timer <= 0 && state.spawned < state.group.count) {
                this.enemies.spawn(ENEMY_DEFS[state.group.enemy], hpScale);
                state.spawned++;
                state.timer += state.group.interval;
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
                bus.emit(GameEvent.PhaseChanged, { phase: this.phase, wave: this.wave });
            }
            return;
        }
        this.completeWave();
    }

    private completeWave(): void {
        const reward = WAVE_CLEAR_GOLD_BASE + this.wave * WAVE_CLEAR_GOLD_PER_WAVE;
        this.economy.earn(reward);
        this.groups = [];

        if (this.wave >= TOTAL_WAVES) {
            this.phase = GamePhase.Won;
            bus.emit(GameEvent.PhaseChanged, { phase: this.phase, wave: this.wave });
            return;
        }
        this.phase = GamePhase.Prepare;
        this.prepTimer = BETWEEN_WAVE_PREP_TIME;
        bus.emit(GameEvent.PhaseChanged, { phase: this.phase, wave: this.wave });
    }
}