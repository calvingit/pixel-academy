# M10 英语快递员实施计划（草案）

编写日期：2026-10-28。状态：**草案，供项目所有者评审拍板**。本文是 [PLAN.md](../PLAN.md) M10 小节与 [Agent 开发交接](m7-m15-agent-handoff.md) §6 的细化规划，**不改变 M10「暂缓」状态，也不代表已授权实施、提交、推送或部署**（同 PLAN.md:7 声明口径）。用户确认后按第 5 章切片推进；与用户最新要求冲突时以后者为准。

依据：PLAN.md:88 与 :330-344（M10 定位、内容与验收）、m7-m15-agent-handoff.md:148-168（§6 定位与切片）、PRD.md:51（FR-10 多游戏一致规则）、五路调研结论（代码结构／内容与学习核心／判题模型／音频与图片资产／流程与验收，本轮已对关键代码事实逐条复核，引用见各节）。

## 1. 目标与范围

### 1.1 定位

英语首款游戏。玩家读（首版）或听（可选切片）简短英语指令，选取对应包裹并送达对应角色；少量固定站位、点选移动，无自由寻路或复杂地图（PLAN.md:337）。训练内容从 EN-01A「家庭成员、状态和感受」两个候选知识点准备短任务（PLAN.md:336），对应现有候选映射 MAP-015（`english.family.members` → EN-01A-U01）与 MAP-016（`english.emotions.basic` → EN-01A-U02）（src/content/skills.ts:275-298）。

### 1.2 与 M13 单词冒险岛的边界

| | M10 英语快递员（本计划） | M13 单词冒险岛（PLAN.md:378-392） |
| --- | --- | --- |
| 任务形态 | 给定**明确指令**（谁收件/什么状态）→ 取对应包裹 → 送达对应角色；封闭的两步判题 | 给定**线索**（词义/图片/简短情境）→ 在场景中**寻物**定位目标 |
| 判题核心 | 指令解析（两步组合判定，见第 3 章） | 线索与目标的对应关系 |
| 玩法重心 | 配送循环（取件→送达→纠错） | 场景搜索、目标定位与提示机制 |

当前评估：两者为可区分的玩法，不构成重复。若 M10 实施后其词汇识别模式已实际覆盖 M13 的任务形态（任务退化为「读目标词 → 点同词」），按交接文档 §9.2 切片 1 与 §13 的口径**提出最小合并方案交用户裁决**——合并/取消里程碑是范围变化，不自行取消 M13，也不复制一套仅换皮的游戏（m7-m15-agent-handoff.md:224,323）。

### 1.3 首版范围

**做**：文字指令两步送达；词汇识别与句意理解两类任务（第 3 章）；一年级开放（其他年级显示未开放）；每局 5 任务；本地记录、暂停恢复、离线运行；首页第五游戏入口。

**不做（明确排除）**：自由寻路、滚动地图、复杂场景装饰（PLAN.md:337；design.md:13）；拖拽交互（点选即可，design.md:36 不强制拖拽）；金币、道具、商店、课程接入（交接 §2.1：新游戏不自动继承经济规则，m7-m15-agent-handoff.md:43）；口语录音、语音识别、自动发音评分（PLAN.md:344；PRD.md:75）；听力模式默认不进首版（建议，见第 7 章决策 1）；账号、云同步、排行榜（m7-m15-agent-handoff.md:44）与在线 TTS 依赖（m7-m15-agent-handoff.md:131；docs/m9-audio-prep.md 方案 B 否决口径）；物品、动作、颜色主题（PLAN.md:336 明确「有审核数据后扩充」，且展示原型 apple/pear 不是教材覆盖证明，m7-m15-agent-handoff.md:152）。

## 2. 玩法规则草案

以下为供拍板的完整草案；确认后落成 `docs/gameplay-english-courier.md`（体例对齐 [汉字勇者玩法说明](gameplay-hanzi-hero.md) 与 [算术地下城玩法说明](gameplay-arithmetic-dungeon.md)：规则 + 一局完整示例 + 验收条件）。

### 2.1 核心循环与机制

- **地址包裹机制**：每个任务一条英语指令 + 若干**带地址标签的包裹**（标签为知识点内英语词，如 `Mum`、`sad`）+ 场景中若干**角色卡**（家庭成员形象或情绪表情形象，原创 SVG）。玩家：① 读指令 → ② 点选一个包裹取件 → ③ 点选场景中一个角色送达 → 判定。
- 判定两步分开：**包裹对**（标签词匹配指令指向）且**对象对**（角色匹配指令指向）才算送达完成。仅对其一时给出区分反馈：「包裹不对」/「对象不对」/「都不对」，采用「颜色 + 形状 + 文案」冗余反馈（design.md:11），答错不扣分、不锁死、可换包裹或换目标纠正重试，无死局。
- 该机制使「**选对物品但送错对象**」与「**选错物品却送对地点**」（m7-m15-agent-handoff.md:159）在家庭/情绪词表内自然成立，不引入 PLAN 暂缓的物品词表；家庭/情绪情境自然（送错人的包裹、送错情绪的收件人都有可解释反馈），不为玩法牵强改写英语（m7-m15-agent-handoff.md:158）。
- **标签可见性**：包裹标签英语词常显——取包裹步是「词→词」辨认（在候选标签中找出指令指向的词）；角色卡**不带英语文字标签**，仅以形象/表情表达词义——送达步是「词→义」辨认。两步合计仍要求词义理解；若角色卡也带词标签，任务将整体退化为「读词→点同词」，即 1.2 写下的 M13 合并触发形态，故不采用。图片—词义对应因此是核心审核项（4.2、4.4）。
- **未取件点选角色不构成送达尝试**：快递员可移动但不判定、不计分、不消耗首答档位，计入移动操作统计（语言作答与移动操作分开，不将随意走到固定位置算作理解，m7-m15-agent-handoff.md:168）；已取件后点选目标才构成尝试并判定（作答契约见 3.3）。

### 2.2 导航与操作（PLAN.md:337「导航操作保持简单」）

