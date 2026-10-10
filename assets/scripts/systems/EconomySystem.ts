/**
 * 经济系统：金币与基地生命。所有变动都会广播事件，表现层无需回查。
 */
import { START_BASE_HP, START_GOLD } from '../config/GameConfig';
import { bus } from '../core/EventBus';
import { GameEvent } from '../core/GameEvents';

export class EconomySystem {
    gold: number = START_GOLD;
    baseHp: number = START_BASE_HP;

    reset(): void {
        this.gold = START_GOLD;
        this.baseHp = START_BASE_HP;
        bus.emit(GameEvent.GoldChanged, { gold: this.gold, delta: 0 });
        bus.emit(GameEvent.BaseHpChanged, { hp: this.baseHp, delta: 0 });
    }

    canAfford(amount: number): boolean {
        return this.gold >= amount;
    }

    /** 扣钱，余额不足返回 false 且不扣 */
    spend(amount: number): boolean {
        if (!this.canAfford(amount)) {
            return false;
        }
        this.gold -= amount;
        bus.emit(GameEvent.GoldChanged, { gold: this.gold, delta: -amount });
        return true;
    }

    earn(amount: number): void {
        if (amount <= 0) {
            return;
        }
        this.gold += amount;
        bus.emit(GameEvent.GoldChanged, { gold: this.gold, delta: amount });
    }

    damageBase(amount: number): void {
        if (amount <= 0) {
            return;
        }
        this.baseHp = Math.max(0, this.baseHp - amount);
        bus.emit(GameEvent.BaseHpChanged, { hp: this.baseHp, delta: -amount });
    }

    get isDead(): boolean {
        return this.baseHp <= 0;
    }
}