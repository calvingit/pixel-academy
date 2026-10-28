# M11 几何建筑师实施计划

编写日期：2026-10-28。状态：**实施计划（开工前资料）**。本文是 [PLAN.md](../PLAN.md) M11 小节与 [Agent 开发交接](m7-m15-agent-handoff.md) §7 的细化规划，**不改变 M11「暂缓」状态**；实施启动按用户指示或 2026-10-28 长期指令（自动推进、不中途提问）执行。开放决策点已按该长期指令由代理按建议拍板（见第 7 章，每条注明拍板理由，用户可否决）；与用户最新要求冲突时以后者为准。

依据：PLAN.md:90（M11 行）与 :358-372（M11 小节：范围、内容与验收）、m7-m15-agent-handoff.md:172-192（§7 定位、五条切片与测试验收）、PRD.md:51（FR-10 多游戏一致规则）、本轮代码调研结论（知识点与映射现状、任务模型与判题分派、SW 接线、图片资产先例，引用见各节）。

## 1. 目标与范围

### 1.1 定位

数学第二款游戏（数字消除、算术地下城之外的新任务形态）。玩家在「积木工坊」场景中完成立体图形的辨认、分类与按目标搭建；训练对象为**立体图形**（长方体、正方体、圆柱、球，一年级上学期典型四种），渲染用等轴测风格原创 SVG 示意图。

内容依据为 MA-01A-U05「有趣的立体图形」（src/content/units.ts:274-289，课次：认识图形、我说你做、怎样搭得高，`handoff-2026-10-25` 录入候选，lessonCoverage: examples）——交接文档 §7.1「现有 MAP-009 是分类候选；立体图形能力目前缺少对应知识点，必须依据实际来源新增」（m7-m15-agent-handoff.md:176）中的「实际来源」即该候选单元及其课次。候选单元中**没有平面图形认识单元**（MA-01A 各单元为生活中的数／5以内加减／整理与分类／10以内加减／有趣的立体图形等；MA-02A 的「图形的运动（一）」属图形运动扩展范围，非平面图形认识，src/content/units.ts:438），故首版训练对象限于立体图形。

### 1.2 首版范围

**做**：立体图形辨认（choose）、分类（classify）、按目标搭建（build）三类任务（第 3 章）；点选放置为主路径、拖拽为辅路径（同一任务两条路径均可完成，m7-m15-agent-handoff.md:182 切片 2）；仅一年级开放（其他年级显示未开放）；每局 5 任务；不限时；本地记录、暂停恢复、离线运行；首页第六游戏入口。

**不做（明确排除）**：平面图形辨认（候选目录无依据单元，见 1.1；补充属 F1 内容扩充方向，PLAN.md:444）；旋转操作与图形运动（交接 §7.1「旋转/图形运动仅在内容审核明确后扩展」，m7-m15-agent-handoff.md:175；积木首版以标准方向呈现）；自由画布搭建与自由沙盒编辑器（槽位制替代，见 2.2；PLAN.md:372「首版不需要物理引擎、三维建模或自由沙盒编辑器」）；金币、道具、商店、课程接入（交接 §2.1：新游戏不自动继承经济规则；金币零收支同 M12 先例）；投影、透视等高复杂度三维表现（等轴测简笔示意，m7-m15-agent-handoff.md:177「首版无需三维或物理引擎」）。

## 2. 玩法规则草案

以下为供拍板的完整草案；确认后落成 `docs/gameplay-geometry-builder.md`（体例对齐 [汉字勇者玩法说明](gameplay-hanzi-hero.md) 与 [算术地下城玩法说明](gameplay-arithmetic-dungeon.md)：规则 + 一局完整示例 + 验收条件）。

### 2.1 场景与核心循环

- **单一固定工地场景**：上部为目标区（分类区或搭建槽位），下部为**积木栏**（候选积木，渲染为等轴测立体图形 SVG）。任务节奏：读题面 → 放置积木 → 判定反馈 → 任务完成，无场景滚动、无地图。
- **三类任务**（题面文案均为中文；图形名称为学习内容）：
  1. **辨认（choose）**：题面呈现一个立体图形渲染图，从 4 个中文名称候选中选出正确名称（看图识名）；结构同 hanzi-choose 单选（models.ts:74-82 先例）。干扰项取其余立体图形名称，可解释、可复现（拼音干扰组同思路，src/content/pinyin-exercises.ts:19-59）。
  2. **分类（classify）**：题面给出 4–6 块积木与 2–3 个分类区（每区标注目标形状，accept 恰为一个立体图形身份）；玩家把每块积木放入对应区（点选积木→点选区，或拖拽），**整组提交**统一判定（题型扩展多选「整组提交」先例，docs/math-question-expansion.md）；提交后反馈哪些块放错，可撤回重排再提交（m7-m15-agent-handoff.md:185 切片 4「错放可撤回」）。
  3. **搭建（build）**：题面给出目标结构（如「塔顶放一个正方体，底座用圆柱」）与 N 个按序高亮**槽位**；玩家把积木放到槽位，放置即时判定（该槽位 accept 集合是否含该积木形状）：放对即固定，放错给出可解释反馈并可撤回换块。全部槽位正确即任务完成。
