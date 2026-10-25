# M7 第一阶段交付验收 · 验收记录

执行者：实现工程师·M7 会话内的代理验收（zcode-agent），非真人操作。日期：2026-10-25。

本文件是第一阶段的端到端汇总记录。各里程碑的分轮浏览器证据（执行者、环境、逐题数据、截图）在：

| 里程碑 | 证据 |
| --- | --- |
| M3 可玩原型（含死局缺陷发现与修复复验） | [docs/evidence/m3/README.md](../m3/README.md)（截图 docs/evidence/m3/） |
| M4 手机交互与复古掌机视觉（实现者轮 + 验收员第 1 轮） | [docs/evidence/m4/README.md](../m4/README.md)（截图 docs/evidence/m4/） |
| M5 本地记录与恢复（实现者冒烟轮 + 验收员第 1 轮） | [docs/evidence/m5/README.md](../m5/README.md)（截图 docs/evidence/m5/） |
| M6 离线运行与资源更新（实现者轮 + 验收员第 1 轮 + 独立复核修复复验） | [docs/evidence/m6/README.md](../m6/README.md)（截图 docs/evidence/m6/） |

（目录实际名称为小写 m3–m7；PLAN.md 历史行文中出现的 `docs/evidence/M3/` 等大写写法在本机 macOS 大小写不敏感文件系统上指向同一目录。）

## 环境与代码状态

- macOS darwin 25.6.0 arm64，Node.js 24.20.0，npm。
- 服务：`npm run serve`（构建 + Node 内置 http），http://127.0.0.1:4173/（localhost 安全上下文）。
- 浏览器：agent-browser 驱动的无头 Chrome（CDP），会话 `m7`；模拟器证据，非真实设备。
- 代码状态：main 分支工作区（M7 变更：`.github/workflows/check.yml` 新增、README/VERIFICATION/PLAN/docs 更新；M1–M6 功能代码未改动）。

## 可复现命令（本次真实执行）

| 命令 | 结果 |
| --- | --- |
| `npm ci` | 通过（added 1 package，锁文件安装 typescript 5.9.3） |
| `npm run check`（typecheck + 构建 + node --test） | 通过：73 项测试 pass 73 / fail 0（learning 14 + number-puzzle 12 + session 8 + storage 13 + offline 26） |
| `npm run build`（生产构建） | 通过，退出码 0：`sw.js 已生成：版本 assets-v1-ce9e1f843c3c，预缓存 18 个资源（dist 模块 16 个）`，与 M6 修复复验后的版本基线一致 |
| `npm run serve` | 通过：构建后 http://127.0.0.1:4173/ 返回 200，页面正常启动 |

持续集成：`.github/workflows/check.yml`（npm ci + npm run check，Node 22）已落盘；**未获推送授权，未在 GitHub Actions 上实际运行**，不声称 CI 通过。

## 正式入口只用 approved 练习（复查留证）

1. 代码路径：正式入口默认 URL 时 `main.ts:131` 选择 `content.select`（预览仅在显式 `?preview=candidate` 时切换，`main.ts:815`）；`content.ts:53` 的 select 即 Learning Core 的 `selectExercises`；`catalog.ts:79` 的 select 只返回 `review.status === 'approved'`（catalog.ts:73）。
2. 运行时核查（`node /tmp/m7-approved-check.mjs`，从 dist 导入真实产物）：`selectExercises` 对 [1] 返回 12 道（MATH-001~012）、[2] 返回 6 道（MATH-013~018）、[1,2] 与全年级返回 18 道，**全部 approved、无 draft**（nonApproved=0）；[3][4][5][6] 均为空；`previewExercises` 当前同为 18 道（draftCount=0，现有题库无草稿）。
3. 浏览器证据：默认 URL 无预览横幅（`#preview-banner` hidden=true）、结算无预览标注（`#result-preview-note` hidden=true）、开放年级提示「当前开放：一年级、二年级（数学）」、可用内容「一年级 12 道、二年级 6 道，共 18 道」（截图 01、02）。
4. 既有测试持续覆盖：draft 不出现在任何正式结果、正式/预览口径分离（tests/learning.test.mjs、tests/number-puzzle.test.mjs，含于上述 73 项）。

## 端到端验收（本次会话完整执行）

链路：**选年级 → 完整游玩 → 结算 → 重开 → 恢复记录 → 断网重进**。棋盘点选经页面 `PointerEvent('pointerdown', {pointerType:'touch'})` 按画布 360×620 逻辑坐标派发（与 M3–M6 同方法）；题面与棋盘值经对 `fillText`/`arc` 的只读包装读取，判题计分全部来自页面真实行为。

