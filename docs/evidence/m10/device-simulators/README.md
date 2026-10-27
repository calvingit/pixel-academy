# M10 英语快递员 · 模拟器验证记录（Android Chrome / iOS Safari）

日期：2026-10-28。口径：2026-10-27 用户裁决（真机缺口以模拟器口径闭环；模拟器证据不等同物理真机）。环境与坑位沿用 [M7 模拟器验证](../../m7/device-simulators/README.md)（iOS 输入为页面级合成事件 `el.click()`、iOS 冷导航离线打开受控源落系统错误页（WebKit 不唤醒 SW）→ 全程「受控后断源刷新」口径）。

## 构建版本

`assets-v1-7b3cf359a863`（与桌面验收轮一致：五入口预缓存 128 项，含 `/english.html`、english dist 模块与 12 张角色 SVG）。本地源 `node scripts/serve.mjs`（Android 4273 / iOS 4373）；驱动脚本 [android-round.mjs](android-round.mjs)、[ios-round.mjs](ios-round.mjs)（答案从页面快照经 dist 判题模块自算，不注入游戏状态）。

## Android Chrome 模拟器（emulator-5556：Android 14，Chrome 113；CDP 真实触摸）

视口 412×790 CSS px（dpr 2.625）；origin 经 `adb reverse tcp:4273`；逐场景数据见 [android-online-results.json](android-online-results.json)、[android-offline-results.json](android-offline-results.json)。

| # | 场景 | 结果 |
| --- | --- | --- |
| S1 | 在线完整局：菜单「英语快递员」入口（与三游戏锚点并存、装饰字 aria-hidden）→ 勾一年级「本局题库：一年级 18 个任务」→ 5 任务两步送达全部真实触摸（`Input.dispatchTouchEvent`），第 2 任务对包裹错对象→✗「对象不对」（attempts/wrongs=1、携带保留）→纠正 +5 → 结算「总分 45」「完成 5 个任务 · 首次一次完成 4 · 错送 1 次 · 送达尝试 6 次」「词汇识别 3/3 · 句意理解 1/2 题首答」与逐题档位吻合 → 记录 gameId=english-courier、recordId=roundId、逐题 mode 序列一致 → recent-ids 全含 → 金币零收支 | ✅ 通过 |
| S2 | 返回路径与五入口并存：顶栏「返回数字消除」回首页；数字消除勾一年级可用并复原；菜单四游戏锚点 + 数字消除共五入口可见 | ✅ 通过 |
| S3 | 离线断源：SW `pixel-academy:number-puzzle:assets-v1-7b3cf359a863` 受控、预缓存含 /english.html（css、dist 模块、12 张 SVG，mum.svg 命中 200）→ 杀 serve 4273 → 刷新同标签页 → 首页与 /english.html 由缓存打开 → 断网下题库模块 import 成功（18 任务）→ 断网整局 5 任务全首答完成（站位角色图全部加载）→ 断网记录 score=50 全 firstTry、快照清除 → 返回首页 | ✅ 通过 |

截图：android-online-01~09、android-offline-01~03（png，本目录）。

## iOS Safari 模拟器（iPhone 16 Pro / iOS 18.6，UDID 28F2F0F0-…；safaridriver）

会话能力 `platformName: iOS` + `safari:useSimulator: true`（UA 含 iPhone 确认，非 macOS 回退）。逐场景数据见 [ios-online-results.json](ios-online-results.json)、[ios-offline-results.json](ios-offline-results.json)。

| # | 场景 | 结果 |
| --- | --- | --- |
| S1 | 在线完整局：菜单「英语快递员」入口 → 勾一年级 → 5 任务两步送达（`el.click()`，M10 全 DOM 交互，无 canvas/PointerEvent，无 M9 的手势受阻问题），第 1 任务对包裹错对象→✗「对象不对」→纠正 +5 → 结算「总分 45」「…首次一次完成 4 · 错送 1 次 · 送达尝试 6 次」「词汇识别 x/x · 句意理解 y/y 题首答」与逐题档位吻合 → 记录 gameId/score/逐题 mode 序列一致 → recent-ids 全含 → 金币零收支 | ✅ 通过 |
| S2 | 返回路径与五入口并存（同 Android 口径） | ✅ 通过 |
| S3 | 离线断源刷新：SW 受控、预缓存含 /english.html（12 张 SVG 命中 200）→ 杀 serve 4373 → Safari 刷新（非冷导航）→ 首页与 /english.html 由缓存打开 → 断网整局 5 任务全首答完成 → 断网记录 score=50 全 firstTry、快照清除 → 返回首页 | ✅ 通过 |

截图：ios-online-01~09、ios-offline-01~03（png，本目录）。

## 与 M9 的差异说明

M10 首版仅文字指令、无音频、交互全部为 DOM 按钮，故 M9 的「iOS 听辨 playing 断言受阻」条目不适用；本轮 iOS 无受阻项（完整局可经 `el.click()` 全程作答，两步送达的取件/送达按钮均为 DOM button）。

## 已知限制

1. 物理真机未测（2026-10-27 裁决以模拟器口径闭环；模拟器证据不等同真机证据）。
2. iOS 输入为页面级合成事件（safaridriver 对 iOS 模拟器无有效 HID 注入，M7 实测口径）；Android 为 CDP 真实触摸。
3. iOS 冷导航离线打开受控源落系统错误页为 WebKit 既有行为（断源刷新正常），与本游戏代码无关，历史记录见 M7。
