# 汉字勇者（M8）首版验证记录

执行于 2026-10-27，执行者为工作流代理（zcode-agent 会话）。依据 [玩法说明](../../gameplay-hanzi-hero.md) 与 [交接文档](../../m7-m15-agent-handoff.md) 的 M8 切片执行：A 阶段规则与内容 → B 阶段窄路径 → C 阶段首版交付 → D 阶段浏览器验证。代码未提交、未推送（待用户授权）；生产部署与真机未验证。

## 交付范围

- 规则与内容：`docs/gameplay-hanzi-hero.md`（每局 5 题、首答 10/重试 5、不限时、无金币道具）、`docs/content-review-hanzi-hero.md`（28 题逐条代理审核）、`src/content/hanzi-hero.ts`（28 个 approved 任务，全部通用原创）。
- Learning Core 扩展：`src/learning/models.ts` 增加 `Exercise<T>` 任务泛型与 `ChineseTask`（`hanzi-choose` 单选、`hanzi-parts` 多选部件集合）；`src/learning/hanzi.ts` 判题模块（校验 + 按内容判题，不依赖位置/颜色/排列）；`evaluation.ts` 统一接入；数学调用方类型收窄（generation/main/profile/rules/content/learning 均为 `Exercise<MathTask>`）。
- 首版页面：`web/hanzi.html` + `web/hanzi.css` + `src/game/hanzi-hero/{rules,content,storage,main}.ts`（独立命名空间 `pixel-academy:hanzi-hero:v1:*`）；11 张原创几何 SVG 配图（`web/img/hanzi-hero/`，随构建交付）。
- SW 双入口：`scripts/build-sw.mjs` 预缓存扩展为 `dist/game/number-puzzle/main.js` + `dist/game/hanzi-hero/main.js` 双闭包（45 资源，含 hanzi 页面/样式/11 张 SVG）；`web/sw.source.js` 导航离线回退扩展至 `/hanzi.html` 入口（ignoreSearch）。
- 首页导航：数字消除首页菜单弹层新增「汉字勇者」入口（`web/index.html:128`，`href=/hanzi.html`，装饰字 span aria-hidden）；hanzi 页顶栏新增「返回数字消除」锚点（`web/hanzi.html:24`，href=/）；`tests/offline.test.mjs` 新增 SW 双入口导航回退断言。验证见下文「首页导航接入验证」与「设备模拟器验证」。

## 自动化检查

`npm run check`：typecheck + 生产构建 + **98 项测试全部通过**（learning 15 + hanzi 6 + hanzi-hero 8 + number-puzzle 12 + session 8 + storage 13 + offline 26 + generation/courses 其余）。新增：

- `tests/hanzi.test.mjs`：单选按字身份判题（反转排列答案不变）、meaning 缺图拒绝、组字集合判题（无序/去重/部分集判错）、非法任务拒绝（候选<4、重复候选、目标不在候选、非单字符、shape 带图、部件重复、结果字混入部件、部件不在候选）、正式池 28 题仅一年级仅 hanzi-hero（数学池 18 题不受污染）、draft 隔离（独立 catalog 构造验证 select 不含 draft、preview 含 draft）。
- `tests/hanzi-hero.test.mjs`：抽题 5 题唯一、上一局避重、池不足抛错、计分档（首答 10/重试 5/答错不扣分）、组字 toggle/提交/答错清空、整局 50 分结算、快照往返恢复一致、损坏快照拒绝、全部内容题自身答案判对。
- `tests/offline.test.mjs` 扩充：hanzi 入口闭包覆盖断言（main/rules/storage/content + learning/hanzi + content/hanzi-hero）；SW 双入口导航回退分支断言（`/` 与 `/hanzi.html`）。
- `tests/learning.test.mjs` 假设更新：静态 approved 18+28、数值域断言限定数学任务、新增语文筛选断言。

## 浏览器验证（D 阶段，全部通过）

环境：无头 Chrome/156.0.8078.48（CDP 直连，独立 profile），视口默认 756×469、窄屏 390×844（Emulation.setDeviceMetricsOverride）；DOM 控件为页面内程序化点击（无头 Chrome 真实事件管线），答案从页面题面经 dist 产物（`hanziHeroExercises` + `correctHanziIds`）自算；未注入状态。验证页面用 `?nosw` 参数跳过 SW 注册以保证每次驱动当前构建（该参数仅供验证工具，不影响正式入口）。