| # | 场景 | 预期 | 实际 | 截图 |
| --- | --- | --- | --- | --- |
| 1 | 默认入口（干净 localStorage） | 可游玩、无预览横幅、当前开放一/二年级、离线缓存就绪带版本 | 一致：`assets-v1-ce9e1f843c3c`；开放提示、空记录、无恢复提供 | 01-default-entry.png |
| 2 | 选一+二年级 → 查看可用内容 | 「一年级 12 道、二年级 6 道，共 18 道」 | 一致 | 02-availability-g12.png |
| 3 | 中断恢复提供 | 刷新后出现「继续上局/放弃上局」，进度如实 | 一致：「已完成 2/10 题，得分 20。」（本次正式流程）；截图为补充构造的「已完成 1/10 题，得分 10。」整页快照（含两条历史记录） | 03-restore-offer.png |
| 4 | 恢复续打完整一局到结算 | 恢复后题目/得分一致，跨恢复不重复计分 | 一致：恢复后「第 3/10 题 · 得分 20」，续打至结算「总分 100 / 一次通过 10/10 / 答错 0 次」——前 2 题计一次、后 8 题计一次，恰 100 分 | 04-settlement-restored-round.png |
| 5 | 结算页「再来一局」重开 | 新局重新开始（第 1/10 题、得分 0） | 一致 | 05-replay-new-round.png |
| 6 | 返回年级选择查看练习记录 | 恰一条该局成绩、无重复记录 | 一致：「10-25 22:59 · 一年级、二年级 · 总分 100 · 一次通过 10/10 · 答错 0 次」；年级勾选保留 | 06-records-after-round.png |
| 7 | 断网重开（网络层丢弃全部源站请求，与 M6 离线口径相同） | 页面由 SW 缓存完整加载，设置与记录可读 | 一致：booted、controller=true、勾选恢复、记录可读、缓存就绪提示带版本 | 07-offline-restart.png |
| 8 | 离线查看二年级可用内容 | 「二年级 6 道，共 6 道」 | 一致 | 08-offline-availability-g2.png |
| 9 | 离线完整玩 6 题局到结算 | 逐题作答、结算与计分规则一致、成绩离线保存 | 一致：逐题 12/6/50/10/35/40（含 3 道乘法点阵题按点阵数作答），结算「总分 60 / 一次通过 6/6 / 答错 0 次」 | 09-offline-settlement.png |
| 10 | 离线后的练习记录 | 离线局成绩入库、历史记录完整 | 一致：恰两条（离线 60 分 + 此前恢复局 100 分）；恢复联网后复验无变化 | 10-offline-records.png |

过程中顺带观察到的既有行为（与既往里程碑结论一致，未新发现缺陷）：页面隐藏自动暂停（M4）在两次命令间隙触发，恢复后进度与计分不丢；消除窗口内的重复点击被忽略、不重复计分（M3）——驱动脚本在一次竞态中重发点击，实测被规则忽略。

## 过程记录与工具侧说明（非应用缺陷）

- 首版驱动脚本的 `arc` 包装丢弃了角度参数，Chrome 对非有限参数抛 TypeError，导致**乘法点阵题的绘制帧中断**（画面只剩 HUD、棋盘空白）。修正为完整转发参数后，乘法题正常渲染与作答（场景 9 的 3 道乘法题即修正后作答）。期间曾误判为游戏死局，经画布帧记录定位为测试脚本缺陷；游戏代码零改动。
- 场景 3 的首次截图（2/10 提供时刻）视口内未含提供区块，补充构造一次中断（1/10、得分 10）拍摄整页快照；原「已完成 2/10 题，得分 20。」文本经页面 eval 读取得证，并以该局完成恢复续打到结算（场景 4）。

## 未执行 / 未验证（如实记录）

1. **iOS Safari 与 Android Chrome 真实设备未测**：本环境无真机；M3–M6 全部为桌面无头 Chrome 模拟。按 PLAN.md 验收条件「仅有模拟器证据时不能声称真实设备验收完成」，该项作为缺口保留于 PLAN.md M7。
2. **真实部署环境未验证**：部署位置未经用户确认，本轮仅覆盖 localhost 安全上下文（`npm run serve`）；部署后 SW 注册/更新/缓存行为待部署环境确认后验证。
3. **CI 未实际运行**：`.github/workflows/check.yml` 仅落盘，未获推送授权，无 GitHub Actions 运行记录。
4. 音效可听性（延续 M4 缺口）：无头环境无音频输出，未真人试听。
5. 乘法点阵教学有效性（延续 M2/M4 缺口）：需真实学生/教师实机观察，本轮仅验证可读性与可作答性。

