# M5 浏览器验证记录（本地记录与恢复）

本文件在 macOS 大小写不敏感文件系统上对应 docs/evidence/M5/ 与 docs/evidence/m5/ 同一目录，含两轮记录：

- 第一部分：实现工程师冒烟轮（zcode-agent，会话 m5smoke，15 张编号截图）。
- 第二部分：浏览器验收员第 1 轮（独立会话 m5v1 / m5v1ns，19 张 v1- 前缀截图）。

两轮均来自桌面 Headless Chrome 模拟；iOS Safari 与 Android Chrome 真实设备未测，属 M7 汇总缺口。

---

## 第一部分：实现工程师冒烟轮

- 执行者：zcode-agent（实现工程师，代理执行）。
- 日期：2026-10-25。
- 环境：macOS darwin 25.6.0 arm64，Node 24.20.0；页面经 `npm run serve`（先构建）由 Node 内置 http 提供，地址 http://127.0.0.1:4173/。
- 浏览器：Headless Chrome（agent-browser 经 CDP 驱动，会话 m5smoke）；DOM 控件为真实点击，棋盘点选为页面内合成 PointerEvent（pointerType=touch，坐标按画布 360×620 逻辑坐标系换算，与 M3/M4 证据同方法）。
- 构建版本：本工作区未提交变更（M5 实现：storage.ts 新增，main.ts/session.ts/random.ts/web 接线）；`npm run check` 于冒烟前执行通过（47 项测试 pass 47 / fail 0）。

### 场景与结果

| # | 场景 | 步骤 | 预期 | 实际 | 截图 |
| --- | --- | --- | --- | --- | --- |
| 1 | 首次使用 | 清空 localStorage 后打开页面 | 无存储键、无勾选、记录区显示「暂无已保存的练习记录」、无存储告警 | 一致 | 01-select-fresh.png |
| 2 | 设置持久化 | 勾选一年级（即改即存）→ 刷新 | 复选框保持勾选，settings 键为 `{"schemaVersion":1,"selectedGrades":[1],"soundOn":true}` | 一致；键名 `pixel-academy:number-puzzle:v1:settings` | 02-settings-persisted.png |
| 3 | 中断快照与恢复提供 | 开局后逐题答对 3 题（得分 30）→ 刷新 | 出现「继续上局/放弃上局」，文案「已完成 3/10 题，得分 30。」 | 一致 | 03-restore-offer.png |
| 4 | 恢复续局 | 点「继续上局」→ 继续作答 | 游戏屏恢复，题目/得分/进度与中断时刻一致（第 4/10 题、得分 30），继续作答正常累计 | 一致 | 04-restored-playing.png |
| 5 | 暂停态恢复 | 无头浏览器在命令间隐藏页面触发 visibilitychange 自动暂停（快照 paused=true）→ 刷新 →「继续上局」 | 恢复后保持暂停覆盖层，状态不丢 | 一致（快照 JSON 实测 paused=true；恢复后 overlay 可见） | 05-restore-paused.png |
| 6 | 恢复局结算与去重 | 续局打完剩余 7 题到结算 | 结算「总分 100 / 一次通过 10/10 / 答错 0」（30 为中断前、70 为恢复后，无重复计分）；records 键恰有 1 条（同 recordId 幂等）；中断快照键被清除 | 一致；记录条目「10-25 20:07 · 一年级 · 总分 100 · 一次通过 10/10 · 答错 0 次」 | 06-result-record.png |
| 7 | 记录持久读取 | 返回年级选择 → 刷新 | 记录列表仍显示该条；无残留恢复提供 | 一致 | 07-records-persisted.png |
| 8 | 内容版本不兼容 | 将中断快照 contentVersion 改为旧值 → 刷新 | 显示「内容已更新，上次中断的局次无法继续，已安全放弃。历史成绩与设置不受影响。」；仅清中断快照，records=1、settings 不变 | 一致 | 09-version-incompatible.png |
| 9 | 损坏存档按首次使用 | 将中断快照键改为非法 JSON → 刷新 | 无恢复提供、无错误屏、按键自愈删除、records 与 settings 不受影响、页面可游玩 | 一致 | 10-corrupt-first-use.png |
| 10 | 存储不可用 | 以 init script 在页面脚本前令 localStorage 访问抛 SecurityError → 刷新 | 顶部红色告警「本地存储不可用，练习记录与设置无法保存，游戏仍可正常游玩。」；设置回退默认、记录区为空 | 一致 | 11-storage-unavailable.png |
| 11 | 不可用时仍可游玩 | 同上开局并作答（先答错后答对） | 棋盘输入正常处理（✗ 再想一想 反馈可见），答对后得分 5（10/5 计分规则正常）、进入第 2 题，告警持续显示 | 一致 | 12-unavailable-playable.png、13-unavailable-answered.png |
| 12 | 清除本地记录 | 点「清除本地记录」→ 按钮变「确认清除？」→ 再点确认 | 第一击不动数据；确认后仅删除本应用两个存储键（settings/records，测试外加的无关键保留），记录区回「暂无」，提示「本地记录已清除。」 | 一致 | 14-clear-confirm.png、15-cleared.png |
| 13 | 预览入口隔离 | /?preview=candidate：点选年级、进入预览流程 | 预览横幅显示、记录区隐藏；年级变更不写 settings；不产生中断快照键 | 一致 | （状态经 eval 核对，见上） |

