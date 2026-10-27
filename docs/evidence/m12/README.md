# 算术地下城（M12）首版验证记录

## 内容来源与审核边界

- 门题与资源题**完全复用已审核的数学动态题库**：`generated-v4`（运算规则生成，审核记录见 [内容审核：动态题库生成](../../content-review-generation.md)）与 `choices-v3`（选择题生成，审核记录见 [内容审核：选择题扩充](../../content-review-question-expansion.md)）。本游戏**零新增题目、零新增题型、零新增审核动作**。
- `src/game/arithmetic-dungeon/content.ts` 在地下城侧对同一份已审核题库的**内存副本**追加 `gameIds: arithmetic-dungeon`，不改写审核元数据（review 状态、审核人、审核时间原样保留）；认数任务（「找出 N」，依赖数字消除点阵棋盘玩法、无门题题面形态）被过滤，不进入地下城题池。
- 正式取题只走 Learning Core 的 `selectExercises`（`selectDungeonExercises`，仅 approved + math + 本游戏 gameId + 所选年级）；无预览入口，draft 不可能出现在任何正式探索。
- 验收轮在浏览器内经 dist 产物核验：`selectDungeonExercises([1])` 共 1074 道全部 `approved`；作答答案一律从页面题面经 dist 判题模块（`correctOptionIds` / `answerFor`）自算，未注入任何游戏状态。

## 桌面浏览器验证（D 阶段，独立验收轮）

执行于 2026-10-27。执行者为 **zcode-agent 代理（浏览器验收，独立于实现者的冒烟轮）**，只验证与记录、不修改任何游戏代码。依据 [玩法说明](../../gameplay-arithmetic-dungeon.md)（重点对照「一局完整示例」的 35 分计分路径）。

**环境**：HeadlessChrome/156.0.0.0（Chrome 156.0.8078.48，`--headless=new`，CDP 直连端口 9742），视口 1280×773（DPR 1），全程全新 profile（无历史档案，IndexedDB 金币初始 20），本地源 `node scripts/serve.mjs 4173`（构建产物 `assets-v1-51ab2e546d4c`）。真实鼠标事件（trustedClick）、真实键盘（Tab/Enter/insertText）、`Page.reload` 刷新、杀源站进程断源。驱动脚本 [dungeon-browser.mjs](dungeon-browser.mjs)，结构化结果 [dungeon-browser-results.json](dungeon-browser-results.json)（逐场景 pass/result/checks，含逐场景横向溢出与 JS 错误记录）。