- **判题语义与操作分离**（m7-m15-agent-handoff.md:184 切片 3「判题基于形状、关系或槽位语义，不能只比截图像素或唯一操作顺序」）：判题只比较**形状身份**与**槽位/分区 accept 语义**，与积木渲染位置、放置顺序（build 槽位可任意顺序填充）、操作路径（点选或拖拽）无关。
- **多解与错误例**（交接 §7.2 切片 1 要求附多解例与错误例，m7-m15-agent-handoff.md:181）：多解=build 槽位 accept 为形状**集合**（如塔顶 accept ['cube','cuboid']，两种摆法均可）与 classify 同类多块的任意分配顺序；错误例=把圆柱放入 accept ['sphere'] 的分区（形状语义不符）。等价解判题按可接受集合逐成员测试（M10 `ENGLISH_SYNONYMS` 集合口径，src/learning/english.ts）。

### 2.2 操作与容差

- **点选放置为主路径**：点积木（选中态高亮）→ 点分区/槽位放置；**拖拽为辅路径**：pointer 事件拖动积木至目标区松手（交接 §7.2 切片 2：两条路径完成同一真实任务，m7-m15-agent-handoff.md:182）。全部为 DOM 控件与事件，不用 Canvas 自由坐标。
- **槽位制免自由坐标**：放置判定以分区/槽位的 DOM 区域命中为准（elementFromPoint 或事件目标），不存在像素级容差问题；拖拽中途松手在区外=取消归位、不丢块（切片 4「拖出边界、触摸中断和旋转不造成丢块」，m7-m15-agent-handoff.md:185；旋转首版不存在）。拖拽坐标换算（视口→元素）在五档视口下验证（6.2）。
- 触摸目标 ≥44 CSS px；不依赖 hover；错误点击无不可逆惩罚（design.md:31-38 既有口径）。反馈为「颜色 + 形状 + 文案」冗余（design.md:11）。

### 2.3 随机化

- 积木排列、分类区顺序、槽位 accept 集合的呈现顺序在**组卷时用局内 rng 洗牌**（每局每任务重新随机），辨认选项同样洗牌——答案不恒在首位（M8/M9「答案恒为第一张」缺陷修复机制：组卷洗牌 + 洗牌结果进快照 + 判题按内容身份与渲染位置无关，src/game/hanzi-hero/rules.ts:72-83 先例）。
- 洗牌结果随 RoundState 进入中断快照；恢复后排列与中断前完全一致，不重新洗牌（M10 站位口径，m7-m15-agent-handoff.md:160）。

### 2.4 单局规则

- **每局 5 个任务**（三款先例同档；组卷按题型配额轮转：choose/classify/build 在局内尽量各 ≥1，先选不同题型再抽题，混排对齐动态题库组卷先例 docs/content-review-generation.md），从所选年级正式池 `selectExercises` 洗牌抽取，局内任务唯一，避开上一局任务 ID（「最近开局 ID」先例）。池不足 5 道时阻止开局并提示。
- **不限时**：搭建与分类是操作型任务，倒计时与操作学习冲突；同 M8/M10 阅读类任务口径（m7-m15-agent-handoff.md:43「新游戏不自动继承 10 秒计时」）。
- **计分：首答 10 分 / 重试 5 分**（三款同档）。**首答口径**：choose=第一次选择；classify=第一次整组提交；build=第一次放置判定。任一首次判定错误即入重试档；答错不扣分，可撤回纠正、无限重试，无死局。
- **重复判定不重复计分**：任务完成后锁定，继续点击一律忽略（连点不重复计分，design.md:38）；classify 已提交后未修改再提交、build 已正确槽位再放置均不产生新判定。
- **金币零收支**（M12 先例，PLAN.md:376）；不加道具、复活（操作型任务答错可自行纠正，辅助道具无意义）。

### 2.5 暂停、恢复与记录

- 暂停覆盖层「继续游戏」；页面切后台自动暂停、回前台不自动继续（三款同口径）。不限时，暂停仅冻结进行状态。
- 中断快照写入 `pixel-academy:geometry-builder:v1:interrupted`：完整任务序列（含每任务积木排列、分区/槽位洗牌结果）、当前任务、已放置/已分类状态与已撤回历史不需要（只存当前布局）、每任务尝试次数与首答记号、分数、局次 ID、RNG 内部状态。刷新后提供「继续上局／放弃上局」，恢复后布局与连续游玩一致（含已放置积木位置与选中态，交接 §7.2 切片 4「恢复保存当前布局、方向与选中状态」，m7-m15-agent-handoff.md:185）；结算只记一条成绩；内容版本不兼容时安全放弃中断局并说明原因。
- 成绩写入 `pixel-academy:geometry-builder:v1:records`（最近 20 条，按局次 ID 幂等去重），**显式携带 gameId** 且解析层只接受本游戏 gameId（拼音口径先例 src/game/pinyin-adventure/rules.ts:12,20），**记录内容版本指纹** `contentVersion`（同 M9/M10 先例）。记录分列：**图形作答**（每任务判定结果、首答/重试）与**放置操作**（错放次数、撤回次数、操作路径点选/拖拽）分开统计，不以操作结果推断图形理解（M10 语言作答/移动操作分列先例，m7-m15-agent-handoff.md:168）。

