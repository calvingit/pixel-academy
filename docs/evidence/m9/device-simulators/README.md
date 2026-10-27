# M9 拼音冒险设备模拟器验证(Android Chrome / iOS Safari)

执行于 2026-10-27,执行者为 **zcode-agent 代理验证**(只验证与记录、不修改任何游戏代码),依据 [PLAN.md M9 小节](../../../PLAN.md)、[音频来源方案](../../../m9-audio-prep.md)与[拼音内容审核](../../../content-review-pinyin.md),口径对齐 M12 设备模拟器验证(方法先例 [m12/device-simulators/](../../m12/device-simulators/) 的 `android-round.mjs` / `ios-round.mjs` 与其 README)+ M9 桌面验收轮([../README.md](../README.md) P 轮与缺陷修复复验轮,音频状态机断言同源)。

**一句话结果:Android Chrome 4 项场景全部通过(含听辨 3/3 题 Audio playing + 请求 200 双通道、断网听辨播放缓存命中);iOS Safari 3 项场景通过(辨认作答/重试档/记录/金币/降级路径/缓存命中/贯穿检查),「听辨题 Audio playing 断言」在 iOS 记受阻——iOS 模拟器自动化无任何真实手势通道(探针证据见下),游戏按设计的「音频不可用降级」路径在该平台实测成立。全程无横向溢出、JS 错误 0、金币零收支;未发现游戏代码缺陷。**

## 环境与版本

- 构建版本 `assets-v1-9f9ffaac4a45`(与桌面缺陷修复复验轮一致;本轮开始前 `npm run build` 重新构建,`web/sw.js` 预缓存 108 项,含 `/pinyin.html`、`/pinyin.css`、拼音 dist 模块与 47 条 `/audio/pinyin/*.wav`);零新增依赖。
- 判题与取题核验:正式池经 dist 产物在页面内 `selectPinyinExercises([1])` 现取(94 题全 `approved`,辨认 47 + 听辨 47);答案一律从页面题面(`#q-prompt` 的 `dataset.exerciseId`)经 `/dist/learning/pinyin.js` 的 `correctPinyinAnswer` 自算,未注入任何游戏状态。
- 驱动脚本与结构化结果:本目录 `android-round.mjs` / `android-results`(`android-online-results.json` + `android-offline-results.json`)、`ios-round.mjs` / `ios-results`(`ios-online-results.json` + `ios-offline-results.json`,含 `blocked` 受阻台账)。
- 环境收尾:验证完成后本地 serve(4273/4373)均已终止(两处 serve 被各自离线场景按口径杀源,事后确认无残留进程);Android 模拟器飞行模式全程保持原状(0/关,未启用过);iOS 模拟器保持 Booted 原状。

### Android

- emulator-5556(常驻实例,复用 M7/M8/M12 同一台):Android 14,Chrome 113.0.5672.136(系统镜像 UA 上报 Android 10),视口 412×790 CSS px(dpr 2.625);origin 经 `adb reverse tcp:4273` 指向本地 serve,模拟器内访问 `http://localhost:4273/`(安全上下文,SW 可用)。
- CDP 走 **browser 级 endpoint + `Target.attachToTarget(flatten)`**(per-page WebSocket 在本机 Chrome 113 握手成功但命令可能无响应,先例 m8/production/android-prod-smoke.mjs);开跑前 `am force-stop com.android.chrome` 清环境(存储保留,断言均为相对值);驱动前 `KEYCODE_WAKEUP` + `Page.bringToFront`。
- 输入全部为 `Input.dispatchTouchEvent` **真实触摸**(辨认/听辨候选与全部按钮)。
- 本地源 `node scripts/serve.mjs 4273`。**注意:serve.mjs 对 `.wav` 返回 `application/octet-stream`(MIME 表无 wav 映射,scripts/serve.mjs:13-24),Chrome 嗅探内容仍正常加载播放,故 Android 未受影响;Safari 严格校验媒体 MIME,该缺口在 iOS 轮暴露(见下)。**

### iOS

