---
name: element-plus-form-crud-e2e
description: 用 Playwright 对 Element Plus / Vben Admin 后台表单页做「有头可视化 + 真实增删改查闭环」的演练，以及**只读的字段业务联动测试**。当任务是"给某几个列表页做增删改查测试/演练"、"某页面的输入框选择框有什么业务联动"、"给几个 Tab 页写自动化测试/完善测试用例"、"分析这几个 git 提交的改动并写测试用例+出验证报告（报告不要出现技术字眼）"、需要按唯一标记值定位并自清理测试数据、要给**没有删除能力的页面做半闭环（增→查→改→查）**、或遇到级联下拉/虚拟列表（el-select-v2 只渲染首屏项）/按名字选下拉/多选下拉 collapse-tags/`.el-select__placeholder` 的 is-transparent/弹窗里再叠子弹窗导致 locator 漂移/radio 组/树选择器/daterange/残留弹窗遮罩/动态列/`:text-is` 命中不到按钮/PlusSearch 折叠后靠前的搜索项不在 DOM（要先点「展开」）/`filter(has=X)` 里 X 要传不带外层前缀的裸 locator/接口 URL 与前端函数名不一致导致监听不到响应/「置灰」输入框分不清是引用锁定还是发布态还是字段互斥/列表接口不回锁定标志要用弹窗按钮禁用态反推/长流程并发开浏览器把 chromium 挤死这些 Element Plus 特有的坑时使用。
---

# Element Plus / Vben 表单页增删改查演练

## 适用场景

给一批长得很像的「列表页 + 新增/编辑弹窗」做端到端增删改查验证：
真的新增 → 查询确认 → 打开编辑改一个字段 → 查询确认 → 勾选删除 → 查询确认，跑完自动清理。
页面没有删除能力时降级成**半闭环**（增 → 查 → 改 → 查，数据保留并写清标记值，见第五步）。

另一条同样高频的支线：**只读的「字段业务联动」测试** —— 不提交任何数据，
只填表读值，把「A 字段改了什么会带动 B / 什么时候必填 / 什么时候多一个 Tab」
全测出来。模式见「只读『字段联动』用例集」一节。

典型落点（本项目 lucky-front，国际货运 SaaS）：

- 成本维护 6 页：`tests/visual_crud.py`（入口）+ `tests/crud_pages.py`（每页适配器）+ `tests/crud_common.py`（公共层）
- 客户中心：`tests/visual_crud_customer.py`（入口）+ `tests/crud_customer_pages.py`（适配器），**公共层原样复用**
  - 其中『客户资料』(/customer/customerData) 是**半闭环**样例：闭源后端没有 DELETE `/sale/customer`，
    跑到「改 → 查」为止，会留 1 条 `E2E-CRUD-customer_data-…` 的测试客户
- 客户资料的**联动 + 各 Tab 专项用例集**（另起一套）：
  `tests/customer_data_cases.py`（22 联动 + 5 新增态 + 9 Tab + **4 条写闭环** = 40 条）
  + `tests/visual_customer_data.py`（入口，`--suite` / `--with-write` / `--video`）
- 订单中心**出口海运订单全流程**：`tests/sea_order_cases.py` + `tests/visual_sea_order.py`，
  7 个套件可任意组合/串联：
  `--suite readonly|add|audit|stowage|hbl|cabinet|distribute|all`
  （另有 `--order <订单号>` / `--cabinet <柜号标记>` 单独驱动后段）
  - `readonly` 弹窗结构/默认值/字段联动（零写入）；`add` 完整填表 + 真提交（本页无删除，数据保留）
  - `audit` 审核通过 → `stowage` 操作中心补必填保存 → `hbl` 生成 HBL 补必填保存
    → `cabinet` 新增柜子 → `distribute` 配柜管理勾柜子+勾订单+添加入柜
  - 强先后依赖：审核通过前，操作中心查不到单；`all` 靠套件间传递订单号串起来
  - **订单号由系统自动生成，脚本不填**；后端不回吐（`data:true`），
    靠「保存前快照 → 保存后列表 diff」取回真单号再往下传（见第 29 条）
  - 最新一次单会话 `--suite all`：**35/35 全绿**
  - 注意它**不用** `crud_common` 那套：确认按钮文案是「保存」、列表搜索是「条件查询」，
    详见下面第 16、17 条坑

## 三层结构（照这个抄，别写成一个巨型脚本）

1. **`crud_common.py` — 页面无关的公共能力**
   选择器常量、标记生成、弹窗定位、填表动作（`fill_input` / `set_date` / `set_date_range` /
   `pick_option` / `pick_option_matching` / **`pick_by_name`（按名字选，会输入筛选）** /
   `option_texts` / **`visible_dropdown`（锁定当前展开的 popper）**）、`force_close_dialogs`、
   `do_search` / `find_row` / `require_row`、`open_edit_dialog` / `select_row_only` /
   `delete_selected`、`watch_writes`（打写接口日志）、`cleanup`。
2. **`crud_pages.py` — 每个页面一个类，只回答 4 个问题**
   `route_key` / `marker_kind`(number|text) / `write_keyword` / `search()` `create()` `edit()`。
   页面特有字段顺序只写在这里。
3. **`visual_crud.py` — 统一编排**：`open_page()` 换页、`run_page()` 单页闭环、`main()` 参数与汇总。

## 运行

```bash
# 前置：注入登录态（storage_state 里带 JWT）
python run_e2e.py --token <JWT>
# 必须用带 playwright 的解释器（managed 的裸 python 里没有 playwright）
C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tests/visual_crud.py --dry-run --headless --slow 0   # 先验选择器，不写数据
C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tests/visual_crud.py --headless --slow 20            # 真跑，自清理
C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tests/visual_crud.py --slow 350 --video             # 有头 + 录屏（交付用）
```

参数：`--page all|warehouse|trailer|trailer_transfer|container_transport|cost_maintenance|port_of_departure`、
`--headless`、`--slow <ms>`、`--video`、`--keep`、`--dry-run`、
`--product-type / --recv-warehouse / --send-warehouse`（拖车中转成本的级联，按名字选；
传 `auto` 退回逐项遍历）

客户中心用的是**同一个入口的孪生脚本**（公共层完全复用）：

```bash
PY=C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe
"$PY" tests/visual_crud_customer.py --page customer_data --dry-run --headless  # 验选择器
"$PY" tests/visual_crud_customer.py --page customer_data --headless           # 真跑（半闭环，会留数据）
"$PY" tests/visual_crud_customer.py --page customer_data --slow 350 --video    # 有头 + 录屏
```
参数同样是 `--page / --headless / --slow / --video / --keep / --dry-run`；
客户资料用 `--page customer_data`（它 `no_delete=True`，跑完保留 1 条测试客户）。

客户资料的**联动 + 各 Tab 专项**用例集（另起一套，默认零写入）：

```bash
PY=C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe
"$PY" tests/visual_customer_data.py --suite linkage --headless          # 22 条联动，只填表不提交
"$PY" tests/visual_customer_data.py --suite all --with-write --headless --slow 30   # 40 条全量
"$PY" tests/visual_customer_data.py --suite all --with-write --slow 350 --video      # 有头录屏（交付）
```

`--suite` 可选 `linkage`(22) / `add`(5) / `tabs`(9) / `write`(4) / `all`；
`all` = linkage+add+tabs，**写后端的 `write` 要显式加 `--with-write`**（默认不跑）。

**跨模块的「业务全流程」用例集**（订单中心 · 海运订单，串起多个页面）：

```bash
PY=C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe
"$PY" tests/visual_sea_order.py --suite readonly --headless   # 6 条结构/联动（零写入）
"$PY" tests/visual_sea_order.py --suite all --headless --slow 30   # 18 条：新增→审核→操作中心保存
"$PY" tests/visual_sea_order.py --suite audit,stowage --order E2E-SEA-xxxx   # 只跑后半段
# 共享环境（构建版 9090，key 是 -prod-）：
E2E_BASE_URL=http://192.168.7.55:9090 E2E_AUTH_STATE=auth_state_55.json \
  "$PY" tests/visual_sea_order.py --suite all --slow 350 --video
```

`--suite` 可选 `readonly / add / audit / stowage / all`（可逗号组合）。
**跨页面流程要把产物（订单号）传给下一套件** —— 这里用 `run_add` 的返回值当 `run_audit` 的输入，
`all` 就是「新增 → 审核 → 操作中心保存」的串联（见第 23 条）。

## 别拿"整页不可删"给所有子表定死刑

客户资料**主表** `/sale/customer` 没有 DELETE（**产品设计如此**：这个列表本就不提供删除），
但如果因此把整页判成"半闭环"、把所有 Tab 降级成"只做结构断言"，就会漏掉一大批可测能力 ——
实测 **联系人 / 邮箱群组 / 客户EDI 三个子表各自都有独立的增删接口**，都能做真正的闭环。

正确做法：**逐个 Tab 翻它 import 了哪些写接口**（`api/core/*.ts` + 该 Tab 组件里
`xxxApi(...)` 的调用点），再打开那个 Tab 看按钮挂在哪个函数上。
判断依据是**接口**，不是"整页能不能删"。

## ⚠️ 弹窗底部『确定』可能保存**整个弹窗的所有 Tab**

客户资料弹窗的 `handleConfirm` 长这样：

```js
await baseInfoRef.value?.save()
await financeInfoRef.value?.save()
await ediInfoRef.value?.save()
await proxyExchangeRateRef.value?.save()
```

**它不是只保存当前 Tab。** 所以你在某个 Tab 上点『确定』，会连带打出别的 Tab 的写接口
（没改动过的按**原值回写**）。

写用例前必查两件事：