### 2.6 一局完整示例（一年级）

1. 选择屏：勾选「一年级」→ 显示「一年级开放 15 个任务」（示例按首批 approved ≥15 计，见 4.1；可用性提示只统计 approved）→「开始搭建」。
2. 任务 1（辨认）：题面呈现圆柱渲染图 → 候选「正方体 / 圆柱 / 球 / 长方体」（局内洗牌）→ 点「圆柱」→ ✓ +10（首答）。
3. 任务 2（分类）：题面「把积木按形状分类」→ 积木 [球, 正方体, 球, 圆柱]，分区「球区 / 正方体区 / 圆柱区」→ 全部放入 → 提交 → ✗ 反馈「第 3 块放错了」（误入正方体区）→ 撤回改放球区 → 再提交 ✓ +5（重试档）。
4. 任务 3（搭建）：题面「搭一座小塔：底座用圆柱，塔顶用正方体或长方体」→ 槽位 [底座, 塔顶] → 放圆柱到底座（✓ 固定）→ 放正方体到塔顶（✓，accept 集合多解）→ 完成 +10。
5. 任务 4（搭建）：第一次放置错误（把球放到 accept ['cube','cuboid'] 的槽位）→ 反馈「这块不合适，换一块试试」→ 撤回换长方体 → 完成 +5。任务 5（辨认）：首答正确 +10。
6. 结算：「总分 40 · 首次一次完成 3/5 · 重试 2 次 · 错放 2 次」。成绩入记录（gameId `geometry-builder`），金币不变；「再来一局」抽新 5 题。

### 2.7 PLAN M11 验收条件逐条落实对照

| PLAN.md 验收条件（:368-372） | 本计划落实 |
| --- | --- |
| 平面投影或示意图不会混淆二维图形与立体对象，图片表现与训练目标一致 | 训练对象为立体图形（1.1）；SVG 等轴测示意呈现立体特征（3.4）；**内容审核覆盖最终渲染截图**，不只看源数据（4.4；m7-m15-agent-handoff.md:190） |
| 多个等价正确解可通过 | build 槽位 accept 集合多解 + classify 同类多块任意顺序（2.1）；集合判题逐成员测试（6.1） |
| 不同屏幕尺寸下拖拽判定稳定，提供点选后放置的操作方式 | 槽位制 DOM 命中（2.2）+ 点选主路径 / 拖拽辅路径双路径（切片 2）+ 五档视口验证（6.2） |
| 首版不需要物理引擎、三维建模或自由沙盒编辑器 | 1.3 明确排除；完成前 diff 复查 |

交接 §7.3 附加验收（m7-m15-agent-handoff.md:188-192）：等价正确解、错误分类、**允许/禁止旋转**（首版=禁止旋转口径：无旋转操作与 UI，测试断言积木方向固定不变）、容差边界（区外松手取消归位）、重复放置不重复判定、拖拽取消、同一坐标转换下绘制/命中一致（2.2 DOM 命中口径 + 6.2 场景）、**真实触摸与鼠标/桌面触摸模拟分别记录**（模拟器轮 CDP 真实触摸 vs 桌面鼠标，6.2）、内容审核覆盖渲染图（4.4）。

## 3. 图形任务类型与判题模型设计

### 3.1 现状

- Task 联合现为 `MathTask | ChineseTask | PinyinTask | EnglishTask`（src/learning/models.ts:135），无图形任务 kind；SubmittedAnswer 已支持 `number | string | readonly string[]`（models.ts:136）。
- 数学知识点已有 `math.classification.basic`「分类与整理」（MAP-009 → MA-01A-U03「整理与分类」，src/content/skills.ts:51-54,204-214），但无图形认识知识点。
- PLAN.md:294：「语文、英语、图形任务需要在实际开发对应游戏时增加明确的任务类型与判题规则，不能强塞进 MathTask 或依靠字符串执行。」

### 3.2 知识点新增（内容前置）

- 新增 skill：`math.geometry.solids`「立体图形的认识」（subject math），新增映射 **MAP-030**（现映射 MAP-001–029 已用满，src/content/skills.ts 共 29 条）：skillId `math.geometry.solids` → unitIds `['MA-01A-U05']`，sourceVerification/curriculumVerification 均 pending，evidenceIds `['handoff-2026-10-25']`——依据为该候选单元及课次（1.1），候选映射不宣称教材对齐（docs/content-baseline.md:23-32）。
- **不挂 MAP-009**：三类任务的训练核心是「认识立体图形」，而 MAP-009「分类与整理」的语义是按用途/颜色/形状的整理活动（MA-01A-U03）；按形状分类是立体图形认识的应用场景，归属新知识点语义更准。MAP-009 继续留给后续分类整理类内容。
- 形状身份词表常量（shapes.ts 导出，内容模块与判题共用防漂移，照 `PINYIN_INITIALS`/`ENGLISH_SYNONYMS` 模式）：`SHAPES_3D = ['cuboid', 'cube', 'cylinder', 'sphere']`，中文名映射 `SHAPE_LABELS = { cuboid: '长方体', cube: '正方体', cylinder: '圆柱', sphere: '球' }`。四种为一年级上学期通用数学事实，不宣称对应教材页码。