- iPhone 16 Pro 模拟器(**iOS 18.6**,UDID `28F2F0F0-4732-4493-816A-A382DCBF329A`,与 M7/M8/M12 同设备;iOS 27.0 运行时 safaridriver 无法创建会话,不使用),Safari UA `iPhone OS 18_6`(会话能力强制 `platformName: iOS` + `safari:useSimulator: true`,以 UA 含 iPhone 确认未回退 macOS Safari),视口约 402×678 CSS @3x;safaridriver 26.6.2(`-p 4801`)。
- safaridriver 对 iOS 模拟器 HID 输入注入不完整(M7 实测,本轮再次证实:WebDriver **原生 element click 端点调用成功但 onclick 处理器从未触发**),输入口径与 M3–M12 同:DOM 控件 execute 内 `el.click()`(合成点击,`isTrusted=false`,如实记录)。
- 本地源为**验证旁路服务 `/tmp/serve-mime.mjs 4373`(不入库)**:`scripts/serve.mjs` 的逐行克隆,仅三处差异——`.wav` → `audio/wav`、显式 `Content-Length`、`Accept-Ranges`/206 Range 响应。根因:serve.mjs 的响应无 Content-Length(Node 隐式 chunked)且不支持 Range,`fetch()` 能正常收,但 **WebKit 媒体栈加载失败(Audio error code 4)**;生产 Cloudflare Pages 自带正确 MIME 与 Range 支持,不受影响。文件与目录不变,页面/资源内容与 serve.mjs 完全一致。

### 音频断言口径(两台设备同源)

模拟器无声输出,音频不做声音主观判断,全部基于状态机:页面注入 Audio 构造器包装(`canplay`/`playing`/`error` 事件台账,游戏每次播放都 `new Audio(url)`,导航后注入仍可拦截全部游戏音频实例)+ CacheStorage 命中 200 + Android 侧另加 CDP Network 域 `/audio/pinyin/` 响应记录。

## Android 场景与结果(全部通过)

| # | 场景 | 结果 |
| --- | --- | --- |
| A1 | 在线完整局(辨认真实触摸 + 听辨播放后作答 + 第 2 题答错重试档) | 菜单「拼音冒险」入口(href=/pinyin.html、装饰字 span aria-hidden,与汉字勇者/算术地下城锚点并存)进入 /pinyin.html;勾一年级→「本局题库:一年级 94 道,共 94 道」与 dist 层一致;完整局 5 题(辨认 2 + 听辨 3,题目 PY-C-006、PY-L-037、PY-L-019、PY-C-023、PY-L-013):第 1 题辨认「找出字母『t』」触摸答对 +10 → **第 2 题听辨(PY-L-037,ve.wav)先触摸答错(✗、得分仍 10)→「再试一次」重新计时→答对 +5** → 第 3 题听辨(z.wav)+10 → 第 4 题辨认(w)+10 → 第 5 题听辨(q.wav)+10;**听辨 3/3 题 Audio `canplay`+`playing` 事件触发、播放 URL 与题库一致、CDP Network 记录 3 条 /audio/pinyin/ 响应 status=200(fromDiskCache=true,SW 预缓存)、CacheStorage 命中 200 三通道成立**;听辨题面泄露扫描 3/3 无拉丁字母(题头/题面/播放区/倒计时);结算「总分 45」「作答 5 题 · 首答 4 · 重试 1 次」「辨认 2/2 题首答 · 听辨 2/3 题首答」与逐题档位(4×10+5=45)吻合;练习记录新增 1 条(gameId=pinyin-adventure、recordId=roundId、score=45、逐题 mode 序列与局内观察一致、第 2 题 wrongs=1),列表显示「45 分 · 首答 4/5」;recent-ids 含本局全部题目 ID;IndexedDB 金币局前 20 = 局后 20(零收支) |
| A2 | 返回路径与四入口并存 | 拼音冒险顶栏「返回数字消除」回首页;数字消除勾选一年级→下一步按钮启用(取消复原);菜单弹层内「汉字勇者」(href=/hanzi.html)、「算术地下城」(href=/dungeon.html)、「拼音冒险」(href=/pinyin.html)三锚点并存可见(数字消除为当前页,共四入口) |
| A3 | 离线断源(缓存打开 + 断网完成整局含听辨播放缓存命中) | SW `pixel-academy:number-puzzle:assets-v1-9f9ffaac4a45` 受控且预缓存含 /pinyin.html(/pinyin.css、拼音 dist 模块、音频 47 条,/audio/pinyin/b.wav 命中 status=200)→杀 serve 4273(源站 fetch 确认失败)→刷新同一标签页:首页与菜单进 /pinyin.html 均由缓存打开(6 年级卡、boot-fail 隐藏);断网下题库模块经 SW 预缓存 import 成功(94 题);选一年级完成断网整局 5 题(辨认 2 + 听辨 3):**听辨 ao.wav / ong.wav / in.wav 三题 playing 事件触发且 CacheStorage 命中 200(断网下 200 只能来自缓存)**,全部首答答对,结算「总分 50」「作答 5 题 · 首答 5 · 重试 0 次」;离线练习记录新增 1 条(gameId=pinyin-adventure、score=50、5 题全 firstTry),列表「50 分 · 首答 5/5」;结算返回后中断快照清除;离线金币 20 = 20;返回首页正常 |
| A4 | 贯穿检查 | 11 个检查点(在线 6 + 离线 5)`scrollWidth ≤ innerWidth` 全部成立;JS 错误台账全程 0(`android-*-results.json` 的 overflowLedger / errorLedger) |

