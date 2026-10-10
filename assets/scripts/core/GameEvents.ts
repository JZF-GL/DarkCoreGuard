/**
 * 全局事件定义与共享类型。
 * 所有系统之间不直接互相调用回调，统一通过 EventBus 广播，
 * 表现层（HUD / 飘字 / 结算面板）只订阅事件，便于后续替换 UI 实现。
 */

/** 单局游戏的运行阶段 */
export enum GamePhase {
    /** 波次之间的准备阶段，可以建造 / 升级塔 */
    Prepare = 'prepare',
    /** 正在按配置出怪 */
    Spawning = 'spawning',
    /** 怪物已出完，等待场上清空 */
    Fighting = 'fighting',
    /** 胜利 */
    Won = 'won',
    /** 失败 */
    Lost = 'lost',
}

/** 事件名常量 */
export enum GameEvent {
    /** 金币变化 */
    GoldChanged = 'gold-changed',
    /** 基地生命变化 */
    BaseHpChanged = 'base-hp-changed',
    /** 新一波开始 */
    WaveStarted = 'wave-started',
    /** 阶段切换 */
    PhaseChanged = 'phase-changed',
    /** 单局结束 */
    GameOver = 'game-over',
}

export interface GoldChangedPayload {
    gold: number;
    delta: number;
}

export interface BaseHpChangedPayload {
    hp: number;
    delta: number;
}

export interface WaveStartedPayload {
    wave: number;
    total: number;
}

export interface PhaseChangedPayload {
    phase: GamePhase;
    wave: number;
}

export interface GameOverPayload {
    win: boolean;
    wave: number;
    bestWave: number;
}