---

# 验收员第 1 轮（浏览器验收员·M7，独立会话）

执行者：浏览器验收员·M7（独立于实现工程师·M7 的验收代理，zcode-agent），非真人操作。日期：2026-10-25。截图 49 张（`v1-` 前缀）存于本目录，不覆盖实现轮的 `01-`~`10-` 编号截图。

## 环境与方式

- macOS darwin 25.6.0 arm64，Node.js v24.20.0，npm 12.2.1；仓库 main 分支工作区（本轮零代码改动，仅新增本目录截图与本节记录）。
- 浏览器：agent-browser 驱动的 Chrome for Testing 155.0.8059.84（CDP），会话 `m7acc1`；默认桌面视口（截图宽 1280px，画布显示 252×434，即缩放下限 0.7 档）。**模拟器证据，非真实设备。**
- 服务：`npm run serve`（构建 + Node 内置 http），http://127.0.0.1:4173/（localhost 安全上下文）。
- 棋盘点选方式：逐题截图后由验收员目视读取题面与棋盘数值，经页面 `PointerEvent('pointerdown', {pointerType:'touch'})` 按画布 360×620 逻辑坐标派发到等值块中心（tile 中心逻辑坐标：列 64/180/296，行 282/378/474/570；canvas rect 由页面读取后换算）。判题、计分、记录全部来自页面真实行为，未注入任何游戏状态。

## 命令核对（本轮真实执行）

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 通过，exit 0：`ℹ tests 73 / ℹ pass 73 / ℹ fail 0`（typecheck + 构建 + node --test） |
| `npm run build` | 通过，exit 0：`sw.js 已生成：版本 assets-v1-ce9e1f843c3c，预缓存 18 个资源（dist 模块 16 个）。` |
| `npm run serve` | 通过：启动日志正常，`curl http://127.0.0.1:4173/` 返回 `HTTP 200`，页面完整加载（截图 v1-01） |
| `npm ci` | **本轮未重跑**：按任务要求引用已执行结果（本文件上方实现轮记录与 PLAN.md M7：通过，added 1 package），不自行删除 node_modules；本轮只核对了安装状态 `npm ls typescript` → `typescript@5.9.3` 在位 |

CI：`.github/workflows/check.yml` 仅落盘，未获推送授权、无 GitHub Actions 运行记录，不声称 CI 通过。

## 默认入口只用 approved 练习（页面 + 网络请求 + dist 运行时三重核查）

1. **页面入口**（默认 URL，全新 localStorage）：`#preview-banner` 与 `#result-preview-note` 均 hidden；DOM 中不存在任何 `<a>`（即没有任何指向 `?preview=candidate` 的入口链接）；开放提示「当前开放：一年级、二年级（数学）」；`localStorage` 为空、无恢复提供、无存储告警（截图 v1-01）。
2. **网络请求**（`agent-browser network requests`，CDP 层）：默认入口共 19 个请求，全部为 `http://127.0.0.1:4173/*` 同源（18 个应用资源 + `favicon.ico` 404），无任何外部域请求；页面 `performance.getEntriesByType('resource')` 共 18 条、非同源条目 0。练习数据为构建产物 `dist/content/exercises.js` 静态同源加载。
3. **dist 运行时核查**（`node /tmp/m7acc-approved-check.mjs`，从 `dist/index.js` 导入真实产物，对照 `src/content/exercises.ts` 的审核状态）：`selectExercises` 对 [1] 返回 12 道（MATH-001~012）、[2] 返回 6 道（MATH-013~018）、[1,2] 与全年级返回 18 道，全部与 approved 集合一致，非 approved 混入 0、草稿混入 0；[3]~[6] 均为空；`previewExercises` 当前与正式集相同（现有题库 18/18 全 approved、无草稿）。RESULT: PASS。
4. **预览入口显式分离**：`?preview=candidate` 下练习记录区整体隐藏（截图 v1-28，画面为选择屏）；默认 URL 下横幅隐藏且无入口链接（v1-01）。预览入口不读写正式记录（正式记录区在预览入口不可见）。
   - **复核补证（实现工程师·M7 修正轮，2026-10-25，会话 m7fix，agent-browser 无头 Chrome）**：v1-28 为选择屏画面，横幅（位于游戏屏，web/index.html:73）与结算标注（位于结算屏，web/index.html:94）不在该画面内，不能作为二者可见性的截图证据——原句「横幅可见、结算预览标注解除隐藏（截图 v1-28）」超出该截图所证范围，已更正。补充截图：`?preview=candidate` 开局后横幅「候选内容预览 · 练习未审核」在游戏屏可见（11-preview-banner-game.png，eval 实测 `#preview-banner` hidden=false）；预览局结算页标注「候选预览局 · 结果不计入正式记录」可见（12-preview-settlement.png，eval 实测 `#result-preview-note` hidden=false），且结算后 localStorage 无任何 records 键（预览局不写正式记录，与 M5 场景 13 一致）。

