# AGENTS.md · SDMini 开发须知

给 AI 助手（Trae）在新机器上接手本项目时必须先读的上下文。人类开发者可直接看
[README.md](README.md)（构建发布、玩法说明）。

---

## 1. 项目是什么

- **Cocos Creator 3.8.8 + TypeScript** 的简易塔防小游戏，目标平台微信小游戏，竖屏 720×1280。
- **零美术资源**：所有图形用 `cc.Graphics` 程序化绘制，所有文字用系统字体 `Label`。
  不引入任何图片 / 图集 / 字体 / 动画文件，也不要新增 PNG 之类的资源。
- 无第三方 npm 依赖（`node_modules` 为空，`package.json` 里没有 `dependencies`）。

## 2. 常见命令

```powershell
# 类型校验（唯一可用的离线校验手段，目标 exit=0）
npx --yes -p typescript@5.4.5 tsc -p tsconfig.json; echo "exit=$LASTEXITCODE"
```

- `tsconfig.json` 继承 `temp/tsconfig.cocos.json`，**该文件由编辑器打开工程时生成**；
  若报找不到该文件，先在 Cocos Creator 里打开一次工程。
- `tsconfig.json` 里 `strict: false`，且未启用 `noUnusedLocals`——未使用变量不会报错。
- 该命令偶发 OOM（堆太小），重跑一次即可，**不要因此怀疑代码有错**。
- 不做单元测试、没有测试框架；验证方式是 tsc + 浏览器预览。

浏览器预览地址（端口/场景 id 以编辑器实际输出为准）：

```
http://localhost:7456/?scene=678b40bc-9426-4c5c-a5ba-932f32af36fa
```

**工作流约定：改完代码不要重启开发环境，用户会自己启动/重启应用验证。**

## 3. 绝对不可违反的硬约束

1. **必须提交 `assets/` 与 `settings/` 下的 `*.meta` 文件**。它们保存资源 uuid，丢失会导致
   场景与脚本引用全部失效。同理**不得忽略 `settings/`、`build-templates/`、`extensions/`**。
2. 编辑器环境拦截必须用 **`EDITOR_NOT_IN_PREVIEW`**（`cc/env`），**不能用 `EDITOR`**。
   `EDITOR` 在编辑器自带预览窗口里同样为 true，会把预览里的游戏一起挡死。见
   [Bootstrap.ts](assets/scripts/Bootstrap.ts)。
3. **不要覆盖 [LevelConfig.ts](assets/scripts/config/LevelConfig.ts)**（经典模式的关卡数据）。
   历史上曾把它误当新建文件覆盖。新增关卡配置要另建文件（如 `CircleLevelConfig.ts`）。
4. 经典固定路径模式（`GameManager` / `Tower` / `Enemy` / `WaveSystem` /
   `LevelConfig` / `BuildMenu` / `Hud`）目前**入口已隐藏但代码保留**，
   改动圆形模式时不要影响它。
5. 战斗区必须用**矩形遮罩**隐藏溢出内容（敌人/子弹/特效），HUD 与技能条必须放在遮罩之外，
   否则会被裁掉。

## 4. 当前游戏形态

- 首页（`HomePanel`）隐藏了经典模式，只保留两个入口：**技能宝典**、**敌人卡片**。
- 路由 `ModeShell` 是四屏：**首页 → 图鉴 → 关卡选择 → 战斗**，主玩法是
  「圆形中心防守模式」（`CircleGameManager`）。
- 共 **10 个关卡**（`CircleLevelConfig`），星数规则：满血通关 3 星、核心剩余 > 60% 2 星、其余 1 星。
- 单关 12 波；波间准备 3 秒、首波 6 秒（`CircleWaveSystem`）。
- 6 种敌人（`EnemyConfig`）：圆形兵 / 三角疾行 / 方阵重甲 / 五角堡垒 / 符文卫兵 / 六角投手（远程）。
- 升级卡 12 种（`CircleConfig.CARD_DEFS`）：异向弹道、同向齐射、子弹反弹、攻速、攻击力量、
  攻击范围、能量护盾、恢复血量 + 4 个自动技能（范围爆破 / 冰霜减速 / 雷达眩晕 / 风向击退）。
