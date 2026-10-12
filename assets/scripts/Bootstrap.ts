/**
 * 启动入口。
 *
 * 为什么不做成「场景里挂组件」：
 * 场景文件手写 Script 组件需要写入脚本的压缩 uuid，一旦 uuid 推导有偏差就会整场景反序列化失败。
 * 因此这里改为「脚本被加载时自动挂载」——Cocos 启动时会执行 assets 下所有脚本，
 * 此时注册 EVENT_AFTER_SCENE_LAUNCH，等首个场景启动完成后自行找到 Canvas 并引导游戏。
 * 场景因此可以退化为最普通的 Canvas + Camera，零风险。
 *
 * 仍然保留 Bootstrap 组件：如果希望在编辑器里显式挂载 / 控制启动时机，
 * 把该组件拖到 Canvas 节点上即可（重复启动由 booted 标志兜住）。
 *
 * 【重要】编辑器场景进程也会加载并执行项目脚本，且它自己会启动一个「空场景」。
 * 必须把启动挡在「仅在编辑器、且不在预览」的场景下，否则会出现两个问题：
 * 1. 编辑器启动时误报「未找到 Canvas 节点」；
 * 2. 打开 Main.scene 时把 GameRoot / GameManager 建进被编辑的场景里，污染工程。
 *
 * 注意这里用的是 EDITOR_NOT_IN_PREVIEW 而不是 EDITOR：
 * 引擎源码中 EDITOR 的判定是「存在 Editor 全局且运行在 Electron 里」，
 * 编辑器自带的预览窗口同样满足该条件（EDITOR 为 true、isPreviewProcess 为 true），
 * 用 EDITOR 会把编辑器预览里的游戏一起挡死。EDITOR_NOT_IN_PREVIEW 的定义是
 * 「EDITOR && !isPreviewProcess」，才是「仅编辑器场景进程」的准确判据。
 */
import { _decorator, Canvas, Component, Director, Node, ResolutionPolicy, UITransform, director, view } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from './config/GameConfig';
import { createUiNode } from './core/GraphicsUtil';
import { ModeShell } from './systems/ModeShell';

const { ccclass } = _decorator;

@ccclass('Bootstrap')
export class Bootstrap extends Component {
    onLoad(): void {
        boot(this.node);
    }
}

/** 全进程只启动一次 */
let booted = false;

/** 广度优先找到带 Canvas 组件的节点 */
function findCanvas(root: Node): Node | null {
    const queue: Node[] = [root];
    while (queue.length > 0) {
        const node = queue.shift() as Node;
        if (node.getComponent(Canvas)) {
            return node;
        }
        for (const child of node.children) {
            queue.push(child);
        }
    }
    return null;
}

/**
 * 应用竖屏设计分辨率。
 * SHOW_ALL：设计区域完整可见，剩余空间留黑边，保证任何机型都不会裁掉 HUD 或战场。
 */
function applyDesignResolution(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.SHOW_ALL);
}

/**
 * 引导游戏：找到 Canvas -> 设定分辨率 -> 建一个位于屏幕中心的根节点 -> 挂上 GameManager。
 * 所有游戏对象都在 GameManager 里由代码创建。
 */
export function boot(root: Node): void {
    // 只在「编辑器场景进程」里拦截；编辑器预览与浏览器预览都要正常启动游戏
    if (EDITOR_NOT_IN_PREVIEW) {
        return;
    }
    if (booted) {
        return;
    }
    const canvas = findCanvas(root);
    if (!canvas) {
        console.warn('[SDMini] 未找到 Canvas 节点，无法启动');
        return;
    }
    booted = true;
    applyDesignResolution();

    // GameRoot 位于 Canvas 锚点（即屏幕中心），因此子节点的局部坐标就是以屏幕中心为原点的坐标
    const gameRoot = createUiNode('GameRoot', canvas);
    gameRoot.addComponent(UITransform);
    // 先挂路由组件：由玩家在玩法选择面板里决定走哪种模式
    gameRoot.addComponent(ModeShell);
}

// 兜底启动一：脚本执行时场景若已启动（理论上不会，但取决于引擎启动顺序），立刻引导
const currentScene = director.getScene();
if (currentScene) {
    boot(currentScene);
}

// 兜底启动二：场景即便没有挂载任何脚本组件，游戏也能跑起来
director.on(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
    if (booted) {
        return;
    }
    const scene = director.getScene();
    if (scene) {
        boot(scene);
    }
});