| # | 场景 | 结果 |
| --- | --- | --- |
| V1 | 完整局（识别/配对/组字混合）| 5 题全对（含组字「日+月」提交）→ 结算「总分 50 · 首次答对 5/5 · 答错 0」；记录恰 1 条；无横向溢出、无 JS 错误 |
| V2 | 答错重试 + 暂停→刷新→恢复 | 第 1 题故意答错（✗ 再想一想）再答对得 5 分档；第 2 题暂停→刷新→恢复后题面/选项/得分逐项一致（`hanzi-v2-*`） |
| V3 | 续局结算与记录幂等 | 第二局「总分 45 · 首次答对 4/5 · 答错 1 次」（5+10×4）；记录 2 条、局次 ID 幂等、中断快照清除 |
| V4 | 窄屏 390×844 | 选择屏单屏完整（未开放年级禁用置灰）、配对题太阳配图清晰、字卡触摸目标充足、无溢出（`hanzi-v4-*`） |
| V5 | 离线断源刷新 | SW 受控后 kill 服务 → 刷新：页面由缓存完整启动、离线开局正常（第 1/5 题「找出『目』字」，`hanzi-v5-*`）；`/hanzi.html` 导航回退修复后通过 |

截图目视核对（7 张 V1–V3 + 3 张 V4 + 3 张 V5）：选择屏年级态、题面/配图、答错反馈、暂停遮罩、结算卡、离线提示均清晰可读；单选题不再显示「提交答案」按钮。

## 验证中发现并修复的缺陷

1. **SW 导航回退缺 `/hanzi.html`**：原逻辑仅 `/` 回退缓存入口，hanzi 页离线刷新落兜底页（`hanzi-v5-02` 首轮截图即失败现场）。修复为双入口 `ignoreSearch` 匹配后通过。
2. **CSS `[hidden]` 被 flex/grid 覆盖（4 处）**：`.boot-fail`、`.pause-overlay`、`.question-image`、`.parts-submit` 的 `display:flex/block` 覆盖了 `hidden` 属性的 UA `display:none`——boot-fail 横幅常显、暂停遮罩残留在结算屏、shape 题残留上一题配图（碎图标）、单选题显示提交按钮。全部补 `[hidden] { display: none; }`。
3. **答错反馈被清**：`renderGame()` 无条件隐藏反馈条，答错「再想一想」一闪即逝。改为 `renderGame(questionChanged)`——同题重渲染（答错、勾选部件）保留反馈，换题才清除。
4. **配图路径 404**：内容数据 image 带 `web/` 前缀，serve 根目录已挂 web/ 内容（实际路径 `/img/...`）。修正内容路径前缀。
5. **结算残留暂停遮罩**：局内页面后台化自动暂停后若直接结算，遮罩未关。结算时显式关闭。
6. 首跑发现的 `boot()` 未调用（页面不初始化）、`btn-start` 接线在重构中丢失，均为实现期缺陷，修复后由 V1–V3 覆盖。

## 首页导航接入验证（桌面无头 Chrome，全部通过）

首页加入口与 hanzi 页返回锚点落地后的回归轮：无头 Chrome/CDP 直连（独立 profile），视口 1280×813，真实鼠标点击与 Tab 键盘导航；驱动脚本 `nav-browser.mjs`，结构化结果 `nav-browser-results.json`（7 场景全部通过）。答案从页面题面经 dist 产物自算，未注入状态；JS 错误与无障碍树经 CDP 核查。