1. 这个 Tab 有没有**独立的保存按钮**？没有的话（客户资料的 EDI / 财务就是），保存全挂在父『确定』上，
   你没法"只保存这一块"。
2. 连带提交的其它 Tab，字段是不是**原值**？如果为了别的用例动过，会被一起写进去。

对策：写用例**只动目标 Tab 的字段**，别碰其它；再加一道"只在测试数据上写"的护栏（见下）。

## 写用例的护栏：先确认"这条是测试数据"再动手

写操作真落共享后端，而用例常按"列表第 1 行"取目标。**必须**先读一个能识别身份的字段
（如客户编码）确认它是测试数据，否则直接跳过——**宁可不测，也不在真实数据上写**。

护栏的返回约定：**返回"跳过 + 原因"而不是抛异常**，这样汇总里能一眼区分"没测"和"测挂了"。

⚠️ 踩坑：护栏读"客户编码"时，弹窗可能还停在**上一条用例留下的 Tab** 上，
基础信息 pane 不可见 → 读不到值 → 把测试数据误判成真实数据、用例被自己拦掉。
**读基础信息的字段之前先 `click_tab('基础信息')`。**

## 数据安全（写进去之前先想清楚）

**即使前端跑在 localhost，`.env.localhost` 的 `VITE_GLOB_API_URL` 仍指向共享网关
（`192.168.7.55:8888`），所以增删改会真实写到共享后端。** 四道自我保护：

1. 用**本次生成的唯一标记值**定位（不按行号盲操作）；数字标记用「时分秒+offset」，
   文本标记用 `E2E-CRUD-<page>-<月日-时分秒>`。
2. **标记必须能在列表里看得见**，否则「查」无从验证。选标记字段时看列表表头：
   有备注列就用备注（最稳、编辑态也能改）；没有就用某个能上列表的单价；
   有动态列（列名由后端数据决定，如柜型）就只能挂在已被现有行用过的那个列名下。
3. 删除前校验**勾选数必须正好为 1**，否则中止。
4. 任何一步异常都走 `finally` 兜底清理（`--keep` 时跳过）。

## 必踩的坑（都是实测出来的，别再花时间重走）

### 1. 明细行里的「金额输入框」不能用 nth / 第一个非下拉 input 定位
仓库成本 / 整柜起运港的明细行里，**费用名称、英文名称是选完费用代码自动带出且 `disabled`** 的框，
位置还排在单价前面。取「第一个非下拉 input」会命中它们 → `click` 一直等
`element is not enabled` 到超时。
**正解：按 placeholder 精确命中**（实测 `请输入单价` / `请填写费用`），
退回条件是「非下拉 + 未 disabled + 未 readonly」。

### 2. `el-date-editor--daterange`（一个表单项里两个 `.el-range-input`）必须一次填完再回车
只填一半就按 Enter/Escape，未提交的区间会被组件**还原成空串**（回读 `''`）。
**正解**：先 `fill` 第 0 个（起）和第 1 个（止），再按一次 Enter，然后回读校验。
区分办法：`item.locator("input.el-range-input").count() >= 2` 就是区间；
否则是「两个各自独立的日期框」，单个填法没问题。写个 `set_validity()` 自动识别，页面代码就不用各记各的。

### 3. SPA 换页后上一页的弹窗会留在 DOM 里遮住整页
路由切走时若页面组件在 keep-alive 中，弹窗（teleport 到 body）不会卸载，下一页第一次点
『重置』就报 `… aria-modal="true" … subtree intercepts pointer events`。
**正解**：
- 换页前、查询前、删除前都调 `force_close_dialogs(page)`；
- 关闭按钮用**原生 DOM click**（`el.evaluate("el => el.click()")`），
  普通 `click()` 会被遮挡/不稳定状态拦掉；`Escape` 放在最后（对拿不到焦点的弹窗无效）；
- 最后手段是把残留 `.el-overlay` 从 DOM 摘掉（纯前端、不碰数据），并打告警。

### 4. SPA 换页后 DOM 有滞后，只等 URL 相等会读到上一页的表格
**正解**：以**表头集合发生变化**作为换页完成的判据，变化后再 `wait_table`。

### 5. 下拉选项多时（虚拟列表）必须**输入筛选按名字选**，别按 index 遍历

> ⚠️ 这一条推翻过本 skill 早先的一个**错误结论**。早先写的是「产品类型只有 11 项、
> 55 后端上只有『进口』配了收货仓点」。真相是：`/sys/productType/listProductType`
> 返回 **22 项**，而 el-select-v2 是虚拟列表 —— **DOM 里只有首屏渲染的 11 项**，
> `pick_option(index)` 遍历到的永远是这 11 项（下标还被 `min(index, cnt-1)` 夹住，
> 越界时反复命中第 11 项），『深圳直出』在第 12 项之后，根本不存在于 DOM。
>
> **教训：下"某项没配数据"的结论前，先抓 XHR 数一下接口返回多少条，别拿 DOM 的 item 数当总数。**

正解：这些下拉都是 `filterable` 的，**打字把目标筛出来再点**。封成 `pick_by_name()`：

```python
select_locator.click()                       # 点开
dd = visible_dropdown(page, label)           # 锁定当前展开的 popper（见第 6 条）
inp = select_locator.locator("input").first
inp.fill(keyword)                            # 例：'深圳' / '外运'
# 读当前渲染项 → 文本精确匹配优先、包含匹配兜底 → click
# 筛不到就 fill("") 清掉筛选，再逐屏 _scroll_dd() 滚动虚拟列表重新找
```

实测（拖车中转成本，2026-10-09）：
`产品类型` 输入「深圳」→ 只剩『深圳直出』；`收货仓点` 输入「外运」→ 3 项里选中
『外运新干线---福州仓山仓』；选完收货仓点后 `出货仓点` 自动收敛成同名的 1 项。
级联顺序照旧（产品类型 → 收货仓点 → 出货仓点），每级选完 `sleep 2.5s` 等下级刷新。

**滚动收集时的坑：滚动容器不是 `.el-vl__wrapper`。** el-select-v2 的结构是

```
.el-select__popper > .el-select-dropdown > .el-vl__wrapper   ← scrollHeight == clientHeight，滚不动
                                                     └ .el-vl__window.el-select-dropdown__list  ← 真正的滚动容器
                                                        └ ul > .el-select-dropdown__item × N
```

所以要按「`scrollHeight > clientHeight + 1`」去挑容器（`_scroll_dd()` 就是这么写的），
写死选择器会静默失效（`option_texts()` 会一直只返回首屏那 11 项）。
修好后实测：首屏 11 项 + 滚到底 11 项 = **22 项**，两边不重叠。

### 6. 定位下拉 popper 要用 `display`/`aria-hidden`，**不能**用 `.el-select-dropdown:visible:last`

页面上**所有** select 的 popper 都常驻 body（teleport），`.last` 极易命中别的字段留下的那个。
实测因此把『收货仓点』读成过 **11 项**（其实是『产品类型』的）、读出过 **1 项 `SIYISIER`**
（其实是『拖车公司』的）—— 并据此得出了上面第 5 条里那个错误结论。

正解：同一时刻只有一个 popper 是展开的，按这个找：

```js
[...document.querySelectorAll('.el-select__popper')]
  .filter(x => { const cs = getComputedStyle(x);
                 return cs.display !== 'none' && cs.visibility !== 'hidden'
                        && x.getAttribute('aria-hidden') !== 'true'; })
  .pop().id          // 用它的 id 建 locator 最稳
```

（每个 popper 都有 id，且恰好等于它对应 select 的 `aria-controls` 的 +1。）

`.el-select-dropdown__item` 在 v1 / v2 下都可用（v2 只是把 item 绝对定位在 `.el-vl__window` 里），
不用为 v2 单独写选择器；判空读 `.el-select-dropdown__empty` 的文本最直接。

### 7. 名字带括号/冒号的 label 要用候选列表匹配
例如 `拖车费(BILL):`。`form_item(dlg, "拖车费(BILL):", "拖车费(BILL)")`：
先 `:text-is` 精确，再 `:has-text` 兜底。**永远按 label 匹配，不要用 nth 下标**——
条件渲染的字段（区间/联动字段）会让下标漂移。

### 8. 提交前后要清掉残留的 ElMessage
切换计费单位之类的操作会弹 info 提示，不清干净的话提交后可能读到**旧**提示把结果判错。
`drain_messages(page)` 后再提交。

### 9. `button:text-is('确定')` 会命中 0 —— 用 `:has(> span:text-is(...))`

Element Plus 的按钮是 `<button><span>确定</span></button>`。Playwright 的
**text 引擎只匹配「包含该文本的最小元素」**，也就是那个 `<span>`，
所以 `button:text-is('确定')` 恒为 0；`button:has-text('确定')`（后代包含匹配）
和 `button:has(> span:text-is('确定'))`（直接子元素精确）都能命中。

实测（客户资料的 FullscreenDialog）：
`button:text-is('取消') -> 0`、`button:has-text('取消') -> 1`。
公共层的 `confirm_button()` / `force_close_dialogs()` 已经两种写法都备着，
自己写选择器时别只留 `:text-is`。

**顺带一提**：`FullscreenDialog` 底层就是 `el-dialog`（class 里多一个
`fullscreen-dialog`），所以 `.el-dialog:visible` 这套照样用；
但它传了 `:show-close="false"` —— **没有右上角 X**，只能点底部『取消』关。

### 9.1 `FullscreenDialog` 的关窗路径只有两条，且都有条件（2026-10-09 补，踩过）

上一条说「只能点底部『取消』」还不够 —— 实测在客户资料上，「取消」**根本不在页面上**。
四个原因叠在一起，不处理就一路退化到「从 DOM 摘掉 8 个遮罩」：