| # | 场景 | 结果 |
| --- | --- | --- |
| D1 | 首页菜单入口 | 通过。数字消除保持当前游戏（h1/title 不变）；菜单弹层（aria-label=学习与收藏）内「算术地下城」入口 href=/dungeon.html 可见，装饰字 span aria-hidden=true，与「汉字勇者」入口并存；Tab 焦点路径 关闭→学习课程→错题复习→金币商店→我的收藏→汉字勇者 后到达本入口（键盘可达）；CDP 无障碍树 link 角色、名称「算术地下城」；全新档案金币 20；JS 错误 0 |
| D2 | 进入 dungeon.html | 通过。真实点击入口后 /dungeon.html 正常加载：h1「算术地下城」、6 张年级卡、boot-fail 隐藏、「返回数字消除」锚点（href=/）可见；JS 错误 0 |
| D3 | 年级与可用性 | 通过。勾一年级→「本层题库：一年级 1074 道，共 1074 道」（与 dist 层一致）、开始可用；三～六年级卡禁用置灰（disabled、title=暂未开放、点击无效）——未开放年级不可混入；混选一+二→「一年级 1074 道、二年级 52139 道，共 53213 道」仍可开始；dist 层 `describeAvailability([3])`=「三年级暂无已审核的数学练习。当前开放：一年级、二年级（数学）。」；设置持久化正常 |
| D4 | 完整通关局（对照示例 35 分） | 通过（含缺陷影响记录，见缺陷 #1）。起点→石门→岔口→左门→资源房→折回岔口→右门（故意答错一次，✗ 不解锁不扣分）→「再试一次」→「换一题」→答对→终点。结算「总分 30」「作答 4 题 · 首答 2/4 · 重试 2 次」与计分规则逐项吻合：本局资源题抽到算式题「1 + 5 = ?」，受缺陷 #1 影响走超时→再试路径入重试档 5 分（期望分按计分规则动态核算 10+10+5+5=30）；若 4 题均为选择题则期望恰为 35 分（35 分示例路径受阻于缺陷 #1，计分逻辑本身无偏差）。练习记录新增 1 条：gameId=arithmetic-dungeon、recordId=roundId、keyUses=0、route=起点→岔口→资源房→岔口→终点房，列表显示「30 分 · 首答 2/4 · 重试 2」；recent-ids 含本局全部题目 ID；IndexedDB 金币局前 20 = 局后 20（零收支）；「收下钥匙」在答对后约 0.9 秒的 resolving 窗口内首次点击被静默忽略、二次点击生效（缺陷 #2） |
| D5 | 备用钥匙路径 | 通过。石门+左门+资源题首答全对（30 分、钥匙 1/1）→右门先故意答错（✗、不解锁不扣分、「用钥匙开门」出现）→消耗备用钥匙直接解锁→通关结算「总分 30」「作答 3 题 · 首答 3/3 · 重试 1 次」；记录 keyUses=1、keysHeld=0，作答表现 slots=[gate-stone, gate-left, resource]——用钥匙开门的右门不计入作答表现、计入探索决策；本局题目避开上一局（recent-ids）；金币 20 不变 |
| D6 | 暂停/恢复 | 通过。石门答对 +10 后暂停：覆盖层「在地下城歇一会」出现、HUD 不变，继续正常；左门计时中（剩 10 秒）暂停→倒计时「已停止计时」、快照 remainingMs 冻结 10000ms（2.5 秒后仍不变）→继续后 9.7 秒 ≈ 冻结值（暂停期间未流逝）、题面不变；续答左门到资源房（石门+左门开），快照 room/openDoors/score 与刷新前一致（D7 前置） |
| D7 | 刷新恢复 | 通过。20 分（石门+左门开、资源房）后 Page.reload→恢复提供「有未完成的探索，可以继续（房间、门、钥匙与作答进度都会恢复）。」→继续探索：房间/得分 20/钥匙 0/1/roundId/门状态与刷新前一致→续打资源题+右门→结算「总分 40 · 首答 4/4 · 重试 0」（=20+20；若石门/左门重计应为 60，未发生）；记录 recordId=roundId 幂等 |
| D8 | 双游戏回归 | 通过。地下城「返回数字消除」回首页，钱包「小小探险家 · 20 金币」不变；数字消除选择屏年级勾选/下一步可用正常；菜单两入口并存；hanzi.html 正常加载（6 年级卡）并可达返回；dungeon.html 正常（6 年级卡、练习记录 3 条=D4/D5/D7 三局）并可达返回；JS 错误 0 |
| D9 | SW 三入口与断源 | 通过。构建生成的 web/sw.js 版本 `pixel-academy:number-puzzle:assets-v1-51ab2e546d4c` 预缓存 51 项含 /、/hanzi.html、/dungeon.html（含 /dungeon.css）；杀掉 serve 进程（源站请求确认失败）后刷新：首页由缓存打开（提示「离线缓存已就绪（版本 assets-v1-51ab2e546d4c），断网也能游玩。」）→菜单进地下城由缓存正常加载→**断网下题库模块经 SW 预缓存 import 成功（1074 题）**→开局答对石门并穿门（离线探索正常）→放弃（中断快照清除）→返回首页→hanzi.html 正常——三入口缓存互导；全程 JS 错误 0 |
| D10 | 贯穿检查 | 通过。全部截图检查点 `scrollWidth ≤ innerWidth`（无横向溢出）；`window.__errors` 全程 0（结果 JSON 的 d10Throughline 汇总） |

## 验收中发现的真实缺陷（未修改任何游戏代码，交实现者处理）