### 过程记录与说明

- 场景 3–7 为同一局完整闭环：开局 → 3 题答对（30 分）→ 刷新恢复 → 暂停态恢复复验 → 续局 7 题到结算 → 记录恰一条且无重复计分。
- 自动暂停与快照联动在本轮多次自然发生（无头浏览器命令间页面隐藏）：每次隐藏均把 paused=true 与冻结计时器写入快照，恢复后行为一致，与 M4 会话状态机及 M5 快照设计的组合行为相符。
- 测试初期出现一次「settings/records 键全部消失」的现象：经复现实验（canary 键 + 相同 open/init-script 序列两轮）与代码路径核对（clearAll 是唯一同时删除两键的入口，且两击确认内才会执行；存储被注入脚本阻断时 GameStorage 无后端、removeRaw 直接返回），确认删除不来自应用代码，为本会话 init-script 注入与命令时序造成的测试工具侧现象；应用自身的清除流程随后在可观测条件下完整复验通过（场景 12）。
- 预览入口（场景 13）按 docs/gameplay-number-puzzle.md「预览局不写入正式记录存储」验证。
- 已知限制：本记录全部来自桌面 Headless Chrome 模拟；iOS Safari 与 Android Chrome 真实设备未测（属 M7 汇总缺口，与 M3/M4 相同）。localStorage 写入中途失败（如配额满）的浏览器内复现未做（需可控配额环境），该路径由 tests/storage.test.mjs 的注入式失败后端覆盖。

---

## 第二部分：浏览器验收员第 1 轮

- 执行者：zcode-agent（浏览器验收员，代理执行，独立于实现工程师冒烟轮）。
- 日期：2026-10-25。
- 环境：macOS darwin 25.6.0 arm64，Node v24.20.0，agent-browser 0.39.2；页面经 `npm run serve`（先执行 tsc 构建，成功）由 Node 内置 http 提供，地址 http://127.0.0.1:4173/。构建内容为工作区未提交的 M5 变更（src/game/number-puzzle/storage.ts、main.ts、session.ts、random.ts、web/）。
- 浏览器：HeadlessChrome/155.0.0.0（agent-browser 经 CDP 驱动，独立会话 m5v1 与 m5v1ns，两会话浏览器实例隔离、localStorage 互不可见）。
- 方法：
  - DOM 控件（复选框、按钮）为真实点击（agent-browser click / check）。
  - 棋盘点选为页面内合成 PointerEvent（pointerType=touch），目标块按 localStorage 中断快照（应用在每次规则状态变化后持久化的权威状态，src/game/number-puzzle/main.ts:606 persistSnapshot）计算当前题答案与棋盘布局后换算为画布实际坐标，与 M3/M4 证据同方法；每次点击是否被游戏判对由应用自身状态机验证（得分/题号推进）。
  - 画布显示经 init-script 包装 `CanvasRenderingContext2D.fillText` 读取（HUD 题号/得分、题面文本、棋盘块数值与坐标；脚本为测试工具，存于 /tmp/m5-observer.js 与 /tmp/m5-nostorage.js，不入仓库源码）。
  - 两会话全程 `agent-browser errors` 与 `console` 均为空（无页面错误、无控制台输出）。
  - 本轮未重跑 `npm run check`（非本轮浏览器验收要求；本轮结论不引用测试输出作依据）。

