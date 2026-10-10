/**
 * 通用对象池。微信小游戏内存敏感，敌人与子弹必须复用节点，避免频繁创建/销毁。
 */

export interface IPoolable {
    /** 从池中取出时调用 */
    onAcquire?(): void;
    /** 归还池中时调用 */
    onRelease?(): void;
}

export class ObjectPool<T extends IPoolable> {
    private free: T[] = [];
    private createdCount = 0;

    /**
     * @param factory 创建新对象的工厂
     * @param maxSize 池中最多缓存的空闲对象数，超出则直接丢弃
     */
    constructor(private factory: () => T, private maxSize: number = 128) {}

    get(): T {
        let item: T;
        if (this.free.length > 0) {
            item = this.free.pop() as T;
        } else {
            item = this.factory();
            this.createdCount++;
        }
        if (item.onAcquire) {
            item.onAcquire();
        }
        return item;
    }

    put(item: T): void {
        if (item.onRelease) {
            item.onRelease();
        }
        if (this.free.length < this.maxSize && this.free.indexOf(item) < 0) {
            this.free.push(item);
        }
    }

    clear(): void {
        this.free.length = 0;
    }

    /** 累计创建过的对象数量，用于日志/调试 */
    get created(): number {
        return this.createdCount;
    }

    /** 当前空闲对象数量 */
    get freeCount(): number {
        return this.free.length;
    }
}