| # | 场景 | 结果 |
| --- | --- | --- |
| N1 | 首页游戏选择入口 | 首页保持数字消除（h1/title 不变）；菜单弹层内汉字勇者入口（`web/index.html:128`，href=/hanzi.html）可见可点；Tab 焦点路径 btn-menu-close→4 个功能按钮→入口（键盘可达）；CDP 无障碍树为 link 角色、名称「汉字勇者」（装饰字 span aria-hidden=true）；nav aria-label=学习与收藏；无 JS 错误 |
| N2 | 点击汉字勇者进入 hanzi.html | 真实鼠标点击跳转 /hanzi.html 正常加载（6 张年级卡、boot-fail 隐藏、标题「汉字勇者 · Pixel Academy」），JS 错误 0 个 |
| N3 | hanzi 页返回数字消除首页 | 点击「返回数字消除」（`web/hanzi.html:24`）回到 /，数字消除首页正常且菜单内汉字勇者入口仍在、可见 |
| N4 | 数字消除整局回归（10 分/5 分档） | 选一年级→查看挑战（动态出题 · 每局 10 题 · 每题 10 秒 · 最多复活 2 次）→开局，10 题全部从页面题面经 dist 判题模块自动作答（正式池 select([1]) 共 1085 题）；第 1 题故意答错→购买复活卡 15 金币→复活重试；结算「总分 95 · 已完成 10/10」「首次答对 9/10 · 辅助完成 1」「答错 1 次 · 超时 0 次 · 复活 1 次」「本局 +23 金币」（首答 10 分/重试 5 分，`src/game/number-puzzle/rules.ts:17-18`）；返回首页入口仍在，钱包 20−15+23=28 |
| N5 | ?preview=candidate 预览隔离 | 预览页钱包「候选预览 · 不读写正式档案」、记录区隐藏、对局内显示预览横幅；预览模式下导航区整体隐藏（`src/game/number-puzzle/main.ts:245`，先于本改动的设计，非缺陷）；预览局答 1 题后放弃，localStorage 与 IndexedDB 档案快照（金币 28/记录 1 条/revision 34）零变化，回正式首页钱包与档案一致、入口 href 不带 preview 参数；正式池 1085 题全部 approved，当前无草稿数学题（静态 18+生成 53224 全 approved），故为结构性+行为性验证而非草稿差异验证（草稿隔离由 selectExercises 的 approved 过滤保证，`src/learning/catalog.ts:73`） |
| N6 | 刷新恢复（继续上局不重复计分） | 答对 2 题（「第 3/10 题 · 20 分」）后刷新出现「新版挑战进度已保存，恢复后手动继续。」→继续上局→冒险休息站→继续游戏回到同一题，续打至结算「总分 100 · 已完成 10/10」「首次答对 10/10」（若重开/重计应分别为 80/120）；本局 +30 金币，钱包 28+30=58 |
| N7 | SW 清单与断源回归 | npm run build 重建的 web/sw.js 版本 assets-v1-deb0ba6e041b 与按工作区内容经 scripts/build-sw.mjs 函数重算一致、与按 HEAD 内容重算的 assets-v1-f1fbdc70d7c8 不同（版本哈希随改动更新）；预缓存 45 项含 / 与 /hanzi.html 且两个导航回退分支齐备（`tests/offline.test.mjs:307-315`）；杀掉源站进程后刷新，首页与 hanzi 页均由缓存打开（提示「离线缓存已就绪（版本 assets-v1-deb0ba6e041b）」），入口与返回链接离线可点击往返，JS 错误 0 个 |

截图 14 张（`nav-01`–`nav-14`）：N1 `nav-01-home-entry`；N2 `nav-02-hanzi-entered`；N3 `nav-03-hanzi-back-home`；N4 `nav-04-availability`、`nav-05-wrong-revive`（答错与复活）、`nav-06-result-95`（结算 95）、`nav-07-home-after-round`（局后首页与钱包）；N5 `nav-08-preview`（预览钱包/横幅）、`nav-09-preview-round`（预览局）；N6 `nav-10-restore-offer`（恢复提示）、`nav-11-restored-round`（恢复续打）、`nav-12-result-100`（结算 100）；N7 `nav-13-offline-home`、`nav-14-offline-hanzi`（离线两页）。

## 设备模拟器验证（Android / iOS，全部通过）

Android 与 iOS 模拟器各跑同一套在线整局 + 返回路径 + 断源离线场景，驱动脚本与结构化结果在 `device-simulators/`（`android-round.mjs`/`ios-round.mjs`、`android-results.json`/`ios-results.json`，Android 另存 `android-online-results.json`/`android-offline-results.json` 分相结果）。

**Android 模拟器**：emulator-5556（Android 14 / Chrome 113），origin 经 `adb reverse` 指向本地 serve；驱动用 `Input.dispatchTouchEvent` 真实触摸，viewport 412×790 dpr 2.625。