### Android 截图索引

- A1 `android-online-01-home`(首页)、`02-home-menu`(菜单弹层:四入口)、`03-pinyin-select`(拼音选择屏与返回锚点)、`04-choose-question`(辨认题大字形候选)、`05-listen-question`(听辨题:播放钮 + 4 候选、题面无泄露)、`06-wrong-retry`(第 2 题听辨答错 ✗ 与「再试一次」)、`07-result`(45 分结算)、`08-records`(练习记录)
- A2 `android-online-09-home-returned-menu`(返回后首页菜单四入口)
- A3 `android-offline-01-home`(断网首页)、`02-pinyin-select`(断网拼音选择屏)、`03-offline-listen`(断网听辨题播放缓存音频,ao/ou/a/o 候选)、`04-offline-result`(断网 50 分结算)
- A4 为贯穿检查,无独立截图

## iOS 场景与结果(S1/S2/S3 通过,playing 断言受阻见下节)

| # | 场景 | 结果 |
| --- | --- | --- |
| I1 | 在线完整局(辨认点击 + 首道辨认题答错重试档 + 听辨播放尝试/降级跳过 + 记录金币) | 菜单「拼音冒险」入口(href=/pinyin.html、装饰字 aria-hidden)进入 /pinyin.html;勾一年级→「本局题库:一年级 94 道,共 94 道」与 dist 层一致;完整局 5 题(辨认 3 + 听辨 2,题目 PY-C-012、PY-C-003、PY-L-017、PY-C-011、PY-L-013):**第 1 题辨认 el.click() 先答错(✗、得分不变)→「再试一次」重新计时→答对 +5** → 第 2 题辨认 +10 → 第 3 题听辨播放尝试(事件台账为空:play() 被 NotAllowedError 拒绝且无 error 事件,见受阻节)→**「当前无法播放声音。可以返回结束本局,或跳过这道听辨题继续。」提示 + 「跳过这道听辨题」入口出现(游戏按设计的音频不可用降级)→跳过不计分不计作答** → 第 4 题辨认 +10 → 第 5 题听辨同降级跳过;**听辨 2/2 题 CacheStorage 命中 200**;听辨题面泄露扫描 2/2 无拉丁字母;结算「总分 25」「作答 3 题 · 首答 2 · 重试 1 次 · 跳过 2 题」「辨认 2/3 题首答 · 听辨 0/2 题首答」与逐题档位吻合;练习记录新增 1 条(gameId=pinyin-adventure、recordId=roundId、score=25、逐题 mode 序列一致、跳过题 answered=false/mode=listen 如实标注),列表「25 分 · 首答 2/3 · 跳过 2」;recent-ids 含本局全部题目 ID;金币局前 20 = 局后 20 |
| I2 | 返回路径与四入口并存 | 同 A2(「返回数字消除」回首页、一年级可勾选、菜单三游戏锚点 + 当前页四入口并存) |
| I3 | 离线断源刷新(缓存打开 + 断网整局:听辨音频缓存命中 + 降级跳过 + 辨认作答) | SW `pixel-academy:number-puzzle:assets-v1-9f9ffaac4a45` 受控且预缓存含 /pinyin.html(/pinyin.css、拼音 dist 模块、音频 47 条)→杀源服务(源站 fetch 确认失败)→**Safari 刷新同一标签页(非冷导航)**:首页与菜单进 /pinyin.html 均由缓存打开;断网下题库模块 import 成功(94 题);选一年级完成断网整局 5 题(辨认 2 + 听辨 3):**听辨 m.wav / s.wav / h.wav 三题 CacheStorage 命中 200(断网下 200 只能来自缓存),播放被拒(iOS 手势受阻)→降级提示 + 跳过不计分**;辨认题答对照常(第 2 题答错→再试一次→+5、第 5 题 +10);结算「总分 15」「作答 2 题 · 首答 1 · 重试 1 次 · 跳过 3 题」;离线记录新增 1 条(score=15、跳过题 answered=false),列表「15 分 · 首答 1/2 · 跳过 3」;结算返回后中断快照清除;离线金币 20 = 20;返回首页正常 |
| I4 | 贯穿检查 | 12 个检查点(在线 6 + 离线 6)`scrollWidth ≤ innerWidth` 全部成立;JS 错误台账全程 0(`ios-*-results.json` 的 overflowLedger / errorLedger) |