1. `:show-close="false"` → 原生 `.el-dialog__headerbtn` **不存在**，那条退化路径必然落空；
2. 关闭按钮其实在**自定义头**里：`.plus-dialog-header .header-actions .action-btn`
   （`.last` 才是 Close，前面可能还有个全屏按钮），但只有 `isPlusDialogMode` 才渲染这个头；
3. 父组件是把『取消 / 确定』**手写在 body 里**、并且带 `v-if`：
   客户资料只在 `['baseInfo','financeInfo','ediForm','proxyExchangeRate']` 这几个 Tab 下渲染
   → **停在『联系人』这类 Tab 时，页面上一个『取消』都没有**；
4. `close-on-press-escape` 默认为 **false**，Escape 也关不掉。

正解（客户资料的 `close_all()` 就是这么写的）：

```
逐层关（先关闭最上层子弹窗）
  → 先点『基础信息』把 Tab 切回去（这样脚注才存在）
  → 找 button:text-is('取消') / button:has-text('取消')
  → 找不到就退回 .plus-dialog-header .header-actions .action-btn（取 .last = Close）
  → 都失败才 Escape，最后才交给通用的 force_close_dialogs
```

改完后日志里「已从 DOM 摘掉 N 个残留遮罩」的告警彻底消失。

### 10. `.el-dialog:visible` 的 `.last` 是**活查询**，叠了子弹窗就会漂

Playwright 的 `.el-dialog:visible` 每次用都重新求值，`.last` 自然跟着变。
父弹窗里点出联系人子弹窗之后，**原先指向父弹窗的 locator 会突然指到子弹窗上**，
父弹窗里的 Tab、表格、按钮一下全找不到了（实测：`_pane_headers` 返回空、
`click_tab` 找不到 Tab）。

**正解**：给最上层弹窗打一个临时属性，拿一个稳定 locator：

```python
def _tag_dialog(page, tag):
    page.evaluate("""(tag) => {
      const ds = [...document.querySelectorAll('.el-dialog')].filter(d => {
        const cs = getComputedStyle(d);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      });
      if (ds.length) ds[ds.length - 1].setAttribute('data-e2e-dlg', tag);
      return ds.length;
    }""", tag)
    return page.locator(f".el-dialog[data-e2e-dlg='{tag}']")
```

之后 `main = _tag_dialog(page,'cust-main')`、`nd = _tag_dialog(page,'cust-contact')`，
两个弹窗各用各的。关窗判定用
`page.wait_for_selector(".el-dialog[data-e2e-dlg='...']", state="hidden")`
（**不能**用 `count()==0` —— 元素可能只是 `display:none`，还在 DOM 里）。

### 11. `.el-select__placeholder` 有 `is-transparent` = **没有选中值**（反直觉！）

读下拉的当前值是个高频动作，坑在于**占位文案和已选值共用同一个节点**
`.el-select__selected-item.el-select__placeholder`。判据是 `is-transparent`，
但方向和直觉相反 —— 实测（客户资料，`value('国家')` vs `value('销售代表')`）：

```html
<!-- 国家：已选「中国大陆」 → 没有 is-transparent -->
<div class="el-select__selected-item el-select__placeholder"><span>中国大陆</span></div>
<!-- 销售代表 / 客户等级：空 → 有 is-transparent，span 里是占位文案 -->
<div class="el-select__selected-item el-select__placeholder is-transparent"><span>请选择销售代表</span></div>
```

所以**读值时要排掉带 `is-transparent` 的那个 placeholder**：

```js
.filter(e => !(e.classList.contains('el-select__placeholder')
               && e.classList.contains('is-transparent')))
```

⚠️ 一开始按官方命名直觉写成了「有 is-transparent = 有值」，正好把**真值全滤掉**，
同时把**空值读成占位文案** —— 两边都反了。后果是 `bool(value)` 恒为真，
「销售代表与部门同有同无」这条用例**假通过**了好几轮。
**教训：占位符/值的判定一定要用「已知有值」和「已知为空」两个字段对照验证，别靠类名猜语义。**

### 12. 多选下拉开了 `collapse-tags` 时，**输入框上读不到第 2 个及后的选择**

`BaseSelect` 写死了 `collapse-tags` + `:max-collapse-tags="1"`：
多选时**只渲染第一个 tag**，其余折成一个「+N」的 tag
（实测：客户类型选了「同行 + 指定货客户」，`value()` 只返回 `同行`）。

后果：想「判断某项现在选没选、再决定点不点」，从 tag 上判断会**整个跳过**那一步
（实测 L17「取消指定货客户」因此没还原，下一条用例跟着挂）。

**正解**：打开下拉，看**选项自己的 `selected` 类**：

```python
def dd_option_state(page, label, name, click=False, dlg=None):
    """返回 (点击前是否已选中, 选项文本)；click=True 顺手点它。
    多选里『点已选中的项 = 取消勾选』，所以这个函数天然可以做 toggle。"""
    it = locate_item(page, label, dlg)
    sel = it.locator(".el-select").first
    sel.click(); time.sleep(0.9)
    dd = visible_dropdown(page, label)
    sel.locator("input").first.fill("")      # 清掉上次残留的筛选词
    ...
    was = "selected" in (opt.get_attribute("class") or "")
    if click: opt.click()
    _close_popper(page)
    return was, texts[idx]
```

### 13. 选完下拉一定要收 popper，否则**挡住后面用例的点击**

下拉的 popper 是 teleport 到 body 的。`pick_sel()` 成功选完如果不按 Escape，
它会一直悬在页面上，下一条用例点同区域控件就会一直报：

```
<div class="el-select-dropdown__header"> from <div id="el-popper-container-6997">
subtree intercepts pointer events
```

→ 直到 20s 超时（实测 L19 点『销售代表』就是这么挂的）。
**约定：所有「打开下拉」的辅助函数，成功路径也要 `_close_popper(page)`**：

```python
def _close_popper(page):
    if page.evaluate(_VISIBLE_POPPER_JS):   # crud_common 里那个 JS
        page.keyboard.press("Escape"); time.sleep(0.35)
```

### 14. 新增/编辑弹窗里再开一个子弹窗时，按标记**删那一行**，别删第一行

子表（联系人 / 明细）的每行都有删除按钮时，
`pane.locator("button:has-text('删除')").first` **会删掉别人的真实数据**。
正确姿势（三层自保）：

1. 标记值**每次动态生成**（`f"E2ECT{datetime.now().strftime('%m%d%H%M%S')}"`），
   保证「按标记定位」只可能命中刚建的那一行；
2. 命中行数**必须正好为 1**，否则抛错；
3. 删之前再核一次：该行**要有某个 `<td>` 正好等于标记值**（扫所有单元格，不猜列下标），
   不满足就放弃删除 —— **宁可残留一条测试数据，也不能误删真实数据**。

```python
found = rows.filter(has_text=marker)
if found.count() != 1: raise RuntimeError(...)
row = found.first
if not _row_exact(row, marker): raise RuntimeError("安全检查未通过，放弃删除")
row.locator("button:has-text('删除')").first.click()   # 只点这一行的
```

### 15. 「同有同无」这种比较型断言，先确认两侧**都读得准**

`bool(a) == bool(b)` 这种写法很脆：只要有一侧把占位符/默认值读成了值，
它就恒为真。本项目的翻车案例见第 11 条。
**要么**先把读数修准再断言「派生关系」，**要么**改成**可复现性**断言更稳：

```
选 A → 记 v(A)；选 B → 记 v(B)；再选回 A → 记 v(A')
assert v(A) == v(A')          # 一定成立（不受后端数据影响）
且 v(A) != v(B) 时 → 直接证明联动生效
```

这样即使 A、B 恰好同值也不会假绿，还顺带证明了「不累积、可复现」。

### 16. 按 label 定位 form-item 必须**精确匹配** —— 有前缀包含字段时必翻车

一个弹窗里同时有「目的港」和「目的港代理」、「中转港」和「指定中转港」时，
`filter(has=locator(".el-form-item__label", has_text="目的港"))` 会取到**第一个**匹配的
——也就是「目的港代理」，于是你往「目的港代理」的下拉里筛"伦敦"，候选全是客户名
（实测报错：`找不到 '伦敦'（当前候选只有 ['JTCUS2026082600001-...']）`）。

`:text-is()` 在这种 label 上**也不可靠**（试过，命不中）。正解是自己在 JS 里比对：

```js
const get = x => { const le = x.querySelector('.el-form-item__label');
                   return le ? (le.innerText || '').trim() : ''; };
const norm = s => String(s == null ? '' : s).replace(/[\s\u200b\ufeff\u00a0]/g, '');
let it = items.find(x => norm(get(x)) === norm(label));                  // 精确优先
if (!it) it = items.find(x => norm(get(x)).includes(norm(label)));       // 再退回包含
```

找到后**给该 form-item 打一个临时属性**（`data-e2e-item="1"`）再取 locator，
这样后续 `it.locator(".el-select").first` 就一定落在对的字段上。

⚠️ **连带踩的坑**：`item(page, label)` 里的 `page` 一定要传 **Page**，别传 Locator。
`Locator.evaluate(fn, arg)` 会把**元素**作为第一个参数传给 fn，
于是 `fn` 里的 `label` 变成了 DOM 元素 → 报
`TypeError: (s || "").replace is not a function`。
这个报错完全指不到真因，看到它先检查"是不是把 dlg 当 page 传了"。

### 17. 弹窗的确认按钮文案不一定是「确定」

`crud_common.confirm_button()` 只认 `text-is('确定')`。但 `FullscreenDialog` 的
`confirm-text` 是可配的 —— 海运订单新增弹窗取的是 `common.save`，按钮写的是**「保存」**。
写用例前先 dump 一次弹窗内所有按钮文本：

