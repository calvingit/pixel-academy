# 拼音冒险（M9）首版桌面浏览器验证记录

## 内容与审核边界

- **题目来自结构化生成**：`src/content/pinyin-exercises.ts` 按拼音领域词表（23 声母 + 24 韵母）为每字母生成辨认 + 听辨各一题共 94 题，干扰项取自显式易混组（`PINYIN_CONFUSABLE_GROUPS`）并按表序补充。审核记录见 [拼音内容审核](../../content-review-pinyin.md)——**审核者为 zcode-agent（代理审核）**，仅核对字母身份、干扰项可解释性、听辨结构级防泄露（`validatePinyinTask` 强制题面不含任何拉丁字母）；来源核对（sourceVerification）与教学映射核验（curriculumVerification）保持 pending，未宣称教师评审或发音教学核验。
- **音频来自 macOS 婷婷（Tingting）TTS 预生成**（[音频来源方案](../../m9-audio-prep.md) 方案 A，2026-10-27 用户确认）：47 条 16-bit / 22.05 kHz 单声道 WAV 入库 `web/audio/pinyin/`，随构建进入 SW 预缓存；声母呼读音、韵母直读，ü/üe/ün 与 ui/iu/un 的近似口径见审核记录。生成脚本 `scripts/gen-pinyin-audio.sh` 可复现。
- **发音真人试听未做（缺口）**：TTS 读单字母的呼读音口径、清晰度与儿童可听性未经真人核验，代理无法替代。后续按条目单独重生成或替换；本验证只断言「音频可播放、可重复播放、断网缓存命中」，**不构成发音正确性结论**。
- 验收轮在浏览器内经 dist 产物核验：`selectPinyinExercises([1])` 共 94 道全部 `approved`（辨认 47 + 听辨 47）；作答答案一律从页面题面 `data-exercise-id` 经 dist 判题模块（`/dist/game/pinyin-adventure/content.js` 的 `selectPinyinExercises` + `/dist/learning/pinyin.js` 的 `correctPinyinAnswer`）自算，未注入任何游戏状态。

## 桌面浏览器验证（P 阶段，独立验收轮）

执行于 2026-10-27。执行者为 **zcode-agent 代理（浏览器验收员，独立于实现轮）**，只验证与记录、不修改任何游戏代码。依据 PLAN.md M9 小节与 [音频来源方案](../../m9-audio-prep.md) 的交互约束（听辨不得以文字泄露答案、音频不可用时不假装完成听力训练、断网可播放）。

**环境**：HeadlessChrome/156.0.0.0（Chrome 156.0.8078.48，`--headless=new`，CDP 直连端口 9742），视口 1280×713（DPR 1），全程全新 profile（无历史档案，IndexedDB 金币初始 20），本地源 `node scripts/serve.mjs 4173`（构建产物 `pixel-academy:number-puzzle:assets-v1-82a7025b1ba5`，预缓存 108 项）。启动参数含 `--autoplay-policy=no-user-gesture-required --mute-audio`：headless 无声输出，**音频断言全部基于状态机**（Audio `canplay`/`playing`/`error` 事件、`currentTime`、CacheStorage 命中 200），不涉及真实声音质量。真实鼠标事件（trustedClick）、真实键盘（Tab）、`Page.reload` 刷新、杀源站进程断源、CDP Fetch 域拦截 `*.wav` 模拟音频不可用。驱动脚本 [pinyin-browser.mjs](pinyin-browser.mjs)（最终入库版与产出证据的第 5 轮运行版仅差一处未使用变量清理，断言逻辑一致），结构化结果 [pinyin-browser-results.json](pinyin-browser-results.json)（逐场景 pass/result/checks，含逐场景横向溢出与 JS 错误记录）。