| # | 场景 | 结果 |
| --- | --- | --- |
| A1 | 在线：首页→汉字勇者入口→完整一局识别题→结算计分 | 菜单导航含「字 汉字勇者」入口（`web/index.html:128`）→ hanzi.html 选择屏 →「一年级 28 个，共 28 个任务」→ 5 题完整一局：q1 组字+10、q2 形近题故意答错（✗ 再想一想）后重试+5、q3 组字+10、q4 看图题+10、q5 形近题+10，结算「总分 45 \| 首次答对 4/5 · 答错 1 次」，与首答 10 分/重试 5 分口径逐项吻合，记录 0→1（score=45） |
| A2 | 返回路径：hanzi→数字消除首页，选年级开一局作答 2 题 | 结算屏「返回选择」→ 汉字选择屏（练习记录出现 45 分记录）→ 顶部「返回数字消除」链接回首页 → 勾选一+二年级（勾选重建坑按 M7 口径逐次重查）→「动态出题 · 每局 10 题」→ 开局作答 2 题（binary 12、binary 5）→ 返回确认放弃，成绩 0→0 无新增 |
| A3 | 离线：SW 就绪→kill 服务→首页与 hanzi 均可打开并完局 | kill `node scripts/serve.mjs 4273`（curl 返回 000、无监听确认）→ 刷新后首页离线打开且提示「离线缓存已就绪（版本 assets-v1-deb0ba6e041b），断网也能游玩。」→ 菜单离线导航进入 hanzi.html → 一年级 28 个任务 → 5 题全对完局「总分 50 \| 首次答对 5/5 · 答错 0 次」，记录 1→2（score=50）。注：模拟器系统网络仍在线（onLine=true，仅本地服务被杀），页面资源全部由 SW 缓存供给，符合「kill 服务」离线口径 |
| A4 | 全程无 JS 错误、无横向溢出 | 驱动脚本在每个截图检查点执行 scrollWidth>innerWidth 与 window.__errors 断言（Page.addScriptToEvaluateOnNewDocument 注入 error/unhandledrejection 收集），在线 13 个检查点 + 离线 5 个检查点均通过 |

Android 截图 21 张：A1 `android-online-01-home`…`android-online-06-hanzi-result`（含 `android-online-q1`、`android-online-q2-wrong` 两张题面特写）；A2 `android-online-07-hanzi-back-select`…`android-online-13-math-returned`；A3 `android-offline-01-home`…`android-offline-05-hanzi-result`（含 `android-offline-q1`）；A4 为贯穿检查，无独立截图。

**iOS 模拟器**：iPhone 模拟器（udid 28F2F0F0-4732-4493-816A-A382DCBF329A，iOS 18.6 Safari，WebDriver 驱动），origin localhost:4373。

| # | 场景 | 结果 |
| --- | --- | --- |
| I1 | 在线：首页入口→hanzi.html→完整局 5 题→结算 | 首页菜单弹层「汉字勇者」入口（href=/hanzi.html、装饰字 aria-hidden）进入 hanzi.html（6 年级卡、boot-fail 隐藏），选一年级（「一年级 28 个，共 28 个任务」）开局，5 题中第 1 题先错（「✗ 再想一想」）后对、第 2–5 题首答正确，结算「总分 45」「首次答对 4/5 · 答错 1 次」（= 重试 5 + 首答 10×4，验证首答 10 分、重试 5 分），记录 0→1 条 |
| I2 | 返回路径：hanzi 返回数字消除首页→选年级开局→作答 2 题 | 结算屏「返回选择」后点顶栏「返回数字消除」（href=/）回到数字消除首页并开菜单确认入口仍在；勾一年级→「动态出题 · 每局 10 题 · 每题 10 秒 · 最多复活 2 次」→开局作答 2 题（第 1 题 binary 棋盘 PointerEvent 按块、第 2 题 choice 选项 el.click()）至第 3/10 题 20 分，弃局返回选择屏；成绩 0→0 条、金币 20→20（弃局不产生成绩） |
| I3 | 离线（断源刷新口径）：SW 受控→kill 服务→Safari 刷新→首页与 hanzi 由缓存打开→hanzi 完整局 | SW pixel-academy:number-puzzle:assets-v1-deb0ba6e041b 受控且预缓存含 /（正文含入口）与 /hanzi.html（正文含返回标记）；kill serve.mjs 4373 后源站 fetch 失败（navigator.onLine 仍为 true，以请求失败判离线），刷新同一标签页（非冷导航）首页由缓存打开并显示「离线缓存已就绪…」，经菜单入口离线进入 hanzi.html 完整玩 5 题全对，结算「总分 50」「首次答对 5/5 · 答错 0 次」，记录 1→2 条；全程未遇到 WebKit 冷导航落系统错误页（未做离线冷导航） |
| I4 | 全程无 JS 错误、无横向溢出（贯穿检查） | 8 个页面检查点（S1 首页/hanzi 选择屏/结算屏、S2 返回后首页/数字消除选择屏、S3 离线首页/hanzi 选择屏/结算屏）scrollWidth>innerWidth 全为 false；error+unhandledrejection 台账逐页注入采集，全程 0 条 |