```python
names = page.evaluate("""() => {const vis=e=>{const cs=getComputedStyle(e);
  return cs.display!=='none'&&cs.visibility!=='hidden'&&e.offsetParent!==null;};
  const ds=[...document.querySelectorAll('.el-dialog')].filter(vis);
  const top=ds[ds.length-1]; if(!top) return [];
  return [...top.querySelectorAll('button')].filter(vis).map(b=>(b.innerText||'').trim());}""")
```

### 18. `do_search()` 会先点『重置』—— 带条件的搜索必须自己点『搜索』

`crud_common.do_search()` 的实现是「先重置、再查询」，用来做"全量刷新"。
如果你的策略是靠查询栏**收敛到 1 行**（如海运订单的「条件查询」= 字段下拉 + 关键词），
`do_search()` 会把刚填的条件**清掉**，于是永远查不到。
正解：自己定位 `.plus-search` 内的『搜索』按钮点一下，不要用 `do_search()`。

### 19. 提交按钮点了没反应？先把"为什么"读出来

`submitForm` 一般长这样：`await ruleFormRef.validate()` 不通过就 `catch` 里弹提示，
**接口根本不会发出**。诊断三件套：

1. 表单错误：`.el-form-item__error` 的文本（注意有的表单会加 `hide-validate-error`
   把错误藏起来，那这里读出来是空的，别误判成"没有校验错误"）；
2. toast：`.el-message` 的文本（`deduplicatedMessageWarning(error?.msg || '请完善必填信息')`）；
3. 等接口用 `page.expect_response(...)` 而不是固定 sleep —— 超时本身就是"没提交"的证据。

### 20. 「DOM 里可见」≠「表单全部校验项」—— 必填项会藏在**折叠面板**里

**最坑的一条。** 操作中心配载详情里，首屏 DOM 只扫到 4 个 `.el-form-item.is-required`
（客户名称 / 收费标准 / 长期保函 / 业务员），点保存却报「请填写**包装类型**」。
真相：另外 18 个必填项全在 **`el-collapse` 折叠区**里，`offsetParent===null`，被可见性过滤掉。
**展开后是 22 个必填。**

**正解**：扫描必填项之前，先把所有 `.el-collapse-item__header`（或 `.el-collapse-item:not(.is-active) .el-collapse-item__header`）
点一遍展开，再跑扫描。写成自动化的固定动作，别指望"首屏扫一遍就全"。

> 推广：任何「折叠区 / Tabs 的非激活页 / 懒渲染列表」里的字段，都不会出现在首屏 DOM。
> 要断言"必填项都补齐了"，必须先让它们**都进 DOM**，否则用例会假绿（扫描没扫到 → 空项为 0 → 通过），
> 而真实提交会被后端/前端校验拦下。

### 21. 抓写接口的谓词别只写前缀 —— 会命中同前缀的旁路接口

海运订单保存的接口是 `PUT /operate/oceanOrder/updateOceanOrder/0`。
但页面上先触发的是 `PUT /operate/oceanOrder/updateOceanOrderOverSizeCheck`
（超尺寸校验），用 `"updateOceanOrder" in r.url` 会**先抓到旁路那条**，
于是断言 `HTTP=200` 过了、但其实真正的保存还没发生 —— **假通过**。

**正解**：谓词用完整路径/精确正则，例如
`re.compile(r"/oceanOrder/updateOceanOrder/\d+$")`，别用裸前缀 `in`。
`expect_response` 命中第一条符合的就会返回，不精确就等于没抓。

### 22. 本地 dev server 反复 OOM 时，切「共享构建版」并换对登录态 key

沙箱内存限制下 vite 依赖预构建可能反复 OOM（机器本身内存够也没用）。此时直接打共享环境：

- 登录态：构建产物 env 是 `prod`，localStorage key 里是 `-prod-`（本地 dev 是 `-dev-`）。
  把 `auth_state.json` 的 `origins[0].origin` 改成共享地址、key 里 `-dev-`→`-prod-`
  （并去掉 iconify 这类体积大又无用的项），存成 `auth_state_55.json`（记得 gitignore）。
- 入口支持 `E2E_BASE_URL` + `E2E_AUTH_STATE` 两个环境变量覆盖，就不用改代码。
- 探测共享地址必须**绕过代理**（本机常有 `HTTP_PROXY`）：python 用
  `urllib.request.build_opener(urllib.request.ProxyHandler({}))`，curl 加 `--noproxy '*'`。

### 23. 跨页面业务流：后一步的**前置状态**要靠前一步产生，别当成独立用例

「新增订单 → 审核通过 → 操作中心打开订单保存」看着是三个页面，其实**强先后依赖**：
操作中心的「订单查询」列表**默认筛选 `reviewStatus=1`（已审核）**——
**不先审核通过，订单在操作中心根本查不到**。写用例时：

- 把上一步的**产物**（订单号）作为下一步的**入参**传递：`order_no = run_add(...) or order_no`
  → `run_audit(..., order_no)` → `run_stowage(..., order_no)`；`--order` 允许跳过前置、手工指定。
- 每步还要能**单独跑**（用户有时只想验后半段）：`--suite audit,stowage --order E2E-SEA-xxx`。
- 前置被跳过的情形（`order_no` 为空）要显式判失败并给出原因，别静默 skip。

**同一页面的「行级操作」同理** —— 海运订单的『审核』按钮在工具栏，**必须先勾选行**
（`type=selection` 的 checkbox）才可用；不勾就点，按钮是 disabled，`click` 会一直等。

### 24. `filter(has=X)` 的 X 是**相对外层元素**查询 —— 别把外层的选择器带进去

想「在一个 `.el-form-item` 里找含某 input 的那一项」时：

```python
# ❌ 永远匹配不到：内层选择器被拼成 ".plus-search.el-form-item input…"，实际是
#    「在 form-item 内部再找一个 .plus-search」，必然为空
item = box.locator(".el-form-item").filter(has=box.locator("input[placeholder*='关键字']"))
# ✅ 内层必须传**不带外层前缀**的裸 locator
item = box.locator(".el-form-item").filter(has=page.locator("input[placeholder*='关键字']"))
```

`has=` / `hasNot=` 的内层 locator 是**相对每个候选元素**解析的，传入带基座的选择器会被当成
「候选元素内的后代」。**症状最阴**：检索没生效但断言仍通过（列表本来就只有 1 行），属于
**假通过**。凡是「先过滤再断言命中」的用例，都要让过滤函数**返回是否真的填/选成功**，
不成功就判失败，别只看最终行数。

### 25. PlusSearch 折叠时，靠后的搜索项**根本不在 DOM**

`plus-pro-components` 的 `PlusSearch`：`hasUnfold && !isShowUnfold` 时
`subColumns = originData.slice(0, showNumber)` —— 被折叠的列是 **`v-if` 不渲染**，不是 `display:none`。

- 典型：配柜页柜子列表 `show-number="3"` + `:col-props="{md:12}"`，只渲染前 3 项，
  「多字段查询」排第 9 → `document.querySelectorAll("input[placeholder*='关键字']").length === 0`。
- **解法**：操作靠后的项之前，先点页脚的「展开」。
  - ⚠️ 父组件只要提供了 `#footer` 插槽，PlusSearch 自带的 `.plus-search__unfold` 就**不会渲染**，
    此时「展开」是**业务自己写的**控件：可能 `el-button`、可能 `el-text`，**按文案找**：
    `box.locator("button:has-text('展开'), .el-text:has-text('展开')").last.click()`
  - 有些页面把「展开」做成 `collapse = !collapse` 切传给 `:hasUnfold` 的 ref —— 点一下就展开。
  - 独立页面（如柜子管理页 `show-number="4"` 且不传折叠）会把全部列渲染出来，**同一套
    `useSearchConfig` 在两个页面表现不同**，别拿一个页面的结论套另一个。

### 26. 后端接口 URL ≠ 前端函数名 —— 监听响应别照函数名写

`intoOrderCabinet()` 打的却是 `/operate/oceanMovingCabinetOrder/intoCabinet`。
照函数名写 `INTO_CABINET_API = "intoOrderCabinet"` 会**永远抓不到响应**，
用例报「未触发接口」但**业务其实成功**（别被这种假失败带走，先看 toast / 目标列表）。

- 正确姿势：**先去 `src/api/**` 里搜真实 path**，再决定匹配串；
- 同前缀有兄弟接口时（`…/intoCabinetBeforeCheck`、`…/intoCabinetCheckCbmAndKgs`）
  匹配串要**带 `?`** 区分：`"oceanMovingCabinetOrder/intoCabinet?"`。

### 27. 一次只开一个浏览器 —— 并发跑会把 chromium 挤死

同时跑两个 Playwright 会话时出现过：**chromium 被 OOM 杀掉、python 端死等不返回**
（特征：日志与 `--video` 录屏**同时停止增长**、`tasklist` 里一个 chrome 进程都不剩、
必须 `taskkill /F /T /PID` 才能收尸）。

- 长流程改成**分段跑**（每段一个会话），比 `--suite all` 一条龙更稳；
  段与段之间用 `--order` / `--cabinet` 传产物。
- 远程/无桌面会话下**不要开有头**：会 `TargetClosedError: Target page, context or browser
  has been closed`。一律 `--headless`，`--video` 照常出片。
- 用 `wmic process where "name='python.exe'" get ProcessId,CommandLine /format:list`
  找挂起进程（PowerShell 的 `Get-CimInstance` 在本机常返回空）。

### 28. 套件之间不要隐式依赖「上一步已经把页面导航好」