| # | 场景 | 结果 |
| --- | --- | --- |
| P1 | 首页菜单四入口 | 通过。数字消除保持当前游戏（h1/title 不变）；菜单弹层（aria-label=学习与收藏）内「拼音冒险」入口 href=/pinyin.html 可见（描述「听声音认拼音字母」），装饰字 span aria-hidden=true，与「汉字勇者」「算术地下城」两入口及四功能按钮并存（共 7 项）；Tab 焦点路径 关闭→学习课程→错题复习→金币商店→我的收藏→汉字勇者→算术地下城 后到达拼音入口（键盘可达）；CDP 无障碍树 link 角色、名称「拼音冒险」；全新档案金币 20；JS 错误 0 |
| P2 | 进入 pinyin.html | 通过。真实点击入口后 /pinyin.html 正常加载：h1「拼音冒险」、6 张年级卡、boot-fail 隐藏、存储可用提示隐藏、「返回数字消除」锚点（href=/）可见；JS 错误 0 |
| P3 | 年级筛选 | 通过。dist 层 `selectPinyinExercises([1])`=94 道（辨认 47 + 听辨 47，全部 approved），二~六年级各 0 道；UI 初始未选年级开始禁用 → 勾一年级→「本局题库：一年级 94 道，共 94 道」（与 dist 一致）、开始可用；二年级卡禁用置灰（disabled、title=暂未开放、点击无效、提示不变）——未开放年级不可混入；dist 层 `describeAvailability([2])`=「二年级暂无已审核的拼音练习。当前开放：一年级（语文）。」（startable=false）；设置持久化正常 |
| P4 | 完整局 5 题（听辨 ≥2 + 重试档 + 记录/金币） | 通过。本局 2 辨认 + 3 听辨（PY-L-021、PY-C-013、PY-C-034、PY-L-017、PY-L-009）；**听辨题面（除候选按钮）经逐题 DOM 扫描确认无任何拉丁字母/ü 且不含答案字形**，题头「听辨练习 · 听声音选字母」；播放钮可点，Audio `canplay`+`playing` 触发、currentTime=0、URL 与题库一致、CacheStorage 命中 200（3/3 题）；**可重复播放**（同一题第二次播放再次 `playing`）；第 4 题故意答错（✗、得分仍 30）→「再试一次」重开计时→重试 +5；结算「总分 45」「作答 5 题 · 首答 4 · 重试 1 次」「辨认 2/2 题首答 · 听辨 2/3 题首答」与逐题档位（4×10+5）吻合；记录 gameId=pinyin-adventure、模式序列与局内观察一致、首答 4/5、第 4 题 wrongs=1；recent-ids 含本局全部题目 ID；IndexedDB 金币局前 20 = 局后 20（零收支）；JS 错误 0 |
| P5 | 音频不可用降级（拦截 wav → 提示 + 跳过不计分） | 通过。注销 SW 并以 `?nosw=1` 重载（controller=null），CDP Fetch 拦截 `audio/pinyin/*.wav`；第 1 题（听辨）点播放 → **Audio `error` 事件触发（无 `playing`）**→ 出现「当前无法播放声音。可以返回结束本局，或跳过这道听辨题继续。」提示与「跳过这道听辨题」入口（不假装完成听力训练）；跳过后其余 4 题（辨认 2 + 听辨 2）全部首答答对；结算「总分 40」「作答 4 题 · 首答 4 · 重试 0 次 · 跳过 1 题」——**跳过题不计分不计作答**；记录 score=40、5 题中 1 题 answered=false（mode=listen、firstTry=false）、列表含「跳过 1」；金币不变；JS 错误 0 |
| P6 | 暂停/恢复（倒计时冻结） | 通过。第 1 题首答 +10 后暂停：覆盖层「在字母森林歇一会」出现、HUD 不变，继续正常；第 2 题计时中（剩 9.3 秒）暂停→快照 remainingMs 冻结于 9270ms（paused=true，2.5 秒后仍不变）→继续后 9.3 秒 ≈ 冻结值（暂停期间未流逝）、题面不变；续答第 2 题 → 第 3/5 题、得分 20、快照 questionIndex=2（P7 前置）；JS 错误 0 |
| P7 | 刷新恢复（不重复计分） | 通过。20 分后 Page.reload → 恢复提供「有未完成的练习，可以继续（题目、得分与计时进度都会恢复）。」→继续练习→第 3/5 题、得分 20、roundId/题目 ID 序列/firstTryCount 与刷新前一致、计时继续（剩 9.7 秒）→续答 3 题全对→结算「总分 50」（=20+30；若前两题重计应为 70，未发生）「辨认 3/3 题首答 · 听辨 2/2 题首答」；记录 recordId=roundId 幂等恰 1 条、5 题全 firstTry；JS 错误 0 |
| P8 | 三游戏回归 | 通过。拼音「返回数字消除」回首页，钱包「小小探险家 · 20 金币」不变；数字消除选择屏年级勾选/下一步可用正常；菜单内汉字勇者/算术地下城/拼音冒险三锚点并存；hanzi.html 正常加载（6 年级卡）并可达返回；dungeon.html 正常（6 年级卡）并可达返回；JS 错误 0 |
| P9 | SW 四入口与断网听辨 | 通过。SW 版本 `pixel-academy:number-puzzle:assets-v1-82a7025b1ba5` 预缓存含 /、/hanzi.html、/dungeon.html、/pinyin.html（含 /pinyin.css 与拼音 dist 模块）+ **47 条 /audio/pinyin/*.wav**（sw.js 清单文本含拼音入口）；杀掉 serve 进程（源站请求确认失败）后刷新：首页由缓存打开，菜单进拼音冒险由缓存正常加载（6 年级卡）；**断网开局答对前序题后遇听辨题 `audio/pinyin/ou.wav` → 播放成功（`playing` 事件触发、CacheStorage 命中 200）并答对完成该听辨题**；放弃本局回选择屏（中断快照清除）→返回首页→hanzi.html、dungeon.html 均由缓存正常加载——四入口缓存互导；全程 JS 错误 0 |
| P10 | 贯穿检查 | 通过。全部场景 `scrollWidth ≤ innerWidth`（无横向溢出）；`window.__errors` 全程 0（结果 JSON 汇总） |

## 对照 M9 验收条件的结论

- 「加入可重复播放的音频和明确的作答方式；辨认与听辨分开组织，不用文字提示泄露听辨答案」：重复播放（P4）、点击作答（P4）、模式分开记录与统计（P4 结算「辨认 X/Y · 听辨 Z/W」、记录逐题 mode）、听辨题面结构级无泄露（P4 逐题扫描）均验证通过。**口径说明：「分开组织」在本实现为混合局内分开组卷（听辨池 2–3 题/局、辨认池补足）+ 分开记录，不是纯辨认局/纯听辨局分开关卡**（`rules.ts` createRound）；与 PLAN 原文不冲突但有解释空间，供实现者/用户确认口径。
- 「静音或音频不可用时，听辨关卡明确提示并允许退出或选择可用模式，不假装完成听力训练」：P5 验证通过（明确提示 + 返回本局入口 + 跳过入口，跳过不计分不计作答、记录如实标注）。实现不检测系统静音（仅检测播放失败），提示文案由 `audio-notice` 与 `feedback` 两处呈现——见观察 #2。
- 「听辨音频随内容缓存，断网可播放；首版不开发自动发音评分」：P9 验证通过（47 条 WAV 预缓存、断网播放+作答完成一题）；无发音评分功能。
- 「音频发音及字母、音节标记完成审核；字体能区分易混字形」：审核为**代理审核**（真实执行者，见文首边界），发音真人试听为**未完成缺口**；候选以独立大字卡呈现（截图 p4-01 中 s/z/c/b、p5-01 中 j/l/i/b 等易混组同屏），视觉上字形清晰可辨，但本轮未做专门的易混字形辨识测试，字体区分度结论以截图目测为限。

## 验收中发现的真实缺陷（未修改任何游戏代码，交实现者处理）

1. **正确答案恒为第一个候选卡，辨认题干扰项失效、听辨题存在投机路径（高优先级）**。`src/content/pinyin-exercises.ts` 的 `chooseTask`/`listenTask`（pinyin-exercises.ts:80、90）把答案字母放在 `options[0]`（`[letter, ...pinyinDistractors(...)]`），而 `src/game/pinyin-adventure/main.ts` 的 `renderQuestion()`（main.ts:210-218）按数组原序渲染、不洗牌。后果：**每一题（辨认与听辨）点第一张候选卡必然正确**。对辨认题，精心设计的易混干扰组完全失效——孩子无需辨认字形，学会「点第一张」即可满分；对听辨题，发现规律后可以完全不听音频作答，与「不假装完成听力训练」的训练效度精神相悖（本轮作答虽按题库答案点击而非利用此规律，但截图 p4-01/p5-01/p9-03 均可见答案位居首位）。修复方向：渲染层对 `task.options` 洗牌（或内容层乱序存放答案），判题按字母身份不受影响。
2. **（轻微）音频不可用提示同屏重复两条**。降级时「当前无法播放声音……」由 `#audio-notice`（role=status 提示条）与 `#feedback`（信息条）各呈现一次（main.ts `showFeedback('info', ...)` + `renderPlayArea`），文案相同、同屏出现（截图 p5-01）。信息无害但冗余，建议保留一处。
3. **（口径记录，非缺陷）听辨播放不暂停作答计时**。`main.ts` onPlay 注释明确「播放期间作答计时继续」（与数字消除「每题 10 秒」同口径）；本轮每道听辨题 1–2 次播放后作答均在限时内完成，未构成超时，但低龄儿童多次重听可能吃掉作答时间，属设计取舍，如实记录。

## 缺陷修复复验轮（2026-10-27，合并复验 M9 两缺陷 + M8 同款缺陷）

实现者修复后由验收员执行合并复验（只验证与记录、不改代码）：**M9 #1 组卷洗牌**（`src/game/pinyin-adventure/rules.ts` createRound 以局内 rng 洗每题 `options`，洗牌结果随 RoundState/快照恢复）、**M9 #2 降级提示去重**（`src/game/pinyin-adventure/main.ts` onPlay 降级只置 `audioUnavailable`，提示仅由 `audio-notice` 呈现）、**M8 同款洗牌**（`src/game/hanzi-hero/rules.ts` createRound 同路径，choose+parts，判题按字/部件集合身份，内容数据零改动；M8 侧记录见 [汉字勇者验证记录 · 候选排列缺陷修复](../m8/README.md)）。`npm run check` 重跑 **167 项通过**（含新增 hanzi-hero 洗牌与 offline 测试更新）。

**复验环境**：同首轮（HeadlessChrome/156.0.0.0，CDP 9742，视口 1280×713，全新 profile，本地源 4173），构建产物更新为 `pixel-academy:number-puzzle:assets-v1-9f9ffaac4a45`。驱动脚本 [pinyin-fix-verify.mjs](pinyin-fix-verify.mjs)，结果合入 [pinyin-browser-results.json](pinyin-browser-results.json) 的 `fixVerification` 字段（首轮 P1–P10 证据原样保留）。

| # | 场景 | 结果 |
| --- | --- | --- |
| FX1 | M9-P4 重跑（3 局洗牌 + 判题/记录/金币） | 通过。3 局 ×5 题（首局截图 fx-1-01）：**答案位置分布 `[0,2,1,0,1,3,0,1,2,1,0,0,2,2,3]`（4 个不同位置、首位仅 5 题）、15/15 题渲染序 ≠ 内容原始序**——洗牌生效（修复前恒为首位）；每题渲染候选均为内容候选的排列，按字母身份点击判对；听辨防泄露逐题照旧；每局第一道听辨播放成功（playing + 缓存命中 200）；第 4 题答错→再试一次→重试档，结算「总分 45」「作答 5 题 · 首答 4 · 重试 1 次」逐局吻合、记录模式序列/wrongs 校验 3/3；金币 20 零变化；JS 错误 0 |
| FX2 | M9-P5 重跑（降级单提示 + 跳过不计分） | 通过。拦截 *.wav → Audio error（无 playing）→ **audio-notice 一条提示、feedback 保持隐藏**（修复前同屏两条同文案，截图 fx-2-01 对照首轮 p5-01）→ 跳过后其余 4 题首答答对；结算「总分 40」「作答 4 题 · 首答 4 · 重试 0 次 · 跳过 1 题」；跳过题记录 answered=false（mode=listen、firstTry=false）；金币不变；JS 错误 0 |
| FX3 | M8 抽验（hanzi 洗牌 + 身份判题 + 组字多选 + 刷新恢复） | 通过。共 2 局（首局含刷新恢复；一年级池 28 题含 3 道组字题、单局随机抽可能不含，续局直至覆盖）：**10/10 题渲染序 ≠ 内容原始序、正确选项位置分布 `[2,0,2,0,3,2,0,2,3,3]`（3 个不同位置）**——洗牌生效；每题经 `/dist/learning/hanzi.js` correctHanziIds 对洗牌后 task 自算正确选项（choose 按字身份、parts 按部件集合身份勾选+「提交答案」，截图 fx-3-04），全部首答判对；答对 2 题刷新→恢复→**逐题洗牌排列与刷新前一致（随快照恢复）**→续打；各局结算「总分 50 · 首次答对 5/5 · 答错 0 次」、记录 id=roundId 恰 1 条；金币不变；JS 错误 0 |
| FX4 | 快速回归（数字消除 + 地下城） | 通过。数字消除选择屏年级勾选/下一步可用（数学题无选项卡不受影响）；dungeon.html 正常加载（6 年级卡）；JS 错误 0 |
| FX5 | 贯穿（横向溢出与 JS 错误） | 通过。复验全程无横向溢出、JS 错误 0 |

**缺陷关闭状态**：M9 #1（答案恒为首候选）**关闭**——洗牌生效且快照/恢复/判题口径保持；M9 #2（降级提示重复）**关闭**——同屏仅 audio-notice 一条；M8 同款缺陷**关闭**（复验见上表 FX3 与 m8 记录）。首轮观察 #3（听辨播放不暂停计时，口径记录）未改，维持口径如实记录。

**复验脚本调试记录（如实）**：复验脚本共 3 轮执行。第 1 轮因脚本自身问题全部中断——全新 profile 下验收脚本带版本号 `indexedDB.open` 抢先创建了缺 `profiles` store 的空库（改为 `indexedDB.databases()` 先探测）；第 2 轮 FX1 因脚本漏装题库池的 `audio` 字段误报播放失败（诊断显示 canplay+playing 实际齐备）、FX3 超时未复现（现场探针 57ms 就绪）；第 3 轮修正后 FX1–FX5 全过。另发现脚本初版误按拼音的 `{records:[...]}` 包装读汉字记录，实际 hanzi 存储为纯数组结构（`storage.ts` write 直写数组）——已修正，属脚本缺陷非游戏缺陷。

## 首跑失败与修复过程（驱动脚本调试，如实记录）

验收轮共执行 5 轮（每轮全新 Chrome profile、重置档案）。**前 4 轮的失败均为驱动脚本自身缺陷或环境问题，未暴露游戏实现缺陷**；第 2、4 轮的现场诊断（保留在失败轮输出中）反而证明游戏行为正常——音频实际已播放（记录含 `canplay`+`playing`）、降级提示实际已出现。逐轮如下：

- **第 1 轮**：P1–P3 过；P4/P5 失败于「Audio 实例创建」等待超时；P6 因脚本误读快照形状（把 `snap.state.score/questionIndex` 当作快照顶层字段）数值断言失败，P7 连锁（前置校验读同一错误字段），P8/P9 连锁失败（前序场景中途退出遗留局内状态）。
- **第 2 轮**：修正快照字段后 P6–P8 过；P4/P5/P9 仍失败于同一「Audio 实例创建」超时；诊断显示 Audio 记录已存在且 `playing`/`error` 事件齐备（P5 的降级提示文案已完整出现）——脚本缺陷而非游戏缺陷。
- **第 3 轮**：无效轮——第 2 轮的 P9 场景已杀掉本地 serve 且未重启，全部场景因 `chrome-error://` 加载失败，结果不具证据效力，如实废弃。
- **第 4 轮**：为 `playAudio` 加现场诊断与轮询日志，定位根因：**脚本的 `waitUntil` 辅助函数只接受 truthy 返回值，而首个 Audio 实例的索引恰为 0（falsy）**，轮询首轮即观察到记录增长却永远不返回，直至超时。修复为包一层对象返回。
- **第 5 轮**：P1–P10 全部通过，即本记录所载证据（21 张截图与结果 JSON 均产自该轮）。

## 截图索引（docs/evidence/m9/，21 张 p- 前缀 + 7 张 fx- 前缀）

### 首轮验收（21 张，p- 前缀）

- P1 `p1-01-home-menu`（首页菜单弹层：三游戏入口并存）
- P2 `p2-01-pinyin-entered`（拼音冒险选择屏与返回锚点）
- P3 `p3-01-grade-filter`（一年级勾选、可用性提示；二~六年级置灰）
- P4 `p4-01-listen-question`（听辨题面：播放钮 + 4 候选、题面无泄露）、`p4-02-before-wrong`（第 4 题作答前）、`p4-03-wrong-retry`（答错反馈与「再试一次」）、`p4-04-result`（结算屏：总分 45、辨认/听辨分开统计）
- P5 `p5-01-audio-unavailable`（降级提示与「跳过这道听辨题」入口；**注意含修复前 feedback+audio-notice 两条同文案提示**）、`p5-02-result`（结算屏：跳过 1 题不计分）
- P6 `p6-01-pause-overlay`（暂停覆盖层）、`p6-02-pause-timer-frozen`（计时中暂停、倒计时冻结）
- P7 `p7-01-restore-offer`（恢复提供）、`p7-02-restored`（恢复后第 3 题）、`p7-03-result`（结算屏：总分 50、不重复计分）
- P8 `p8-01-home-menu`（三入口并存）、`p8-02-hanzi`（汉字勇者加载）
- P9 `p9-01-offline-home`（断源后首页）、`p9-02-offline-pinyin`（断源后拼音冒险选择屏）、`p9-03-offline-listen`（**断网听辨题播放缓存音频**）、`p9-04-offline-hanzi`（断源后汉字勇者）、`p9-05-offline-dungeon`（断源后算术地下城）

### 缺陷修复复验轮（7 张，fx- 前缀）

- FX1 `fx-1-01-result-round1`（复验局 1 结算：总分 45、洗牌后题序）
- FX2 `fx-2-01-audio-unavailable`（**降级单提示：仅 audio-notice 一条**，对照首轮 p5-01 的双提示）、`fx-2-02-result`（结算屏：跳过 1 题不计分）
- FX3 `fx-3-01-restore-offer`（汉字勇者刷新后恢复提供）、`fx-3-02-restored`（恢复后第 3 题、洗牌排列随快照）、`fx-3-03-result`（结算屏：总分 50）、`fx-3-04-parts-question`（组字多选题面：部件候选与「提交答案」）

## 已知限制与未验证项

- **headless 无声输出**：音频仅状态机断言（事件/缓存命中），未验证真实声音输出与发音可听性；`--mute-audio` 下播放事件仍真实触发。发音正确性属**真人试听缺口**（见文首）。
- **桌面模拟**：本记录为桌面无头 Chrome（1280×713）；iOS Safari / Android Chrome 真机未测，窄屏（390 宽）适配未在本轮覆盖（M8/M12 先例为独立模拟器轮）。
- 生产环境（Cloudflare Pages）与 SW 机制在生产域名的行为未复验（M8 曾有 308 规范化先例，SW 导航回退已覆盖 `/pinyin` 无扩展名路径）。
- 教学效果（听辨是否提升字母掌握）、儿童真实操作可玩性未测，属持续缺口。
