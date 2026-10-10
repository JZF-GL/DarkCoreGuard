/**
 * 敌人数值配置表。speed 以「格/秒」为单位，运行时乘以 CELL_SIZE 转为像素速度。
 */
export type EnemyType = 'grunt' | 'tank' | 'runner';

export type EnemyShape = 'circle' | 'square' | 'triangle';

export interface EnemyDef {
    type: EnemyType;
    /** 显示名 */
    name: string;
    /** 基础生命 */
    hp: number;
    /** 移动速度（格/秒） */
    speed: number;
    /** 护甲（固定值减免） */
    armor: number;
    /** 击杀奖励金币 */
    reward: number;
    /** 抵达终点时对基地造成的伤害 */
    baseDamage: number;
    /** 绘制半径 */
    radius: number;
    /** 外形 */
    shape: EnemyShape;
    /** 颜色 */
    color: number;
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
    grunt: {
        type: 'grunt',
        name: '小兵',
        hp: 60,
        speed: 1.6,
        armor: 0,
        reward: 8,
        baseDamage: 1,
        radius: 18,
        shape: 'circle',
        color: 0xef5350,
    },
    tank: {
        type: 'tank',
        name: '重甲',
        hp: 220,
        speed: 1.0,
        armor: 4,
        reward: 20,
        baseDamage: 2,
        radius: 23,
        shape: 'square',
        color: 0x8d6e63,
    },
    runner: {
        type: 'runner',
        name: '疾行',
        hp: 45,
        speed: 2.8,
        armor: 0,
        reward: 10,
        baseDamage: 1,
        radius: 15,
        shape: 'triangle',
        color: 0xffca28,
    },
};