### 3.3 任务类型草案（两种 kind，对齐 M8/M9 多 kind 先例）

```ts
/** 立体图形辨认任务：呈现图形渲染图，从中文名称候选中选认（单选）。 */
export interface ShapeChooseTask {
  readonly kind: 'shape-choose';
  /** 目标形状身份（SHAPES_3D 内）。 */
  readonly shape: string;
  /** 题面渲染图路径（web 根内相对路径，随构建预缓存）。 */
  readonly image: string;
  /** 中文名称候选（含正确名与干扰名，取自 SHAPE_LABELS）。 */
  readonly options: readonly string[];
  /** 正确答案中文名；判题按身份，与候选排列无关。 */
  readonly answer: string;
}
/** 立体图形放置任务：把积木放入分类区（classify，整组提交）或搭建槽位（build，逐槽即时判定）。 */
export interface ShapePlaceTask {
  readonly kind: 'shape-place';
  readonly mode: 'classify' | 'build';
  /** 中文题面。 */
  readonly prompt: string;
  /** 积木形状身份序列（语义序；渲染排列由组卷洗牌决定）。 */
  readonly blocks: readonly string[];
  /** classify：分类区（accept 恰一个形状）；build：按序槽位（accept 为可接受形状集合，等价解来源）。 */
  readonly zones: readonly { readonly id: string; readonly accept: readonly string[] }[];
}
```

设计理由（最小必要复杂度）：

- choose 与 place 的作答结构不同（单选字符串 vs 放置结果集合），合并为单一 kind 会造成字段稀疏；M8（hanzi-choose/hanzi-parts）与 M9（pinyin-choose/pinyin-listen）均按作答结构分 kind，本款对齐。classify 与 build 共用 place kind：同为「积木→区域」放置，差别仅在判定时机（整组提交 vs 逐槽即时）与 accept 语义（区=单形状 vs 槽=集合），以 `mode` 字段区分并分列记录（M10 单 kind + mode 的同型思路用在同类结构上）。
- zone.id 为稳定标识（`z1`/`z2`…），accept 存**形状身份**而非中文名（判题按身份，渲染层取 SHAPE_LABELS 显示）；classify 模式每 zone accept 恰一个形状且四区互异，build 模式槽位 accept 可为 1–2 个形状的集合（多解）。
- 渲染图不进 place 任务数据：积木按 `blocks` 身份渲染（SHAPE_IMG 映射，照 hanzi PICTOGRAM 先例 src/content/hanzi-hero.ts:16），任务保持精简。
- 备选方案（classify/build 拆两个 kind）已评估并否决：结构重复、无独立判题语义，见决策点 4。

### 3.4 判题模型与作答契约

- **判题一律走 Learning Core**（evaluateAnswer，src/learning/evaluation.ts:10），游戏层不重复判题。新增 `src/learning/shapes.ts`，照 `english.ts` 模块模式（词表 + 结构校验 + 按内容身份判题），并在 evaluateAnswer / validateTask（src/learning/evaluation.ts:39）分派注册（M8/M9/M10 三次验证过的接入模式）。
- **作答契约**：
  - `shape-choose`：SubmittedAnswer = `string`（选项身份/中文名）。
  - `shape-place`：SubmittedAnswer = `readonly string[]`，每项 `"<block 形状身份>@<zone id>"`（如 `"cylinder@z1"`）。classify 为全部分配结果的**无序集合**（全部块分配且每块归属区 accept 含其形状才算完成）；build 为**已放置结果**（每槽至多一项，槽位 accept 含形状即该槽正确；全部槽正确即完成）。
- `shapes.ts` 另导出 `shapePlaceResult(task, answer): { correct: boolean; wrongBlocks: number[] }`（classify 逐块定位错块供反馈）与 `shapeSlotResult(task, answer): { slotOk: boolean[]; complete: boolean }`（build 逐槽状态）——与 M10 `englishDeliveryResult` 同口径：**不是第二个判定入口**，而是同一判定逻辑的粒度分解（src/learning/english.ts 先例），供游戏规则层获取分步反馈而不重复实现判定。
- **结构校验**（validateShapeTask，仿 english.ts / pinyin.ts）：`shape`/`blocks`/`accept` 成员全部 ∈ SHAPES_3D；options 数量 4、互异、∈ SHAPE_LABELS 值域；answer 可达（∈ options）；blocks 数量界（classify 4–6、build 1–4）；zones 数量界（classify 2–3、build 1–4）；**可达性**：每 zone 的 accept 至少被一块 blocks 满足（不出现空区/死槽），classify 每块恰有唯一归属区（accept 互异保证），build 每槽 accept 非空；classify 的 zones accept 互异；image 路径白名单 `^/img/geometry-builder/[a-z-]+\.svg$`（照音频路径白名单先例 src/learning/pinyin.ts:36）；prompt 非空中文。validateCatalog 对每条图形练习调用 validateTask，非法任务装载期即失败。
- **不混淆口径**：choose 干扰项只取其余立体图形名称（不引入平面图形名称作干扰——平面图形不在本款训练范围，引入即混淆训练目标）；渲染层把立体特征画足（3.2 知识点对应图、4.2 样张）。