1. **算式题「开门」按钮在用户键入后不启用，首答被系统性降为重试档（高优先级）**。`src/game/arithmetic-dungeon/main.ts` 的 `renderQuestion()`（main.ts:250，dist 同位）只在渲染时按 `input.value.trim() === ''` 计算 `btn-input-submit.disabled`，且对 `answer-input` 只监听 keydown Enter（main.ts:497-505）、没有 input 事件联动。实测（真实键入 `Input.insertText` + 真实鼠标点击 + 真实 Enter 三重验证）：面板初开（输入框为空）时按钮 disabled，键入答案后仍 disabled——鼠标点击与 Enter（内部调 `btn.click()`，disabled 按钮不响应）均无法提交。唯一可用路径是等 10 秒超时（按答错处理）→ 点「再试一次」触发重渲染（此时输入值残留非空、按钮启用）→ 再提交。后果：**binary/chain 门题与资源题无法在限时内完成首答，作答表现被强制记为重试档 5 分**（D4 本轮资源题「1 + 5 = ?」即如此，结算 30 而非 35；若某局 4 题均抽到算式题，满分路径整体不可达）。触屏用户无物理 Enter，实际被完全阻断在该题提交之外。修复方向：监听 `input` 事件联动按钮 disabled（或提交时直接读输入框值，不依赖按钮态）。
2. **机关答对后约 0.9 秒 resolving 窗口内的点击被静默忽略（轻微）**。`main.ts` 的 `submit()`（main.ts:289-320）在答对后 `sleep(900)` 期间 `state.resolving=true`，`leaveSlot()`（main.ts:387-388）、`engage()` 等动作静默 return；而「收下钥匙，返回房间」按钮文本与可点外观在答对后立即渲染（`renderGame` 在 sleep 之前执行），用户即刻点击无任何响应也无视觉禁用提示。验收脚本按真实用户「再点一次」绕过，不影响流程，但建议窗口期给按钮加 disabled 态或提示。

## 与玩法规格文档的偏差（如实记录）

- 「再试一次」按钮**只重开 10 秒计时、不换题**；换题由独立的「换一题」按钮承担（`main.ts` retryAttempt/swapQuestion 两个动作）。玩法文档 line 18/23 写「点『再试一次』重开 10 秒计时并换一题」——实现把重开计时与换题拆成两个按钮，能力等价且给玩家保留了同题重试选项，但与文档描述不一致，建议二选一：改文档或合并按钮。
- D3 场景中未开放年级在地下城为**禁用置灰**（点不了），数字消除为**可勾选、可用性屏拦截**。两者「不混入未开放年级内容」的核心约束一致（D3 另经 dist 层核验 `describeAvailability([3])` 不可开局），交互形态不同，供实现者确认口径。

## 首跑失败与修复过程（驱动脚本调试，如实记录）

验收轮共执行 5 轮（每轮全新 profile、重置档案）。前 4 轮的失败分为两类：

- **暴露实现缺陷的失败**：第 2 轮 D4 石门抽到算式题「3 − 3 = ?」超时失败，由此追查出缺陷 #1（含三重复现实测：真实键入后鼠标/Enter 双路径均无效、超时→再试→提交成功但入 5 分档）；第 1 轮 D4/D5 的「收下钥匙」超时失败，追查出缺陷 #2（resolving 窗口吞点击，现场截图 `d4-02-resource-key.png` 为第 1 轮答对后按钮可点形态）。两项均如实计入上文缺陷清单，脚本改为按真实用户可用路径作答并动态核算期望分（choice 首答 10 / 受缺陷算式题重试档 5 / 右门答错重试 5），计分逻辑验证与缺陷影响解耦。
- **驱动脚本自身笔误**（与游戏实现无关）：第 2 轮 D5 断言把右门故意答错的重试次数误写为 0、D7 读练习记录取了最旧一条而非按 recordId 匹配本局、D8 关闭菜单后才点菜单内锚点、D9 缺装题库池索引；第 3 轮 D4 岔口视角断言误写「折回资源房」（实为「经过左门 → 资源房」）、D8 回首页断言带了仅菜单展开时成立的 visible 条件；第 4 轮 D8 地下城加载判定缺 `gradeCards===6`（模块未执行完时记录列表尚未渲染，读得 0 条）且钱包文本断言过死。全部修正后第 5 轮 9 场景全部通过。

## 截图索引（docs/evidence/m12/）

### 首轮验收（21 张，d- 前缀）

- D1 `d1-01-home-menu`（首页菜单弹层：两游戏入口并存）
- D2 `d2-01-dungeon-entered`（地下城选择屏与返回锚点）
- D3 `d3-01-grades-availability`（年级勾选与可用性提示；未开放年级置灰）
- D4 `d4-01-start-room`（起点房）、`d4-02-resource-key`（资源题答对、钥匙 1/1）、`d4-03-right-wrong`（右门答错反馈）、`d4-04-result`（结算屏）、`d4-05-records`（练习记录）
- D5 `d5-01-right-wrong-key-offer`（右门答错、「用钥匙开门」按钮）、`d5-02-result`（30 分结算）
- D6 `d6-01-pause-overlay`（暂停覆盖层）、`d6-02-pause-timer-frozen`（计时中暂停、倒计时冻结）
- D7 `d7-01-restore-offer`（恢复提供）、`d7-02-restored`（恢复后资源房）、`d7-03-result`（40 分结算、不重复计分）
- D8 `d8-01-home-menu`（双入口并存）、`d8-02-hanzi`（汉字勇者加载）
- D9 `d9-01-offline-home`（断源后首页离线提示）、`d9-02-offline-dungeon`（断源后地下城）、`d9-03-offline-explore`（断网探索到岔口）、`d9-04-offline-hanzi`（断源后汉字勇者）