## 端到端链路（第一实例：默认入口 → 完整游玩 → 结算 → 重开 → 中断恢复 → 记录）

逐题作答记录（第 1 局混选 10 题，全部首答正确，无重试）：①45+12−7=50 ②点阵5×2=10 ③找出10 ④7+2=9 ⑤5−2=3 ⑥4+6=10 ⑦找出0 ⑧8+1=9 ⑨找出3 ⑩0+5=5。

| # | 场景 | 预期 | 实际 | 截图 |
| --- | --- | --- | --- | --- |
| 1 | 默认入口（全新状态） | 可游玩、无预览横幅、无预览入口链接、缓存就绪带版本、无记录 | 一致：`assets-v1-ce9e1f843c3c`、19 请求全同源、开放一/二年级 | v1-01-default-entry.png |
| 2 | 选一+二年级 → 可用内容 | 「一年级 12 道、二年级 6 道，共 18 道」 | 一致 | v1-02-availability-g12.png |
| 3 | 开局至第 10 题逐题作答 | 每题答对消除 + 补块、HUD 得分按 10 分递增、无答错 | 一致：得分 0→10→…→90，第 2/4/6 题为乘法点阵按「几个几」作答 | v1-03-game-start.png、v1-04-q02.png、v1-05-q03.png、v1-06-q04.png、v1-06-q04-full.png、v1-07-q05.png、v1-08-q06.png、v1-09-q07.png、v1-10-q08.png、v1-11-q09.png、v1-12-q10.png |
| 4 | 结算 | 总分与计分规则一致、无预览标注 | 一致：「总分 100 / 一次通过 10/10 / 答错 0 次」，`#result-preview-note` hidden | v1-13-settlement.png |
| 5 | 结算页「再来一局」重开 | 新局重新洗牌、第 1/10 题、得分 0 | 一致：新棋盘（0,10,1/1,6,6/2,4,7/8,3,3），首题 3−1=2 | v1-14-replay-new-round.png、v1-15-replay-q02.png |
| 6 | 第 2 局答对 2 题（20 分）后刷新制造中断 | 中断快照如实保存 | 一致：刷新前读取 `pixel-academy:number-puzzle:v1:interrupted` → `questionIndex:2, score:20, results:2, paused:false, recordId:np-12c625f3…` | —（数据经页面读取取证） |
| 7 | 刷新后恢复提供 | 「继续上局/放弃上局」且进度如实 | 一致：「检测到上次未完成的局次：已完成 2/10 题，得分 20。」；年级勾选保留、既有 1 条 100 分记录可见 | v1-16-restore-offer.png |
| 8 | 「继续上局」恢复 | 题目/得分/棋盘与中断时刻一致 | 一致：恢复到第 3/10 题 · 得分 20 · 找出 10 · 中断前棋盘原样；期间页面隐藏触发 M4 自动暂停覆盖层（既有设计），「继续游戏」后正常续打 | v1-17-restored-game.png、v1-18-restored-playing.png |
| 9 | 恢复续打至结算 | 跨恢复不重复计分、只记一条成绩 | 一致：续答 8 题全部首答（30→…→90→100），结算「总分 100 / 一次通过 10/10 / 答错 0 次」＝恢复前 2 题 20 分 + 恢复后 8 题 80 分 | v1-19-restored-q04.png、v1-20-restored-q05.png、v1-21-restored-q06.png、v1-22-restored-q07.png、v1-23-restored-q08.png、v1-24-restored-q09.png、v1-25-restored-q10.png、v1-26-restored-settlement.png |
| 10 | 返回年级选择查记录 | 恰 2 条（两局各一条）、无重复、快照清除 | 一致：`10-25 23:22` 与 `10-25 23:19` 各一条 100 分，恢复提供消失，勾选保留 | v1-27-records-two.png |

## 断网重进与离线对局（第二实例）