## 4. 内容准备与审核计划

启动前置：PLAN.md:29,461 要求「启动任何一款前需先准备并审核对应学科的任务类型与内容」——本章工作（切片 0/1）先于任何页面实现。

### 4.1 首批内容规模（建议值，已拍板见决策点 5）

| 项 | 建议值 | 说明 |
| --- | --- | --- |
| 形状集 | 4 种立体图形（长方体、正方体、圆柱、球） | 一年级上学期通用范围，与 MA-01A-U05「认识图形」课次对应（候选口径） |
| 任务数 | 18 道草稿：辨认 6 + 分类 6 + 搭建 6，全部映射 MAP-030 | 每条定义题面、积木集、分区/槽位与 accept 集合、干扰项、错误反馈、多解例或错误例（m7-m15-agent-handoff.md:181） |
| approved | ≥ 15 道 | 每局 5 题 + 避重余量（M10 同口径）；低于 15 不建议再压缩 |
| 年级开闭 | 仅一年级开放 | MAP-030 映射 MA-01A（一年级）；其他年级显示未开放，不跨年级补题（PLAN.md:292） |
| ID 段 | `MA-G-001` 起（数学几何段，对齐 MATH- / HZ- / EN-C- 前缀惯例） | 稳定 ID 不随展示排序改变 |

通用原创教学内容，依据为通用数学事实与 MA-01A-U05 候选单元；审核记录如实标注「通用原创、未对照教材版次」，来源核对与映射核验保持 pending（汉字勇者先例口径）。

### 4.2 图片来源与记录口径

- **原创等轴测 SVG**，入库 `web/img/geometry-builder/{cuboid,cube,cylinder,sphere}.svg`（4 张基础渲染 + 若干场景需要的变体，总数 ≤8），随构建交付并登记 SW 预缓存（build-sw.mjs:45-51 汉字/英语图片登记模式）。几何图形绘制难度低于 M10 人物/情绪形象，歧义风险主要在**立体感表达**（球 vs 圆、正方体 vs 正方形）。
- **样张先行**：先出 4 张基础图形样张，按「一眼可辨立体特征、颜色语义化（积木用玩具色，非装饰渐变，design.md 口径）」自检后进入逐条审核；用户评审计划时可否决风格。不使用 emoji（立体感不可控）与外部素材库（许可成本）。
- 渲染防混淆自检口径：球体带高光与投影、正方体/长方体可见三个面、圆柱可见顶面椭圆——在 320px 窄屏截图下仍可区分（7.3「图片不混淆圆与球、正方形与正方体」，m7-m15-agent-handoff.md:190）。

### 4.3 审核记录安排

- 新建 `docs/content-review-geometry-builder.md`，结构照 content-review-english-courier.md：审核对象（ID 区间、题量、年级、gameId、映射 MAP-030）→ 审核者与 ISO 时间 → 审核范围与局限 → 逐条审核表 → 汇总与撤回条件。
- 逐条审核表覆盖：题面表述可理解无歧义、积木集与 accept 集合正确性、干扰项可解释、**渲染图—形状对应**（含立体特征自检，4.2）、题面/图形/目标/判题四者一致、多解例与错误例成立（交接 §7.2 切片 1）。
- **代理审核身份如实标注**（zcode-agent），不冒充教师或教材专家；教学难度、学生空间观念发展等无法由代理完成的部分如实留缺口并设撤回条件（AGENTS.md 内容约束）。
- **不编造**教材书名、ISBN、版次、课次：MA-01A 现状字段不动（title/isbn/edition 保持现值、verification 保持 pending）；MAP-030 以 pending 候选入库，不宣称教材对齐。
- **draft→approved 流程**照 content-workflow.md 7 步执行；不为通过测试或解除阻塞把 draft 改成 approved（AGENTS.md 内容约束）。

### 4.4 内容装配与筛选口径

- 新建 `src/content/geometry-exercises.ts`（静态题库，gameIds 仅 `['geometry-builder']`，mappingIds 指向 MAP-030），照 english-exercises.ts 模式头部注明题量与审核记录位置。
- 照拼音/英语先例按本游戏独立 gameId 重建 Learning Core，不改默认静态 catalog（src/game/pinyin-adventure/content.ts:24-33 口径）；`selectGeometryExercises(grades)` 只走 `selectExercises`（src/learning/catalog.ts:79）。
- `describeAvailability` 同构实现：所选年级供题量、未开放年级明示、不足 5 道阻止开局（src/game/pinyin-adventure/content.ts:37-63 模式）。
- `select` 署名断言沿用 M9 先例（题库全部为图形任务且经 validateCatalog 逐题校验后双重断言，src/game/pinyin-adventure/content.ts:30-33 口径），保留同等注释。

## 5. 工程实施切片

按 tracer bullet / 竖向切片推进（交接 §2.2 四阶段：A 规则与内容 → B 窄路径验证 → C 首版交付 → D 回归与记录，m7-m15-agent-handoff.md:46-57）。窄路径成功不能代替首版验收。

