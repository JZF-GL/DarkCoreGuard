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

export interface SaveData {
    /** 历史最高到达波次 */
    bestWave: number;
    /** 累计开局次数 */
    playCount: number;
    /** 累计通关次数 */
    winCount: number;
}

const DEFAULT_SAVE: SaveData = {
    bestWave: 0,
    playCount: 0,
    winCount: 0,
};

function normalize(raw: any): SaveData {
    if (!raw || typeof raw !== 'object') {
        return { ...DEFAULT_SAVE };
    }
    return {
        bestWave: Number(raw.bestWave) || 0,
        playCount: Number(raw.playCount) || 0,
        winCount: Number(raw.winCount) || 0,
    };
}

/** 读取本地存档，异常时返回默认值（不抛错，保证游戏可玩） */
export function loadSave(): SaveData {
    try {
        const text = sys.localStorage.getItem(SAVE_KEY);
        if (!text) {
            return { ...DEFAULT_SAVE };
        }
        return normalize(JSON.parse(text));
    } catch (e) {
        console.warn('[SDMini] 读取存档失败，使用默认值', e);
        return { ...DEFAULT_SAVE };
    }
}

export function writeSave(data: SaveData): void {
    try {
        sys.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('[SDMini] 写入存档失败', e);
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