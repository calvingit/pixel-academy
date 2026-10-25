# M6 离线运行与资源更新 · 浏览器验证记录

执行者：zcode-agent（代理验证）。日期：2026-10-25。

> 2026-10-25 补：独立复核第 1 轮发现「waiting 语义不可依赖」缺口，修复与复验记录见文末「独立复核第 1 轮修复复验」；修复后构建版本基线为 `assets-v1-ce9e1f843c3c`。

## 环境

- macOS darwin 25.6.0 arm64，Node.js 24.20.0。
- 浏览器 A：agent-browser 0.39.2 驱动的无头 Chrome（HeadlessChrome/155.0.0.0，CDP），会话 m6v3；模拟器证据，非真实设备。
- 浏览器 B：独立无头 Google Chrome（macOS 系统 Chrome，`--headless=new`，CDP WebSocket 直连，脚本 /tmp/m6-cdp-verify.mjs、/tmp/m6-cdp-missing-resource.mjs，临时文件不入仓库）。引入浏览器 B 的原因：agent-browser 守护进程在「源站进程死亡」后会整体失联（eval/snapshot 均无响应，见「工具观察」），需要真实源站死亡的场景改由直连 CDP 完成。
- 本地服务：`npm run serve`（Node 内置 http，http://127.0.0.1:4173/，localhost 安全上下文）。
- 构建版本：`assets-v1-88d5a07f50eb`（基线，18 个预缓存资源）；更新流程中依次构造 `assets-v1-cdd6746309c4`、`assets-v1-40e1a2e9c44b`（对 web/style.css 依次追加临时注释触发重建，验证后已还原并重建回基线版本）。

## 「离线」的口径

- 场景 2/3（离线整局、离线刷新）：CDP `network route --abort` 丢弃**全部**源站请求——对页面而言每个资源请求都以网络失败告终，与源站不可达等价；`navigator.onLine` 仍为 true（宿主机联网），故状态提示行显示 ready 文案。
- 场景 7/8（源站死亡）：真实 `kill` 服务进程（连接拒绝），由浏览器 B 执行。

## 场景与结果

| # | 场景 | 预期 | 实际 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 首次在线访问，等待缓存完成 | 提示「离线缓存已就绪（版本 …），断网也能游玩。」带版本标记；Cache Storage 恰一个带前缀缓存、18 条资源（入口、样式、16 个 dist 模块含练习数据） | 一致；`caches.keys()` = `pixel-academy:number-puzzle:assets-v1-88d5a07f50eb`，18 条 URL 与预缓存清单逐一相同 | 01-ready-with-version.png；eval 输出（notice 文本 + 缓存清单） |
| 2 | 断网重开（abort 全部源站请求）后完整游玩 | 页面完整加载、能选年级、开局、逐题作答到结算、成绩离线保存 | 6 题局全部作答（经页面 pointerdown 事件按快照中的任务计算答案点击），结算「总分 60 / 一次通过 6/6 / 答错 0 次」；localStorage records 恰一条（二年级 MATH-013~018，contentVersion 指纹 fp1:6:…），中断快照按 M5 规则清除 | 02-offline-settlement.png；eval 输出（结算文本 + 记录 JSON） |
| 3 | 离线刷新与重复启动 | 再次离线重载后页面可用、设置与练习记录可读取 | 一致：`nav type=reload`、booted=true、二年级勾选恢复、记录列表显示「10-25 21:27 · 二年级 · 总分 60 · 一次通过 6/6 · 答错 0 次」 | 03-offline-restart-records.png |
| 4 | 选择屏上的版本更新（无进行中局次） | 新版本自动生效（skip-waiting 由页面发起）、controllerchange 后刷新、旧版本缓存被清理 | 重载后自动完成：notice 显示新版本 `assets-v1-cdd6746309c4`；`caches.keys()` 仅剩新缓存（旧 `…88d5a07f50eb` 已删除） | 04-updated-version.png |
| 5 | 单局中途更新 | 新版本下载但推迟生效（提示明示局次不受影响）；单局继续正常；返回选择屏后自动生效且成绩完整 | 开局后重建触发 `registration.update()`：notice=「新版本已下载，返回年级选择后自动生效；进行中的局次不受影响。」；两个缓存并存（激活 cdd6746309c4 + 等待 40e1a2e9c44b）；局中继续答对一题（得分 10）；整局打完结算 60/6/0；返回选择屏后自动采用并刷新，notice=新版本，`caches.keys()` 仅剩新缓存，两局成绩（两条 60 分）完整保留 | 05-after-midround-update.png；逐步 eval 输出 |
| 6 | 预缓存失败（首次安装） | 提示「离线缓存未完成，断网可能无法游玩。请联网后刷新本页重试。」、不承诺离线可玩；游戏在线仍可玩；失败原因消除后自愈 | 重置为首次状态（unregister + 删缓存 + 清存储）并使 web/style.css 暂时 404：install 失败、无 active SW、notice 为失败文案且带警示样式、boot 正常（游戏在线可玩）；恢复文件后重载 → ready | 06-precache-failed-notice.png |
| 7 | 离线且缓存缺失（源站真实死亡） | 导航请求回退到 SW 内置兜底页（可理解提示）；服务器恢复后重载自愈（缓存回填） | 浏览器 B：ready → 删除缓存 → kill 服务进程 → 重载 → 页面为兜底页「暂时无法打开游戏……」；重启服务后重载 → ready 且缓存回填 18 条 | 07-offline-fallback-page.png；/tmp/m6-cdp-verify.mjs 全流程 exit 0（含 fallbackOk:true、recovered.cacheEntries:18） |
| 8 | 主模块资源缺失（缓存条目被删 + 源文件 404，页面在线） | index.html 内联兜底脚本提示「页面资源加载失败，请刷新重试。」；不进入可玩状态；恢复后 ready | 浏览器 B：删除缓存中 main.js 条目 + 源文件临时改名 → 重载 → booted=false、游戏屏未显示、notice=「页面资源加载失败，请刷新重试。」（警示样式）；恢复后重载 → ready | 08-missing-resource-notice.png；/tmp/m6-cdp-missing-resource.mjs exit 0 |