- 单一固定场景，3–4 个**固定站位槽位**；角色卡即送达目标，点选即移动（快递员短动画走到位；已取件时触发判定，未取件口径见 2.1），无自由寻路、无地图、无场景滚动。
- 普通操作全部 DOM 控件；触摸目标 ≥44 CSS px；不依赖 hover；错误点击无不可逆惩罚（design.md:31-38）。
- 界面与反馈文案用中文；英语只出现在学习内容（指令、包裹标签、角色标签）。

### 2.3 随机化（PLAN.md:343「正确位置不能长期固定以致绕过语言任务」）

- 角色与站位的对应关系在**组卷时用局内 rng 洗牌**（每局每任务重新随机），包裹排列同样洗牌——答案不恒在首位（M8/M9「答案恒为第一张」缺陷修复的同一机制：src/game/hanzi-hero/rules.ts:72-83，组卷洗牌 + 洗牌结果进快照 + 判题按内容身份与渲染位置无关）。
- 位置分配随 RoundState 进入中断快照；恢复后站位与排列与中断前完全一致，不重新洗牌（m7-m15-agent-handoff.md:160）。

### 2.4 单局规则

- **每局 5 个任务**（交接建议短局 5 任务固化为首版规则，m7-m15-agent-handoff.md:55；不沿用数字消除 10 题）。组卷从所选年级正式池 `selectExercises` 洗牌抽取，局内任务唯一，避开上一局任务 ID（「最近开局 ID」先例）。池不足 5 道时阻止开局并提示。
- **首版不限时**：阅读理解类任务不设倒计时（同汉字勇者首版口径 docs/gameplay-hanzi-hero.md:9；交接建议新游戏不自动继承 10 秒计时，m7-m15-agent-handoff.md:43）。如用户要求计时，再按每题 10 秒常量接入 RoundSession。
- **计分**：首答 10 分 / 重试 5 分（三款游戏同档）。**首答 = 本任务第一次送达尝试**（已取件后点选目标触发判定）；首次尝试未完成（含只错一步，如「选错物品却送对地点」）即入重试档。**未取件点选角色不是尝试**：不判定、不计分、不消耗首答档位，仅计入移动操作（不将随意走到固定位置算作理解，m7-m15-agent-handoff.md:168）；已取件的每次错送（「选对包裹送错人」或「选错包裹送对人」）均为一次作答尝试并消耗首答档位。
- **重复送达不重复计分**：任务完成后本场景锁定，继续点击一律忽略（连点不重复触发计分，design.md:38）；答错不扣分，无限重试无死局。
- **听力模式（若后续交付）**：音频不可用时明确提示并提供「跳过这道任务」，跳过不计分不计作答、记录如实标注 skipped，不假装完成听力训练（M9 降级口径，src/game/pinyin-adventure/main.ts 的 audioUnavailable 处理与 web/pinyin.html 的 audio-notice/跳过入口）；播放失败处理沿用 `createPinyinSpeaker` 的注入式封装与 3 秒超时判定（src/game/pinyin-adventure/audio.ts:1-17）。听力模式下**不默认显示指令文字**（PLAN.md:344，防泄露规则见 3.4）。

### 2.5 暂停、恢复与记录

- 暂停覆盖层「继续游戏」；页面切后台自动暂停、回前台不自动继续（与现有三款同口径）。首版不限时，暂停仅冻结进行状态。
- 中断快照写入 `pixel-academy:english-courier:v1:interrupted`：完整任务序列（含每任务包裹排列与站位分配）、当前任务、已携带包裹、每任务尝试次数与首答记号、分数、局次 ID、RNG 内部状态。刷新后提供「继续上局／放弃上局」，恢复后与连续游玩一致，结算只记一条成绩；内容版本不兼容时安全放弃中断局并说明原因。
- 成绩写入 `pixel-academy:english-courier:v1:records`（最近 20 条，按局次 ID 幂等去重），**显式携带 gameId** 且解析层只接受本游戏 gameId（拼音口径先例 src/game/pinyin-adventure/rules.ts:12,20 与 storage.ts:1-6），并**记录内容版本指纹**（`contentVersion`，拼音记录同字段先例 src/game/pinyin-adventure/storage.ts:118,131；满足 PLAN.md:294「学习记录保留游戏、题目及内容版本」）。记录分列：**语言作答**（每任务的包裹判定、对象判定、首答/重试）与**移动操作**（送达尝试次数、错送次数）分开统计，不以移动结果推断语言理解（m7-m15-agent-handoff.md:168）。

### 2.6 一局完整示例（一年级，文字指令局）

1. 选择屏：勾选「一年级」→ 显示「一年级开放 16 个任务」（示例按首批 16 道 approved 计，见 4.1；可用性提示只统计 approved，先例 src/game/pinyin-adventure/content.ts:37-48）→「开始配送」。
2. 任务 1（词汇识别）：指令「Deliver the parcel to Mum.」→ 场景站位（局内洗牌）：奶奶、爸爸、妈妈、哥哥 → 包裹卡「Dad / Mum / Grandma / Sister」→ 取「Mum」包裹 → 点妈妈 → ✓ 送达完成 +10（首答）。
3. 任务 2（句意理解）：指令「Dad wants his parcel.」→ 先取「Mum」包裹 → 点爸爸 → ✗ 反馈「包裹不对」（选对对象、选错物品）→ 换「Dad」包裹再送爸爸 → ✓ +5（重试档）。
4. 任务 3（词汇识别·情绪）：指令「Deliver the parcel to the sad one.」→ 角色卡：开心孩子、难过孩子、疲倦孩子（同任务内情绪互不相同；角色形象显示对应表情、不带文字标签）→ 包裹卡「happy / sad / tired」→ 取「sad」→ 点难过孩子 → ✓ +10。
5. 任务 4（句意理解）：首答正确 +10。任务 5：答错两次后完成 +5。
6. 结算：「总分 40 · 首次一次完成 3/5 · 重试 2 次 · 送达尝试 8 次、错送 3 次」。成绩入记录（gameId `english-courier`），金币不变；「再来一局」抽新 5 题。

### 2.7 PLAN M10 验收条件逐条落实对照

