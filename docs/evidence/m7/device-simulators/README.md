# M7 模拟器可玩性验证与 Cloudflare 部署验证

执行于 2026-10-27（北京时间凌晨），执行者为工作流代理。依据用户当日裁决：**①真机验证缺口以模拟器口径闭环；②部署位置定为 Cloudflare（git 集成自动部署）；③授权推送**。本文记录 Android 模拟器 Chrome 的完整可玩性验证（本地源与生产部署源、在线与离线）以及 Cloudflare Pages 部署与部署环境 SW 行为验证。全部结论为**代理验证**，代表模拟器而非物理真机；iOS Safari 模拟器验证待补（见「iOS 状态」）。

## 环境与版本

- Android 模拟器（复用本机已在运行的实例 emulator-5556）：`sdk_gphone64_arm64`，Android 14（API 34），Chrome 113.0.5672.136（UA 上报 Android 10，系统镜像行为）；视口 412×790 CSS px（devicePixelRatio 2.625，物理 1080×2400）。
- iOS：用户开启 Safari 远程自动化（`sudo safaridriver --enable`）后，实际可驱动的模拟器为 **iPhone 16 Pro（iOS 18.6）**——系统 safaridriver 26.6.2 对 **iOS 27.0 运行时无法创建会话**（"Could not find any session hosts"，稳定复现），对 iOS 18.6 正常；会话能力必须含 `platformName: iOS` + `safari:useSimulator: true`，否则静默回退到 macOS Safari（首轮曾因此误跑桌面 Safari，产物已删除重跑）。safaridriver 的模拟器 HID 输入注入不完整（实测 pointerdown/touchstart 送达但无 pointerup/touchend/click，后续输入整体丢失；element click 与 Actions touch/mouse 均无效），故 iOS 轮输入采用页面级合成事件（与 M3–M7 桌面证据同方法）。safaridriver 单会话配对残留会持续阻断新会话（"already paired"），需重启宿主 Safari 与模拟器内 Safari 才能恢复。
- 驱动：Node 24 直连 CDP（adb forward `tcp:9333 → chrome_devtools_remote`）；输入全部为 `Input.dispatchTouchEvent` 真实触摸事件（棋盘坐标按 `render.ts boardLayout` + `main.ts fitBoard` 测量口径换算，DOM 控件按元素中心点击）；答案一律从页面档案（IndexedDB `pixel-academy/profiles/local`）中的题面经 `/dist/learning/choice.js`（`correctOptionIds`）与 `/dist/learning/evaluation.js`（`answerFor`）自行计算；未注入金币／道具、未篡改状态，仅只读档案作核对。
- 构建版本：`assets-v1-322cb9f2c400`（本地与生产部署产物一致）。
- 驱动脚本与结果：本目录 `android-round.mjs`、`android-*-results.json`；截图每场景双份（页面截图 + `adb screencap` 设备实帧 `-frame.png`）。

## 模拟器验证场景与结果（全部通过）

| # | 场景 | 源 | 结果 |
| --- | --- | --- | --- |
| R1 | 在线完整局 + 暂停刷新恢复 + 重开 + 弃局 | `http://localhost:4173/`（adb reverse，安全上下文） | 混选一+二年级 10 题（choice／棋盘／多选／对错混合）全对；结算「通关！★★★ · 总分 100 · 首次答对 10/10 · 答错 0 · 超时 0 · 复活 0 · +30 金币」；records 0→1、金币 5→35；第 5 题（40 分）暂停→刷新→恢复后题目、分数、棋盘逐项一致；再来一局回第 1/10 题、得分 0；「放弃本局未结算金币？」确认后无新增成绩；三档断言无横向溢出、无 JS 错误 |
| R2 | 离线完整局 | 同上，宿主 serve 进程停止（源站不可达） | 页面完全由 SW 缓存启动，提示「离线缓存已就绪（版本 assets-v1-322cb9f2c400）」；离线完整 10 题局 100/10/0、+30 金币离线入账（records 1→2、金币 35→65）；离线刷新与再次开局正常 |
| R3 | 生产部署在线完整局 | `https://pixel-academy.pages.dev/` | 同 R1 全套断言通过：100/10/0、+30 金币（records 0→1、金币 20→50）、SW 受控、提示带版本标记、无溢出无错误 |
| R4 | 生产部署离线完整局 | 同上，模拟器飞行模式（`navigator.onLine === false`） | 页面由 SW 缓存启动，提示「当前处于离线状态，正在使用已缓存资源（版本 assets-v1-322cb9f2c400）」；离线完整 10 题局 100/10/0、+30 金币（records 1→2、金币 50→80）；恢复联网后数据完好 |

关键截图（各场景配 `-frame.png` 设备实帧）：`android-online-01~06`、`android-offline-01~05`、`android-prod-online-01~04`、`android-prod-offline-01~04`、`a-paused`、`a-restored`。结算与离线首页已目视核对：生产结算屏（R3）、离线选择屏（R4）与 JSON 断言一致，版本标记可见。

## Cloudflare Pages 部署