| 切片 | 阶段 | 内容 | 进入条件 |
| --- | --- | --- | --- |
| 0 | A | 本计划口径确认；词表与 4 张图形样张；18 道任务草稿；MAP-030 入库 | 关键歧义解决；不把候选映射当教学结论 |
| 1 | A/B | ShapeChooseTask/ShapePlaceTask 入 models.ts Task 联合 + `src/learning/shapes.ts` + evaluation.ts 分派 + geometry-exercises.ts 首批 approved + `tests/shapes.test.mjs`（判题正例/非法清单/可接受集合逐成员/63 种年级组合/数学回归） | npm run check 全绿；审核记录完成 |
| 2 | B | `src/game/geometry-builder/` 最小四件套（rules/content/storage/main），**一道 build 任务**打通：selectExercises → 点选放置 → 判题 → 快照保存恢复 → 断网重开（本地构建） | 窄路径六环节实际打通 |
| 3 | C | 完整局次：三模式组卷配额与避重、计分（首答 10/重试 5）、classify 整组提交与撤回、拖拽辅路径、洗牌+恢复布局一致、记录分列、describeAvailability 年级口径 | 本款验收项有结果 |
| 4 | C | 入口接线：web/geometry.html + geometry.css（boot-fail 兜底、返回锚点、?nosw）、首页导航第六入口、SW 三处接线、tests/offline 六入口断言、五档视口与触摸目标 | 手机交互与离线清单完整 |
| 5 | D | 共享改动回归（M10 计划 §12.2 五类范围）+ 四轮验证 + 文档三件套 + PLAN/README/架构同步 | 交接 §12.3 完成核对六条 |

### 5.1 复用清单（不新建、直接引用）

| 能力 | 位置 | 用法 |
| --- | --- | --- |
| 判题分发扩展点 | src/learning/evaluation.ts:10,39 | 注册图形两分支；判题唯一入口 |
| 学科判题模块模式 | src/learning/english.ts、pinyin.ts | shapes.ts 照此编写（词表/校验/身份判题） |
| 运行时随机源与快照恢复 | src/game/number-puzzle/random.ts 的 createRuntimeRng/restoreSeededRng | 积木/分区洗牌与恢复（跨游戏 import 先例 src/game/pinyin-adventure/main.ts:8-10） |
| 存储模块模板 | src/game/english-courier/storage.ts（口径最新：schemaVersion + gameId 校验 + 单条损坏只丢该条） | 换 STORE_PREFIX 与记录 schema |
| 页面骨架 | web/english.html + english.css（年级多选、恢复上局、暂停遮罩、boot-fail 内联脚本、返回锚点） | 复制改造为 geometry.html/css |
| 可用性提示模式 | describeAvailability + OPEN_GRADES + GRADE_NAMES（src/game/pinyin-adventure/content.ts:37-63） | 同构实现 |
| SW 接入点 | scripts/build-sw.mjs:21-26（SW_ENTRY_MODULES）、:41-42/:57-61（静态清单与映射）、web/sw.source.js:103-107（导航回退，Pages 308 re-wrap）、tests/offline.test.mjs（入口断言三组） | 三处同步扩展为六入口 |
| 首页导航模式 | web/index.html:125（#main-nav 内 `<a>`） | 追加第六条 |
| 拖拽/触摸事件先例 | 数字消除画布 pointer 事件与 `touch-action` 处理（src/game/number-puzzle/render.ts）、MDN 标准做法 | place 任务拖拽实现 |
| 内容审核/证据文档模板 | docs/content-review-english-courier.md、docs/evidence/m8–m10 README 骨架 | 第 4、6 章产出照此 |
| 新增游戏接线模板 | M10 首版提交 d6dfe17 的触碰文件清单（git show --stat d6dfe17） | 接线完整参照；package.json/tsconfig/serve.mjs/stage-site.mjs 无需改动 |

### 5.2 新增/修改清单（逐文件）

**新增**：

1. `src/learning/shapes.ts` —— SHAPES_3D、SHAPE_LABELS、isShapeTask、validateShapeTask、shapePlaceResult、shapeSlotResult。
2. `src/content/geometry-exercises.ts` —— 首批图形题库（gameIds `['geometry-builder']`）。
3. `src/game/geometry-builder/rules.ts` —— GAME_ID='geometry-builder'、STORE_PREFIX='pixel-academy:geometry-builder:v1'、组卷（题型配额 + 积木/分区/选项洗牌）、判定消费、计分、快照；无 DOM/存储依赖。
4. `src/game/geometry-builder/content.ts` —— 独立 Learning Core 装配、selectGeometryExercises、describeAvailability、SHAPE_IMG 映射、CONTENT_VERSION。
5. `src/game/geometry-builder/storage.ts` —— 独立命名空间 KV、设置/成绩/快照/最近 ID。
6. `src/game/geometry-builder/main.ts` —— 页面接线（点选/拖拽、判题消费、不重复判题）。
7. `web/geometry.html` + `web/geometry.css` —— 入口页与样式。
8. `web/img/geometry-builder/*.svg` —— 立体图形原创渲染图（≤8 张）。
9. `tests/shapes.test.mjs`（判题）+ `tests/geometry-builder.test.mjs`（rules/storage/content，从 dist 导入，npm test 先 build）。
10. `docs/gameplay-geometry-builder.md`、`docs/content-review-geometry-builder.md`、`docs/evidence/m11/README.md`。