| PLAN.md 验收条件（:342-344） | 本计划落实 |
| --- | --- |
| 指令含义、图片、目标与判题一致 | 每条任务在审核记录中逐条核对指令句型、角色图、目标与判题四列一致（3.5、4.4）；判题只按内容身份（第 3 章）；浏览器目视核对截图 |
| 多种合理表达不会被错误判错 | 判题按**可接受答案集合**而非单字符串（3.3）：如 `mum`/`mother` 同集合；测试覆盖每个同义成员 |
| 送错对象不触发完成 | 两步分别判定、双对才完成（2.1）；规则测试覆盖「对物品+错对象」「错物品+对对象」「双错」矩阵 |
| 重复送达不重复计分 | 完成后场景锁定、连点忽略（2.4）；测试与浏览器连点场景 |
| 正确位置不能长期固定以致绕过语言任务 | 站位分配与包裹排列组卷洗牌 + 进快照（2.3）；多种子位置分布断言 |
| 听力模式不默认显示答案文字 | 听力任务结构级防泄露：界面指引文案不得含拉丁字母（3.4）；听力默认不进首版（决策 1） |
| 口语录音、语音识别与自动评分暂不开发 | 1.3 明确排除；完成前 diff 复查（交接 §12.3 第 5 条） |
| 导航操作保持简单 | 固定站位点选即达，无寻路无地图（2.2） |

## 3. 英语任务类型与判题模型设计

### 3.1 现状（M10 与前三款的最大差异）

- Task 联合现为 `MathTask | ChineseTask | PinyinTask`，无任何英语任务 kind；SubmittedAnswer 已支持 `number | string | readonly string[]`（src/learning/models.ts:118-119）。
- 英语只有索引与知识点：Subject 已含 `'english'`（models.ts:2），EN-01A 六个候选主单元与 MAP-015/016 已入库（src/content/units.ts:499-576、skills.ts:275-298），但英语练习为 0、判题完全缺失（docs/architecture.md「英语只有索引和知识点，尚无题型及判题实现」）。
- PLAN.md:295：「语文、英语、图形任务需要在实际开发对应游戏时增加明确的任务类型与判题规则，不能强塞进 MathTask 或依靠字符串执行。」

### 3.2 任务类型草案（单一 kind + mode 口径字段）

```ts
/** 英语快递任务：读/听指令 → 取对应地址包裹 → 送达对应角色；两步分开判题。 */
export interface EnglishDeliveryTask {
  readonly kind: 'english-delivery';
  /** 任务类别：'vocab' 词汇识别（词卡/图卡对应）/ 'sentence' 句意理解（短句解析定收件人）。 */
  readonly mode: 'vocab' | 'sentence';
  /** 英语指令（固定文案，随构建交付；审核记录支撑其句型与指向）。 */
  readonly prompt: string;
  /** 听力模式音频路径（可选；仅听力切片使用，web 根内相对路径）。 */
  readonly audio?: string;
  /** 听力模式的界面指引文案（纯中文，结构级禁拉丁字母，防泄露答案）。 */
  readonly listenPrompt?: string;
  /** 包裹候选：地址标签词（含正确词与干扰词，取自领域词表）。 */
  readonly parcels: readonly string[];
  /** 收件目标候选：角色身份词——家庭任务取家庭词表、情绪任务取情绪词表（角色为显示该词义的形象卡，情绪即身份、无复合身份词）；同任务内互不相同。 */
  readonly recipients: readonly string[];
  /** 正确包裹的可接受标签词集合（如 ['mum','mother']）。 */
  readonly parcelAnswers: readonly string[];
  /** 正确收件人的可接受身份词集合。 */
  readonly recipientAnswers: readonly string[];
}
```

设计理由（最小必要复杂度）：

- 两类任务**结构完全相同**（同为「取包裹→送达」两步），差别只在指令句型与语言要求：`vocab` 用短语句（「Deliver the parcel to Mum.」，考词形辨认），`sentence` 用需解析的完整短句（家庭族如「Dad wants his parcel.」、情绪族如「The sad child is waiting.」，考句意理解；句型清单经审核固定，见 4.4）。以 `mode` 字段 + 内容分组 + 记录分列满足 PLAN「明确词汇识别与句意理解两类任务」（PLAN.md:338），不拆两个 kind 造成结构重复。`mode` 同时进入成绩记录与审核记录的分类口径。
- 词汇识别步 = 读指令 → 认出对应标签词取包裹；句意理解步 = 解析指令定收件人 → 送达对应角色。两步各自有候选与可接受集合，独立判定。
- **两族取材、单一结构**：任务分家庭族（包裹标签与角色身份均取家庭词表，角色为家庭成员形象，映射 MAP-015）与情绪族（均取情绪词表，角色为显示对应情绪的人物卡，映射 MAP-016），单任务不混映射；不引入复合身份词（如 happy-girl），情绪即角色身份，同任务内候选互不相同（由唯一性校验保证，见 3.3）。
- 角色配图不进任务数据：照汉字勇者 PICTOGRAM 先例由内容模块按身份词映射图片路径（src/content/hanzi-hero.ts:16 的映射模式），任务保持精简。
- 备选方案（拆 `english-vocab` / `english-sentence` 两个 kind）已评估并否决：类型结构重复、无独立判题语义，列为决策点 5 供用户否决本建议。

### 3.3 判题模型与可接受答案集合