iOS 截图 14 张：I1 `ios-s1-01-home-entry`…`ios-s1-06-result`（含 q1 答错现场）；I2 `ios-s2-01-home-back`…`ios-s2-04-select-after-abandon`；I3 `ios-s3-01-offline-home`…`ios-s3-04-offline-result`；I4 为贯穿检查，无独立截图。

iOS 环境观察（非阻塞）：`xcrun simctl terminate com.apple.mobilesafari` 会清空该模拟器 Safari 的 origin 存储（localStorage/IndexedDB）——第 1 轮运行结束时 hanzi 记录为 2 条，第 2 轮 S1 起步又为 0。全部断言均为相对值（前→后），两轮各自自洽，不影响本轮结论；但该模拟器上强制结束 Safari 后存储不可保留，复跑证据时不能假设跨轮持久化。

## 生产环境验证（Cloudflare Pages，全部通过）

导航接入随 dea2637 推送部署（构建 `npm run build:site` → dist-site/，git 集成自动部署）。生产首验暴露一个本地未复现的真实缺陷并随即修复闭环：部署链 dea2637（导航）→ 生产首验失败 → 968bee5（_redirects 方案，实测无法绕过 Pages 资产解析层的规范化且使 /hanzi 落 308 自循环，撤销）→ 91d309c（终版修复，SW 版本 `assets-v1-c443b797b0e8`）。

**缺陷记录（Pages 308 规范化 × SW respondWith）**：Pages 把 `/hanzi.html` 308 规范化到 `/hanzi`（`/` 无此行为，M7 未暴露）。`cache.addAll` 预缓存跟随 308 后把 `redirected=true` 的 same-origin 200 响应写入缓存键 `/hanzi.html`；此后任何经 SW 的该导航 `cache.match` 命中并以 redirected 响应 respondWith，按 Fetch 规范导航直接网络错误（Chrome 系统错误页 ERR_FAILED）。本地 serve 无规范化，故三端验证（桌面/Android/iOS）均通过而生产首验才发现。修复：SW 导航回退分支命中缓存时对 `redirected` 条目用 `new Response(hit.body, …)` 重包去掉标记（`web/sw.source.js`），并兼容 `/hanzi` 路径（历史规范化 URL 与离线手输）；SW 未接管的首访由浏览器自身跟随 308 正常打开（`/hanzi` 200）。该行为已由 `tests/offline.test.mjs` 回退分支断言固化。

**桌面无头 Chrome 156 验证**（profile 全新首访，脚本 `production/production-browser.mjs`，结果 `production/production-browser-results.json`）：

| # | 场景 | 结果 |
| --- | --- | --- |
| P1 | 生产首页与 SW 版本 | 首页正常加载，SW 受控，缓存 `pixel-academy:number-puzzle:assets-v1-c443b797b0e8` 45 项与预期版本一致，页面提示「离线缓存已就绪」；缓存条目 redirected 形态如实记录（/hanzi.html=true，由 SW re-wrap 兜底），生产 sw.js 含 re-wrap 逻辑 |
| P2 | 导航入口进 hanzi 并返回 | 菜单入口真实点击进入 /hanzi.html（年级卡 6 张、boot-fail 隐藏），「返回数字消除」回首页正常，JS 错误 0 |
| P3 | 缓存清单双入口 | 缓存正文核对：/ 含汉字勇者入口标记、/hanzi.html 含返回标记 |
| P4 | 断网刷新离线可达 | 浏览器级断网仿真刷新：首页与 hanzi 均由缓存打开、离线可往返，JS 错误 0 |

截图 7 张（`production/prod-01`–`prod-07`，含首跑失败现场 `prod-fail-p2/p4`）。

**Android Chrome 113 模拟器验证**（emulator-5556，真实触摸 `Input.dispatchTouchEvent`，脚本 `production/android-prod-smoke.mjs`，结果 `production/android-prod-results.json`）：

| # | 场景 | 结果 |
| --- | --- | --- |
| Q1 | 生产首页 + SW 版本 | 缓存 `assets-v1-c443b797b0e8` 45 项与预期一致、SW 受控，无横向溢出、JS 错误 0 |
| Q2 | 菜单入口进 hanzi + 返回 | 真实触摸进入 /hanzi.html（年级卡 6 张），返回链接回首页，JS 错误 0 |
| Q3 | 飞行模式离线可达（M7 R4 口径） | 飞行模式后刷新：首页与 hanzi 均由缓存打开，JS 错误 0 |