- 升级卡面板 **10 秒后自动随机选一张**（`UpgradeCards`）。

## 5. 坐标与缩放口径（最容易搞错的地方）

- 设计分辨率 720×1280，Canvas 以**中心为原点**：`x ∈ [-360, 360]`、`y ∈ [-640, 640]`
  （`HALF_W = 360`、`HALF_H = 640`）。
- **整块战场挂在 `World` 容器下，整体缩放到 `CAMERA_ZOOM`（= 0.5）**，
  这就是「镜头抬高」的唯一开关（`GameConfig.CAMERA_ZOOM`）。
  `WORLD = 1 / CAMERA_ZOOM = 2`。
- **约定：战场内的常量一律按「设计像素」书写，末尾乘 `WORLD` 换算成世界单位。**
  这样屏幕上看到的大小就等于常量数值本身（`绘制值 × WORLD × CAMERA_ZOOM = 绘制值`）。
- **敌人 `radius` 是唯一例外**：`EnemyConfig.radius` 被**直接当世界单位使用**（没有乘 `WORLD`），
  所以屏幕上敌人的直径 ≈ 配置的 `radius` 数值（`radius × 2 × 0.5`）。
  改敌人尺寸时不要给它补 `WORLD`。
- 输入不走引擎 UI 事件：`input.on(Input.EventType.TOUCH_START)` 手工命中测试。
  **HUD / 升级卡 / 结算面板在未缩放的 UI 层，必须用屏幕像素坐标**；战场内元素用世界单位。

## 6. 绘制规范（`core/GraphicsUtil.ts`）

- `createUiNode(name, parent, x?, y?)` **不会自动加 `UITransform`**；需要遮罩/尺寸的节点要手工
  `node.addComponent(UITransform)`。
- `drawRect / drawCircle / drawPolygon` 的填充/描边形参是**不带 alpha 的十六进制色**（alpha 固定 255）。
- 需要半透明时必须先设
  `g.fillColor = colorOf(hex, alpha)` / `g.strokeColor = colorOf(hex, alpha)`。
- 常用的：`addGraphics`、`colorOf`、`drawRect`、`drawCircle`、`drawLine`、`drawPolygon`、
  `createLabel`、`rectContains`、`makeRect`。
- 特效统一走 `FxSystem`（对象池 + `UIOpacity` 淡出），不要各自新建临时节点。

## 7. 视觉参数速查

| 对象 | 参数 | 位置 |
|---|---|---|
| 镜头远近 | `CAMERA_ZOOM = 0.5`、`WORLD = 2` | `GameConfig.ts` |
| 战场范围 / 出生圆 | `ARENA_RADIUS = 680 * WORLD`（下限 645px，低于会露边） | `CircleConfig.ts` |
| 核心危险区（红圈） | `CORE_HIT_RADIUS = 20 * WORLD` | `CircleConfig.ts` |
| 可玩区（= 遮罩矩形） | `PLAY_AREA_TOP = 505 * WORLD`、`PLAY_AREA_BOTTOM = -425 * WORLD` | `CircleConfig.ts` |
| 攻击区比例 | `ATTACK_SCALE = 0.8`（外围 20% 无伤走廊） | `CircleConfig.ts` |
| 炮塔四圈半径 | 底座 21 / 光环 25 / 炮口 26 / 护盾 31（屏幕 px） | `BaseTurret.ts` |
| 敌人霓虹光晕 | `NEON_HALO_STEPS / SPREAD / ALPHA` | `CircleEnemy.ts` |
| 敌人玻璃裂纹 | `MAX_CRACKS / CRACK_START_RATIO / CRACK_SEGS` | `CircleEnemy.ts` |
| 破碎碎片 | `SHARD_PIECES / SHARD_SIZE_MIN / SHARD_SIZE_RANGE / SHARD_ANGLE_JITTER` | `FxSystem.ts` |
| 屏幕边缘红闪 | `EDGE_FLASH_ALPHA / EDGE_FLASH_TTL` | `CircleGameManager.ts` |
| 打击感：击中火星 | `sparks()`、`SPARK_TTL = 0.26` | `FxSystem.ts` |
| 打击感：玻璃破碎 | `shatter()`、`SHARD_TTL` | `FxSystem.ts` |