### 缺陷修复复验轮（21 张，fx- 前缀）

- F1 `fx1-01-start-room`（复验局起点房）、`fx1-02-resource-key`（资源题答对、钥匙 1/1）、`fx1-03-right-wrong`（右门答错反馈）、`fx1-04-result-35`（35 分结算，示例路径直接达成）
- F2 `fx2-01-typing-probe`（整数题逐键键入后「开门」启用）、`fx2-02-resolving-window`（resolving 窗口内：✓ 反馈渲染、路线/收下钥匙按钮 disabled）、`fx2-03-window-recovered`（窗口后按钮恢复可用）、`fx2-04-result-35`（含整数题键入的 35 分结算）
- F3 `fx3-01-key-offer`（右门答错、「用钥匙开门」出现）、`fx3-02-result-30`（30 分结算）
- F4 `fx4-01-restore-offer`（恢复提供）、`fx4-02-restored`（恢复后资源房）、`fx4-03-result-40`（40 分结算、不重复计分）
- F5 `fx5-01-offline-home`（断源首页，新版本离线提示）、`fx5-02-offline-dungeon`（断源地下城）、`fx5-03-offline-explore`（断网探索）、`fx5-04-offline-hanzi`（断源汉字勇者）
- F5b `fx5b-01-offline-home`、`fx5b-02-offline-dungeon`、`fx5b-03-offline-integer-typing`（断网整数题键入提交后岔口）、`fx5b-04-offline-hanzi`

## 缺陷修复复验轮（2026-10-27，全部通过）

实现者针对上文两个缺陷提交修复后，由原验收代理（zcode-agent，仍只验证不修改游戏代码）在**全新 profile**（金币初始 20）上执行复验。修复后的构建版本 `assets-v1-ed99dbc5fe1a`（52 项预缓存，新增 `input.js` 模块进入 SW 闭包）。复验驱动脚本 [dungeon-browser-fix.mjs](dungeon-browser-fix.mjs)（补充场景同系列），结果合并写入 [dungeon-browser-results.json](dungeon-browser-results.json) 的 **`fixVerification` 字段**（与首轮 9 场景并列区分），新截图 `fx*-` 前缀。

**修复内容（实现者提交，复验只读核对）**：
- 缺陷 #1：新增 `src/game/arithmetic-dungeon/input.ts`（`syncIntegerSubmit` / `wireIntegerSubmit`）——`answer-input` 的 **input 事件实时联动「开门」按钮**（输入禁用或值为空时禁用），点击提交读取当前输入值，Enter 走同一提交路径（main.ts 接线）。
- 缺陷 #2：resolving 反馈窗口内**路线按钮与「离开机关/收下钥匙」按钮渲染为 disabled**（main.ts `renderRoutes` / `renderQuestionActions`），窗口结束后的重渲染恢复。