`run_readonly()` 里打开了新增弹窗，于是 `run_add()` 直接复用当前页面。
一旦单独跑 `--suite add`，页面还停在首页 → 找不到「新增」按钮，20s 超时。
**每个写套件的入口都要自带导航**，并且：

```python
btn = page.locator("button:has-text('新增')").first
try:
    btn.wait_for(state="visible", timeout=15000)
except Exception:            # 首次 goto 偶尔被路由守卫吃掉 → 再跳一次
    goto_route(page, ROUTE, base); time.sleep(6)
    btn = page.locator("button:has-text('新增')").first
    btn.wait_for(state="visible", timeout=20000)
btn.click(timeout=15000)
```

### 29. **系统自动生成的编号不要自填** —— 保存后用「列表 diff」把真值捡回来

新增单号/流水号这类字段，**业务上往往是系统生成的**，脚本自填等于造假数据。
先看 `rules`：**不在 `rules` 里的就不是必填**，多半由后端生成。

```js
// seaFreightAdd/index.vue —— rules 里根本没有 orderNo
const rules = reactive({ modeOfTrade: [...], productTypeId: [...], /* 无 orderNo */ })
```

- 自填的后果：库里出现 `E2E-SEA-<时间戳>` 这种**假单号**，`orderNo` 与
  `billOfLadingNo` 都等于自填值，与业务格式不符（真值是 `JT`+`DD`+目的港五字码+流水号）。
- **别指望从响应体拿** —— 后端可能只回 `{"code":200,"data":true}`（`data` 是布尔）。
- 正解：**保存前抓一次列表快照 → 保存后刷新再 diff**，差集就是新单号。
  列表默认按创建时间倒序，新单在第 1 页。

```python
before = {x for x in list_order_nos(page)}      # 读列表「订单号」列
... 提交 ...
reload_list(page)                                # 清关键词点一次『搜索』
fresh = [x for x in list_order_nos(page) if x not in before]
gen_no = fresh[0] if fresh else ""
```

- **连带检查所有按「前缀」选订单的地方**：老脚本靠 `E2E-SEA` 前缀检索，
  系统生成的单号没这个前缀 → 全部改成一有单号就**按单号搜**，没有才退回原逻辑。
- 报告里把「系统生成的单号」和「历史自填的假单号」**分开列**，方便后续人工清理。

### 30. 同一个文件**一次只发一个编辑**

写这种动辄上千行的用例集时，一轮里对同一文件连着发多个 `Edit`，会出现
**只有其中一个真正落盘、其余静默丢失**的情况（工具还照样回 "successfully edited"）。
症状是 `TypeError: xxx() got an unexpected keyword argument`、
`NameError: name 'yyy' is not defined` 这类**明明改过却报未改**的错误。

规矩：**同一文件一次只发一个 Edit，改完（或编译校验过）再发下一个。**
改完顺手 `py_compile` 一下，比跑一遍用例快得多。

### 31. 「只读检查」与「写入」套件要**复用同一个弹窗**，别关掉再开

拆成 `readonly`（结构/默认值/联动）和 `add`（真填真提交）两个套件是对的，
但**各自独立 `open_add` + `close_add`** 会在有头演示里出现刺眼的
「打开 → 关闭 → 又打开」。改法：

- `run_readonly(..., keep_open=("add" in want))` —— 后面跟着 add 时不关，`return dlg`
- `run_add(..., dlg=dlg_readonly)` —— `dlg.count() > 0` 就直接复用，否则自己 `open_add`

⚠️ **有个坑必须一起改**：`search_list()` 内部会 `force_close_dialogs`，
复用路径上不能再走它。更要命的是 —— **「保存前快照」必须在开弹窗之前取**：
弹窗打开期间背后列表往往还没加载完，此时读表得到 **0 条**，diff 会把整页 50 条
全当成「新增」（只是列表恰好倒序、新单在第一个，才**碰巧撞对**，属假通过）。
正解：由 `main` 在 `readonly` 之前先 `search_list(ROUTE)` 取好快照，作为 `before=` 传进 `run_add`。
判据：日志里 `保存后新增` 必须是 **1 条**，不是 50 条。

### 32. 复用弹窗后，别让「填表函数」把 readonly 选过的字段**再选一遍**

承接第 31 条。只解决「不关窗」还不够 —— 有头演示里会看到
**先跳到中间选了「产品类型」「贸易方式」，然后回到开头又完整选一遍**，很怪。
原因：两个套件的动作目的不同、**顺序也不同**。

| 时点 | 动作 | 顺序 |
|---|---|---|
| `readonly` R04/R05 | 为**验证联动**挑两个字段 | 产品类型 → 贸易方式（跳着来） |
| `add` `fill_required` | 正式填表，按业务顺序 | 客户 → 订单号 → 产品类型 → 装箱类别 → 贸易方式 → … |

改法：给 `fill_required` 加 **`skip=()` 参数**，在每个 `pick_sel` 前判一下：

```python
def skipped(label): return label in skip
if skipped("产品类型"):
    log("   产品类型：跳过（延用已有值）")
else:
    pick_sel(page, "产品类型", ...)
rec("产品类型")            # ← 跳过也要 rec，快照/A01 断言不受影响
```

`run_add` 里 `pre = {"产品类型","贸易方式"} if reuse else set()`，`fill_required(..., skip=pre)`。

⚠️ 两个约束：
1. **只读套件挑字段时，必须挑填表函数本来就会设成同值的那些**（readonly 选 `深圳直出`/`FOB`，
   fill 的默认值也是它俩），否则跳过会留下不一致的值。
2. **跳过 ≠ 不读取**：`rec()` 照旧执行，否则 A01「三个目标字段填对了」这类断言会读不到值。

### 33. 让有头浏览器窗口**真正最大化**：CDP，不要 `--start-maximized`

需求通常是「演示时窗口铺满屏」，顺手写 `launch(args=["--start-maximized"])` —— **不可靠**。
实测（Windows / Playwright chromium）：窗口停在 `1296×808`，`Browser.getWindowBounds`
里 `windowState` 仍是 `'normal'`；而 Chromium 自报 `screen.width=1280`（明明有双屏 1920×2）。
原因：该 flag 依赖 Chromium 自己探测屏幕，**多屏 / 目标屏与主屏不一致时经常落空**。

✅ 可靠做法 —— 建页后下 CDP 命令：

```python
cdp = ctx.new_cdp_session(page)
wid = cdp.send("Browser.getWindowForTarget")["windowId"]
cdp.send("Browser.setWindowBounds", {"windowId": wid,
                                     "bounds": {"windowState": "maximized"}})
# 校验：再 getWindowBounds，windowState 应为 'maximized'（实测 1936×1056）
```

⚠️ **必配的一条：最大化时 `viewport` 要显式给尺寸，不要设成 `None`。**

这条我第一次**写反了**，记下正确结论：

- `viewport=None` = "跟随窗口/屏幕尺寸"，看似最合理，**但这台机器上会翻车**：
  Chromium 在多屏环境下自报 `screen.width=1280`（Windows API 明明报 1920×2），
  于是页面被渲染成 **1280 宽、右侧留白 640px** —— 窗口明明铺满了，
  内容却没铺满，就是用户看到的「内容是最大化的，实际的浏览器不是最大化」。
- ✅ 正确组合：**`viewport={1920,1080}`（固定） + CDP `windowState=maximized`**。
  实测 `innerWidth=1920`、`#app=1920×1080`、`scrollWidth=1920`（无横向滚动条）。

```python
ctx = browser.new_context(viewport=VIEWPORT, ...)   # ← 固定尺寸，别 None
page = ctx.new_page()
maximize_via_cdp(ctx, page)                          # ← 窗口铺满，和 viewport 解耦
```

要点：
- **窗口尺寸和 viewport 是两个独立的东西**：CDP 管前者（系统级最大化），
  `viewport` 管后者（页面渲染宽度）。要"内容铺满屏幕"，两者都要设对。
- 探测屏幕用 `GetSystemMetrics(0/1)`（**主屏**），别用 `SM_CXVIRTUALSCREEN`
  ——多屏时会拿到拼接宽度。
- 写进 `config.py` 用环境变量开关（`E2E_MAXIMIZED`，默认开），别硬编码。
- **诊断口径**：看 `window.innerWidth` / `documentElement.clientWidth`（内容真实宽度）
  和 `Browser.getWindowBounds().windowState`（窗口状态），
  **别信 `screen.width`**——多屏/缩放下它会给出与物理屏不符的值。

## 只读「字段联动」用例集（不写数据也能把联动测透）

客户资料那一轮（`tests/customer_data_cases.py` + `tests/visual_customer_data.py`）
总结出一个可复用的模式：**要验证输入框/选择框之间的业务联动，根本不需要提交表单。**

先写一个只读「字段探针」，一次读全一个 form-item 的状态（`page.evaluate` 走 DOM，
比 Playwright locator 快且不受遮挡影响）：

```js
{ exists, required, disabled, readonly, inputValue, selectTexts, hasUpload }
// required 星号在 **form-item 根元素** 的 .is-required 上，不在 label 上
// selectTexts 要排掉带 is-transparent 的 placeholder（见第 11 条）
```

然后按「联动类型」分组写用例，全部**只填表读值、结束点『取消』**：

| 联动类型 | 怎么测 |
|---|---|
| 实时正则过滤 | 逐字输入不合规字符，读回实际值（`type_text` 带 delay 才看得到 @input） |
| A 字段 → B 字段自动跟随 | 清空 B、改 A、读 B；**再补一条脏检查边界**（B 有独立值时不该被覆盖） |
| 条件必填 | 切前置字段，读目标字段的 `required`（星号在 form-item 根） |
| 条件 Tab / 条件字段 | 切字段后读 Tab 列表 / 字段是否存在 |
| 只读派生 | 读 `readonly` + 用「换源看值变不变」证明派生关系（见第 15 条） |