### 场景与结果（全部通过）

| # | 场景 | 步骤 | 预期 | 实际 | 截图 |
| --- | --- | --- | --- | --- | --- |
| A | 设置年级与音效 → 刷新 → 保留 | 勾选一、二年级 → 开局点「音效 开」变「音效 关」（aria-pressed=false）→ 返回弃局 → 刷新 | 设置键即改即存；刷新后复选框与音效状态恢复 | settings 键实测随每次变更即写（`{"schemaVersion":1,"selectedGrades":[1,2],"soundOn":false}`）；刷新后复选框恢复勾选、无存储告警、无恢复提供；再开局「音效 关」与存储一致 | v1-01、v1-02 |
| B | 完整玩完一局 → 刷新 → 结算记录仍在且数值一致 | 二年级单选 6 题局全部首答正确 → 结算 → 刷新 | 结算数值与记录一致，刷新后记录仍在 | 结算「总分 60 / 一次通过 6/6 / 答错 0 次」；records 键恰 1 条（recordId np-bb1bfe95…，score 60 = 6×10，firstTryCount 6，totalWrongCount 0，questions 6 条，contentVersion fp1:6:6fc38f7859a65a62），中断键已清除；刷新后记录列表「10-25 20:24 · 二年级 · 总分 60 · 一次通过 6/6 · 答错 0 次」逐值一致 | v1-03、v1-04 |
| C1 | 中途刷新 → 恢复一致 → 只记录一次 | 开局 Q1 对(10) → Q2 先错再对(5) → Q3 对(10) → 记录快照 → 刷新 → 继续上局 → 打完 | 恢复提供文案、题目、分数、进度、棋盘与中断时刻一致；续局结算与中断前衔接；该局只记一条成绩 | 恢复提供「已完成 3/6 题，得分 25。」；恢复后画布 HUD「第 4 / 6 题」「得分 25」，12 块棋盘逐位等于快照 board `[10,37,57,14,70,78,54,0,53,18,28,34]`（0 mismatch），题面为乘法点阵（快照任务 MATH-018 5×2，点阵无数值文本，一致）；续打 Q4–Q6 各 +10 → 结算「总分 55 / 一次通过 5/6 / 答错 1 次」= 中断前 25 + 恢复后 30；records 恰 2 条，本局 recordId 与中断快照相同（np-36dfd761…，逐题 firsts=[true,false,true,true,true,true]、wrongs=[0,1,0,0,0,0]），中断键已清除 | v1-05、v1-06、v1-07 |
| C2 | 中途关闭重开 → 恢复提供 → 放弃上局 | 再来一局答 1 题(10) → 关闭标签页 → 新标签页打开同 URL → 放弃上局 | 恢复提供与历史记录同显；放弃后快照清除、历史不动 | 新标签页（原页面上下文已销毁）显示「已完成 1/6 题，得分 10。」及 2 条历史记录；点「放弃上局」后恢复提供消失、中断键为 null、2 条成绩与设置原样 | v1-08 |
| D | 改内容版本为不兼容值 → 重开 → 放弃说明 + 历史仍在 | 中途局（1/6、10 分）回选择屏后用浏览器把中断快照 contentVersion 改为 `fp0:incompatible-old-content` → 刷新 | 显示放弃原因说明；仅弃中断局次，历史成绩与设置不动 | 红色警示「内容已更新，上次中断的局次无法继续，已安全放弃。历史成绩与设置不受影响。」；无恢复提供；中断键删除；records 2 条数值原样、settings 原样 | v1-09 |
| E | 记录键写入损坏 JSON → 重开 → 首次使用处理、可游玩 | records 键写入 `{broken json not valid` → 刷新 → 完整玩一局（1 错 + 5 对） | 不崩溃、记录区按首次使用显示为空、页面可游玩；损坏值随后被合法数据替换 | 选择屏正常（无错误屏），记录区「暂无已保存的练习记录。」，设置（二年级勾选）不受影响，无存储告警；完整一局可玩（答错反馈 + 5 分重试计分正常），结算 55/5/1，records 键被重写为合法 JSON 恰 1 条（55 = 5 + 5×10，firstTry 5，wrong 1） | v1-10、v1-11 |
| F | 清除记录入口：确认后清空，刷新后为空 | 有 1 条记录时点「清除本地记录」→「确认清除？」→ 再点确认 → 刷新 | 第一击不动数据；确认后全部应用键清空；刷新后仍为空 | 第一击后按钮变「确认清除？」且 records/settings 键原样（3 秒超时自动复位亦实测：按钮复原、数据未动）；两击确认后「本地记录已清除。」、记录区回「暂无」、年级勾选清空、localStorage 中 pixel-academy 键全空；刷新后仍为空、无残留状态 | v1-12、v1-13、v1-14 |
| G | 存储不可用仍可游玩并提示（浏览器内真实模拟） | 独立会话以 init script 在页面脚本前把 `window.localStorage` 换为访问即抛 SecurityError 的 getter（等价浏览器隐私模式阻止站点数据）→ 开局作答 → 刷新 | 告警显示、游戏可玩、无任何持久化 | eval 证实 localStorage 访问抛 `SecurityError`；顶部红色告警「本地存储不可用，练习记录与设置无法保存，游戏仍可正常游玩。」持续显示；选二年级开局：首块答对 30+20−10=40 得 +10，答错（点 86）✗「再想一想」分数不变，重试答对 +5（第 3/6 题、得分 15）；刷新后无任何设置恢复（无勾选）、告警仍在 | v1-15、v1-16、v1-17、v1-18 |