**修改**：

11. `src/learning/models.ts:135` —— Task 联合追加 ShapeChooseTask | ShapePlaceTask（SubmittedAnswer 不变）。
12. `src/content/skills.ts` —— skills 追加 `math.geometry.solids`；mappings 追加 MAP-030（pending）。
13. `src/learning/evaluation.ts` —— evaluateAnswer/validateTask 注册图形分支。
14. `web/index.html:125` —— #main-nav 追加几何建筑师入口锚点。
15. `scripts/build-sw.mjs` —— SW_ENTRY_MODULES 追加 `dist/game/geometry-builder/main.js`；STATIC_PRECACHE_URLS 与 STATIC_FILE_FOR_URL 登记 `/geometry.html`、`/geometry.css`、全部图片。
16. `web/sw.source.js:103-107` —— 导航回退分支追加 `/geometry.html` 与 `/geometry`（Pages 308 规范化口径）。
17. `tests/offline.test.mjs` —— 三组断言扩展为六入口。
18. 文档同步：`docs/architecture.md`（模块表更新）、`PLAN.md`（M11 状态推进）、`README.md`（支持内容）、`VERIFICATION.md`（如有新检查方法）。

### 5.3 共享改动影响面

Task 联合、evaluation.ts、skills.ts、build-sw、首页导航与 sw.source.js 属共享代码：按交接 §12.2 回归表覆盖 Core/内容（数字消除整数与选择题、汉字、拼音、英语任务判题、正式/预览隔离、63 种年级组合）、导航/公共样式（五款已交付游戏进出、窄屏横屏）、SW/构建（五款断网可进、活动局不采用更新）；已交付五款游戏的存储、钱包、成绩完全不动（m7-m15-agent-handoff.md:291-297）。

## 6. 验证与验收计划

### 6.1 自动化

- `npm run check`（typecheck + 构建 + 全部测试）：新增 tests/shapes.test.mjs 与 tests/geometry-builder.test.mjs；Core 变化回归旧四类任务、全部 63 种非空年级组合、学科/gameId/草稿隔离。
- 判题测试：正例 + 非法输入清单 + accept 集合逐成员（等价解）+ 测试内独立 expected 对照 + 组合矩阵（classify 全对/单块错/多块错/块未分配；build 逐槽对/错/重复放置幂等）+ 结构校验非法清单（空区/死槽/身份越界/路径越权/answer 不可达）。
- 规则测试：多种子排列分布断言（正确答案不长期固定）、洗牌后判题与渲染排列无关、恢复后布局一致（含已放置与选中态）、完成后重复操作不重复判定、首答档位判定、拖拽取消不丢块（以纯逻辑状态断言表达）。
- 离线测试：六入口清单断言、sw.js 导航分支、资源缺失构建失败。

### 6.2 浏览器与设备验证（四轮，M8/M9/M10/M12 同构）

1. **桌面验收轮**（无头 Chrome，验收员独立于实现者）：场景至少覆盖——选年级（单选/混选/仅无内容年级）、空内容提示、完整一局（三模式混合：辨认→分类→搭建→结算）、classify 错块反馈与撤回重排、build 多解（同一槽位两种可接受积木均通过）、错误例（不可接受积木被拒）、拖拽与点选两路径完成同一任务、拖拽区外松手取消归位、重复放置与连点、暂停/刷新恢复（布局与洗牌一致）、横竖屏切换布局一致、断网重开完整局、活动局更新延后；横向溢出与 JS 错误贯穿检查。
2. **缺陷修复复验轮**：发现缺陷如实记录（fx- 前缀截图 + results.json fixVerification 字段），修复后复验。
3. **模拟器轮**：Android Chrome（CDP `Input.dispatchTouchEvent` 真实触摸，**拖拽手势重点场景**：触摸拖动放置、拖拽中断取消）与 iOS Safari（模拟器口径，2026-10-28 裁决豁免真机）各覆盖关键场景；**真实触摸结果与桌面鼠标/触摸模拟分别记录**（m7-m15-agent-handoff.md:191）。
4. **生产环境轮**：推送部署 Cloudflare Pages 后无头 Chrome 验证新入口在线/离线与 SW 导航（含 Pages 308 规范化 re-wrap 口径）；生产段落写入 docs/evidence/m11/README.md 主文件（M9 教训口径）。

视觉验证按五档（320×568、390、412×915、低高度横屏、桌面）截图，核对图形可辨（球/圆柱/正方体/长方体在窄屏不混淆）、触摸目标 ≥44px、目标区不被遮挡；渲染图核对以**最终渲染截图**为准（4.2）。

### 6.3 验收条件 ↔ 验证方法对照

