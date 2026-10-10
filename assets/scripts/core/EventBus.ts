/**
 * 极简事件总线。使用 target 做解绑，避免表现层销毁后仍被回调。
 */

type Handler = (payload?: any) => void;

interface Entry {
    handler: Handler;
    target: any;
}

export class EventBus {
    private map: Map<string, Entry[]> = new Map();

    on(event: string, handler: Handler, target: any = null): void {
        let list = this.map.get(event);
        if (!list) {
            list = [];
            this.map.set(event, list);
        }
        list.push({ handler, target });
    }

    off(event: string, handler: Handler, target: any = null): void {
        const list = this.map.get(event);
        if (!list) {
            return;
        }
        for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            if (e.handler === handler && e.target === target) {
                list.splice(i, 1);
            }
        }
        if (list.length === 0) {
            this.map.delete(event);
        }
    }

    /** 解绑某个对象注册的全部监听 */
    offTarget(target: any): void {
        this.map.forEach((list, event) => {
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].target === target) {
                    list.splice(i, 1);
                }
            }
            if (list.length === 0) {
                this.map.delete(event);
            }
        });
    }

    emit(event: string, payload?: any): void {
        const list = this.map.get(event);
        if (!list) {
            return;
        }
        // 复制一份，避免回调中解绑导致遍历异常
        const snapshot = list.slice();
        for (let i = 0; i < snapshot.length; i++) {
            snapshot[i].handler.call(snapshot[i].target, payload);
        }
    }

    clear(): void {
        this.map.clear();
    }
}

/** 全局唯一实例 */
export const bus = new EventBus();