## 已知限制

1. 「正在准备离线缓存……」（preparing）中间态未在浏览器截到：本地安装 18 个资源耗时过短，页面提示直接从 preparing 到达 ready；该文案与「不承诺离线可玩」逻辑由 tests/offline.test.mjs 覆盖，且 preparing→failed 的同一状态机转换在场景 6 浏览器实测。
2. 真实设备（iOS Safari / Android Chrome）未测：与 M3–M5 相同，属 M7 汇总缺口。Service Worker 在 iOS Safari 的行为（作用域、更新节奏）未验证。
3. 场景 2/3 的离线口径是「全部源站请求在网络层失败」；「真实源站死亡下的整局游玩」未在浏览器 B 重跑（场景 7 已证明源站死亡时 SW 正常服务导航与资源）。
4. 更新验证通过修改 web/style.css 触发（内容哈希变化即新版本），未修改练习数据本身；练习数据变化与样式变化走同一条版本链路（构建哈希覆盖 dist 内全部模块，见 tests/offline.test.mjs 清单一致性测试）。
5. agent-browser 守护进程在源站死亡后失联属工具侧观察（见下），非应用缺陷；产品侧表现由浏览器 B 的直连 CDP 验证覆盖。

## 工具观察（非应用缺陷）

- 会话 m6verify / m6v2 中，`kill` 源站进程后执行 `location.reload()`：页面本身离线渲染成功（截图 docs/evidence/m6/01-ready-with-version.png 同款界面在服务器死亡后仍完整出现），但 agent-browser 守护进程随后对 eval/snapshot 全部失联（“Failed to read: Resource temporarily unavailable”）。此后涉及源站死亡的场景改用独立 Chrome + CDP 直连完成。
- agent-browser 的 `network route --abort` 不拦截 Service Worker 内部发起的 fetch（CDP 拦截范围限制）：场景 7 初次尝试「删缓存 + abort + 重载」时页面仍完整加载，检查发现是 SW 在服务器存活时经 fetch 回填了缓存——该现象反向验证了「缓存被清后联网自动回填」的自愈路径。

---

# 验收员第 1 轮 · 独立浏览器验收（M6 离线运行与资源更新）

执行者：zcode-agent（浏览器验收员，代理验证）。日期：2026-10-25。本轮为验收员第 1 轮，与上方实现者验证记录相互独立；文件名以 `v1-` 前缀区分。`docs/evidence/M6/` 与 `docs/evidence/m6/` 在 macOS（大小写不敏感文件系统）为同一目录。

