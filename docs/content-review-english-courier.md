# 英语快递员首批内容审核记录

## 审核对象

- 游戏：英语快递员（`english-courier`），首版静态题库 `src/content/english-exercises.ts`。
- 范围：12 个词条（家庭成员 6 + 状态感受 6）、18 道任务（词汇识别 10：EN-C-001–010；句意理解 8：EN-C-011–018）。
- 年级与映射：全部关联一年级；家庭族任务 → MAP-015（`english.family.members` → EN-01A-U01「What is your family like?」），情绪族任务 → MAP-016（`english.emotions.basic` → EN-01A-U02「How are you today?」）。单任务不混映射。
- 配图：12 张原创 SVG（`web/img/english-courier/*.svg`：家庭角色 6 + 情绪表情 6），随构建交付。

## 审核者与时间

- 审核者：**zcode-agent（代理审核）**，2026-10-27T18:20:00Z。
- 如实声明：本审核为代理审核，不代表教师、家长、母语者或教材专家评审；未对照任何教材版次。

## 审核方法与范围

1. **词表审核**：12 词均为一至六年级通用常用家庭称呼与基础情绪词（mum、dad、grandma、grandpa、brother、sister、happy、sad、tired、hungry、thirsty、sleepy），拼写逐词核对；依据为通用语言事实，不宣称对应特定教材课次。同义表达（mother/mom/father/grandmother/grandfather/glad/unhappy 等）作为判题可接受集合口径实现（`ENGLISH_SYNONYMS`），不作为独立词条。
2. **逐条任务审核**（下表）：指令表述、正确包裹与收件人、干扰项可解释性、词汇/句意模式标注、图片—词义对应、判题一致性。
3. **结构校验**：`validateEnglishTask` 强制候选 3–4 个、无重复、答案集合同指一个规范词且至少一个成员可达；`tests/english.test.mjs` 覆盖判题矩阵与同义集合；`tests/english-courier.test.mjs` 覆盖组卷洗牌、计分档、快照不变式。
4. **配图目视核对**：实现代理逐张目视 12 张 SVG（[svg-gallery.png](evidence/m10/svg-gallery.png)，2026-10-28 本地渲染截图，全部加载成功）与游戏内渲染截图（[evidence/m10/e7-390-game-detail.png](evidence/m10/e7-390-game-detail.png)、[e7-320x568.png](evidence/m10/e7-320x568.png)、[e5-01-wrong-parcel.png](evidence/m10/e5-01-wrong-parcel.png)）——角色特征可辨（mum 棕长发橙衣、dad 短发蓝衣白领、grandma 灰髻+圆眼镜紫衣、grandpa 灰发+胡髭绿衣、brother 红帽黄衣、sister 侧发髻粉衣；happy 微笑、sad 哭脸含泪、tired 汗滴倦眼、hungry 张口、thirsty 伸舌含水滴、sleepy 闭眼+Zz）；角色卡不含英语文字标签（词→义辨认不退化为读词点同词）。

## 审核局限（如实记录，不以下一轮「应该可以」填补）

1. 指令句型的**教学适宜性与儿童可读性未经真人复核**（无具备教学资质者参与）；一年级学生能否顺读「Deliver the parcel to …」句式未经真实学生验证。
2. 配图辨识度仅经代理目视，**未经真实学生/教师确认**（如 mum 长发造型与 grandpa 胡髭的辨识是否对低龄儿童足够清晰）。
3. MAP-015/016 与 EN-01A 的来源核对、地区选用与映射核验均为 **pending**；approved 不宣称与特定教材版次对齐。
4. 首版不含听力模式（实施计划决策 1），无发音音频审核项；后续听力切片交付时需另行完成音频来源与发音审核。

## 逐条审核表（18 题）