### 过程记录与说明

- C1 恢复验证的对照基准为刷新前从 localStorage 读出的完整中断快照（recordId、questionIndex 3、score 25、firstTryCount 2、totalWrongCount 1、board 12 块、下一题任务、rngState 1978970475），恢复后逐项比对一致；恢复后继续作答能被游戏判对，功能上证明恢复出的棋盘与题目可用。
- C1 恢复后立刻处于暂停覆盖层（无头浏览器命令间页面隐藏触发 visibilitychange 自动暂停，快照 paused=true 原样恢复）——v1-06 截图即为该状态（棋盘已按快照恢复、覆盖层「已暂停/继续游戏」显示）；点「继续游戏」正常续局，快照 paused 回 false。与 M4 会话状态机 + M5 快照的组合设计一致。
- D 场景第一次尝试在局次进行中改写 contentVersion，随后被应用自身的快照写入覆盖（页面隐藏自动暂停触发 persistSnapshot 重写全量快照）——这是应用对进行中局次存储键的合法所有权行为，非缺陷；改为在选择屏（无进行中局次）改写后按预期触发放弃流程。
- E 场景针对的是成绩记录键（`pixel-academy:number-puzzle:v1:records`）；损坏的中断快照键自愈路径见实现工程师冒烟轮场景 9 与本轮 D（其键被整体删除）。
- G 场景为读取/访问被浏览器阻止的存储不可用；localStorage 写入中途失败（如配额满）需可控配额环境，本轮同样未在浏览器内真实复现，维持 PLAN.md M5 已知限制 ②：该路径由 tests/storage.test.mjs 的注入式失败后端覆盖（本轮未重跑该测试，覆盖结论引用实现轮执行记录）。
- 全部截图已由验收员逐张目视核对内容与本表描述一致（v1-06 为暂停覆盖层状态已在表内注明）。

### 已知限制

1. 全部浏览器证据来自桌面 Headless Chrome（HeadlessChrome/155.0.0.0）模拟；iOS Safari 与 Android Chrome 真实设备未测（本环境无真机，属 M7 汇总缺口，与 M3/M4 相同）。
2. localStorage 写入中途失败（配额满等）未在浏览器内真实复现（需可控配额环境）；与已验证的「存储访问被阻止」不同，该路径由单元测试的注入式失败后端覆盖。
3. `npm run check` 本轮未重跑（浏览器验收轮；实现工程师冒烟轮已执行通过，47 项测试 pass 47 / fail 0，见第一部分）。
4. 音效可听性未验证（无头浏览器无音频输出），仅验证音效开关的设置持久化与 UI 状态同步。
