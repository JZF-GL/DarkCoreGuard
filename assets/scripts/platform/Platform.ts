/**
 * 平台适配层。
 * 存档统一走引擎的 sys.localStorage（微信小游戏由 Adapter 自动映射到 wx.setStorageSync），
 * 这里额外封装震动反馈与平台判断，方便后续接入排行榜、分享等能力。
 */
import { sys } from 'cc';
import { SAVE_KEY } from '../config/GameConfig';

declare const wx: any;

/** 是否运行在微信小游戏环境 */
export const isWechat: boolean = typeof wx !== 'undefined' && !!wx.getSystemInfoSync;

/** 单关最高星数（0 表示未通关，1~3 表示已通关的评价） */
export const MAX_STARS = 3;

export interface SaveData {
    /** 历史最高到达波次（经典路径模式） */
    bestWave: number;
    /** 历史最高到达波次（圆形防守模式） */
    circleBestWave: number;
    /** 累计开局次数 */
    playCount: number;
    /** 累计通关次数 */
    winCount: number;
    /** 每关的历史最高星数，下标 = 关卡序号 - 1 */
    levelStars: number[];
}

const DEFAULT_SAVE: SaveData = {
    bestWave: 0,
    circleBestWave: 0,
    playCount: 0,
    winCount: 0,
    levelStars: [],
};

function normalize(raw: any): SaveData {
    if (!raw || typeof raw !== 'object') {
        return { ...DEFAULT_SAVE, levelStars: [] };
    }
    const stars: number[] = [];
    if (Array.isArray(raw.levelStars)) {
        for (const item of raw.levelStars) {
            stars.push(Math.max(0, Math.min(MAX_STARS, Math.round(Number(item) || 0))));
        }
    }
    return {
        bestWave: Number(raw.bestWave) || 0,
        circleBestWave: Number(raw.circleBestWave) || 0,
        playCount: Number(raw.playCount) || 0,
        winCount: Number(raw.winCount) || 0,
        levelStars: stars,
    };
}

/** 取某一关的历史星数（0 表示未通关） */
export function levelStarsOf(data: SaveData, levelId: number): number {
    const value = data.levelStars[levelId - 1];
    return typeof value === 'number' ? value : 0;
}

/** 记录某一关的星数，只有刷新纪录时才写入，返回是否刷新 */
export function recordLevelStars(data: SaveData, levelId: number, stars: number): boolean {
    const index = levelId - 1;
    if (index < 0 || stars <= levelStarsOf(data, levelId)) {
        return false;
    }
    while (data.levelStars.length <= index) {
        data.levelStars.push(0);
    }
    data.levelStars[index] = Math.min(MAX_STARS, stars);
    return true;
}

/** 全部关卡累计星数 */
export function totalStars(data: SaveData, levelCount: number): number {
    let sum = 0;
    for (let i = 0; i < levelCount; i++) {
        sum += levelStarsOf(data, i + 1);
    }
    return sum;
}

/** 读取本地存档，异常时返回默认值（不抛错，保证游戏可玩） */
export function loadSave(): SaveData {
    try {
        const text = sys.localStorage.getItem(SAVE_KEY);
        if (!text) {
            return { ...DEFAULT_SAVE, levelStars: [] };
        }
        return normalize(JSON.parse(text));
    } catch (e) {
        console.warn('[DarkCoreGuard] 读取存档失败，使用默认值', e);
        return { ...DEFAULT_SAVE, levelStars: [] };
    }
}

export function writeSave(data: SaveData): void {
    try {
        sys.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('[DarkCoreGuard] 写入存档失败', e);
    }
}

/** 轻微震动（仅微信小游戏有效） */
export function vibrateShort(): void {
    if (!isWechat || typeof wx.vibrateShort !== 'function') {
        return;
    }
    try {
        wx.vibrateShort({ type: 'light' });
    } catch (e) {
        // 忽略：部分基础库/机型不支持
    }
}