- **判题一律走 Learning Core**（evaluateAnswer），游戏层不重复判题。新增 `src/learning/english.ts`，照 `pinyin.ts` 模块模式（领域词表 + 结构校验 + 按内容身份判题，src/learning/pinyin.ts:9-58），并在 `src/learning/evaluation.ts:9-40` 的 evaluateAnswer / validateTask 分派注册（M8 hanzi.ts、M9 pinyin.ts 两次验证过的接入模式）。
- **复合作答契约**：本任务的 SubmittedAnswer 为**长度恰为 2 的字符串数组** `[包裹标签词, 收件人身份词]`，仅在**已取件的送达尝试**时提交；未取件的点选无包裹分量、不构成作答（见 2.1、2.4）。`evaluateAnswer` 英语分支 = 两步均在各自可接受集合内才返回 true。**判题入口唯一**：evaluateAnswer 返回 complete；`english.ts` 另导出 `englishDeliveryResult(task, answer): { parcel: boolean; recipient: boolean; complete: boolean }`——它不是第二个判定入口，而是同一判定逻辑的粒度分解（complete = parcel && recipient），供游戏规则层获取分步反馈而不重复实现判定（游戏层引用 Learning Core 判定函数的先例：src/game/arithmetic-dungeon/main.ts:6 引 `isMultiple`/`optionText`）。
- **可接受答案集合**（PLAN.md:342「多种合理表达不会被错误判错」）：每步答案为集合而非单值——同一收件人 `mum`/`mother`/`mom`、`dad`/`father`、`grandma`/`grandmother` 等同义表达同集合；集合成员全部落在领域词表内（词表常量照 PINYIN_INITIALS/FINALS 模式导出供内容模块共用，防两侧漂移，src/learning/pinyin.ts:9-21）。
- **结构校验**（validateEnglishTask，仿 pinyin.ts:38-52）：候选数量界（包裹 3–4、角色 3–4）、无重复、非空词——角色唯一性同时保证同任务内情绪/家庭身份互不相同，同义表达（如「开心/高兴」同指 happy）只进可接受集合、不作为两个候选身份（无重复校验同款先例 src/learning/pinyin.ts:44）；每个可接受集合**至少一个成员在对应候选中可达**（照「Answer not reachable among options」先例 src/learning/pinyin.ts:45）；`mode`/`prompt`/词表成员合法性；`audio` 存在时路径白名单正则（照 `^audio\/pinyin\/[a-z]+\.wav$` 先例 src/learning/pinyin.ts:36）；`listenPrompt` 存在时**不得含任何拉丁字母**（照听辨题 LATIN_RE 结构级防泄露先例 src/learning/pinyin.ts:33,47-49）。
- validateCatalog 对每条英语练习调用 validateTask，非法任务使 createLearningCore 抛错（src/learning/catalog.ts:54,59-61）——非法跨学科、答案不可达、集合为空等在装载期即失败。
- **不执行字符串匹配以外的宽松解析**：判题只比较词表内身份（小写规范形），不做词干化、大小写宽松或模糊匹配——宽松裁剪超出审核口径（拼音判题同口径先例，tests/pinyin.test.mjs）。

### 3.4 听力模式防泄露（若交付）

- 音频读英语指令；**界面指引（listenPrompt）结构级不得含拉丁字母**，渲染层不显示英语指令文字（PLAN.md:344）；**包裹标签照常显示**（候选词必须可见才能作答——同 M9「候选可见、题面不含答案字形」口径，泄露面=指令句文字而非候选）；角色卡本就不带英语文字标签（2.1），听力模式下同样不新增。
- 泄露检查：结构校验（listenPrompt 无拉丁字母）+ 全池断言测试 + 浏览器截图核对（M9 三层口径，tests/pinyin.test.mjs:96-127 先例）；listenPrompt 的**语义泄露**（如以中文复述「送给难过的人」点破收件人）结构校验覆盖不到，列入 4.4 逐条审核。
- 英语任务的泄露检查无法照搬拼音「禁拉丁字母查 prompt」——因为 prompt 本身是英语指令；故拆分为 `prompt`（文字模式显示）与 `listenPrompt`（音频模式显示、纯中文）两个字段，结构校验分别约束。

### 3.5 与现有判题先例的关系

| 先例 | 关系 |
| --- | --- |
| HanziChooseTask mode shape/meaning（models.ts:74-82） | 「带图/带词候选 + 按内容身份单选」形态同源；英语为两步复合 |
| hanzi-parts 集合判题（evaluation.ts:13-15） | 英语**不**复用其无序集合语义——两步是**有序对**，语义不同，由 english.ts 独立实现 |
| pinyin.ts 词表+结构校验+防泄露（pinyin.ts 全文） | 直接套用的模块模式；词表、可达性校验、音频路径白名单、防泄露三层检查均照此 |
| choice 多选集合（evaluation.ts:23-25） | 不适用（同 hanzi-parts 条） |
| M12 零新增内容复用（arithmetic-dungeon） | 不适用——M10 必须新增题型与内容，无复用判题捷径 |

Learning Core 保持纯 TypeScript：english.ts 不引入 DOM、Canvas、存储、音频播放回调或服务端依赖；判题不依赖界面、显示顺序或存储（AGENTS.md 实施约束；m7-m15-agent-handoff.md:42）。

## 4. 内容准备与审核计划

启动前置：PLAN.md:29 与 :461 要求「启动任何一款前需先准备并审核对应学科的任务类型与内容」——本章工作（切片 0/1）先于任何页面实现。

### 4.1 首批内容规模（建议值，供拍板）

| 项 | 建议值 | 说明 |
| --- | --- | --- |
| 词条 | 12 个：家庭成员 6（mum, dad, grandma, grandpa, brother, sister）+ 状态感受 6（happy, sad, tired, hungry, thirsty, sleepy） | 通用原创词表，不宣称对应特定教材课次；同义表达（mother/father/grandmother 等）进可接受集合 |
| 任务数 | 18 道草稿：词汇识别 10 + 句意理解 8；家庭族任务映射 MAP-015、情绪族任务映射 MAP-016，单任务不混映射 | 每条定义指令、物品（包裹标签）、收件人/地点、可接受组合、干扰对象、反馈与语言能力（m7-m15-agent-handoff.md:158） |
| approved | ≥ 15 道 | 每局 5 题 + 避重余量；低于 15 时连续两局重复率明显升高，宁缺勿滥 |
| 年级开闭 | 仅一年级开放 | MAP-015/016 均映射 EN-01A（一年级，src/content/skills.ts:275-298）；其他年级显示未开放，不跨年级补题、不用其他年级填补（PLAN.md:292；AGENTS.md 实施约束） |
| ID 段 | `EN-C-001` 起（courier 段） | 稳定 ID 不随展示排序改变 |