| 验收点 | 验证方法 |
| --- | --- |
| 示意图不混淆二维与立体对象 | 渲染样张自检（4.2）+ 审核覆盖渲染截图（4.3）+ 五档截图目视核对（6.2） |
| 多个等价正确解可通过 | accept 集合判题测试逐成员 + 浏览器多解场景（6.2 场景：同槽两种积木均通过） |
| 不同屏幕尺寸拖拽稳定 + 点选放置可用 | 五档视口双路径场景 + 模拟器真实触摸拖拽（6.2） |
| 无物理引擎/三维建模/沙盒 | 范围声明（1.3）+ 完成 diff 复查 |
| 交接 §7.3 各项 | 6.1 组合矩阵与 6.2 场景清单逐项对应（2.7） |

### 6.4 证据留痕

`docs/evidence/m11/`：README.md（内容来源与审核边界 → 自动化检查项数 → 分场景结果表 → 缺陷与修复 → 截图索引 → 已知限制与未验证项）+ 分轮截图 + results.json。每条证据含日期/执行者、提交或未提交差异、构建/内容版本、访问地址、设备/系统/浏览器、真实或模拟、步骤、预期/实际、未验证项（m7-m15-agent-handoff.md:301-303 口径）。测试与夹具数据不入用户档案、不当内容审核。

## 7. 决策点（按 2026-10-28 长期指令代理拍板，用户可否决）

| # | 决策点 | 拍板 | 理由 |
| --- | --- | --- | --- |
| 1 | **首版训练对象** | **仅立体图形**（长方体、正方体、圆柱、球），不做平面图形 | MA-01A-U05「有趣的立体图形」是候选目录唯一图形认识单元（src/content/units.ts:274-289）；平面图形无候选单元依据，不能编造映射（AGENTS.md 内容约束）；交接 §7.1 明确「必须依据实际来源新增」 |
| 2 | **知识点与映射** | 新增 `math.geometry.solids` + MAP-030（→MA-01A-U05，pending），不挂 MAP-009 | 三类任务训练核心是认识立体图形；MAP-009「分类与整理」语义不同（3.2） |
| 3 | **任务类型形态** | 两种 kind：`shape-choose` + `shape-place`（mode: classify/build） | 作答结构不同按结构分 kind（M8/M9 先例）；classify/build 同构共用（M10 mode 字段思路） |
| 4 | **操作形态** | 槽位制（DOM 区域命中），点选放置主路径 + 拖拽辅路径；无自由坐标画布 | 满足交接切片 2 双路径与验收「拖拽稳定 + 点选可用」，同时免除像素容差与物理引擎（最小必要复杂度） |
| 5 | **首批规模** | 4 形状 / 18 道草稿（辨认 6+分类 6+搭建 6）/ approved ≥15 / 仅一年级 | M10 同档口径；低于 15 避重余量不足 |
| 6 | **旋转** | 首版无旋转操作（积木标准方向），测试断言方向固定 | 交接 §7.1「旋转仅在内容审核明确后扩展」；「允许/禁止旋转」验收以禁止口径覆盖 |
| 7 | **计分与经济** | 首答 10/重试 5（choose=首次选择、classify=首次整组提交、build=首次放置）；不限时；金币零收支；无道具 | 三款先例同档；操作型任务可自行纠正，道具无意义；经济不继承（交接 §2.1） |
| 8 | **图片来源** | 原创等轴测 SVG（≤8 张），样张先行自检 | 无版权负担、随构建交付；几何绘制风险低于 M10 人物形象（4.2） |

主要风险（非决策项，实施中管理）：① 拖拽在 CDP 真实触摸下的坐标换算是本款最大验证风险，点选主路径为保底（验收条件即要求双路径）；② 立体感 SVG 歧义风险，靠样张自检 + 渲染截图审核 + 撤回条件控制；③ Task 联合与 evaluation.ts 为共享代码，改动需严格回归五款已交付游戏（5.3）；④ select 署名断言沿用 M9 先例（4.4），如需消除另行评估。

## 8. 与既有文档的一致性

- **本文与 PLAN.md**：细化 PLAN.md:90（M11 行）与 :358-372（M11 小节）的交付物与验收条件，全部验收条件逐条映射见 2.7 与 6.3；不改变 M11「暂缓」状态。启动前置（「先准备并审核对应学科的任务类型与内容」）体现为切片 0/1 先于页面实现。
- **本文与 m7-m15-agent-handoff.md**：§7.1–7.3 的定位、五条执行切片与三条测试验收全部覆盖（切片对齐 §2.2 四阶段与 §7.2 五条，验收映射见 2.7 与 6.3）；§2.1–2.3 统一边界（年级、审核隔离、Core 纯 TS、经济不继承、不提前抽象）全文遵守；§12 证据与完成核对清单作为切片 5 的收口标准；§13 阻塞处理适用于缺图片/审核输入的情形（可继续任务模型、草稿与测试，不编造资源与审核）。
- **本文与其他文档**：内容与审核口径对齐 content-workflow.md / content-baseline.md；视觉与交互对齐 design.md；玩法文档体例对齐 gameplay-hanzi-hero.md / gameplay-arithmetic-dungeon.md。
- **授权状态**：本文为开工前资料，编写与发布不改变 M11 状态。实施、提交、推送、部署按 2026-10-27 长期授权（里程碑完成收口）与 2026-10-28 长期指令（自动推进）执行；用户另有指示时以其为准。
