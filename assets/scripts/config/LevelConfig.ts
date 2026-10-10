/**
 * 关卡配置：固定路径 + 10 波怪物。
 * 路径使用「网格坐标（列, 行）」描述，起点在屏幕左侧外、终点在屏幕右侧外。
 */
import { EnemyType } from './EnemyConfig';
import { HP_GROWTH_PER_WAVE } from './GameConfig';

/** 固定路径路点（列, 行），按顺序连成一条 S 形折线 */
export const PATH_WAYPOINTS: number[][] = [
    [-1, 6],
    [1, 6],
    [1, 2],
    [4, 2],
    [4, 10],
    [7, 10],
    [7, 6],
    [9, 6],
];

/** 一波中的一组怪物 */
export interface WaveGroup {
    enemy: EnemyType;
    /** 数量 */
    count: number;
    /** 出怪间隔（秒） */
    interval: number;
    /** 相对本波开始的延迟（秒） */
    delay: number;
}

export interface WaveDef {
    groups: WaveGroup[];
}

function group(enemy: EnemyType, count: number, interval: number, delay: number = 0): WaveGroup {
    return { enemy, count, interval, delay };
}

/** 10 波配置，数值与 docs/02-数值设计表.md 一一对应 */
export const WAVES: WaveDef[] = [
    { groups: [group('grunt', 6, 1.2)] },
    { groups: [group('grunt', 8, 1.1)] },
    { groups: [group('grunt', 6, 1.0), group('runner', 4, 0.8, 6)] },
    { groups: [group('runner', 8, 0.9)] },
    { groups: [group('grunt', 8, 1.0), group('tank', 2, 1.5, 7)] },
    { groups: [group('runner', 6, 0.8), group('tank', 4, 1.4, 4)] },
    { groups: [group('grunt', 12, 0.7), group('runner', 6, 0.7, 5)] },
    { groups: [group('tank', 6, 1.2)] },
    { groups: [group('runner', 12, 0.6), group('tank', 3, 1.3, 6)] },
    {
        groups: [group('tank', 6, 1.1), group('runner', 10, 0.6, 5), group('grunt', 10, 0.5, 10)],
    },
];

/** 总波数 */
export const TOTAL_WAVES = WAVES.length;

/** 第 wave 波（1 起）的敌人生命倍率 */
export function waveHpScale(wave: number): number {
    return 1 + HP_GROWTH_PER_WAVE * (wave - 1);
}

/** 第 wave 波的敌人总数 */
export function waveEnemyCount(wave: number): number {
    const def = WAVES[wave - 1];
    if (!def) {
        return 0;
    }
    let count = 0;
    for (const g of def.groups) {
        count += g.count;
    }
    return count;
}