/**
 * 敌人数值配置表。speed 以「格/秒」为单位，运行时乘以 CELL_SIZE 转为像素速度。
 *
 * 六种敌人靠外形 + 属性区分定位：
 *   grunt  圆形   —— 基础单位
 *   runner 三角   —— 速度极快、血薄
 *   tank   方形   —— 血厚防高、迟缓
 *   brute  五边形 —— 血量最厚的攻城单位
 *   sigil  圆形 +  内部符文图案 —— 减免固定伤害的护甲单位
 *   ranger 六边形 —— 远程单位，停在射程外向核心投掷
 */
import { WORLD } from './GameConfig';

export type EnemyType = 'grunt' | 'tank' | 'runner' | 'brute' | 'sigil' | 'ranger';

export type EnemyShape = 'circle' | 'square' | 'triangle' | 'pentagon' | 'hexagon';

/** 圆形敌人内部叠加的图案，用于区分「同外形不同属性」的敌人 */
export type EnemyPattern = 'rune';

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
    /** 外形内部的图案（仅 shape 为 circle 时有意义） */
    pattern?: EnemyPattern;
    /** 颜色 */
    color: number;
    /** 特性说明，用于敌人图鉴 */
    trait: string;
    /** 远程攻击：进入该像素距离后停止推进并定期开火；缺省表示近战（一直推进到核心） */
    attackRange?: number;
    /** 远程开火间隔（秒） */
    attackInterval?: number;
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
    grunt: {
        type: 'grunt',
        name: '圆形兵',
        hp: 60,
        speed: 1.6,
        armor: 0,
        reward: 8,
        baseDamage: 1,
        radius: 22,
        shape: 'circle',
        color: 0xef5350,
        trait: '基础单位，属性均衡，靠数量压制',
    },
    runner: {
        type: 'runner',
        name: '三角疾行',
        hp: 45,
        speed: 2.8,
        armor: 0,
        reward: 10,
        baseDamage: 1,
        radius: 22,
        shape: 'triangle',
        color: 0xffca28,
        trait: '移动速度最快，血量最低，容易被漏过',
    },
    tank: {
        type: 'tank',
        name: '方阵重甲',
        hp: 220,
        speed: 1.0,
        armor: 4,
        reward: 20,
        baseDamage: 2,
        radius: 23,
        shape: 'square',
        color: 0x8d6e63,
        trait: '血量厚、护甲高，行动迟缓',
    },
    brute: {
        type: 'brute',
        name: '五角堡垒',
        hp: 420,
        speed: 0.7,
        armor: 8,
        reward: 32,
        baseDamage: 3,
        radius: 26,
        shape: 'pentagon',
        color: 0x7e57c2,
        trait: '血量最厚、护甲最高，突破一次扣 3 点核心生命',
    },
    sigil: {
        type: 'sigil',
        name: '符文卫兵',
        hp: 150,
        speed: 1.2,
        armor: 2,
        reward: 22,
        baseDamage: 2,
        radius: 24,
        shape: 'circle',
        pattern: 'rune',
        color: 0x26a69a,
        trait: '圆形躯体覆有符文，减免固定伤害，中等强度',
    },
    ranger: {
        type: 'ranger',
        name: '六角投手',
        hp: 90,
        speed: 1.1,
        armor: 1,
        reward: 18,
        baseDamage: 1,
        radius: 24,
        shape: 'hexagon',
        color: 0x42a5f5,
        /** 停在距核心 250px（屏幕像素）处，向核心投掷攻击；
         *  乘 WORLD 是因为圆形模式的战场整体挂在缩放容器里，坐标一律用世界单位 */
        attackRange: 250 * WORLD,
        attackInterval: 2.4,
        trait: '远程单位，停在 250px 外向核心投掷，不靠近炮塔',
    },
};

/** 敌人图鉴的展示顺序 */
export const ENEMY_ORDER: EnemyType[] = ['grunt', 'runner', 'tank', 'brute', 'sigil', 'ranger'];