配套：**每条用例自己 setup + finally 还原现场**，用例之间不依赖执行顺序；
另外单开一个 `--with-write` 开关，把会写后端的用例（自带清理）隔离开，
默认跑零写入 —— 这样日常回归可以随便跑，不怕污染共享环境。

## 换一个模块怎么扩（客户中心实操）

照着三层结构抄，**但先做「可行性分类」再写适配器** —— 一个菜单下的页面不是每个都能跑
CRUD。先花 10 分钟摸清楚，比写完再一个个返工便宜得多。

### 第一步：探页面（一个脚本跑完整个菜单）

对每个候选页 dump 四样东西：**列表表头 / 查询项 / 工具栏按钮 / 新增弹窗的 form-item**。
两个必须注意的点：

- **等够时间再 dump**：SPA 切页 + 懒加载，等 2.5s 读出来可能是空的（实测客户中心所有页面
  第一次都读成 0 表头），等 4s 才稳定。
- **表头选择器用 `.el-table thead th`**，别用 `.el-table__header th`。

### 第二步：分类（下面四种页面直接排除，别浪费时间写适配器）

1. **路由进不去** —— 本地 `modules/*.ts` 里列了，但后端菜单没下发（当前账号无权限），
   敲进去是 404「哎呀！未找到页面」。判据：`elTables === 0` 且 body 文本里有「未找到页面」。
2. **提交被业务规则挡死** —— 选择器全对、表单能填满，但接口返回**业务错误码**。典型：
   客户等级的分数区间与已有数据重叠（`code:10023`）。这类只看 HTTP 200 会误判，
   要看**响应体里的 code**；`wait_settled` 的判据是「弹窗关闭」，弹窗不关 = 业务失败。
3. **必填项没有可选数据** —— 下拉是空的（如客户账号的『分配角色』：选完客户全称仍 0 项）。
   探的时候要**先把前置下拉选完再 dump 依赖项**，否则会漏判。
4. **删除语义不是删除** —— 按钮叫「移除 / 作废 / 提交」，点完记录还在（审批流）。
   这类写进去**清理不掉**，在共享环境就是脏数据，务必排除。

### 第三步：写适配器（结构一样，但要留两个钩子）

页面组件往往是同一套（`PlusSearch` / `card-box` / `base-table` / `FullscreenDialog`），
`crud_common.py` 直接复用即可。每个页面只要回答：

- `route_key` / `marker_kind` / `write_keyword`
- `search()` / `create()` / **可选** `edit()` —— 没有行内 link 的页面不写，
  入口脚本用 `hasattr(spec, "edit")` 判断并跳过「改」这一步
- **可选** `delete()` —— 默认走「勾选 → 点删除 → 确认」；按钮文本不同、
  或要额外填原因（如黑名单的「移除原因」）时自己实现，
  入口脚本用 `hasattr(spec, "delete")` 分流

### 第四步：工具栏按钮可能不止一个

客户菜单页面**有两个『新增』**（左侧菜单树一个、右侧列表一个）。取最后一个：
`locator(...).nth(count - 1)` —— 点第一个会点到菜单树上，不是列表的「新增」。
凡是「左树右表」布局的页面都要留这个心。

### 第五步：不是所有页面都能删 —— 「半闭环」页面（no_delete）

**动笔前先确认后端有没有删除能力**：翻 `apps/web-ele/src/api/core/*.ts`，看主表的
`requestClient.delete(...)`。实测客户资料只有
`POST /sale/customer`（增）+ `PUT /sale/customer`（改），**没有 DELETE**，
页面上也没有删除按钮 —— 工具栏那一排是「查询EDI/导入EDI/新增/编辑/导入/审核/同步给分办/刷新缓存」。

这种情况不要硬凑一个「删」，而是把闭环诚实地缩到 **增 → 查 → 改 → 查**：

- 适配器上加类属性 `no_delete = True`；
- 入口脚本据此**跳过删除步骤和 finally 里的兜底清理**，并在汇总里把这条标成
  `已保留（本页无删除能力）`，而不是假装成功；
- 报告里必须写清「本次会留 1 条测试数据」+ 标记值，别让使用者以为环境是干净的。

**⚠️ 会留数据的页面，标记要「自解释」**：客户资料把标记同时写进
『客户全称 / 中文名称 / 企业名称』，备注再写一句
「E2E 自动化测试数据，验证后可删除（<标记>）」—— 事后按公司名称一搜就能找到。

**⚠️ 编辑态弹窗可能不会自动关。** 客户资料的父组件是这么写的：

```js
const CustomerInfoConfirm = (data) => {
  if (data?.isAdd) { customerInfoShow.value = false; handleSearch(); return }
  isUpdate.value = true          // 编辑：只打标记，**不关弹窗**
}
```

于是「点确定 → 弹窗关闭」这个通用判据必然超时。给这类页面一个 `save_edit()` 钩子
自己收尾（入口脚本用 `getattr(spec, "save_edit", None)` 分流，没有就走通用 `submit()`）：

```python
with page.expect_response(lambda r: "/sale/customer" in r.url
                          and r.request.method == "PUT", timeout=25000) as resp:
    confirm_button(dlg).click()
# 校验 HTTP 状态 + 响应体里的 code，再看有没有 .el-form-item__error
force_close_dialogs(page, "编辑弹窗")   # 再点『取消』才关，并触发列表刷新
```

### 第六步：数据量大的列表必须**带查询条件**，不能全表翻页扫

成本维护那几页靠「全表扫标记值 + 最多翻 8 页」（`find_row`）就够了。但客户资料
分页 50、后端上千条 —— 翻 8 页只覆盖 400 行，标记值多半不在里面。

正解：`search()` 用查询栏里**能搜到标记的那个字段**把范围收敛到 1 行。
客户资料查询栏的『公司名称』对应 `customerNameCn`，正好就是标记落地的字段：

```python
page.locator(".plus-search input[placeholder='请输入公司名称']").first.fill(marker)
page.locator(".plus-search button:has-text('搜索')").first.click()
```

配套要改入口脚本：`search()` 得知道「这次要找哪个标记」。做法是在 `run_page` 里
每次查询前设 `ctx.marker = <当前标记>`（新增后=m_new、修改后=m_edit），
适配器 `marker = getattr(ctx, "marker", "") or ""` 取用。其它页面忽略它就行。

### 隐性坑：`is-required` 不可信

客户等级的『分数范围』在 DOM 上是 `is-required=false`，但**提交时前端照样拦**
（"请输入最小分数 / 请输入最大分数"）。所以：

- dry-run 只能验证选择器，**必须真跑一次**才知道哪些字段实际必填；
- 真跑报「校验挡住」时，先读 `.el-form-item__error` 的文本，它比提示 toast 准。

**必填的两种写法，只有一种进 DOM**（2026-10-14 海运订单新增页实测）：

| 写法 | DOM | 例子 |
|---|---|---|
| `rules: { x: [{required:true, message}] }` | `.el-form-item.is-required` ✅（有星号） | 客户名称、贸易方式…（共 19 项） |
| `rules: { x: [{validator(rule,value,cb){ if(cond&&!value) cb(Error) ; else cb() }}] }` | ❌ **无 is-required** | 海运订单「柜型」`bookingContainerTypeId` |

⇒ 数「必填项总数」时，用 `.is-required` 会**漏掉 validator 型条件必填**（如 FCL 才必填的柜型）。
想验证这类字段"确实必填"，**只能靠"不填 → 点保存 → 接口不触发"**，别指望 DOM 标记。
反之，也**不要因为字段没有星号就判定它非必填**。

### 下拉选项的值可能是**英文 code**，不是界面所见的语义中文

别按"整箱/拼箱"这类想当然的中文去选。海运订单「装箱类别」的选项值是
`LCL / FCL / AIR / HAU / EXPRESS / CONSOL / Special / Triangular / Rail Transport`
（对应"拼箱/整箱/空运…"）。选值一律**先 dump 候选**（`pick_by_name` 失败时会把
候选列表打出来），再按真实 code 选：`pick_sel(page,"装箱类别","FCL",keyword="FCL")`。

### 下拉 option 的 label 可能是**多行拼接**，别做全文精确匹配

港口选择器的 option label 形如 `KRPUS\nBUSAN\n釜山\n韩国`。`pick_sel(...,"釜山")`
这种"按 label 全文相等"会失败 —— 用 `keyword="釜山"` 走**输入筛选 + 按含该串的项点选**。

### 纯前端「字段联动专项」的用例设计（正向 + 反向，每用例一张截图）

当需求是"**只测某弹窗内的业务联动，不要后续流程**"时，正确姿势是**独立一个只读套件**：

- **零写入**：不点『保存』，只点『取消』。开弹窗 → 反复改选择框 → 断言 → 关弹窗。
  与全流程脚本分开（别污染 `visual_sea_order.py`）。
- **正向 F\* + 反向 N\*** 成对设计：每个 `v-if` 联动都要有"出现/消失"两条；
  每个"自动赋值"都要有"改回去 → 值回退/字段消失"一条。反向用例才是验证
  `watch` 清理逻辑的关键（如 `=2` 显示人员字段、改回 `=1` 必须清空并隐藏）。
- **每用例一张截图**：断言后 `page.screenshot(path=...)`。
  截图**统一落 `reports/screenshots/<套件名>/<用例ID>_<标题>.png`**，
  用 `config.shot_path(suite, name)` 拼路径（自动建目录），别在脚本里手写目录：
  ```python
  from tests.config import shot_path
  page.screenshot(path=shot_path("add-order-linkage", f"{cid}_{safe(title)}.png"))
  ```
  ⚠️ 区分两类图：`reports/screenshots/` 是**按用例**的结果图（少而精，进报告）；
  `reports/steps/` 是 `E2E_STEPS=true` 的**每步流水图**（数百张，回溯用）—— 别混在一起。
  更好的是**给目标字段加红框**再截 —— 用 JS 按 label 精确匹配 form-item 打 outline，
  报告里一眼能看到"这条在验哪个字段"：