第一实例在「源站进程终止后页面内重载」时复现 M6 已记录的工具侧现象：agent-browser 守护进程对该页 eval/snapshot 失联（`Failed to read: Resource temporarily unavailable`，页面本身离线渲染正常）；`close --all` 恢复守护进程但该实例浏览器配置文件未保留。遂重建第二实例完成离线段：先在线重建一条记录，再断网重进。

第二实例在线段（第 3 局，二年级单选 6 题，全部首答正确）：①30+20−10=40 ②45+12−7=50 ③18+22−5=35 ④点阵5×2=10 ⑤点阵2×3=6 ⑥点阵3×4=12；结算「总分 60 / 一次通过 6/6 / 答错 0 次」，返回后恰 1 条记录（v1-30~v1-38）。

| # | 场景 | 预期 | 实际 | 截图 |
| --- | --- | --- | --- | --- |
| 11 | 断网重进（`kill` 源站进程，curl 确认 connection failed 后重新导航） | 页面由 SW 缓存完整加载、无错误屏、设置与记录可读 | 一致：`__pixelAcademyBooted=true`、`screen-error` 隐藏、SW controller 在位、二年级勾选恢复、缓存就绪提示带版本、1 条记录可读（`navigator.onLine` 保持 true，页面不进入 offline 事件分支，提示行维持就绪文案——如实记录口径：源站不可达，非系统级断网） | v1-39-offline-restart.png |
| 12 | 离线查看二年级可用内容 | 「二年级 6 道，共 6 道」 | 一致 | v1-40-offline-availability.png |
| 13 | 离线完整玩 6 题局到结算 | 逐题作答、结算与计分规则一致 | 一致：①点阵3×4=12 ②点阵5×2=10 ③45+12−7=50 ④18+22−5=35 ⑤点阵2×3=6 ⑥30+20−10=40，得分 0→…→60，结算「总分 60 / 一次通过 6/6 / 答错 0 次」 | v1-41-offline-q1.png、v1-42-offline-q2.png、v1-43-offline-q3.png、v1-44-offline-q4.png、v1-45-offline-q5.png、v1-46-offline-q6.png、v1-47-offline-settlement.png |
| 14 | 返回后查练习记录 | 离线局成绩入库、历史记录完整（恰 2 条） | 一致：`10-25 23:35`（离线局）+ `10-25 23:29`（在线局） | v1-48-offline-records.png |
| 15 | 再次断网重进（第二次新导航） | 记录与设置持久 | 一致：booted、恰 2 条、勾选保留 | v1-49-offline-reload-persist.png |

## 证据文档链接核对（m3–m6 相对路径可解析）

`node /tmp/m7acc-linkcheck3.mjs`（解析 m3/m4/m5/m6/m7 各 README 中的 markdown 相对链接与 `.png` 文件名引用，按文档所在目录解析）：合计 127 个引用，125 个直接解析存在。2 个标记项经人工核对均非失效链接：① m3 README 记载的 `19-grade2-normal-settlement.png` 为实现者已删除的误截图（原文明确「已由实现者删除，不作为证据」）；② m6 README 第 43 行按仓库根路径行文提及 `docs/evidence/m6/01-ready-with-version.png`，该文件自仓库根解析存在。**m7 README 指向 m3–m6 README 的 4 个相对链接全部可解析；未发现实际失效的证据引用。LINKCHECK: PASS（含上述说明）。**

## 未执行 / 未验证（如实记录）

1. **iOS Safari 真实设备未测**：本环境无真机。
2. **Android Chrome 真实设备未测**：本环境无真机。
3. **真实部署环境未验证**：本轮仅覆盖 localhost 安全上下文（`npm run serve`），部署位置未经用户确认。
4. **CI（GitHub Actions）未实际运行**：`.github/workflows/check.yml` 仅落盘，未获推送授权。
5. **`npm ci` 本轮未重跑**（按任务要求引用工作流已执行结果，不删除 node_modules）；`npm run check`/`build`/`serve` 本轮已实际执行通过。
6. 音效可听性（延续 M4 缺口）：无头环境无音频输出，未真人试听。
7. 乘法点阵教学有效性（延续 M2/M4 缺口）：需真实学生/教师实机观察；本轮仅按点阵数作答验证可读与可判。
8. 工具侧说明（非应用缺陷）：agent-browser 守护进程在源站进程死亡后对页面 eval/snapshot 失联两次复现（与 M6 已知限制⑥一致）；本轮以 `close --all` + 新标签页导航（SW 离线服务）完成离线段验证，页面行为本身全程正常。