| # | 场景 | 结果 |
| --- | --- | --- |
| F1 | D4 复验：完整通关局 35 分 | 通过。本局 4 题均抽到选择题：起点→石门→岔口→左门→资源房→折回→右门（choice 错项故意答错，不解锁不扣分）→「换一题」→重试档 +5→结算「总分 35」「作答 4 题 · 首答 3/4 · 重试 1 次」「路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 0 把 / 剩 1 把」与规格示例逐项吻合（10+10+10+5=35，**不再依赖运气**）；记录 gameId=arithmetic-dungeon、score=35；金币局前 20 = 局后 20 |
| F2 | 探针局：整数题键入联动（探针 A）+ resolving 窗口（探针 B），并完整通关 | 通过。第 1 局石门即命中整数题「5 − 0 = ?」：**探针 A**——键入前「开门」disabled=true，逐键键入后首字符即实时启用（每字符 disabled=false），点击提交受理、首答 +10（首答档恢复）；左门、资源机关作答后**探针 B**——答对后 resolving 窗口内路线按钮全部 disabled=[true]、「收下钥匙」disabled=true（feedback「✓ 答对了 +10」渲染中），窗口结束后全部恢复 disabled=false、一次点击生效收下钥匙；右门键入错值 **Enter 提交**答错（不解锁不扣分）→「换一题」→重试档 +5→通关结算「总分 35」（含整数题键入的 35 分路径达成） |
| F2b | 含整数题通关局（F2 探针局）的练习记录核对 | 通过。两条 35 分记录（F1 全 choice 局、F2 含整数题局）全部结构正确：gameId=arithmetic-dungeon、retries=1、keyUses=0、route 完整、右门外均 firstTry=true；F2 局石门 exerciseId=`generated-v4:MAP-008:5-0`（整数题）计入作答表现且首答档恢复——整数题通关局的记录归属与首轮同构、gameId 可区分 |
| F3 | D5 抽查：备用钥匙路径 | 通过。石门+左门+资源题首答全对（30 分、钥匙 1/1）→右门故意答错→消耗备用钥匙直接解锁→结算「总分 30」「作答 3 题 · 首答 3/3 · 重试 1 次」；作答表现 slots=[gate-stone, gate-left, resource]（钥匙解锁的右门不计入）、本局避开上一局 |
| F4 | D7 抽查：刷新恢复不重复计分 | 通过。20 分（石门+左门开）后 Page.reload→恢复提供→资源房/得分 20/钥匙 0/1/roundId/门状态与刷新前一致→续打资源题+右门→结算「总分 40 · 首答 4/4 · 重试 0」（=20+20，若重计应为 60 未发生）；记录 recordId=roundId 幂等 |
| F5 | D9 抽查：断源三页缓存 | 通过。修复版 sw.js（assets-v1-ed99dbc5fe1a）预缓存含 /dungeon.html（含 /dungeon.css）；杀源站后刷新：首页由缓存打开（离线提示显示新版本号）→地下城由缓存正常加载→断网题库 import 成功（1074 题）→断网答题 +10 穿门→放弃（快照清除）→返回首页→hanzi.html 正常——三入口缓存互导；本局石门为选择题（choice 命中即作答，断网整数题键入提交由 F5b 补齐覆盖） |
| F5b | 断源重跑：断网整数题逐键键入 + Enter 提交 | 通过。第 4 局石门命中整数题「1 + 2 = ?」：断网下逐键键入实时启用「开门」→**Enter 提交受理** +10 穿门到岔口（断网整数题键入提交走通）→放弃（中断快照清除）→三页缓存互导、JS 错误 0 |
| D10 | 贯穿检查 | 通过。复验轮全部场景 `scrollWidth ≤ innerWidth`、JS 错误全程 0（`fixVerification.d10Throughline`） |

**复验轮首跑失败与修复过程（如实记录，均为验证工具问题而非游戏缺陷）**：复验第 1 轮 F1 直接进入地下城页，全新 profile 上数字消除的 IndexedDB 档案库尚未初始化（profiles store 不存在）导致读金币抛 NotFoundError、后续场景连锁失败——脚本修正为先访问首页完成档案初始化（顺带断言金币初始 20）；复验第 2 轮 F1–F5 全部通过但存在两处覆盖缺口（F1 整局未抽到整数题、F5 断网首局为选择题），以补充场景 F2b（记录核对）与 F5b（断网整数题，修正为循环开局直到命中）补齐；F2b 首跑的整数题记录判定条件笔误漏判（原始记录数据未变，修正判定后通过）。

## 边界与未验证项

- 桌面（D 阶段与修复复验轮）与生产环境（桌面无头 Chrome，见 production/）均已验证；**Android Chrome 113 与 iOS Safari 18.6 模拟器验证见 [device-simulators/README.md](device-simulators/README.md)**（2026-10-27，含断网探索与整数键入提交回归，两缺陷修复在触屏实测成立）。**物理真机未验证**（项目裁决以模拟器口径替代，模拟器证据不代表真机）；iOS 生产环境未单独复跑（Android 生产已验、SW 机制同代码）；教学效果与真实学生可读性未验证。
- 桌面两轮均执行过 `npm run build`（服务与 SW 所需），**均未重跑 `npm run check`**（typecheck + 单元测试以实现者输出为准，验收员未复核；实现者最终输出 128 项全绿，含缺陷修复新增的 3 项测试）。
- 首轮发现的缺陷 #1 已在复验轮确认修复：35 分示例路径不再依赖随机抽题（复验轮 F1 全 choice 局与 F2 含整数题局均结算 35 分），两轮均已固定验证该路径。
- D9/F5b 断源验证后本地 serve 进程已被脚本终止（场景设计如此）。