## 环境

- macOS darwin 25.6.0 arm64，Node.js v24.20.0。
- 浏览器 A：agent-browser 0.39.2 驱动的无头 Chrome（HeadlessChrome/155.0.0.0，CDP），会话 m6acc1（S1–S3）与会话 m6acc2（S5）；模拟环境，非真实设备，视口 1280 宽（桌面）。
- 浏览器 B：独立无头系统 Google Chrome 156.0.8078.47（`--headless=new`，CDP WebSocket 直连，脚本 /tmp/m6-acc1-cdp.mjs，临时文件不入仓库）。引入浏览器 B 的原因：agent-browser 守护进程在源站进程被 kill 后整体失联（与实现者轮观察一致），涉及真实源站死亡的场景改由直连 CDP 完成。
- 本地服务：`npm run serve`（Node 内置 http，http://127.0.0.1:4173/，localhost 安全上下文，响应带 `cache-control: no-store`）。
- 构建版本：基线 `assets-v1-88d5a07f50eb`（`npm run build` 输出：18 个预缓存资源、16 个 dist 模块）。S5 依次构造 `assets-v1-34ed1e7af440`（V2）、`assets-v1-598fc91ba3c4`（V3）：向构建产物 `dist/game/number-puzzle/render.js` 追加一行注释后重跑 `node scripts/build-sw.mjs` 重算版本——未改动任何受版本控制的源文件（dist/ 与 web/sw.js 均为 gitignore 构建产物）；验证结束后已执行 `npm run build` 恢复基线版本并确认 dist 内无残留（grep verify-note = 0）。

## 「断网」的口径

- S2/S3：CDP `Network.emulateNetworkConditions offline=true`（`agent-browser set offline on`，浏览器级离线仿真，`navigator.onLine=false`）。对照实验（见「加强对照」）证明该仿真下网络请求真实失败、SW 缓存命中不受影响。
- S4：真实 `kill` 服务进程（curl 连接拒绝，exit 7），由浏览器 B 执行。

## 场景与结果（全部通过）