截图 6 张（`production/android-prod-01`–`android-prod-06`）。

驱动坑补充（复跑参考）：模拟器 Chrome 113 的 per-page WebSocket 握手成功但命令可能无响应，需走 browser 级 endpoint + `Target.attachToTarget(flatten)`；Chrome `/json` 按"最近使用在前"排序，多 tab 时应匹配本项目 URL 的第一个 target。

## 已知限制与未验证项

1. **物理真机未验证**：已补充 Android 模拟器与 iOS 模拟器验证（见「设备模拟器验证」），但模拟器证据不代表物理真机——触控手感、性能与真实设备系统差异未覆盖。
2. **生产环境已验证（2026-10-27）**：桌面无头 Chrome 156 与 Android Chrome 113 模拟器对 https://pixel-academy.pages.dev 完成导航入口、SW 版本更新与双入口离线验证（见「生产环境验证」）；iOS Safari 生产环境未单独跑（iOS 模拟器验证为本地源，生产 SW 行为与 Android 同机制同代码）；窗口期（dea2637 部署后、91d309c 修复前）安装过新 SW 的浏览器持有被 redirected 响应污染的缓存，91d309c 的版本更新会在 activate 时清理旧缓存自愈。
3. **iOS 离线冷导航为已知 WebKit 行为**：WebKit 离线冷导航可能落系统错误页；本轮按断源刷新口径验证通过（I3），未做离线冷导航。
4. **教学有效性未验证**：28 题为代理内容审核（题意/正确性/适配性），学生可读性、图文认知效果、组字教学价值需教师/学生实测；审核记录已声明撤回条件（图示混淆即撤出）。
5. **抽题覆盖为随机抽样**：V1–V3 每局 5 题（约 3 局 ×5 = 15 题次），未穷举全部 28 题；全部任务已由 `tests/hanzi-hero.test.mjs`「自身答案判对」与窄路径测试覆盖判题面。
6. 验证脚本 `docs/evidence/m8/hanzi-browser.mjs`、`nav-browser.mjs` 与 `device-simulators/{android-round,ios-round}.mjs` 依赖本机 Chrome/CDP、Android 模拟器（adb reverse）、iOS 模拟器（WebDriver）与本地 serve，不直接重放；断言含时序等待（轮询），在更慢环境可能需放宽超时。

## 候选排列缺陷修复（2026-10-27）

M9 拼音冒险验收轮（[拼音验证记录](../m9/README.md)）发现「正确答案恒为第一个候选卡」缺陷（内容层 `options[0]` 恒为答案、渲染层不洗牌，辨认题干扰项失效），汉字勇者存在**同款缺陷**：`src/content/hanzi-hero.ts` 的 choose/parts 任务同样把目标字/正确部件放在 `options[0]`，渲染按原序——目标字恒在首位，干扰项失效。合并修复轮在 `src/game/hanzi-hero/rules.ts` 的 `createRound` 以局内 rng 对每题 `options` 洗牌（choose 与 parts 同路径；parts 判题按部件集合身份、与排列无关；洗牌结果随 RoundState 进入快照、恢复后排列一致；内容数据零改动）。

**修复复验**（2026-10-27，复验脚本与证据见 [拼音验证记录 · 缺陷修复复验轮](../m9/README.md)：`docs/evidence/m9/pinyin-fix-verify.mjs`、`pinyin-browser-results.json` 的 `fixVerification` 字段、截图 `fx-3-*`）：汉字勇者完整 2 局（首局含答对 2 题刷新→恢复续打）共 10 题，渲染候选与内容原始序不同的题 10/10，正确选项位置分布 `[2,0,2,0,3,2,0,2,3,3]`（3 个不同位置、首位 3 题）——不再恒在首位；每题经 `/dist/learning/hanzi.js` `correctHanziIds` 对洗牌后 task 自算正确选项（choose 按字身份、parts 按部件集合身份勾选+提交），全部首答判对；组字多选照常（勾选态、提交按钮）；结算「总分 50 · 首次答对 5/5 · 答错 0 次」、记录 id=roundId 恰 1 条；刷新恢复后逐题洗牌排列与刷新前一致；金币与 JS 错误口径同拼音复验（零收支、全程 0）。`npm run check` 重跑 167 项通过（含新增 hanzi-hero 洗牌测试）。
