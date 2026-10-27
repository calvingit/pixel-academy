# M12 算术地下城设备模拟器验证(Android Chrome / iOS Safari)

执行于 2026-10-27,执行者为 **zcode-agent 代理验证**(只验证与记录、不修改任何游戏代码),依据 [玩法说明](../../../gameplay-arithmetic-dungeon.md),口径对齐 M8 设备模拟器验证(方法先例 [m8/device-simulators/](../../m8/device-simulators/) 的 `android-round.mjs` / `ios-round.mjs` 与 M8 README「设备模拟器验证」节)+ M12 桌面验收轮([../README.md](../README.md) D 轮与缺陷修复复验轮,判题自算方法同源)。

**一句话结果:两台设备各 4 项场景(在线完整通关局、返回路径与三入口、离线断源完整探索含整数题键入提交、贯穿检查)全部通过;全程无横向溢出、JS 错误 0、金币零收支;未发现新的游戏缺陷。**

## 环境与版本

- 构建版本 `assets-v1-ed99dbc5fe1a`(与桌面缺陷修复复验轮一致,含缺陷 #1「整数题键入联动」与缺陷 #2「resolving 窗口按钮 disabled」修复);本地源 `node scripts/serve.mjs`(Android 4273 / iOS 4373);零新增依赖。
- 判题与取题核验:正式池经 dist 产物在页面内 `selectDungeonExercises([1])` 现取(1074 题全 `approved`,题型 binary 57 / choice 1017,即整数题约占每槽位 5.3%);答案一律从页面题面(`#question-prompt` 的 `dataset.exerciseId`)查正式池自算(`correctOptionIds` / `answerFor`),未注入任何游戏状态。开局后先读中断快照 `usedIds` 预窥 4 题题型,不含整数题则弃局重开(弃局不产生成绩),保证「整数题键入提交」必然覆盖。
- 驱动脚本与结构化结果:本目录 `android-round.mjs` / `android-results.json`(含 `android-online-results.json` / `android-offline-results.json` 分相),`ios-round.mjs` / `ios-results.json`(含 `ios-online-results.json` / `ios-offline-results.json` 分相)。

### Android

- emulator-5556(常驻实例,复用 M7/M8 同一台):Android 14,Chrome 113(系统镜像 UA 上报 Android 10),视口 412×790 CSS px(dpr 2.625);origin 经 `adb reverse tcp:4273` 指向本地 serve,模拟器内访问 `http://localhost:4273/`(安全上下文,SW 可用)。
- CDP 走 **browser 级 endpoint + `Target.attachToTarget(flatten)`**(per-page WebSocket 在本机 Chrome 113 握手成功但命令可能无响应,先例 m8/production/android-prod-smoke.mjs);开跑前 `am force-stop com.android.chrome` 清环境(存储保留,断言均为相对值);驱动前 `KEYCODE_WAKEUP` + `Page.bringToFront`。
- 输入全部为 `Input.dispatchTouchEvent` **真实触摸**;整数题为**真实键入**:真实触摸聚焦输入框后逐字符 `Input.insertText`(触发页面原生 input 事件管线,与桌面复验轮 F2 探针同法),逐字符记录「开门」按钮 disabled 实时联动;软键盘遮挡时 `KEYCODE_BACK` 收起并等待视觉视口恢复后再点提交。

### iOS

- iPhone 16 Pro 模拟器(**iOS 18.6**,UDID `28F2F0F0-4732-4493-816A-A382DCBF329A`,与 M7/M8 同设备;iOS 27.0 运行时 safaridriver 无法创建会话,不使用),Safari UA `iPhone OS 18_6`(会话能力强制 `platformName: iOS` + `safari:useSimulator: true`,以 UA 含 iPhone 确认未回退 macOS Safari),视口约 402×678 CSS @3x;safaridriver 26.6.2(`-p 4801`)。
- safaridriver 对 iOS 模拟器 HID 输入注入不完整(M7 实测,与 M3–M8 证据同口径),输入采用:DOM 控件 execute 内 `el.click()`;**整数题键入为合成输入**(execute 设 `input.value` + `dispatchEvent(new Event('input'))`,与 `el.click()` 同口径的合成输入,如实记录,非物理键盘输入),记录键入前后「开门」按钮 disabled 联动后点击提交。
- 截图 `simctl io <udid> screenshot` 经 /tmp 中转拷入本目录(工作区直写无权限);safaridriver 配对锁残留会阻断新会话(见「首跑失败」)。

## Android 场景与结果(全部通过)

| # | 场景 | 结果 |
| --- | --- | --- |
| A1 | 在线完整通关局(整数键入 + choice 触摸 + 答错换题重试档) | 菜单「算术地下城」入口(href=/dungeon.html、装饰字 aria-hidden)进入地下城;勾一年级→「本层题库:一年级 1074 道,共 1074 道」;第 7 次开局(题型 choice/binary/choice/choice):石门 choice 触摸作答→岔口(+10)→左门**整数题「2 + 8 = ?」逐字符真实键入 10、每字符「开门」实时启用(键入前 disabled=true)、点击提交受理**→资源房(+20)→资源机关 choice→钥匙 1/1→折回岔口→右门「8 + 2 ＝ 10,对不对?」故意答错(✗、不解锁、得分仍 30)→「换一题」→答对(重试档 +5)→结算「总分 35」「作答 4 题 · 首答 3/4 · 重试 1 次」「路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 0 把 / 剩 1 把」,与计分规则逐项吻合(10+10+10+5=35);练习记录新增 1 条(gameId=arithmetic-dungeon、recordId=roundId、score=35、keyUses=0、route 完整),列表显示「35 分 · 首答 3/4 · 重试 1」;recent-ids 含本局全部题目 ID;IndexedDB 金币局前 20 = 局后 20(零收支) |
| A2 | 返回路径与三入口并存 | 地下城顶栏「返回数字消除」回首页;数字消除勾选一年级→下一步按钮启用(取消复原);菜单弹层内「汉字勇者」(href=/hanzi.html)与「算术地下城」(href=/dungeon.html)两锚点并存可见(数字消除为当前页) |
| A3 | 离线断源(缓存打开 + 断网完整探索含整数键入提交) | 本轮源站已在先前场景断开,**自导航起全程离线(首页导航由 SW 导航回退服务)**:首页与菜单进 /dungeon.html 均由缓存打开(6 年级卡、boot-fail 隐藏);断网下题库模块经 SW 预缓存 import 成功(1074 题);第 14 次开局完整通关:左门**整数题「1 − 0 = ?」逐字符键入 1、提交受理(+10 首答档)**→结算「总分 40」「作答 4 题 · 首答 4/4 · 重试 0 次」;离线练习记录新增 1 条(gameId=arithmetic-dungeon、score=40,与其他游戏记录区分);结算返回后中断快照清除;离线金币 20 = 20 |
| A4 | 贯穿检查 | 11 个检查点(在线 6 + 离线 5)`scrollWidth ≤ innerWidth` 全部成立;JS 错误台账全程 0(`android-*-results.json` 的 overflowLedger / errorLedger) |

### Android 截图索引

- A1 `android-online-01-home`(首页)、`02-home-menu`(菜单弹层:两游戏入口并存)、`03-dungeon-select`(地下城选择屏与返回锚点)、`04-resource-key`(资源房·钥匙 1/1·得分 30)、`05-right-wrong`(右门答错 ✗ 反馈)、`06-result`(35 分结算)、`07-records`(练习记录)
- A2 `android-online-08-home-returned-menu`(返回后首页菜单三入口)
- A3 `android-offline-01-home`(断网首页)、`02-dungeon-select`(断网地下城选择屏)、`03-offline-explore`(左门「1 − 0 = ?」键入 1 后 ✓ +10 反馈、开门按钮启用)、`04-offline-result`(断网 40 分结算)
- A4 为贯穿检查,无独立截图

## iOS 场景与结果(全部通过)

| # | 场景 | 结果 |
| --- | --- | --- |
| I1 | 在线完整通关局(整数合成键入 + choice 点击 + 答错换题重试档) | 菜单「算术地下城」入口进入地下城;勾一年级→「本层题库:一年级 1074 道,共 1074 道」;第 6 次开局:石门/左门 choice 点击作答(+10×2)→资源机关**整数题「4 + 5 = ?」合成键入 9(input 事件实时启用「开门」,键入前 disabled=true)、点击提交受理**(+10)→钥匙 1/1→折回岔口→右门「6 + 3 ＝ 10,对不对?」故意答错(✗、不解锁、得分仍 30)→「换一题」→答对(重试档 +5)→结算「总分 35」「作答 4 题 · 首答 3/4 · 重试 1 次」「路线 … · 备用钥匙 用 0 把 / 剩 1 把」;练习记录新增 1 条(gameId=arithmetic-dungeon、score=35);recent-ids 含本局全部题目 ID;金币局前 20 = 局后 20 |
| I2 | 返回路径与三入口并存 | 同 A2(「返回数字消除」回首页、一年级可勾选、菜单两游戏锚点并存) |
| I3 | 离线断源刷新(缓存打开 + 断网完整探索含整数合成键入提交) | SW `pixel-academy:number-puzzle:assets-v1-ed99dbc5fe1a` 受控且预缓存含 /dungeon.html(含 /dungeon.css)→杀 serve 4373(源站 fetch 确认失败)→**Safari 刷新同一标签页(非冷导航)**:首页由缓存打开(提示「离线缓存已就绪(版本 assets-v1-ed99dbc5fe1a),断网也能游玩。」)、菜单进 /dungeon.html 由缓存正常加载;断网题库 import 成功(1074 题);第 5 次开局完整通关:左门**整数题「1 − 1 = ?」合成键入 0、提交受理(+10 首答档)**→结算「总分 40 · 首答 4/4」;离线记录新增 1 条(score=40);结算返回后中断快照清除;离线金币 20 = 20 |
| I4 | 贯穿检查 | 11 个检查点 `scrollWidth ≤ innerWidth` 全部成立;JS 错误台账全程 0 |

### iOS 截图索引

- I1 `ios-online-01-home`(首页)、`02-home-menu`(菜单弹层)、`03-dungeon-select`(地下城选择屏)、`04-resource-key`(资源房·钥匙 1/1)、`05-right-wrong`(右门答错 ✗)、`06-result`(35 分结算)、`07-records`(练习记录)
- I2 `ios-online-08-home-returned-menu`(返回后首页菜单三入口)
- I3 `ios-offline-01-home`(断网首页,离线提示可见)、`02-dungeon-select`(断网地下城选择屏)、`03-offline-explore`(左门「1 − 1 = ?」键入 0、开门启用、房间已推进岔口得分 20)、`04-offline-result`(断网 40 分结算)
- I4 为贯穿检查,无独立截图

## 首跑失败与驱动脚本修复过程(如实记录,均为验证工具问题而非游戏缺陷)

1. **Android 离线第 1 跑(整数题提交未受理)**:软键盘遮挡「开门」按钮,`KEYCODE_BACK` 收起后键盘收起动画期间的真实触摸被吞,倒计时耗尽。脚本改为收起后等待 `visualViewport` 恢复 + 提交点击重查重试(最多 3 次)。
2. **Android 离线第 2 跑(8 局未抽到整数题)**:整数题占比 57/1074≈5.3%/槽位,仅要求石门为整数题命中率过低(纯随机,非缺陷)。改为「断网完整探索逐门作答、任一门命中整数题即覆盖」策略(每局 4 槽累积命中率约 19.6%),第 14 局命中。补充跑(第 3 跑)另出现 `collectKey` 8 次点击未闭合(整数题键入后软键盘未收起的组合,现场快照已被后续弃局清理,根因未完全定位)——脚本加入提交后主动收键盘与 collectKey 前防御性收键盘;最终跑通过(该组合未复现,如实记录)。
3. **iOS 配对锁两次**:`Could not create a session: The Safari instance is already paired with another WebDriver session`。第一次按既定口径 `killall Safari` + `simctl terminate/launch com.apple.mobilesafari` 清理;第二次定位到驱动脚本离线分支 `process.exit()` 跳过了 finally 里的会话 DELETE(改为 if/else 复用 finally,跑完自动清理)。
4. **iOS 源站已死时新导航不落缓存**:离线脚本首跑曾以「无源站直接 WebDriver 导航」开始,等待首页超时——与 M7/M8 已知 WebKit 行为一致(离线冷导航 SW 不被唤醒落系统错误页),**不算缺陷**;iOS 离线保持「在线导航 → 杀源 → 刷新同一标签页(非冷导航)」口径。Android 上同场景(源站已死 `Page.navigate`)则由 SW 导航回退正常服务(A3 即以此口径完成,两平台行为差异如实记录)。

## 与桌面验收口径的差异与说明

- 整数题「键入提交」两台设备口径不同:Android 为**真实键入**(insertText 触发原生 input 事件管线,更接近物理键盘);iOS 为**合成输入**(execute 设 value + dispatch input 事件,与 el.click 同口径)。M12 缺陷 #1 修复(键入实时启用「开门」)在两台设备均实测成立,断网下亦然。
- iOS 的「收下钥匙」在 resolving 窗口内首次点击同样被 disabled 挡下(缺陷 #2 修复后的预期形态),重试点击生效(Android 在线局点击 2 次、iOS 在线局 2 次),与桌面复验轮探针 B 一致。
- 年级覆盖仅一年级(与桌面轮同口径);多选年级、三年级置灰等年级组合行为未在模拟器重跑(桌面 D3 已覆盖,模拟器轮聚焦玩法主路径与离线)。

## 已知限制与未验证项

1. **模拟器证据不代表物理真机**:触控手感、性能、真实设备系统差异未覆盖;Android 为 Chrome 113 系统镜像(UA 上报 Android 10),iOS 为 18.6 模拟器(27.0 运行时不可驱动)。
2. **iOS 合成输入口径**:整数题「键入」为 WebDriver execute 设置 `input.value` + dispatch input 事件(与 `el.click()` 同口径),非物理键盘输入;物理键盘路径未在 iOS 验证(Android 已以真实键入覆盖同一联动)。
3. **iOS 生产环境未复跑**:本轮两台设备均为本地源;生产环境(Cloudflare Pages 308 规范化、生产 SW 行为)仅桌面无头 Chrome 已验(见 [../production/](../production/)),模拟器未对生产 URL 复跑。
4. SW 预缓存断言经页面 caches API 完成(`/dungeon.html`、`/dungeon.css`、模块闭包离线可用);sw.js 本体不进预缓存,「SW 清单文本含 dungeon 入口」在源站存活的中间跑经在线 fetch 核验为 true,最终离线跑该项为缓存外核验(桌面 D9 与 `tests/offline.test.mjs` 已覆盖清单断言)。
5. 抽题为随机采样(整数题靠弃局重开命中),未穷举题库;两台设备各完成 1 局含整数题的完整通关局 + 1 局断网完整通关局,「备用钥匙代替重试解锁」路径未在模拟器重跑(桌面 D5/F3 已覆盖)。
6. 音效可听性未验证(模拟器无音频断言);教学有效性、学生可读性缺口不变(与桌面轮一致)。
7. 驱动脚本依赖本机模拟器(adb reverse / safaridriver)与本地 serve,不直接重放;断言含时序轮询,更慢环境可能需放宽超时。