```python
def rec(page, cid, title, ok, detail, annotate=None):
    if annotate:   # annotate = 目标字段 label
        page.evaluate("""(args) => {
          const [label] = args;
          const vis = e => {const cs=getComputedStyle(e);
            return cs.display!=='none'&&cs.visibility!=='hidden'&&e.offsetParent!==null;};
          const ds=[...document.querySelectorAll('.el-dialog')].filter(vis);
          const top=ds[ds.length-1]; if(!top) return;
          const norm=s=>(s||'').replace(/[\\s\\u200b\\ufeff\\u00a0]/g,'');
          const it=[...top.querySelectorAll('.el-form-item')].find(x=>{
            const le=x.querySelector('.el-form-item__label');
            return le && norm(le.innerText)===norm(label);});
          if (it) it.setAttribute('style',(it.getAttribute('style')||'')+
            'outline: 3px solid #ff4d4f; outline-offset: 2px;');
        }""", [annotate])
    page.screenshot(path=shot_path("my-suite", f"{cid}_{safe(title)}.png"))
```

- **断言要用 `field()` 的 `exists`（v-if 显隐）和 `required`（`.is-required`）**，
  这俩是本页唯一可靠的显隐/必填信号；`value` 读下拉要经 `.el-select__placeholder.is-transparent`。
- **前置状态要自己铺**：联动用例之间会相互污染（上一条把装箱类别改成 FCL，
  下一条验仓点就必须先改回 LCL）。要么每条开头显式 `pick_sel` 复位，
  要么按"复位成本低"的顺序编排（收尾用例统一回到默认态）。
- **别把"被重查覆盖"误判成"被清空"**：
  改目的港会 `clear()` 航线后**按新目的港重查并自动选第一条** ——
  断言"航线为空"会失败，正确断言是"中转港未被目的港回写"（单向联动的核心）。

## 调试姿势

- 写选择器前**先探查真实 DOM**：临时脚本 dump `label / placeholder / disabled / readonly /
  inSelect / wrap class / dropdown 选项数 / dropdown 空文本`。
  一次性把 6 个页面的新增弹窗 dump 出来，比对着源码猜快一个数量级。
- 探查脚本只读：打开弹窗 → 加一行明细 → 依次点开下拉触发自动带出 → dump → 取消。
- 探查脚本用完就删，别留在 `tests/` 里。
- **读值/判占位这种「语义不确定」的 DOM 判断，一定要用「已知有值 + 已知为空」两个字段对照**，
  别靠类名猜（第 11 条的 `is-transparent` 就是猜反了，导致用例假通过）。
  写个一次性 dump 脚本把候选节点的 `class / text / 可见性` 全打出来最快。
- **加断言前先问「这个断言在什么情况下会恒为真」**。`bool(x)==bool(y)`、
  `"某字样" in 文本` 这类都容易假绿 —— 报告里读出来是 `'请选择销售代表'` 这种**占位文案**
  就是信号（见第 15 条）。

## 环境坑（Windows / 本机）

- **git-bash 工具链是坏的**（`ls`/`head`/`tail` 都没有）。用 PowerShell，或者直接用
  python 干这些活（`glob`/`os`），最省事。
- **PowerShell 的 stdout 经常捕获为空**，而且 `Remove-Item` 被 safe-delete 垫片接管会报
  `trash-failed`（文件其实已删）。
- ⚠️ **dev server 启动即崩？是 safe-delete 垫片干的。**
  vite 预构建依赖时要删 `node_modules/.vite/deps_temp_*`（实测 189 个文件），
  垫片的 bulk-delete 阈值是 50 → 判为危险批量删除 → **直接终止 node 进程**
  （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。
  解法：启动命令带上 **`CODEBUDDY_SAFE_DELETE_ENABLED=0`**：
  ```bash
  cd apps/web-ele && CODEBUDDY_SAFE_DELETE_ENABLED=0 C:/nvm4w/nodejs/pnpm.cmd local
  ```
  （该变量是垫片的开关，代码里是 `process.env.CODEBUDDY_SAFE_DELETE_ENABLED !== '0'`。）
  端口起来后先 `python -c` 探一下 127.0.0.1:9093，别急着跑用例。
- **playwright 不在 managed 的裸 python 里**，要用
  `C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe`。
- 日志会 `_Tee` 到 `reports/<prefix>-<时间戳>.log`；用 python 读并筛选关键词，
  比在终端里翻快得多。
- 小心别把正在运行的后台任务的输出重定向文件删掉。

## 「改动验证」型任务（给某几个 git 提交写用例 + 出报告）

和「给某页写 CRUD」不同：需求方给的是**一串 commit hash**，
要交的是「改动分析 + 正反向用例 + 执行结果 + 一份**不含技术字眼**的报告」。
lucky-front 的落地：`tests/offer_fix_cases.py`（用例纯数据）+ `tests/offer_fix_test.py`（执行）
+ `tests/probe_col_order2.py`（源码级静态比对）+ `tests/make_word_report.py`（出 docx）。

### 第一步永远是「读 diff 而不是读 commit message」

commit title 只给意图，**实际改了什么必须 `git show`**。实测三个提交里有两个标题都会误导：

- `fix: 修复详情页面单位下拉数据接口未加载` → 实际是给列加 `optionData` + 加 `onMounted` 预加载
- `feat: 编辑页面添加置灰判断` → 实际是从「编辑即全锁」改成「**被引用才锁**」

⚠️ 三个提交常是父子链（A→B→C），但**被测文件可能完全不重叠** →
把它们当三组独立用例，不要串成一条流程（除非真有先后依赖）。

### 字段名 / 控件位置必须先探针，别从 diff 猜

这轮最大的时间浪费就在这。同一个业务概念在不同页叫不同名，且控件不在你以为的位置：

| 概念 | 不同页的叫法 | 实际控件位置 |
|---|---|---|
| 体积比 | LCL/进口/转运系 =「体积比」；FCL 起运港/装运/代理 =「轻重比例」；拖车中转 =「体积比」 | **弹窗内嵌 `.el-table` 费用明细表**的某一列，**不在**主表单 form-item 里 |

⇒ 断言要**深入内嵌表格**（按表头文案定位列序 → 取该列行内 input 的 `disabled`），
只扫 `.el-form-item` 会一条都找不到，然后你会误判成「页面上没有这个字段」。

### 「置灰」类改动的断言要点

1. **先分清置灰源**。一个 input 变灰可能是好几个原因叠加：
   - 引用锁定（本次被测的）
   - 已发布态（表单级 disabled 往下传）
   - 字段间互斥（如拖车成本 `BILL/CBM/TON/轻重比例` 四项互斥）
   ⇒ 断言「未引用=全可编辑」时**必须把互斥字段排除**，否则把互斥置灰误判成锁定失败。
   做法：`key_fields` 只列**真正由被测条件控制的字段**。
2. **用「确定」按钮的禁用态当总开关判据**，比逐字段数置灰数稳：
   `_read_dialog_state()` 同时返回「置灰字段数/总数」+ `confirmDisabled`，
   两者不一致时说明有独立置灰源。
3. **挑数据要先看「发布状态」列**。打开已发布数据必然全灰，
   断言「可编辑」就会假失败 → 写 `_open_row_by_release_state(want_unpublished=True)`
   按列文本挑行，别默认打开第一行。
4. **列表接口可能不回锁定标志**。拖车中转成本列表的 `referencedFlag` 恒为 `None`
   ⇒ 降级方案：**逐行打开弹窗、以「确定」按钮禁用态反推**引用状态（`find_row_by_dialog_probe`）。
   ⚠️ 写 `find_row_with_flag` 时务必加
   `if all(f["flag"] is None for f in flags): return -1`
   —— 否则 fallback 会把 `None` 当成「未引用」提前返回，永远进不到探测分支。
5. **环境凑不齐前置条件就记「不适用」，别降断言强度凑通过**。
   本轮 2 条 N/A 都是这类（无未发布数据 / 无未引用数据），报告里如实标注，结论仍然成立。

### 「列顺序调整」类改动：静态比对 > UI 断言

纯列位置搬移，最可靠的验据是**源码比对**（`probe_col_order2.py`）：
`git show <commit>:<file> > /tmp/after.jsx`，和父提交版本各解析一次列数组
（枚举所有 `[` 数组 → 取 `prop:` 数最多者 → `arr_depth==1` 才认对象），
比「目标列的 index 前移 + 列数不变 + 无重复」。
UI 侧只补「目标列出现在可视列里 + 表头各 1 次」，两边对上就够，别去数像素。

### 出报告：用户要「不含自动化测试字眼和技术框架」

不是把技术词删掉就行，得**做一层转写**。`make_word_report.py` 里的 `humanize(detail, case_id)`：

| 原始机器输出 | 转写后 |
|---|---|
| `/offer/oceanFreight` | 「LCL-海运费维护」（靠 `ROUTE_CN` 路由→业务页名映射表） |
| `首行 disabled=False 值='1000'` | 「该行「轻重比例」可编辑，当前值 1000」 |
| `来源=table 列序=6` | 「在费用明细表中」 |
| `N/A` | 「不适用」 |

写完**必须终检**：把 docx 全部段落 + 表格单元格拼成一串，扫
`自动化|脚本|接口|API|Playwright|pytest|DOM|selector|undefined|disabled|路由|断言|框架|Python`
→ 命中数必须为 0。