| ID | 模式 | 指令 | 正确包裹/收件人 | 干扰项与依据 | 图片—词义 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| EN-C-001 | vocab | Deliver the parcel to Mum. | mum | dad（性别对照）、grandma（辈分）、sister（同辈女性） | mum 形象对应 | 通过 |
| EN-C-002 | vocab | Deliver the parcel to Dad. | dad | mum（性别对照）、brother（同辈男性）、grandpa（辈分） | dad 形象对应 | 通过 |
| EN-C-003 | vocab | Deliver the parcel to Grandma. | grandma | grandpa（配偶对照）、mum（辈分）、sister（年龄） | grandma 形象对应 | 通过 |
| EN-C-004 | vocab | Deliver the parcel to Grandpa. | grandpa | grandma（配偶对照）、dad（辈分）、brother（年龄） | grandpa 形象对应 | 通过 |
| EN-C-005 | vocab | Deliver the parcel to Brother. | brother | sister（同辈对照）、dad（辈分）、grandpa（年龄） | brother 形象对应 | 通过 |
| EN-C-006 | vocab | Deliver the parcel to Sister. | sister | brother（同辈对照）、mum（辈分）、grandma（年龄） | sister 形象对应 | 通过 |
| EN-C-007 | vocab | Deliver the parcel to the happy one. | happy | sad（反义）、tired/sleepy（近义易混） | happy 表情对应 | 通过 |
| EN-C-008 | vocab | Deliver the parcel to the sad one. | sad | happy（反义）、hungry/thirsty（生理状态近义） | sad 表情对应 | 通过 |
| EN-C-009 | vocab | Deliver the parcel to the tired one. | tired | sleepy（近义最易混）、happy/sad（情绪对照） | tired 表情对应 | 通过 |
| EN-C-010 | vocab | Deliver the parcel to the hungry one. | hungry | thirsty（近义最易混）、tired/happy（状态对照） | hungry 表情对应 | 通过 |
| EN-C-011 | sentence | Dad wants his parcel. | dad | 主语解析考句意；干扰同 EN-C-002 集 | dad 形象对应 | 通过 |
| EN-C-012 | sentence | Grandma is waiting for her parcel. | grandma | 进行时+物主代词 her；干扰同 EN-C-003 集 | grandma 形象对应 | 通过 |
| EN-C-013 | sentence | This one is for Grandpa. | grandpa | for + 间接宾语结构；干扰同 EN-C-004 集 | grandpa 形象对应 | 通过 |
| EN-C-014 | sentence | Sister asks for her parcel. | sister | ask for 短语+her；干扰同 EN-C-006 集 | sister 形象对应 | 通过 |
| EN-C-015 | sentence | The sad child is waiting. | sad | 形容词作定语指代人；干扰同 EN-C-008 集 | sad 表情对应 | 通过 |
| EN-C-016 | sentence | The tired one needs a rest. | tired | one 替代+needs a rest 语义指向；干扰同 EN-C-009 集 | tired 表情对应 | 通过 |
| EN-C-017 | sentence | The thirsty child wants a drink. | thirsty | wants a drink 语义指向；干扰同 EN-C-010 集 | thirsty 表情对应 | 通过 |
| EN-C-018 | sentence | The sleepy child is going to bed. | sleepy | going to bed 语义指向；干扰同 EN-C-007 集 | sleepy 表情对应 | 通过 |

逐条核对口径：①指令表述无歧义、无生造句；②正确答案唯一且在候选中可达；③干扰项全部取自同族词表并落在语义对比轴（可解释、非随机）；④角色图与词义对应、不含英语文字标签；⑤指令含义、图片、目标与判题四者一致（判题走 Learning Core，按规范词身份）。

## 汇总

- 18/18 通过，全部 approved（reviewer `zcode-agent（代理审核）`，reviewedAt `2026-10-27T18:20:00Z`）；无暂缓项。
- 干扰项规则显式可复现（同族词表 + 语义对比轴），已由 `tests/english.test.mjs` 断言「候选取自同族词表」与「12 词全覆盖」。
- 撤回条件：任一题被指出指令歧义、图片误指或答案争议 → 该题回 draft 并复验；真人复核（教师/母语者）完成前，教学适宜性缺口持续记录。
- 正式取题口径：仅经 `selectExercises`（approved + subject english + gameId `english-courier` + 年级）；预览口径未启用。
