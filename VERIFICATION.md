# 验证说明

本文件定义当前工程可执行的检查，以及未来里程碑需要补充的证据。浏览器验证通过人工或代理驱动的浏览器完成，工程内没有自动浏览器测试工具链。

## 模拟器验证与 Cloudflare 部署（2026-10-27）

用户裁决真机验证以模拟器口径执行、部署定 Cloudflare。Android Chrome 模拟器（Android 14 系统镜像、Chrome 113）经 CDP `Input.dispatchTouchEvent` 真实触摸完成四轮完整 10 题局：localhost 在线（含暂停刷新恢复、重开、弃局）、localhost 断源离线、生产 URL https://pixel-academy.pages.dev 在线与飞行模式离线，均 100/10/0、+30 金币、无溢出无错误、离线提示带版本标记；方法、结果与限制见 [模拟器验证记录](docs/evidence/m7/device-simulators/README.md)。驱动脚本 `docs/evidence/m7/device-simulators/android-round.mjs` 依赖本机模拟器实例与 adb 转发，不直接重放。

部署：Cloudflare Pages 项目 `pixel-academy` 以 git 集成关联本仓库 main 分支（cf CLI `cf pages create`），构建命令 `npm run build:site`（= `npm run build` + `scripts/stage-site.mjs` 合并 web/ 与 dist/ 为单一产物目录 `dist-site/`），推送自动构建部署。生产 URL 的产物 MIME、SW 注册/接管/离线服务已经模拟器实测；生产环境「版本更新自动采用」未以真实内容变更演练。iOS Safari 模拟器（iPhone 16 Pro / iOS 18.6；iOS 27.0 运行时暂不可被 safaridriver 驱动）同日完成在线与断源刷新离线两轮；iOS 模拟器 HID 触摸注入不完整，输入为页面级合成事件（与 M3–M7 桌面证据同方法）；iOS 冷导航离线打开受控源落系统错误页、断源刷新正常，均已如实记录。模拟器证据不代表物理真机。

## 数学题型扩展（2026-10-26）

当前 `npm run check` 84 项通过。新增 `tests/choice.test.mjs` 对 16,381 道选择题独立求解、穷举每道多选的选择集合，并检查设计中的减法判断、加减算式比较、非法任务、存储、复活与奖励。生成回归覆盖全部 53,224 个正式候选、63 种年级组合、题型配额、语义去重、确定性和恢复；课程回归覆盖 21 节课程。

实际浏览器过程、失败与修复、17 类 × 两档尺寸、答后反馈、课程／错题奖励、半选保存恢复、挑战、道具与离线结果见 [题型扩展验证](docs/evidence/question-expansion/README.md)。分轮脚本依赖当时 TaskSpace、Page 和前序状态，不直接重放；尤其 4185 的界面夹具仅用于独立测试源站，不能写入日常或生产档案。屏幕阅读器、学生体验、真机与生产部署未验证，M7 的既有缺口不变。

## 数字消除交互与 UI 改版（2026-10-26）

本轮后续单屏收敛 `npm run check` 76 项通过；七档尺寸主流程按钮无需滚动，三列／四列交替作答完整局、讲解弹窗、列表返回及离线首页有追加证据。初版界面、完整在线／断网挑战、暂停刷新恢复、空年级和最后三秒警示的结果与截图见 [改版验证记录](docs/evidence/ui-redesign/README.md)。浏览器为桌面 Chrome 模拟，未完成真实设备验收；M7 仍受阻。分轮脚本依赖当时任务空间与档案前置状态，不应在日常档案上原样重放。

## 当前新版挑战、学习与金币验证（2026-10-26）

执行 npm run check，覆盖现有 Learning Core、动态题库、棋盘保证与新版挑战／计时／课程／事务档案规则。本轮 75 项通过；旧中断恢复、旧写入与无限重试用例随被替代实现移除，新增事务和奖励用例，不能只比较测试总数判断覆盖率。

