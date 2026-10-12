/**
 * 圆形防守模式的关卡配置：共 10 关，与经典模式的 LevelConfig（固定路径 + 固定 10 波）互不影响。
 *
 * 每关不再手写逐波怪物表，而是给一组难度参数，由 levelWaves() 程序化生成波次：
 *   - 可用敌人类型按顺序逐步登场（第 i 种从第 i 波开始出现）；
 *   - 每波总数量 = baseCount + countGrowth * (波次 - 1)；
 *   - 生命倍率 = 波次成长(HP_GROWTH_PER_WAVE) × CIRCLE_ENEMY_HP_MUL × 本关 hpMul；
 *   - 速度倍率取本关 speedMul，越靠后的关卡推进越快。
 *
 * 难度曲线（前 5 关按需求指定，后 5 关在此基础上加密）：
 *   1 圆形 + 三角                2 数量增加
 *   3 加入方形                   4 数量增加
 *   5 加入五边形                 6 加入符文圆
 *   7 加入六角远程               8 全类型混编
 *   9 精锐提速                  10 最终防线
 */
import { CIRCLE_ENEMY_HP_MUL } from './CircleConfig';
import { EnemyType } from './EnemyConfig';
import { HP_GROWTH_PER_WAVE } from './GameConfig';

export interface CircleWaveGroup {
    enemy: EnemyType;
    count: number;
    /** 同组内两只怪之间的出生间隔（秒） */
    interval: number;
    /** 相对本波开始的延迟（秒） */
    delay: number;
}

export interface CircleWaveDef {
    groups: CircleWaveGroup[];
}

export interface LevelDef {
    /** 关卡序号，1 起 */
    id: number;
    name: string;
    /** 本关总波数 */
    waves: number;
    /** 本关会出现的敌人类型（按登场顺序） */
    enemies: EnemyType[];
    /** 第 1 波的出场总数 */
    baseCount: number;
    /** 每波数量增量 */
    countGrowth: number;
    /** 出生间隔基准（秒），越小越密集 */
    interval: number;
    /** 生命倍率（叠加在波次成长之上） */
    hpMul: number;
    /** 速度倍率（直接作用在敌人基础速度上） */
    speedMul: number;
}

export const LEVELS: LevelDef[] = [
    {
        id: 1,
        name: '初次接触',
        waves: 6,
        enemies: ['grunt', 'runner'],
        baseCount: 3,
        countGrowth: 1.0,
        interval: 1.3,
        hpMul: 0.6,
        speedMul: 0.8,
    },
    {
        id: 2,
        name: '敌潮加剧',
        waves: 6,
        enemies: ['grunt', 'runner'],
        baseCount: 5,
        countGrowth: 1.4,
        interval: 1.2,
        hpMul: 0.7,
        speedMul: 0.85,
    },
    {
        id: 3,
        name: '方阵登场',
        waves: 7,
        enemies: ['grunt', 'runner', 'tank'],
        baseCount: 5,
        countGrowth: 1.3,
        interval: 1.2,
        hpMul: 0.72,
        speedMul: 0.85,
    },
    {
        id: 4,
        name: '重压推进',
        waves: 7,
        enemies: ['grunt', 'runner', 'tank'],
        baseCount: 7,
        countGrowth: 1.6,
        interval: 1.1,
        hpMul: 0.78,
        speedMul: 0.88,
    },
    {
        id: 5,
        name: '五角堡垒',
        waves: 8,
        enemies: ['grunt', 'runner', 'tank', 'brute'],
        baseCount: 7,
        countGrowth: 1.5,
        interval: 1.1,
        hpMul: 0.8,
        speedMul: 0.9,
    },
    {
        id: 6,
        name: '符文护盾',
        waves: 8,
        enemies: ['grunt', 'runner', 'tank', 'brute', 'sigil'],
        baseCount: 8,
        countGrowth: 1.5,
        interval: 1.0,
        hpMul: 0.85,
        speedMul: 0.92,
    },
    {
        id: 7,
        name: '远程压制',
        waves: 9,
        enemies: ['grunt', 'runner', 'tank', 'brute', 'sigil', 'ranger'],
        baseCount: 8,
        countGrowth: 1.5,
        interval: 1.0,
        hpMul: 0.88,
        speedMul: 0.95,
    },
    {
        id: 8,
        name: '混编来袭',
        waves: 10,
        enemies: ['grunt', 'runner', 'tank', 'brute', 'sigil', 'ranger'],
        baseCount: 9,
        countGrowth: 1.7,
        interval: 0.9,
        hpMul: 0.92,
        speedMul: 0.98,
    },
    {
        id: 9,
        name: '精锐突袭',
        waves: 11,
        enemies: ['grunt', 'runner', 'tank', 'brute', 'sigil', 'ranger'],
        baseCount: 10,
        countGrowth: 1.8,
        interval: 0.85,
        hpMul: 0.96,
        speedMul: 1.0,
    },
    {
        id: 10,
        name: '最终防线',
        waves: 12,
        enemies: ['grunt', 'runner', 'tank', 'brute', 'sigil', 'ranger'],
        baseCount: 12,
        countGrowth: 2.0,
        interval: 0.8,
        hpMul: 1.0,
        speedMul: 1.05,
    },
];

/** 关卡总数 */
export const MAX_LEVEL = LEVELS.length;

/** 取关卡定义（levelId 从 1 起，越界时夹到合法范围） */
export function levelDef(levelId: number): LevelDef {
    const index = Math.max(0, Math.min(LEVELS.length - 1, Math.round(levelId) - 1));
    return LEVELS[index];
}

/** 由关卡参数生成整关的波次表 */
export function levelWaves(def: LevelDef): CircleWaveDef[] {
    const waves: CircleWaveDef[] = [];
    for (let w = 1; w <= def.waves; w++) {
        // 第 i 种敌人从第 i 波开始登场，避免一开局所有类型一起冒出来
        const available = def.enemies.slice(0, Math.min(def.enemies.length, w));
        const total = Math.round(def.baseCount + def.countGrowth * (w - 1));
        const lead = available[0];
        const rest = available.slice(1);
        const groups: CircleWaveGroup[] = [];
        if (rest.length === 0) {
            groups.push({ enemy: lead, count: total, interval: def.interval, delay: 0 });
        } else {
            // 首发类型占大头，其余类型平分剩下的名额并延后出场
            const leadCount = Math.max(1, Math.round(total * 0.55));
            const perRest = Math.max(1, Math.round((total - leadCount) / rest.length));
            groups.push({ enemy: lead, count: leadCount, interval: def.interval, delay: 0 });
            const delay = def.interval * Math.max(2, leadCount * 0.5);
            for (let i = 0; i < rest.length; i++) {
                groups.push({
                    enemy: rest[i],
                    count: perRest,
                    interval: def.interval * 0.85,
                    delay: delay + i * 1.2,
                });
            }
        }
        waves.push({ groups });
    }
    return waves;
}

/** 第 wave 波（1 起）在指定关卡内的敌人生命倍率 */
export function levelHpScale(def: LevelDef, wave: number): number {
    return (1 + HP_GROWTH_PER_WAVE * (wave - 1)) * CIRCLE_ENEMY_HP_MUL * def.hpMul;
}