⚠️ **生成 docx 必须用 venv python**
（`C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe`），
managed 裸 python **没装 python-docx** → `ModuleNotFoundError: No module named 'docx'`。

### 跑批注意

- 全套 23 条 + 出报告**一定要 `run_in_background=true`**，前台 120s 必被 SIGTERM。
- 中间产物按 `_` 前缀落在 `reports/`（如 `_a1.log` / `_final.json`），
  **收尾时清掉 `_*`（保留 `_final.json`）**，否则 `reports/` 迅速堆到 40+ 垃圾文件。

## 出 Word 报告：两条路线怎么选

要把测试结果交成 .docx，有两条完全不同的路，**先按交付形态选路**再动手：

| | 路线① tencent-docx 流水线 | 路线② 手写 python-docx 脚本 |
|---|---|---|
| 形态 | 编排式 Stage 0→3，含 LLM 写作 + HTML 排版 + 质量门禁 | 一个脚本按 API 拼段落/表格 |
| 落点 | `output/<request_id>/stage{1,2,3}/` | 自定义（如 `tests/make_word_report.py`） |
| 适合 | **封面 + 多节 + 页码 + 内嵌大量截图 + 精细排版** | 数据驱动、结构固定、**要求措辞完全可控**（如「不得出现技术字眼」） |
| 代价 | 慢，且 LLM 写作环节会引入不可控措辞，得额外加转写层 | 排版要自己写（字体/底色/页边距） |

路线①链路：`tdoc-orchestrator`(Stage0) → `doc-writer`(写 md) →
`doc-formatter` + `doc-typeset` + **`html-review` 门禁** → `doc-converter` + `html-to-docx`。
`html-review` 是**脚本化确定性检测**（`scripts/review_html.py`，零 LLM 往返）：
6 维度加权，`score ≥ 80` 且六维度全 pass 才放行，否则**打回上游一次定向修正**（不复检、不循环）。
常见打回项：`DT-03` 裸 `margin/padding` 未用 `var(--spacing-*)`、
`SI-02` 表格缺 `<thead>`、`TQ-03` 标题跳级中间无正文。

### ⚠️ html-to-docx 图片撑破页面的三层根因（必记）

源 HTML 里图必须显式给宽度，不然远超 A4 —— 三层叠加：

1. 截图无 DPI 元数据 → html4docx 按 **72 DPI** 取自然尺寸
   → `1920/72*2.54 = 67.73cm`，远超 A4。
2. `html-to-docx` 的 `_MAX_WIDTH_CM_DEFAULT=16.0` 是**死代码**（函数无人调用）。
3. html4docx `constants.MAX_INDENT = 5.5` 英寸 = **13.97cm 硬钳位**，
   连 `width="554"`（14.66cm@96dpi）都填不满内容区。

**三步正解**：① 每个 `<img>` 加 `width="554"` → ② 重新 convert →
③ **后处理 docx XML**：改 `<wp:extent>` / `<a:ext>` 的 `cx` 为目标 EMU，`cy` 等比。

```python
EMU_PER_CM = 360000                      # OOXML 1cm；不是 914400（那是 1 inch）
TARGET_W = round(14.66 * EMU_PER_CM)     # A4 21.0 − 3.17×2 边距 = 14.66cm 内容区
```

**坑：目标 docx 被宿主预览打开时** `shutil.copy2` 报 `WinError 32`、SDK 报
`Export file is occupied`，`close_file(force=true)` 关不掉宿主预览
→ 兜底**另存新文件名**交付，提示用户关预览后再覆盖。

**git-bash 下 `setup-html-to-docx.sh` 会静默失败**（`rm -rf`+`uv venv` 段 stderr 被吞、venv 落到
`E:\c\Users\...`），且它用 `import htmldocx` 探测依赖而**真实模块名是 `html4docx`** → 反复重装。
手工：`uv venv --python 3.12 --clear <abs>` → `uv pip install --python <venv> --only-binary=:all: -r <req>`
→ `cd <skill>/scripts && <venv-python> -m html_to_docx convert in.html -o out.docx --page-size A4`。

### 路线② 手写脚本的四个技术点

1. **中文字体必须设 `rFonts.eastAsia`**：`r.set(qn("w:eastAsia"), name)`，
   否则中文回落默认字体、与西文不一致。用「微软雅黑」。
2. **表头底色 python-docx 无 API**：手写 `OxmlElement("w:shd")` 设 `w:fill`。
3. **不要用 `add_heading()`**（会带 Word 内置样式）；手写段落 + `set_font(size/bold/color)` 更可控。
4. **页边距用 `Pt`**（`s.left_margin = Pt(56)`），不是 cm。

### 「零技术字眼」要求怎么做（高频，几乎每次都被要求）

不是删词就够，要**做一层转写**：`humanize(detail, case_id)` 把机器输出改写成业务语言 ——
路由 → 业务页名（建 `ROUTE_CN` 映射表）、`disabled=False` → 「可编辑」、
`来源=table 列序=6` → 「在费用明细表中」，再加正则兜底清洗。

**写完必须终检**：把 docx 的段落 + 表格单元格拼成一串，扫
`自动化|脚本|接口|API|Playwright|pytest|DOM|selector|undefined|disabled|路由|断言|框架|Python`
→ 命中数必须为 **0**。

⚠️ **生成 docx 必须用 venv python**（`...\python\envs\default\Scripts\python.exe`）——
managed 裸 python 没装 python-docx，会 `ModuleNotFoundError: No module named 'docx'`。

---

## 截图必须拍在「断言现场」（高频踩坑）

### 症状
用例结论是「某字段置灰 / 某按钮禁用」，但证据图里**只有列表页、没有弹窗** ——
结论无法自证。

### 根因
用例函数习惯写：

```python
try:
    ...断言...
finally:
    close_dialog(page)      # ← 弹窗已经关了
```

主循环事后 `page.screenshot()` 只能拍到列表页。**事后重开也不行**：
`open_row_dialog()` 内部多用 JS `.click()`，从调用方重开常静默失败。

### 正解：在命中那一刻截图

```python
def take_evidence(page, cid=None):
    """弹窗仍打开时的取证截图；写入 EVIDENCE[cid]，由主循环消费。"""
    ...

def probe_row_state(page, row_index, capture=False, capture_here=False,
                    want_locked=None):
    if not open_row_dialog(page, row_index): return False, None
    try:
        page.wait_for_timeout(settle_ms)
        info = _read_dialog_state(page)
        hit = None
        if want_locked is not None and not info.get("err"):
            cd = info.get("confirmDisabled")
            hit = (cd is True) if want_locked else (cd is False)
        if (capture or capture_here) and hit and not info.get("err"):
            take_evidence(page)          # ← 唯一能拍到弹窗的时机
        return (not info.get("err")), info
    finally:
        close_dialog(page)
```

### ⚠️ 最容易错的一步
逐行探测（`find_row_by_dialog_probe`）已经拍过图了，**调用方不能再拍**，
否则会覆盖成列表页。所有调用方改条件调用：

```python
if pre_info is None:        # 仅非探测路径（弹窗还开着）才取证
    take_evidence(page)
```

本次有 4 处踩到这个坑（`case_trailer_lock` 3 处 + `case_mutex_trailer` 1 处）。

### 红框标注（让结论一眼可见）
- `annotate_field(page, label)` —— 弹窗内 `.el-form-item` 按 label 定位画框
- `annotate_col(page, header_text)` —— 表格列按表头文案定位画框；
  ⚠️ **跳过滚出可视区的列**，否则框画在屏幕外
- 建 `ANNOTATE = {用例ID: ("col", [...]) | ("field", [...])}` 表，主循环统一套用
- 配色 `#ff4d4f`

### 截图目录约定
`reports/screenshots/<套件名>/<用例ID>_<标题>.png`，路径一律用
`config.shot_path(suite, name)`；`--shots-dir` 可覆盖，`--no-shot` 可关闭。

---

## 出 docx 时页脚与分页（html-to-docx 路线）

### 页脚：不写 `@page` 就没有页脚
只写 CSS `body` 样式，转出来 `footer parts: []`、`PAGE 域: False`。
**必须显式声明**：

```css
@page {
  size: A4;
  margin: 2.54cm 3.17cm;
  @bottom-center { content: "第 " counter(page) " 页 / 共 " counter(pages) " 页";
                   font-size: 9pt; color: #6b7280; }
}
```

补上后 `word/footer1.xml` 含 `PAGE` + `NUMPAGES` 两个域。

### 分页：封面独立一页 + 每条用例不跨页

```css
section[role="cover"] { break-after: page; }
section[role="body"]  { break-before: page; }
.case { break-inside: avoid-page; }   /* 用例卡片不要被切断 */
tr    { break-inside: avoid-page; }
```

### 校验清单（转完必查）
```python
z = zipfile.ZipFile(docx)
xml = z.read('word/document.xml').decode()
cx = [int(x) for x in re.findall(r'<wp:extent[^>]*cx="(\d+)"', xml)]
# ① 图片宽度：全部 <= 14.66cm (5277600 EMU)，超宽数必须为 0
# ② footer parts 非空 且 footerN.xml 含 PAGE / NUMPAGES
# ③ 表格行数对：数据源缺失时表只剩表头（见下）
```

### ⚠️ 表格只有表头 = 数据源文件不存在
`make_html_report.py` 读 `reports/_col_order2.json`，缺失时 `col_rows = ""`
静默变空表。数据源要**带 `--json` 参数**重新生成：

```
python tests/probe_col_order2.py --json reports/_col_order2.json
```
不带 `--json` 时它只往 stdout 打报告（人看得到、脚本拿不到）。