| # | 场景 | 步骤 | 预期 | 实际 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | 首次在线加载 → 缓存就绪 | 清态（无注册/无缓存）→ 打开 localhost → 等待提示 | SW 已注册；提示带版本标记；缓存含入口、脚本与练习数据 | 提示「离线缓存已就绪（版本 assets-v1-88d5a07f50eb），断网也能游玩。」；`getRegistration()`：scope=`http://127.0.0.1:4173/`、active state=activated、scriptURL=`/sw.js`、controller=true；缓存恰 1 个带前缀缓存、18 条 URL：入口 `/`、`/style.css`、16 个 dist 模块（含入口 main.js 与数据模块 exercises/textbooks/units/skills/evidence.js 等），与预缓存清单逐一相同 | v1-01-first-online-ready.png；eval 输出（注册信息 + 18 条 URL 全列表） |
| 2 | 网络请求列表无远程内容 | 清空请求记录后整页重载，HAR 录制 | 无远程字体、CDN 或在线内容请求，全部同源 | HAR 恰 18 条请求、全部 `http://127.0.0.1:4173/…`（入口/样式/16 模块，无 Font 类型、无第三方 origin）；静态检查：web/index.html、web/style.css、web/sw.source.js 无 `https?://` 外链、style.css 无 `@font-face`/`url(` | /tmp/m6-v1.har（18 entries 全列表）；grep 输出（0 命中） |
| 3a | 断网新开上下文冷启动 | `set offline on` 后新开标签页导航到入口 | 直接可玩（全部资源来自缓存） | `onLine=false`、booted=true、controller=true、选择屏可见、提示「当前处于离线状态，正在使用已缓存资源（版本 assets-v1-88d5a07f50eb）。」、内容提示「当前开放：一年级、二年级（数学）」 | v1-02-offline-cold-start.png；eval 输出 |
| 3b | 断网刷新当前页 | 离线保持，reload（navigation type=reload） | 仍可玩 | booted=true、选择屏可见、同上提示 | v1-03-offline-reload.png；eval 输出 |
| 3c | 断网完整一局到结算并保存 | 离线下选二年级 → 查看可用内容（「二年级 6 道，共 6 道」）→ 开始 → 逐题经画布 pointerdown 点选正确块（答案经页面内 import dist/learning/evaluation.js 的 answerFor 计算）到结算 | 可完整游玩；成绩离线保存；中断快照清除 | 结算「总分 60 / 一次通过 6/6 / 答错 0 次」；localStorage records 恰 1 条（recordId np-5295d345…、grades [2]、contentVersion fp1:6:6fc38f7859a65a62、6 题 MATH-013~018 各 10 分）；中断快照键为 null | v1-04-offline-settlement.png；eval 输出（结算文本 + 记录 JSON） |
| 4 | 断网重复启动两次 | 离线下再新开标签页 ×2 | 两次均正常启动、设置与记录可读 | 两次均 booted=true、controller=true、二年级勾选恢复、记录列表显示「10-25 21:52 · 二年级 · 总分 60 · 一次通过 6/6 · 答错 0 次」 | v1-05-offline-restart1.png、v1-06-offline-restart2.png；eval 输出 |
| 5 | 缓存缺失 + 离线（浏览器 B，CDP 脚本，exit 0） | 5a 清空全部缓存 + kill 服务 → 重载；5b 恢复服务重载（自愈）；5c 仅删缓存中 `/dist/game/number-puzzle/main.js` 条目 + kill 服务（开离线仿真）→ 重载；5d 恢复服务重载 | 5a 出现可理解兜底页，不白屏、不暴露错误栈；5b 缓存回填自愈；5c 内联提示且不进入可玩态；5d 恢复 ready | 5a 兜底页「暂时无法打开游戏／当前处于离线状态，页面资源没有完整缓存。／请联网后重新打开本页…」（title 数字消除 · 离线提示），bodyText 无 `Error:`/堆栈、booted=false；5b ready 且缓存回填 18 条；5c 页面壳渲染 + 警示提示「当前处于离线状态，页面资源未完整缓存，无法开始游戏。请联网后打开本页…」，booted=false、选择屏/游戏屏均隐藏、无错误栈、onLine=false；5d ready、booted=true、18 条 | v1-07-fallback-cache-missing.png、v1-08-partial-cache-missing.png、v1-09-recovered-ready.png；/tmp/m6-acc1-cdp-results.json（SUMMARY_PASS=true） |
| 6 | 重建新版本 + 在线刷新（选择屏） | 构造 V2 → 在线刷新 | 新版生效、旧缓存清理 | 刷新后自动采用：提示版本 assets-v1-34ed1e7af440、active=activated、waiting=false、`caches.keys()` 仅剩 V2 缓存（V1 已删） | v1-10-updated-v2.png；eval 输出 |
| 7 | 局中更新推迟 + 刷新不破坏进行中局次 | 开局答对 2 题（得分 20）→ 构造 V3 → 页面内 `registration.update()` 触发检查 → 局中再答对 1 题 → 刷新 → 继续上局打完 | 推迟提示明示局次不受影响；双缓存并存；局中可继续作答；刷新后局次完整可恢复、续局结算不重复计分；最终仅剩新缓存 | 提示「新版本已下载，返回年级选择后自动生效；进行中的局次不受影响。」；caches=[V2 激活, V3 等待] 并存；局中第 3 题正常作答（得分 30）；刷新后恢复提供「检测到上次未完成的局次：已完成 3/6 题，得分 30。」且 V3 自动采用（提示 assets-v1-598fc91ba3c4、caches 仅剩 V3）；恢复时处于暂停覆盖层（重载触发 M4 切后台自动暂停、经 M5 原样恢复，属规格行为）→「继续游戏」后打完 Q4–Q6，结算「总分 60 / 一次通过 6/6 / 答错 0 次」；records 恰 1 条（60/6/0，recordId …f197842e）、快照清除——30（刷新前）+30（刷新后）无重复计分、无丢失 | v1-11-midround-defer-notice.png、v1-12-midround-play-continues.png、v1-13-refresh-restore-offer.png、v1-14-resumed-settlement.png；eval 输出 |

## 加强对照（离线仿真真实性）