词条为通用原创教学内容（一至六年级通用常用家庭/情绪词），依据为通用语言事实而非教材页码；审核记录如实标注「通用原创、未对照教材版次」，来源核对与映射核验保持 pending（汉字勇者先例口径，docs/gameplay-hanzi-hero.md「内容与审核边界」节）。

### 4.2 图片来源与记录口径

- **建议：原创 SVG**，入库 `web/img/english-courier/*.svg`，随构建交付并登记 SW 预缓存（汉字勇者先例：11 张原创手绘 SVG + task 路径引用 + 审核记录标注「几何绘制原创，无版权来源」，web/img/hanzi-hero/ 与 docs/content-review-hanzi-hero.md）。
- 与 M8 物体简笔画的差异：本款需要**人物形象**（家庭成员）与**情绪表情**（happy/sad/…），绘制难度更高、更易歧义——执行时先出 2–3 张样张经用户确认风格再批量（决策点 3）。角色卡不带英语文字标签（2.1），**图片—词义对应是词汇识别成立的前提**，逐条列入审核范围；图片不出现答案词字形之外的泄露面，不配图的理由记录在案（M8 口径）。
- 备选：emoji（平台渲染不一致、风格不可控，不推荐）；外部素材库（需逐条许可记录，首版不推荐）。按 content-workflow.md「来源与资源」：图片在实际引入时记录来源、可用范围与替换方式；无法确认可用性的素材不入游戏（docs/content-workflow.md:56-61）。

### 4.3 音频方案（仅听力切片需要；对比与建议）

参考 [M9 音频方案](m9-audio-prep.md) 框架重走决策流程。**关键差异：婷婷是 zh_CN 中文语音，不适用英语单词/短句**，须换英文系统语音（如 macOS 自带 en_US 语音，具体可用项以本机 `say -v '?'` 实测为准）并重新评估发音质量。

| 方案 | 说明 | 评估 |
| --- | --- | --- |
| A′：macOS 英文语音 TTS 预生成 WAV 入库 | `say` → `afconvert` → `web/audio/english/*.wav`，映射表即审计记录（scripts/gen-pinyin-audio.sh:1-24 模式） | 零人力、可复现、断网可播；但英语发音正确性、儿童可听性未经真人验证，**真人试听缺口同 M9**；Apple 语音再分发许可灰色地带需用户知悉（同 m9-audio-prep.md 风险②） |
| B：Web Speech API 实时朗读 | 无文件 | **不推荐**（同 M9 否决口径）：离线无保证、声音随设备变化无法与固定音频绑定审核 |
| C：真人录音 | 按清单录制 | 发音权威、审核口径最干净；依赖人力到位，可作为 A′ 的升级替换路径（文件命名与播放层不变） |
| D：开源音频库 | Wikimedia 等 | 英语单词/短句覆盖与发音口径混杂，逐条许可核对成本高，不推荐 |

**建议**：首版不交付听力（决策点 1）；若后续交付，A′ 先生成 3–5 条小样 → 用户抽听确认 → 再批量，真人试听缺口按 M9 口径如实记录（「发音内容正确性不在代理审核覆盖范围内」，docs/content-review-pinyin.md 缺口口径）。教学音频必须随构建交付并登记来源/许可、合成身份、审核者与范围，不依赖在线 TTS（m7-m15-agent-handoff.md:131）。

### 4.4 审核记录安排

- 新建 `docs/content-review-english-courier.md`，结构照 content-review-pinyin.md / content-review-hanzi-hero.md：审核对象（ID 区间、题量、年级、gameId、映射）→ 审核者与 ISO 时间 → 审核范围与局限 → 音频口径专节（若做听力）→ 逐条审核表 → 汇总与撤回条件。
- 逐条审核表覆盖：指令表述可理解无歧义、包裹/收件人正确性与可接受集合、干扰项可解释、图片—词义对应（角色卡无文字标签，见 2.1）、指令含义/图片/目标/判题四者一致、语言能力标注（vocab/sentence）、听力任务 listenPrompt 不含收件人/包裹词义的中文复述（语义泄露，结构校验覆盖不到，3.4）。
- **代理审核身份如实标注**（zcode-agent，2026-10-2X），不冒充教师、家长或教材专家；发音真人试听、教学难度等无法由代理完成的部分如实留缺口并设撤回条件（AGENTS.md 内容约束；docs/content-workflow.md:41）。
- **不编造**教材书名、ISBN、版次、课次、来源及审核结论：EN-01A 现状保持「深圳用沪教英语目标系列（低年级正式书名待核）」、title/isbn/edition 为 null、各项 verification 为 pending（src/content/textbooks.ts:5-17），本计划不改这些字段；候选映射不宣称教材对齐（docs/content-baseline.md:23-32）。
- **draft→approved 流程**：按 content-workflow.md「新增或修订内容」7 步执行（docs/content-workflow.md:22-31）：录草稿 → 引用校验+测试+审查 → 满足审核要求才设 approved 并填真实审核主体与 ISO 时间 → 正式筛选与候选预览分开检查。**不为通过测试、使页面有题或解除里程碑阻塞把 draft 改成 approved**（AGENTS.md；正式取题只用 selectExercises，previewExercises 仅显式候选预览、不作降级）。

### 4.5 内容装配与筛选口径

- 新建 `src/content/english-exercises.ts`（静态题库，gameIds 仅 `['english-courier']`，mappingIds 指向 MAP-015/016），照 pinyin-exercises.ts 模式头部注明题量与审核记录位置。
- 照拼音冒险先例按本游戏独立 gameId 重建 Learning Core，不改默认静态 catalog（src/game/pinyin-adventure/content.ts:24-33 注释口径）；`selectEnglishExercises(grades)` 只走 `selectExercises`（approved + subject english + gameId english-courier + 年级匹配，src/learning/catalog.ts:67-80）。
- `describeAvailability` 照拼音实现（src/game/pinyin-adventure/content.ts:37-63）：所选年级供题量、未开放年级明示、不足 5 道阻止开局；内容不足的年级显示未开放，不用其他年级填补。
- 署名说明：catalog `select` 返回署名为 `Exercise<MathTask>`（src/learning/catalog.ts:67），拼音冒险以双重断言绕过并留注释（src/game/pinyin-adventure/content.ts:30-33）。M10 沿用该先例并保留同等注释（题库全部为 EnglishDeliveryTask 且经 validateCatalog 逐题校验后断言成立）；若用户希望消除断言需调整 select 泛型署名、影响数字消除等全部调用方（docs/architecture.md「数字消除的取题与棋盘仅接受 Exercise<MathTask>」），属独立小改动另行评估，不在本计划内。