- 按用户要求改用 **cf CLI（1.0.0-beta.6）git 集成自动部署**，不做本地上传：`cf pages create --name pixel-academy --production-branch main --source-type github --source-config-owner calvingit --source-config-repo-name pixel-academy --build-config-build-command "npm run build:site" --build-config-destination-dir dist-site`。项目 id `7a406246-…`，生产地址 **https://pixel-academy.pages.dev**，预览部署关闭（preview `none`）。
- 仓库配套提交 5aaa1b8：`package.json` 新增 `build:site`（= `npm run build` + `scripts/stage-site.mjs` 把 `web/` 入口与 `dist/` 模块合并为单一输出目录 `dist-site/`，`/dist/*` 路径与 `web/sw.js` 预缓存清单保持一致）；`.gitignore` 增加 `dist-site/` 与 `.playwright-cli/`。推送后 Pages 自动构建部署成功（deployment `66d1949c`，trigger `github:push`，stages queued/initialize/build/deploy 全 success）。
- 部署产物 HTTP 核对：`/` 200（text/html）；`/sw.js` 版本 `assets-v1-322cb9f2c400`；`/dist/game/number-puzzle/main.js` 200（application/javascript，ES 模块 MIME 正确）；`cache-control: public, max-age=0, must-revalidate`。R3/R4 即部署环境 SW 行为的实测（注册、接管、离线服务、版本标记）。

## 持续集成

`.github/workflows/check.yml` 已随多次推送实际运行且全部成功：40244249280、40294867768（历史）与本轮 40417838804（commit 4e3f72c，ubuntu-latest Node 22，`npm ci` + `npm run check` 全绿）。此前「未在 GitHub Actions 实际运行」的限制已解除。

## iOS 验证结果（2026-10-27，全部通过）

| # | 场景 | 结果 |
| --- | --- | --- |
| I1 | 在线完整局 + 暂停刷新恢复 + 重开 + 弃局 | 混选 10 题全对；结算「通关！★★★ · 100 · 首次答对 10/10 · +30 金币」（records 0→1、金币 20→50）；第 5 题暂停→刷新→恢复一致；重开得分清零；弃局无新成绩（`ios-online-*`、`ios-a-paused/-restored`） |
| I2 | 离线完整局（受控后断源刷新口径） | 页面与档案由 SW 缓存服务（controller true、提示带版本），离线 10 题局 100/10/0、+30 金币离线入账（records 0→1）（`ios-offline-*`） |

环境：iPhone 16 Pro 模拟器（iOS 18.6），Safari UA `iPhone OS 18_6`，视口 402×678 @3x，`maxTouchPoints=5`；结算与恢复截图已目视核对。脚本 `ios-round.mjs`。

### iOS 特有的发现与限制

1. **冷导航离线打开受控源稳定失败**：新会话/新标签页直接导航到已缓存源，iOS Safari 落到系统错误页（「Safari 浏览器打不开该页面，因为无法连接服务器」），SW 不被唤醒（重试仍如此）；而**同一标签页在受控后断源刷新则完全正常**（页面、模块、档案、金币全部由缓存服务）。故 I2 采用与 M6 相同的断源刷新口径。用户「关闭 Safari 后离线重开」的冷启动路径在 iOS 上受此 WebKit 行为限制，如实记录。
2. 一次观察到离线刷新后应用停在「正在读取本机档案…」（IndexedDB 打开未返回，>30 秒），随后同路径复测未再复现且 IDB 探测 1ms 正常；按瞬态记录，未改代码。
3. `navigator.onLine` 在源站连接拒绝时仍为 true（iOS 行为），离线口径以「源站不可达 + SW 服务」为准，与 M6 断源口径一致。
4. iOS 27.0 运行时（iPhone 17 / iPhone 18 Pro 模拟器）当前无法被 safaridriver 驱动，待 WebKit/Xcode 更新；本验证以 iOS 18.6 模拟器为 iOS Safari 证据。

## 限制与如实记录

1. 模拟器结果**不代表物理真机**；按用户 2026-10-27 裁决以模拟器口径执行验收条件④（已记录于 PLAN.md）。Android 与 iOS 模拟器均已完成，iOS 为 18.6（27.0 不可驱动）。
2. 模拟器为本机常驻实例（含用户其他网站的标签页与档案数据）：本轮仅在 `10.0.2.2:4173`、`localhost:4173`、`pixel-academy.pages.dev` 三个自有源读写档案，未清理或触碰其他数据；`10.0.2.2:4173` 源曾生成一个测试档案（勾选了年级、未产生成绩，该源因非安全上下文不支持 SW 与 `crypto.randomUUID`，已弃用并改走 adb reverse 的 localhost 源）。
3. `prod-online` 轮的「再来一局／放弃」截图沿用了 `android-online-05-again/06-records` 文件名，覆盖了 R1 同名截图；两轮该路径断言均通过（见两份 results JSON 的 records/coins 差量），被覆盖的仅为图片证据。
4. 生产环境的「版本更新自动采用」流程未以真实内容变更演练（SW 更新机制与 M6 同代码，localhost 桌面环境已多轮验证；本轮两次 Pages 部署间 SW 版本未变，不构成更新场景）。
5. 桌面 Chrome 未对生产 URL 单独重跑（M6/M7 桌面证据针对本地源；生产 URL 已由模拟器两轮覆盖）。
6. 音效可听性未验证（模拟器无音频断言）；教学有效性与学生可读性缺口不变。
7. 复核驱动过程缺陷（非应用缺陷）：早期脚本在勾选年级后使用过期元素引用、暂停恢复后 `pauseAt` 条件重复命中、以及模拟器熄屏触发 visibilitychange 自动暂停，均已在脚本内修复（逐次重查元素、`pendingPause` 单次消费、`KEYCODE_WAKEUP` + `Page.bringToFront`）；期间产生的中断局经页面自身的「放弃上局」流程清理。