完整过程、分轮脚本、结果 JSON、截图和未验证项见 [新版验收记录](docs/evidence/learning-economy/README.md)。本轮桌面 Chrome 模拟覆盖课程首次奖励与复学、局内道具与有限复活、错题掌握、交易／改名／皮肤、刷新续局、五档布局、断网重开、更新延后、跨页面冲突及真实事务中止。

本轮浏览器脚本是会话内的分轮证据，包含已经执行的前置步骤；不要在已有档案上原样重复运行断言。复验需使用独立本机源站和受控任务空间，按记录建立前置状态，不清空用户日常档案。4180 为真实奖励路径，4181 为商品与故障夹具路径，注入金币只用于交易验证，不证明奖励正确。

下文 M3–M7、game-style 和动态题库的旧浏览器脚本及计数均为历史证据。由于无限重试和旧存档接口已被替换，这些脚本不能直接用于新版验收；保留历史记录用于追溯，不把旧通过结果记为本次通过。真实设备、生产部署与教学效果仍未验证。

## 环境与命令

在仓库根目录执行，需要 Node.js 22+、npm。使用 package-lock.json 安装锁定依赖。

```sh
npm ci
npm run check
```

| 命令 | 当前含义 |
| --- | --- |
| npm run typecheck | tsc 严格类型检查，不生成产物 |
| npm run build | 编译 src 到 dist 并生成类型声明；随后 scripts/build-sw.mjs 解析入口模块的 import 闭包、计算资源版本哈希并生成 web/sw.js（构建产物，不提交，gitignore）；任一清单文件缺失即构建失败 |
| npm test | 先编译，再以 node --test 执行 tests/*.test.mjs |
| npm run check | typecheck 后执行 test |
| npm run serve | 先执行 build，再用 Node 内置 http 启动本地静态服务（默认 http://127.0.0.1:4173/，`npm run serve -- 端口号` 可改端口），提供数字消除游戏页面；这也是当前的本地验收入口（M7） |

当前没有 dev、preview、lint 或浏览器测试脚本；serve 仅用于本地查看与验收；`build:site` 供 Cloudflare Pages 构建使用，不是本地部署方案。新增工具时同步本文件和 package.json。

## 持续集成

[.github/workflows/check.yml](.github/workflows/check.yml)：push 与 pull request 时在 ubuntu-latest（Node 22）执行 `npm ci` + `npm run check`，与本地同一命令。该工作流已随多次推送实际运行且全部成功（2026-10-27 记录：40244249280、40294867768、40417838804 等多次通过）。

## 按变更选择验证

| 变更 | 必要验证 |
| --- | --- |
| 纯文档 | 本地链接、命令和字段与源码一致性、状态与 PLAN 一致；不要求机械重跑业务测试 |
| 教材、单元、映射、练习 | npm run check；核对结构关联、内容审核状态、目标年级与游戏范围；内容语义另行审查 |
| 数字消除生成规则 | npm run check；穷举候选及映射、全部年级组合、配额与去重、多种子完整局、保存恢复一致性；浏览器验证三种 10 题局、刷新与旧存档恢复、再玩及重开、断网重开和样本题面截图；教学有效性单独记录 |
| Core 筛选与判题 | npm run check；围绕变化补充边界或回归测试，不只复述实现 |
| 游戏规则（rules.ts） | npm run check（tests/number-puzzle.test.mjs 覆盖状态转换、可完成局次、重复输入与计分、无解局面排除、随机源确定性）；`npm run serve` 后完整浏览器流程 |
| 浏览器界面与输入（web/、render.ts、main.ts） | 实际浏览器截图或录屏、关键流程结果核对；手机尺寸与触摸操作的完整验收按 M4 执行，设备与模拟结果分开 |
| 本地记录与恢复（storage.ts、main.ts 接线、web/） | npm run check（tests/storage.test.mjs 覆盖损坏数据、版本不兼容、重复写入与中断恢复一致性）；`npm run serve` 后浏览器验证：设置与成绩刷新后仍可读取、中断局次恢复一致且不重复计分、内容版本不兼容安全放弃且不误删历史、存储不可用仍可玩并提示、清除记录有确认。离线（M6）：缓存完成后断网重开并完成一局 |
| 离线资源与版本更新（web/sw.source.js、scripts/build-sw.mjs、offline.ts、main.ts 离线接线、web/） | npm run check（tests/offline.test.mjs 覆盖旧缓存清理决策、更新采用时机与执行决策 planAdoptionExecution（waiting 被浏览器跳过时的刷新/收敛防御）、离线状态文案、预缓存清单与真实 dist 产物及生成的 web/sw.js 的一致性）；`npm run serve` 后浏览器验证：缓存就绪提示带版本标记、断网重开完成整局并保存记录、离线刷新与重复启动、选择屏更新自动生效并清理旧缓存、单局中途更新被推迟且局次不受影响、预缓存失败与资源缺失有可理解提示、离线且缓存缺失回退兜底页（证据 docs/evidence/m6/）；waiting 直通激活的时序差异需浏览器复验（复核第 1 轮已修复并复验，见 docs/evidence/m6/README.md「独立复核第 1 轮修复复验」）；部署环境需支持 Service Worker（localhost/127.0.0.1 即安全上下文），真实设备与部署环境属 M7 汇总 |

## 现有测试基准

M1 的测试覆盖教材槽位、主单元编号、草稿隔离、全部 63 种非空年级组合、学科和游戏过滤、审核 fixture、关联错误以及数学判题与样本范围。M2 扩充单年级正式集合核对、档位数域与答案范围。M3 新增 tests/number-puzzle.test.mjs：实现常量与档位、随机源消耗顺序（洗牌 → 初始棋盘 → 补块）、同种子复现、答错不消除不扣分并锁输入、反馈窗口与消除窗口内点击忽略且不重复计分、整局可完成与计分（10/5 分、一次通过、题数不足取可用数）、多种子无死局与同值上限、保证规则及兜底分支、四场景可用性文案与正式/预览口径（自定义 catalog 构造无 approved 与不足阈值场景）。M4 新增 tests/session.test.mjs：会话生命周期严格转移（idle/running/paused/finished）、暂停冻结剩余时长（暂停期间真实时间不推进计时器）、visibilitychange 自动暂停仅 running 生效且恢复前台不自动继续、pause/resume 幂等、到点计时器剩余钳制为 0、弃局（含结算后弃局）清空计时器可再开局、非法时长拒绝；M5 扩充 restoreRound（按保存的剩余时长恢复到 running/paused、仅 idle 可恢复、非法剩余拒绝）。M5 新增 tests/storage.test.mjs（纯逻辑存储层，注入式 KV）：存储键与结构版本字段、设置损坏/外版本按首次使用、设置经 GameStorage 往返、成绩 blob 损坏重置且单条非法仅丢弃该条、同 recordId 重复写入只留一条且超上限裁剪最旧、内容指纹确定性/顺序无关/内容敏感、中断快照经真实对局构建后解析重建与不间断参考局完全一致（含 resolving 中的计时器剩余与 RNG 内部状态恢复）、暂停快照恢复冻结计时器、终局快照重建成绩且同 recordId 幂等、约 20 类字段非法快照被拒、内容版本或游戏不匹配只放弃中断局次（历史成绩与设置不动）、存储不可用与写入失败时读取退回默认且游戏流程安全。M6 新增 tests/offline.test.mjs：缓存名与版本标记格式（前缀 + assets-v1-<12 位十六进制>）、旧版本缓存清理决策（staleCacheNames 只清本应用前缀下非当前版本且排序确定）、更新采用时机（decideUpdateAdoption：选择屏且无进行中局次才 adopt，单局 running/paused 或非选择屏 defer）、采用动作执行决策（planAdoptionExecution：waiting 存在发 skip-waiting；waiting 缺失且新版本已接管则直接刷新——waiting 可被浏览器跳过直通激活，独立复核第 1 轮实测；waiting 缺失且 controller 未变则收敛防刷新循环）、离线状态文案（preparing/ready/failed/unsupported 与离线、受控组合下的承诺口径，更新提示优先）、import 提取（注释与字符串内 // 不误报）、dist import 闭包覆盖关键模块、预缓存 URL 全部同源且文件真实存在、版本哈希确定性/内容敏感/模板敏感、生成的 web/sw.js 与页面侧缓存名前缀及重算清单一致；测试从 scripts/build-sw.mjs 导入函数并与真实 dist 产物核对（npm test 先 build 后测试）。

测试中的 approved 记录用于构造测试场景；静态题库的审核状态以 src/content/exercises.ts 和审核记录文档为准。首批 18 道练习已按 docs/content-review-first-batch.md 晋级 approved（含点阵呈现重审后晋级的 3 道乘法练习）；正式取题只返回 approved 内容，针对其余年级组合为空属预期结果。

测试数量会随实现变化；以本次执行输出为准，不为保持数量删减测试。未执行检查不能引用旧输出宣称本次通过。

## 浏览器验收路径

M3 已建立运行入口：`npm run serve` 后访问 http://127.0.0.1:4173/（候选预览入口为 `/?preview=candidate`，仅维护者使用）。需验证：选年级、无内容提示、开始、正确与错误作答、结算、重开与返回。M4 增加暂停和手机交互，M5 增加记录恢复，M6 增加离线与更新。

M7 已执行的端到端验收路径（代理驱动，证据与逐场景记录见 docs/evidence/m7/README.md，截图存于 docs/evidence/m7/）：干净安装（npm ci）→ `npm run check`（typecheck + 生产构建 + 73 项测试）→ `npm run serve` 后完整链路「选年级（一+二年级混合，可用内容 12+6=18 道）→ 中断后恢复续打完整一局到结算（100/10/0，跨恢复不重复计分）→ 结算页再来一局重开（第 1/10 题、得分 0）→ 返回查看练习记录（恰一条）→ 断网（网络层丢弃全部源站请求）重开 → 离线完整玩二年级 6 题局到结算（60/6/0）并离线保存记录（恰两条）」。默认入口无预览横幅、正式取题只含 approved 的复查记录同见该文件。真实设备（iOS Safari / Android Chrome）与真实部署环境未测，保留为缺口。

M6 已执行的浏览器验收路径（代理驱动，证据与离线口径见 docs/evidence/m6/README.md，含实现者轮、验收员第 1 轮与独立复核第 1 轮修复复验）：首次在线访问缓存就绪提示带版本标记、Cache Storage 恰一个带前缀缓存（18 条资源）；断网（源站请求全部失败或浏览器级离线仿真）重开后完整游玩 6 题局到结算并离线保存成绩、离线刷新与重复启动设置记录可读；选择屏版本更新自动生效并清理旧缓存；单局中途更新被推迟（提示明示局次不受影响），整局继续到结算、返回选择屏后自动生效且成绩完整（含刷新→恢复上局续打不重复计分）；预缓存失败（404）显示失败提示且无 active SW、恢复后自愈；源站真实死亡 + 缓存缺失回退 SW 兜底页、服务器恢复后缓存回填 18 条自愈；主模块缺失时 index.html 内联脚本提示且不进入可玩状态。waiting 语义不可依赖（可被浏览器跳过直通激活）经独立复核发现，已由 planAdoptionExecution 修复并复验两种时序均收敛（waiting 存在走 skip-waiting、缺失且已接管自动刷新、无卡死且不刷新循环）。「正在准备离线缓存」中间态因本地安装过快未截到，文案由单元测试覆盖（preparing→failed 转换已浏览器实测）。真实设备（iOS Safari / Android Chrome）与真实部署环境仍未测，属 M7 汇总缺口。

M5 已执行的浏览器验收路径（代理驱动，证据见 docs/evidence/m5/README.md）：设置（年级勾选、音效开关）与练习记录在刷新后仍可读取；中断局次刷新后提供「继续上局/放弃上局」，恢复后题目、分数与阶段一致且续局结算只记一条成绩；存储键被改坏（非 JSON）时按首次使用处理、页面保持可游玩；中断快照的内容版本被改旧时提示已安全放弃且历史成绩与设置不受影响；用浏览器覆盖 localStorage 使其不可用时游戏照常可玩并显示无法持久保存提示；清除本地记录两击确认后回到首次使用状态。真实设备（iOS Safari / Android Chrome）仍未测，属 M7 汇总缺口。

M4 已执行的浏览器验收路径（代理驱动，证据见 docs/evidence/m4/README.md）：五档视口（320×568、375×667、412×915、568×320 横屏、1280×800）布局与触摸目标、答对/答错/消除的形状与文案反馈、反馈与消除窗口内连点、三个窗口内的暂停/继续、真实切后台自动暂停（恢复不自动继续）、重新开始两击确认、返回保留勾选、音效开关与关音效完整对局、乘法点阵可数性、四局完整对局到结算。真实设备（iOS Safari / Android Chrome）仍未测，属 M7 汇总缺口。

证据记录至少包含：对应提交、构建或访问入口、设备/系统/浏览器及版本、模拟或真实设备、操作步骤、预期与实际结果、截图或录屏位置。当前没有工程内浏览器自动化工具链；M3 的浏览器证据由代理驱动的浏览器（无头 Chrome，DOM 控件为真实点击，棋盘点选经页面 pointerdown 事件）产生，截图保存于 docs/evidence/m3/。

iOS Safari 与 Android Chrome 真实设备未测则保留缺口。截图能证明布局，不能单独证明判题、记录恢复或离线正确；这些需要实际流程结果。

## 数字花园视觉回归

以下 game-style 脚本及结果是接入动态题库前的历史证据，其中二年级 6 题/60 分断言不适用于当前正式入口。当前变更复验使用下文动态题库脚本；历史截图和记录保留用于追溯。

在 `npm run serve -- 4175` 启动后，可通过已有的 ego-browser 工具执行：

```sh
ego-browser nodejs < docs/evidence/game-style/browser-check.mjs
```

该脚本仅针对本地 4175 测试入口：使用正式题集，产生测试局次与本地练习记录，不清除已有记录；验证五档尺寸、暂停恢复、刷新续局、错误与连续点击、完整结算及断网重开。棋盘使用真实坐标换算后派发 pointerdown，部分 DOM 操作通过页面内 click 驱动；不能等同真机触摸验收。截图与执行结果见 [数字花园验证记录](docs/evidence/game-style/README.md)。视觉回归仍需人工或代理查看截图，自动尺寸断言不能替代视觉判断。

## 完成与失败

### 动态题库验证（2026-10-26）

`npm run check` 共 79 项通过。`tests/generation.test.mjs` 覆盖全部 36,843 个合法候选、63 种年级组合、确定性、题型配额、局内唯一性、跨局最少重复、动态完整局及恢复一致性、避重 ID 存取和损坏处理；原静态棋盘和存档测试保留作为旧内容回归。

浏览器复验入口：`npm run serve -- 4176`，然后 `ego-browser nodejs < docs/evidence/dynamic-question-bank/browser-check.mjs`。脚本只针对本机测试源站，不清除已有成绩；会生成测试成绩和中断快照，覆盖一年级、二年级、混选、断网重开四个 10 题完整局、续局、重开、刷新后避重信息保留及真实旧格式快照恢复。默认复验需在 ego-browser 创建可控任务空间；已经 finish 的空间不能当作未结束的空间重用。

结果、截图与限制见 [动态题库验证](docs/evidence/dynamic-question-bank/README.md)。本次使用桌面 Chrome 模拟，不能替代 iOS Safari / Android Chrome 真机验收或教师评审。

更新里程碑时简述做了什么、执行了哪些检查、结果和限制。失败保留可复现步骤并修复相关问题；环境阻塞明确原因。发现高影响缺陷优先修复，但不因为假想风险扩大系统范围。

M7 的完整交付要求见 [PLAN.md](PLAN.md)。本文件不会自动执行检查，也不是验收通过记录。