打击感实现要点：

- 子弹单体命中 → `BulletSystem` 调 `fx.sparks(x, y, bullet.headingDeg)`，火星**顺着弹道方向**溅开。
- 敌人死亡 → `CircleGameManager.handleKilled()`：先 `fx.explosion()`（本色扩散波纹），
  再 `fx.shatter(..., 0xffffff)`（白色玻璃碎片，半径取 `hitRadius * 0.8`）。
- 敌人血量比例低于 `CRACK_START_RATIO` 开始出现裂纹，越低越多越亮（两遍描边：深色断口 + 亮线）。
- 敌人撞核心 → `handleReachedCore()`：`turret.flashCore()`（炮塔外沿红晕）+ `flashScreenEdge()`（屏幕四周红闪）。
- 护盾被打空 → `damageCore()` 里 `fx.shatter(..., turret.shieldRadius * 0.5, SHIELD_COLOR)`；
  护盾环本身按损失比例画裂纹（`BaseTurret.drawShieldCracks()`）。

## 8. 数值口径（改之前先看注释）

- 单关 12 波约 168 只怪，全清约 652 经验 → 满击杀 Lv16。改 `XP_BASE / XP_GROWTH / XP_PER_HP`
  后**必须复核可达等级**，超过所有卡片可叠加次数之和（约 65，技能类受 `MAX_AUTO_SKILLS = 3` 限制）
  会出现「升级了却无卡可选」。
- 「异向弹道」前 4 次扩充每次攻击力 −10%（累减，最多 −40%），见
  `projectileDamageMul()`；代价只落在伤害上，不影响攻速。
- 击退必须是**平滑过渡**（`PUSH_DECAY` 指数衰减），不得瞬间位移。

## 9. 目录与关键文件

```
assets/scripts/
├─ Bootstrap.ts              # 启动入口（自动挂载 + 兜底，含编辑器拦截）
├─ config/                   # 数据层
│   ├─ GameConfig.ts         # 全局常量与配色（含 CAMERA_ZOOM/WORLD）
│   ├─ CircleConfig.ts       # 圆形模式数值（战场几何/炮塔/经验/卡片/技能）
│   ├─ CircleLevelConfig.ts  # 10 关难度曲线
│   ├─ EnemyConfig.ts        # 6 种敌人数值
│   ├─ LevelConfig.ts        # ⚠️ 经典模式关卡数据，不要覆盖
│   └─ TowerConfig.ts        # 经典模式塔数值
├─ core/                     # 基础设施：EventBus / ObjectPool / GraphicsUtil / Grid
├─ entities/                 # CircleEnemy / BaseTurret / Bullet / Enemy / Tower / CombatTarget
├─ systems/                  # ModeShell(路由) / CircleGameManager(圆形主控) / GameManager(经典)
│   │                        # CircleWaveSystem / CircleEnemySystem / BulletSystem /
│   │                        # SkillSystem / UpgradeSystem / FxSystem / WaveSystem ...
├─ ui/                       # HomePanel / CodexPanel / LevelSelectPanel / CircleHud /
│                            # SkillBar / UpgradeCards / ResultPanel / Hud / BuildMenu
└─ platform/Platform.ts      # 存档（SAVE_KEY = 'sdmini.save.v1'）、震动
```

新增文件后**记得让编辑器生成并提交对应的 `.meta`**，否则另一台机器拉下来引用会失效。

## 10. 沟通约定

- 全程使用**简体中文**（对话、代码注释、界面文案都是中文）。
- 用户会明确给出像素数值（如「直径 42px」），按屏幕像素口径换算成 `数值 * WORLD` 写入常量。
- 用户会自己在编辑器里预览验证，不要反复要求用户提供截图或代跑环境。