## 5. 工程实施切片

按 tracer bullet / 竖向切片推进（AGENTS.md 工程原则；交接 §2.2 四阶段 A 规则与内容 → B 窄路径验证 → C 首版交付 → D 回归与记录，m7-m15-agent-handoff.md:46-57）。窄路径成功不能代替首版验收。

| 切片 | 阶段 | 内容 | 进入条件 |
| --- | --- | --- | --- |
| 0 | A | 第 2、3 章口径经用户确认；词表、指令句型清单、18 道任务草稿、来源与图片样张记录 | 关键歧义解决；不把候选映射当教学结论 |
| 1 | A/B | EnglishDeliveryTask 入 models.ts Task 联合 + `src/learning/english.ts` + evaluation.ts 分派 + english-exercises.ts 首批 approved + `tests/english.test.mjs`（判题正例/非法清单/可接受集合/模式分派/63 种年级组合/数学回归） | npm run check 全绿；审核记录完成 |
| 2 | B | `src/game/english-courier/` 最小四件套（rules/content/storage/main），**一道**真实任务打通：selectExercises → 取包裹 → 送达 → 判题 → 快照保存恢复 → 断网重开（本地构建） | 窄路径六环节实际打通 |
| 3 | C | 完整局次：5 任务组卷与避重、计分（首答 10/重试 5）、结算、暂停/后台、站位与包裹洗牌 + 快照恢复一致、成绩记录分列、describeAvailability 年级口径 | 本款验收项有结果 |
| 4 | C | 入口接线：web/english.html + english.css（boot-fail 兜底、返回锚点、?nosw）、首页导航第五入口、SW 三处接线、tests/offline 五入口断言、五档视口与触摸目标 | 手机交互与离线清单完整 |
| 5 | 可选 | 听力模式 + 音频链路（决策点 1/2 通过后）：`audio.ts` 注入式播放封装（照 pinyin audio.ts）、生成脚本、build-sw 音频目录扫描、播放失败降级与跳过 | 音频审核与离线验收完成后才能标该模式完成（m7-m15-agent-handoff.md:154） |
| 6 | D | 共享改动回归（12.2 五类范围）+ 四轮验证 + 文档三件套 + PLAN/README/架构同步 | 交接 §12.3 完成核对六条 |

### 5.1 复用清单（不新建、直接引用）