`set offline on` 后页面内对照实验：`fetch('/sw.js')`（清单外、必走网络）→ **失败**（Failed to fetch），`fetch('/dist/game/number-puzzle/render.js')`（清单内、SW 缓存）→ **200**——证明离线仿真下网络请求真实被阻断、缓存命中不经过网络；随后整页重载 booted=true、提示离线使用已缓存资源。证据：v1-15-offline-emulation-reload.png + eval 输出。

## 工具观察（非应用缺陷）

1. agent-browser 守护进程在 `kill` 源站进程后对 reload/eval 全部失联（"Failed to read: Resource temporarily unavailable (os error 35)"），与实现者轮记录一致；涉及真实源站死亡的场景（场景 5）改由浏览器 B 直连 CDP 完成。
2. `agent-browser network route --abort` 与 SW 控制的页面叠加时会破坏缓存加载：route 激活 + 离线仿真下重载出现 booted=false、资源被拦截中止（v1-15-double-offline-reload.png 留证）。route 拦截作用于页面目标、连 SW 命中缓存的响应一并中止，不适合作为 SW 应用的断网模拟手段（与实现者轮「route 不拦截 SW 内部 fetch」的观察互补）；本轮断网口径因此采用浏览器级离线仿真。该叠加操作期间基线 V1 经更新检查与安装流程进入等待、并在页面恢复后自动采用（最终状态：V1 为唯一激活缓存、V3 缓存被清理）——与场景 6 直接演示的「在线采用新版本并清理旧缓存」机制一致。

## 已知限制与未验证项

1. **真机未验证**：iOS Safari / Android Chrome 真实设备本轮未测（本环境无真机），全部证据来自桌面无头 Chrome 模拟；与 M3–M5 及实现者轮相同，属 M7 汇总缺口。SW 在 iOS Safari 的更新节奏与作用域行为未验证。
2. **真实部署环境未验证**：本轮仅覆盖 localhost/127.0.0.1 安全上下文（`npm run serve`）；部署到真实域名/主机后的 SW 注册、更新与缓存行为未验证，属 M7 交付验收范围。
3. 「正在准备离线缓存」中间态未在浏览器截到（本地安装 18 个资源过快，提示直接到达 ready），与实现者轮一致；本轮任务清单未要求 preparing→failed 转换，未复测。
4. S2/S3 的断网为浏览器级离线仿真（CDP emulateNetworkConditions）而非物理断网；其真实性由「加强对照」实验与 S4 的真实源站死亡场景共同支撑。
5. 版本更新以「构建产物 dist 注释 + 重跑 build-sw」触发（与真实改码后构建走同一条内容哈希链路），未单独修改练习数据或样式源文件重跑；未改动受版本控制源文件，验证后已恢复基线构建。
6. 本轮视口为桌面 1280 宽，非手机尺寸；手机尺寸与触摸的完整验收属 M4（已完成）与 M7 汇总，不在本轮任务清单内。

## 截图索引（v1- 前缀，共 16 张）

| 文件 | 内容 |
| --- | --- |
| v1-01-first-online-ready.png | 首次在线加载缓存就绪（提示带版本标记 + 选择屏） |
| v1-02-offline-cold-start.png | 断网新开标签页冷启动可玩 |
| v1-03-offline-reload.png | 断网刷新当前页仍可玩 |
| v1-04-offline-settlement.png | 断网整局结算 60/6/0 |
| v1-05-offline-restart1.png / v1-06-offline-restart2.png | 断网重复启动两次（记录与设置可读） |
| v1-07-fallback-cache-missing.png | 清空缓存 + 源站死亡 → SW 兜底页 |
| v1-08-partial-cache-missing.png | 仅缺主模块 + 源站死亡 → 内联警示提示、不可玩态 |
| v1-09-recovered-ready.png | 服务恢复后缓存回填、回到 ready |
| v1-10-updated-v2.png | 选择屏在线刷新自动采用 V2 |
| v1-11-midround-defer-notice.png | 局中更新推迟提示（游戏屏，得分 20 · 第 3/6 题） |
| v1-12-midround-play-continues.png | 等待更新期间局中继续作答正常 |
| v1-13-refresh-restore-offer.png | 刷新后 V3 已采用（提示新版本号；恢复提供与记录区在视口下方，文本以 eval 输出记录） |
| v1-14-resumed-settlement.png | 续局结算 60/6/0（无重复计分） |
| v1-15-offline-emulation-reload.png | 离线仿真对照实验后整页重载可玩 |
| v1-15-double-offline-reload.png | 工具观察②现场（route 拦截破坏 SW 缓存加载，非应用行为） |