### iOS 截图索引

- I1 `ios-online-01-home`(首页)、`02-home-menu`(菜单弹层:四入口)、`03-pinyin-select`(拼音选择屏)、`04-choose-question`(辨认题)、`05-listen-question`(**听辨题音频不可用降级态:提示条 + 跳过入口可见**)、`06-wrong-retry`(第 1 题辨认答错 ✗ 与「再试一次」)、`07-result`(25 分结算含跳过数)、`08-records`(练习记录)
- I2 `ios-online-09-home-returned-menu`(返回后首页菜单四入口)
- I3 `ios-offline-01-home`(断网首页)、`02-pinyin-select`(断网拼音选择屏)、`03-offline-listen`(断网听辨降级态)、`04-offline-result`(断网 15 分结算)
- I4 为贯穿检查,无独立截图

## iOS 听辨播放受阻(如实记录:验证环境问题,非游戏缺陷)

**现象**:iOS Safari 模拟器上,游戏内点击「▶ 播放声音」后 Audio `playing` 事件永不触发;游戏按设计把播放失败判定为「当前无法播放声音」并呈现提示与跳过入口。

**定位过程(本机探针逐步排除,均为自动化环境因素)**:

1. **传输层(已修复为验证旁路)**:serve.mjs 响应无 `Content-Length`(Node 隐式 chunked)且不支持 Range → WebKit 媒体栈加载失败(Audio `error` code 4,而同一 URL 的 `fetch()` 返回 200/audio 全量字节);补 `audio/wav` MIME + `Content-Length` + `Accept-Ranges`/206 后,Audio `load()` 正常到 `canplay`(duration 0.304s)。
2. **手势层(无法修复,最终受阻点)**:游戏 play 路径要求用户手势(浏览器自动播放策略)。逐项实测:
   - 合成 `el.click()`:`isTrusted=false`,处理器内 `navigator.userActivation.isActive=false` → 处理器内同步 `play()` 仍被拒(`NotAllowedError`);
   - WebDriver **原生 element click 端点**:调用成功但 onclick 处理器从未执行(M7「HID 注入不完整」的再证实);
   - `MediaPlaybackRequiresUserAction=0` 默认值(com.apple.mobilesafari)在 iOS 18.6 模拟器**冷重启**后仍不生效;
   - `idb` 未安装;AppleScript System Events 无辅助功能权限(AppleEvent 超时 -1712);`simctl` 无触摸注入。
3. **结论**:在可用自动化通道下,真实手势不可获得,playing 断言在 iOS 无法执行——记受阻(已尝试修复 3 次:MIME/Range 旁路、偏好开关+冷重启、原生 click 端点)。**同代码路径在 Android 真实触摸(CDP 触摸即受信手势)下 playing 3/3 成立,桌面无头 Chrome(自动播放策略放开)亦成立,产品行为本身无 iOS 特定缺陷的证据**;真机上真实触点即为用户手势,不受此自动化限制影响。

**受阻期间 iOS 改验且通过的内容**(这本身是 M9 验收条件「静音或音频不可用时,听辨关卡明确提示并允许退出或选择可用模式,不假装完成听力训练」的移动端 Safari 实证):播放失败 → audio-notice 明确提示(文案完整)→ 跳过入口出现 → 跳过题**不计分、不计作答**,结算显示「跳过 N 题」、记录逐题 `answered=false`(mode=listen)如实标注;音频 **CacheStorage 命中 200** 在线与断网均成立(断网下 200 只能来自 SW 预缓存,音频随内容缓存交付这一点在 iOS 亦得证)。

## 首跑失败与修复过程(如实记录,均为驱动脚本/环境问题而非游戏缺陷)

