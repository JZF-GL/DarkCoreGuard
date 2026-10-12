/**
 * 四屏路由：首页 → 图鉴 / 关卡选择 → 战斗。
 *
 * 经典路径模式暂时隐藏，启动后进入首页；战斗中主控（CircleGameManager）自己处理输入，
 * 本组件只负责在屏与屏之间切换，并把「下一关 / 返回首页」的请求接回来。
 * 每次切屏都整块销毁旧屏的节点树，避免残留节点与输入监听。
 */
import { _decorator, Component, EventTouch, Input, input, Node, view } from 'cc';
import { createUiNode } from '../core/GraphicsUtil';
import { CodexPanel, CodexTab } from '../ui/CodexPanel';
import { HomePanel } from '../ui/HomePanel';
import { LevelSelectPanel } from '../ui/LevelSelectPanel';
import { CircleGameManager, CircleHost } from './CircleGameManager';

const { ccclass } = _decorator;

type Screen = 'home' | 'codex' | 'levels' | 'game';

/** 各屏面板的统一形状：路由只依赖命中测试，节点清理由所在容器层负责 */
interface ScreenPanel {
    handleTap(x: number, y: number): boolean;
}

@ccclass('ModeShell')
export class ModeShell extends Component implements CircleHost {
    private screen: Screen = 'home';
    private panel: ScreenPanel | null = null;
    private layer: Node | null = null;

    onLoad(): void {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        this.showHome();
    }

    onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    // ---------- CircleHost：战斗主控回调 ----------

    exitToHome(): void {
        this.showHome();
    }

    startLevel(levelId: number): void {
        this.showGame(levelId);
    }

    // ---------- 输入 ----------

    private onTouchStart(event: EventTouch): void {
        // 战斗中由主控自己分发输入，这里不重复处理
        if (this.screen === 'game' || !this.panel) {
            return;
        }
        const ui = event.getUILocation();
        const visible = view.getVisibleSize();
        this.panel.handleTap(ui.x - visible.width / 2, ui.y - visible.height / 2);
    }

    // ---------- 切屏 ----------

    private showHome(): void {
        const layer = this.reset('HomeLayer', 'home');
        this.panel = new HomePanel(layer, {
            onStart: () => this.showLevels(),
            onCodex: (tab) => this.showCodex(tab),
        });
    }

    private showCodex(tab: CodexTab): void {
        const layer = this.reset('CodexLayer', 'codex');
        this.panel = new CodexPanel(layer, tab, () => this.showHome());
    }

    private showLevels(): void {
        const layer = this.reset('LevelLayer', 'levels');
        this.panel = new LevelSelectPanel(layer, (levelId) => this.showGame(levelId), () => this.showHome());
    }

    private showGame(levelId: number): void {
        const layer = this.reset('GameLayer', 'game');
        // addComponent 会立刻触发 onLoad，关卡序号与回调只能通过静态字段传入
        CircleGameManager.pendingLaunch = { levelId, host: this };
        layer.addComponent(CircleGameManager);
    }

    /** 销毁上一屏的整块节点树（含主控组件）并开一层新容器，返回新容器 */
    private reset(name: string, screen: Screen): Node {
        this.panel = null;
        if (this.layer) {
            this.layer.destroy();
            this.layer = null;
        }
        this.screen = screen;
        const layer = createUiNode(name, this.node);
        this.layer = layer;
        return layer;
    }
}