---

# 独立复核第 1 轮 · 缺口修复复验（实现者执行，2026-10-25）

复核发现（非阻塞）：agent-browser 驱动的 HeadlessChrome/155 中，SW 更新可跳过 waiting 直通激活（installing→activating→activated、`registration.waiting` 全程 null、旧版本缓存被即时清理），此时 `main.ts` adopt 分支向 `registration.waiting` 发 skip-waiting 是静默无操作，页面停在「正在应用新版本，页面即将刷新。」且不刷新，需手动刷新才恢复；功能验收不受影响（新版本实际已激活、局次与成绩完整）。

修复（本轮，最小改动）：`src/game/number-puzzle/offline.ts` 新增纯函数 `planAdoptionExecution`——waiting 存在 → `send-skip-waiting`（原路径）；waiting 缺失且新版本已接管（controller 不同于页面加载时记录的 `initialController`）→ `reload`（刷新后新页面以新 controller 为初始值，不重复刷新）；waiting 缺失且 controller 未变 → `settle`（仅收敛提示状态，防刷新循环）。`src/game/number-puzzle/main.ts` adopt 分支改按执行计划处理，不再对可能为 null 的 waiting 发消息。tests/offline.test.mjs 新增 3 项覆盖三态与优先级。

复验（会话 m6fix，agent-browser HeadlessChrome/155.0.0.0 经 CDP，逐条 eval 数据）：

1. **正常 waiting 时序观察**：改文件重建（版本 `assets-v1-029795d9bf62`）→ 选二年级开局 → `reg.update()` → 50ms×40 次采样：installing→waiting=true 稳定、notice=defer 文案「新版本已下载，返回年级选择后自动生效；进行中的局次不受影响。」。
2. **复核失败模式构造与修复验证**：向 waiting worker 手动 `postMessage({type:'skip-waiting'})`（与浏览器直通激活的最终运行状态等价）→ 2 秒后 waiting=null、caches 仅剩新版本、游戏屏未受影响、notice 仍为 defer → 局中继续打完整局（结算 60/6/0，notice 仍 defer，局次未受更新影响）→ 点「返回年级选择」→ **页面自动刷新**（eval 报 "Inspected target navigated or closed"，即修复后 reload 分支的直接证据；修复前此处不刷新、notice 卡死）→ 新页面 notice=「离线缓存已就绪（版本 assets-v1-029795d9bf62），断网也能游玩。」、`stuckOnAdopting=false`、选择屏正常、caches 仅剩新版本、成绩 60 分完整保留。截图 10-review-fix-reload.png。
3. **正常 waiting 路径回归**：选择屏（无局次）再触发更新（版本 `assets-v1-7bbc61e67e45`）→ waiting → adopt → send-skip-waiting → controllerchange → 自动刷新（同一 "target navigated" 证据）→ 新版本 ready、caches 仅剩新版本。
4. **waiting 缺失且 updateWaiting 未置位变体**：首轮实验中 `reg.update()` 直通激活、页面未观察到 installed 状态（handler 读 `worker.state` 时已 activating），页面无 defer 提示、notice 经 activate 广播显示新版本 ready、游戏与返回流程全程可玩无卡死（updateWaiting=false 时 adopt 不触发）；settle 分支（updateWaiting=true 且 waiting 缺失且 controller 未变）未在浏览器单独构造，语义由单测覆盖。
5. **结论**：复核缺口已修复——waiting 缺失不再卡死、两种时序均收敛；正常 waiting 路径回归通过；`npm run check` 在修复后代码上执行通过（pass 73 / fail 0，typecheck + build + node --test）；最终基线冒烟（11-final-fixed-baseline.png）：版本 `assets-v1-ce9e1f843c3c` ready、选择屏正常。

补充观察：同一浏览器内 `reg.update()` 触发的更新两轮表现不同（首轮直通、次轮进入 waiting），waiting 是否出现取决于 installed 状态被页面 statechange handler 观察到与否的竞态——实证了「更新机制依赖浏览器 waiting 语义」的复核意见；修复后两种时序均收敛。