| 能力 | 位置 | 用法 |
| --- | --- | --- |
| 判题分发扩展点 | src/learning/evaluation.ts:9-40 | 注册英语分支；判题唯一入口 |
| 学科判题模块模式 | src/learning/pinyin.ts（词表/校验/防泄露）、src/learning/hanzi.ts | english.ts 照此编写 |
| 运行时随机源与快照恢复 | src/game/number-puzzle/random.ts 的 createRuntimeRng/restoreSeededRng | 站位洗牌与恢复（pinyin/dungeon 跨游戏 import 先例，src/game/pinyin-adventure/main.ts:8-10） |
| 存储模块模板 | src/game/pinyin-adventure/storage.ts（口径最新：schemaVersion + gameId 校验 + 单条损坏只丢该条） | 换 STORE_PREFIX 与记录 schema |
| 页面骨架 | web/pinyin.html + pinyin.css（年级多选、恢复上局、暂停遮罩、confirm、boot-fail 内联脚本 web/pinyin.html:9-15、返回锚点 :24） | 复制改造为 english.html/css |
| 可用性提示模式 | describeAvailability + OPEN_GRADES + GRADE_NAMES（src/game/pinyin-adventure/content.ts:37-63） | 同构实现 |
| SW 接入点 | scripts/build-sw.mjs:21-26,39-59；web/sw.source.js:103-107（含 Pages 308 re-wrap :110-113）；tests/offline.test.mjs:214-280,326-329,343-353 | 三处同步扩展为五入口 |
| 首页导航模式 | web/index.html:128（#main-nav 内 `<a>` + aria-hidden 装饰字） | 追加第五条 |
| 音频播放封装（若切片 5） | src/game/pinyin-adventure/audio.ts:1-17（注入式接口 + 3 秒超时） | 同接口英语实现或按真实复用需求再议提取 |
| TTS 生成脚本模式 | scripts/gen-pinyin-audio.sh:1-24（映射表即审计记录 + 逐条校验） | 英语版换语音与清单 |
| 内容审核/证据文档模板 | docs/content-review-pinyin.md、content-review-hanzi-hero.md、docs/evidence/m8–m12 README 骨架 | 第 4、6 章产出照此 |
| 新增游戏接线模板 | M9 首版提交 afba385 的触碰文件清单（git show --stat afba385） | 接线完整参照；package.json/tsconfig/serve.mjs/stage-site.mjs 无需改动（tsconfig include src/** 自动纳入，serve/stage 泛化复制） |

### 5.2 新增/修改清单（逐文件）

**新增**：

1. `src/learning/english.ts` —— 英语词表常量（家庭成员/情绪）、isEnglishTask、validateEnglishTask、englishDeliveryResult、correctEnglishParcel/Recipient。
2. `src/content/english-exercises.ts` —— 首批英语题库（gameIds `['english-courier']`）。
3. `src/game/english-courier/rules.ts` —— GAME_ID='english-courier'、STORE_PREFIX='pixel-academy:english-courier:v1'、组卷（含站位/包裹洗牌）、两步判定消费、计分、快照；无 DOM/存储依赖。
4. `src/game/english-courier/content.ts` —— 独立 Learning Core 装配、selectEnglishExercises、describeAvailability、图片路径映射、CONTENT_VERSION。
5. `src/game/english-courier/storage.ts` —— 独立命名空间 KV、设置/成绩/快照/最近 ID。
6. `src/game/english-courier/main.ts` —— 页面接线（不重复判题、不实现计时算法）。
7. `src/game/english-courier/audio.ts` —— 仅切片 5。
8. `web/english.html` + `web/english.css` —— 入口页与样式（英语文字用清晰字体不像素化，design.md:9）。
9. `web/img/english-courier/*.svg` —— 角色/情绪原创配图。
10. `web/audio/english/*.wav` + `scripts/gen-english-audio.sh` —— 仅切片 5。
11. `tests/english.test.mjs`（判题）+ `tests/english-courier.test.mjs`（rules/storage/content，从 dist 导入，npm test 先 build）。
12. `docs/gameplay-english-courier.md`、`docs/content-review-english-courier.md`、`docs/evidence/m10/README.md`。

**修改**：

13. `src/learning/models.ts:118` —— Task 联合追加 EnglishDeliveryTask（SubmittedAnswer 不变，`readonly string[]` 已覆盖两步作答）。
14. `src/learning/evaluation.ts` —— evaluateAnswer/validateTask 注册英语分支。
15. `web/index.html:128` —— #main-nav 追加英语快递员入口锚点。
16. `scripts/build-sw.mjs` —— SW_ENTRY_MODULES 追加 `dist/game/english-courier/main.js`（:21-26）；STATIC_PRECACHE_URLS 与 STATIC_FILE_FOR_URL 登记 `/english.html`、`/english.css`、全部图片（:39-59）；切片 5 时加音频目录扫描（照 PINYIN_AUDIO_DIR :32-36）。未登记的资源离线不可用；清单内文件缺失构建即失败（:120-125）。
17. `web/sw.source.js:103-107` —— 导航回退分支追加 `/english.html` 与 `/english`（无扩展名兜底，Pages 308 规范化口径）。
18. `tests/offline.test.mjs` —— 三组断言扩展为五入口：入口闭包关键模块（:241-278 模式）、入口 URL 不可移除（:326-329）、sw.js 导航分支字符串（:343-353）。
19. 文档同步：`docs/architecture.md`（模块表与「英语尚无题型及判题实现」行更新）、`PLAN.md`（M10 状态推进）、`README.md`（支持内容）、`VERIFICATION.md`（如有新检查方法）。

### 5.3 共享改动影响面

Task 联合与 evaluation.ts 属共享代码：按交接 §12.2 回归表覆盖 Core/内容（数字消除整数与选择题、汉字、拼音任务判题、正式/预览隔离、63 种年级组合）、导航/公共样式（四款已交付游戏进出、窄屏横屏）、SW/构建（四款断网可进、活动局不采用更新）；数字消除与三款已交付游戏的存储、钱包、成绩完全不动（m7-m15-agent-handoff.md:291-297）。

## 6. 验证与验收计划

### 6.1 自动化

- `npm run check`（typecheck + 构建 + 全部测试）：新增 tests/english.test.mjs 与 tests/english-courier.test.mjs；Core 变化回归旧数学/语文/拼音任务、全部 63 种非空年级组合、学科/gameId/草稿隔离（m7-m15-agent-handoff.md:280-287）。
- 判题测试惯例照现有：正例 + 非法输入清单 + 可接受集合逐成员 + 测试内独立 expected 对照 + 组合矩阵（对包裹+对收件人 / 对包裹+错收件人 / 错包裹+对收件人 / 双错 / 集合外词 / 非法长度数组）。
- 规则测试：多种子站位分布断言（正确目标不长期固定）、洗牌后判题与渲染排列无关、恢复后站位一致、完成后重复送达不重复计分、连点忽略、未取件点选不计尝试不消耗首答档位（计入移动操作）、首答档位判定（首次尝试错→重试档）。
- 离线测试：五入口清单断言、sw.js 导航分支、资源缺失构建失败。

### 6.2 浏览器与设备验证（四轮，M8/M9/M12 同构）

1. **桌面验收轮**（无头 Chrome，验收员独立于实现者）：场景至少覆盖——选年级（单选/混选/仅无内容年级）、空内容提示、完整一局（读指令→取件→送达→纠错→结算）、部分错误反馈三态区分、重复送达与连点、暂停/刷新恢复（站位与排列一致）、断网重开完整局、活动局更新延后；横向溢出与 JS 错误贯穿检查。
2. **缺陷修复复验轮**：发现缺陷如实记录（fx- 前缀截图 + results.json fixVerification 字段），修复后复验。
3. **模拟器轮**：Android Chrome（CDP 真实触摸）与 iOS Safari（模拟器口径，2026-10-27 用户裁决）各覆盖关键场景；若切片 5 交付听力，加音频场景（播放/重听/降级跳过/断网可播），iOS 自动播放策略拒播降级路径如实记录（M9 先例 docs/evidence/m9/device-simulators/README.md）。
4. **生产环境轮**：推送部署 Cloudflare Pages 后无头 Chrome 验证新入口在线/离线与 SW 导航（含 Pages 308 规范化 re-wrap 口径，M8 生产缺陷先例）；**生产段落写入 docs/evidence/m10/README.md 主文件**（吸取 M9 教训：生产证据已提交但 m9 README:94 仍写「生产未复验」，两处不同步）。

视觉验证按五档（320×568、390、412×915、低高度横屏、桌面）截图，核对英文可读无截断、触摸目标 ≥44px、目标不被遮挡（m7-m15-agent-handoff.md:167）；模拟与真机分开记录，物理真机保持「持续缺口」口径（2026-10-27 模拟器裁决）。

### 6.3 验收条件 ↔ 验证方法对照

| 验收点（PLAN.md:342-344） | 验证方法 |
| --- | --- |
| 指令含义、图片、目标与判题一致 | 审核记录逐条四列核对（4.4）+ 判题测试 + 桌面截图目视核对 |
| 多种合理表达不误判 | 可接受集合测试逐成员 + 审核记录同义口径 |
| 送错对象不触发完成 | 规则组合矩阵测试 + 浏览器场景（对物品错对象/错物品对对象） |
| 重复送达不重复计分 | 规则测试 + 浏览器连点场景 + 成绩记录恰一条 |
| 正确位置不长期固定 | 多种子站位分布断言 + 恢复一致断言 + 浏览器恢复场景 |
| 听力不默认显示答案文字 | （若交付）结构校验 + 渲染层测试 + 截图；不交付则记「未交付模式」 |
| 口语录音/识别/评分不开发 | 范围声明（1.3）+ 完成 diff 复查 |
| 导航简单 | 场景固定站位实现 + 窄屏/横屏截图 |

### 6.4 证据留痕

`docs/evidence/m10/`：README.md（内容来源与审核边界 → 自动化检查项数 → 分场景结果表 → 缺陷与修复 → 截图索引 → 已知限制与未验证项）+ 分轮截图 + results.json。每条证据含日期/执行者、提交或未提交差异、构建/内容版本、访问地址、设备/系统/浏览器、真实或模拟、步骤、预期/实际、未验证项（m7-m15-agent-handoff.md:301-303）。测试与夹具数据不入用户档案、不当内容审核。

## 7. 风险与开放决策点（需用户拍板）

| # | 决策点 | 选项与利弊 | 建议 |
| --- | --- | --- | --- |
| 1 | **首版是否交付听力模式** | ① 仅文字指令：体量小、无音频依赖，符合交接「先文字后音频」建议（m7-m15-agent-handoff.md:154）；② 含听力：需先完成音频方案、审核与离线验收才能标该模式完成，首版周期与风险增大 | **①仅文字**；听力列为切片 5，按条件独立验收 |
| 2 | **音频来源（若做听力）** | A′ macOS 英文 TTS 预生成（零人力可复现；发音质量需实测、真人试听缺口与 Apple 语音再分发许可需知悉）；C 真人录音（口径最干净，依赖人力）；B/D 不推荐（4.3） | **A′ 先 3–5 条小样实测+用户抽听，再批量**；C 作为后续替换路径 |
| 3 | **图片来源与风格** | 原创 SVG（无版权负担、随构建交付；人物/情绪绘制难度高于 M8 物体简笔画）；emoji（渲染不一致，不推荐）；外部素材库（许可记录成本高） | **原创 SVG，先出 2–3 张样张确认人物/情绪表情风格再批量** |
| 4 | **首批内容规模** | 12 词条 / 18 道草稿 / approved ≥15 / 仅一年级（4.1）；可按用户判断增减 | **按建议值启动**；低于 15 approved 时避重余量不足，不建议再压缩 |
| 5 | **任务类型形态** | ① 单一 `english-delivery` kind + `mode` 字段（结构最小，两类任务靠句型与记录分列区分）；② 拆 `english-vocab`/`english-sentence` 两个 kind（类型重复、无独立判题语义） | **①**；若用户更看重类型系统显式区分可选 ②，实现成本略增 |
| 6 | **计分与计时口径** | 首答=第一次完整送达尝试（任一步错入重试档）；每局 5 任务；首版不限时；或改为每题 10 秒计时 | **不限时**（阅读理解类，同 M8 口径）；计分口径如上，避免随意点目标无损试探 |
| 7 | **地址包裹机制确认** | 包裹带收件人/情绪词标签、角色卡不带英语文字标签（2.1）——使两类错误（对物品错对象/错物品对对象）在家庭/情绪词表内自然成立，且词汇识别不退化为「读词→点同词」（1.2 的 M13 合并触发形态），不引入 PLAN 暂缓的物品词表；替代方案（无标签包裹使「选错物品」无法判题、角色卡带标签使任务整体退化）均不成立 | **确认采用**；这是判题模型成立的前提 |
| 8 | **内容状态缺口确认** | MAP-015/016 与 EN-01A 各项核验均 pending（src/content/skills.ts:275-298）；按规则候选映射不支撑「已核验教材对齐」的宣称，但不妨碍通用原创练习经审核后 approved 运行（docs/content-baseline.md:32） | **知悉并接受**：approved 不宣称教材版次对齐，核验缺口持续记录 |

主要风险（非决策项，实施中管理）：① Task 联合与 evaluation.ts 为共享代码，改动需严格回归三款已交付游戏（5.3）；② 人物/情绪 SVG 的图片—词义歧义风险，靠样张确认+逐条审核+撤回条件控制；③ 英语 TTS 发音正确性无法代理验证，留真人缺口；④ selectExercises 署名断言沿用 M9 先例（3.5/4.5），如需消除另行评估。

## 8. 与既有文档的一致性

- **本文与 PLAN.md**：细化 PLAN.md:88（M10 行）与 :330-344（M10 小节）的交付物与验收条件，全部验收条件逐条映射见 2.7 与 6.3；不改变 M10「暂缓」状态、不自动启动实施（PLAN.md:23,7）。启动前置（PLAN.md:29,461「先准备并审核对应学科的任务类型与内容」）体现为切片 0/1 先于页面实现。
- **本文与 m7-m15-agent-handoff.md**：§6.1–6.3 的定位、五条执行切片与三条测试验收全部覆盖（执行切片对齐 §2.2 四阶段与 §6.2 五条，验收映射见 6.3）；§2.1–2.3 统一边界（年级、审核隔离、Core 纯 TS、经济不继承、不提前抽象）全文遵守；§12 证据与完成核对清单作为切片 6 的收口标准；§13 阻塞处理适用于缺图片/音频/审核输入的情形（可继续任务模型、草稿与测试，不编造资源与审核）。
- **本文与其他文档**：内容与审核口径对齐 content-workflow.md / content-baseline.md；视觉与交互对齐 design.md；玩法文档体例对齐 gameplay-hanzi-hero.md / gameplay-arithmetic-dungeon.md；M13 边界对齐 PLAN.md M13 节与交接 §9（1.2）。
- **授权状态**：本文为草案。实施、提交、推送、部署分别按项目规则另行获得授权（里程碑完成收口时的提交推送已有 2026-10-27 长期授权，PLAN.md:25；分支操作与启动实施仍依用户指示）。