1. **Android 第 1 跑:正式池索引为空**——脚本把 `window.__pool` 存为对象而 `syncPool` 按数组读取;改为存数组。
2. **Android 第 2–4 跑:「第 1 题可作答」等待超时(题目在轮询期间 10 秒耗尽)**——脚本 `pinyinState` 漏装 `questionVisible` 字段,轮询首条件恒假;加逐轮采样诊断后定位,补字段即过。其间一跑因 Chrome 刚重启 CDP 端口未就绪导致 WebSocket 连接失败(环境时序,等待后重跑即过)。
3. **Android 第 5 跑:听辨 playing 断言误报**——把事件对象数组当字符串数组 `includes('playing')`;`playAudio` 返回值统一规范化为事件名数组。
4. **Android 第 6 跑:汇总「听辨题数 0」**——逐题记录漏 `isListen` 字段;补上后最终跑 A1/A2 通过,A3 离线轮通过。
5. **iOS 第 1–2 跑:听辨播放 error code 4**——发现 serve.mjs 的 MIME/chunked/Range 缺口(见上,环境问题);建验证旁路服务后传输层解决。
6. **iOS 第 3 跑起:playing 仍 NotAllowedError**——手势探针系列(见受阻节)判定受阻,脚本改按「降级路径验证」口径重写听辨流程;期间脚本自身一处笔误(`blocked` 数组声明丢失致 ReferenceError)修复后最终跑通过。
7. iOS 驱动沿用 M12 口径:配对锁预防(每轮前 `killall Safari` + `simctl terminate/launch`),会话 DELETE 放 finally 防配对锁残留。

## 与桌面验收口径的差异与说明

- **听辨播放断言两台设备结果不同**:Android 为真实触摸手势,playing + 请求 200(CDP)+ 缓存命中三通道全成立;iOS 为合成点击(与 M3–M12 所有 iOS 交互同口径),playing 受阻于自动化手势缺失,以「降级提示 + 跳过不计分 + 缓存命中 200」代验并如实标注受阻。M9 桌面轮(Headless Chrome,`--autoplay-policy=no-user-gesture-required`)的 playing 断言不受影响。
- **认题/判题口径同桌面**:答案一律从题面 `dataset.exerciseId` 经 dist 层 `correctPinyinAnswer` 自算;候选排列组卷层洗牌(答案不恒首位)在两台设备的局内均随题呈现(截图候选序可见)。
- 年级覆盖仅一年级(与桌面轮同口径);多选年级、其他年级置灰行为未在模拟器重跑(桌面 P3 已覆盖,模拟器轮聚焦玩法主路径、音频与离线)。
- 每题 10 秒计时内完成全部作答;听辨播放不暂停计时(口径与桌面轮观察 #3 一致)未在本轮重复验证。

## 已知限制与未验证项

1. **模拟器证据不代表物理真机**:触控手感、性能、真实设备系统差异未覆盖;Android 为 Chrome 113 系统镜像(UA 上报 Android 10),iOS 为 18.6 模拟器(27.0 运行时不可驱动)。
2. **iOS 听辨 playing 断言受阻**(见专节):模拟器自动化手势缺失所致;真机行为未验证。缓存命中与降级路径已在 iOS 实测。
3. **iOS 本地服务为验证旁路克隆**(`/tmp/serve-mime.mjs`,不入库):仅补 `.wav` MIME、`Content-Length` 与 Range 支持,对齐生产行为;**留给维护者的观察项:`scripts/serve.mjs` 的 MIME 表建议补 `.wav: audio/wav` 并支持 Range/Content-Length,否则本地 serve 下 Safari 无法播放音频**(生产 Pages 不受影响;本轮未改动仓库文件)。
4. **iOS 生产环境未复跑**:本轮两台设备均为本地源;生产环境(Cloudflare Pages、生产 SW 行为)未在模拟器对生产 URL 复跑(M12 同口径限制)。
5. SW 预缓存断言经页面 caches API 完成(/pinyin.html、/pinyin.css、拼音 dist 模块、47 条音频、b.wav 命中 200);sw.js 本体不进预缓存,清单文本断言由桌面 P9 与 `tests/offline.test.mjs` 覆盖。
6. 抽题为随机采样,未穷举题库;两台设备各完成 1 局在线完整局 + 1 局断网完整局。iOS 在线局听辨全部走降级跳过(2 题),「playing 后答对听辨题」路径在 iOS 未覆盖(Android 已覆盖 6 题:在线 3 + 断网 3)。
7. 音效可听性未验证(模拟器无声输出,状态机断言);发音正确性属**真人试听缺口**(与桌面轮一致);听辨题含降级提示时页面内容超出一屏需纵向滚动(iOS 窄屏截图可见跳过按钮在折叠线下方,页面可正常纵向滚动、无横向溢出)——布局观察,非缺陷。
8. 驱动脚本依赖本机模拟器(adb reverse / safaridriver)与本地 serve,不直接重放;断言含时序轮询,更慢环境可能需放宽超时。
