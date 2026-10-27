# 汉字勇者（M8）首版验证记录

执行于 2026-10-27，执行者为工作流代理（zcode-agent 会话）。依据 [玩法说明](../../gameplay-hanzi-hero.md) 与 [交接文档](../../m7-m15-agent-handoff.md) 的 M8 切片执行：A 阶段规则与内容 → B 阶段窄路径 → C 阶段首版交付 → D 阶段浏览器验证。代码未提交、未推送（待用户授权）；生产部署与真机未验证。

## 交付范围

- 规则与内容：`docs/gameplay-hanzi-hero.md`（每局 5 题、首答 10/重试 5、不限时、无金币道具）、`docs/content-review-hanzi-hero.md`（28 题逐条代理审核）、`src/content/hanzi-hero.ts`（28 个 approved 任务，全部通用原创）。
- Learning Core 扩展：`src/learning/models.ts` 增加 `Exercise<T>` 任务泛型与 `ChineseTask`（`hanzi-choose` 单选、`hanzi-parts` 多选部件集合）；`src/learning/hanzi.ts` 判题模块（校验 + 按内容判题，不依赖位置/颜色/排列）；`evaluation.ts` 统一接入；数学调用方类型收窄（generation/main/profile/rules/content/learning 均为 `Exercise<MathTask>`）。
- 首版页面：`web/hanzi.html` + `web/hanzi.css` + `src/game/hanzi-hero/{rules,content,storage,main}.ts`（独立命名空间 `pixel-academy:hanzi-hero:v1:*`）；11 张原创几何 SVG 配图（`web/img/hanzi-hero/`，随构建交付）。
- SW 双入口：`scripts/build-sw.mjs` 预缓存扩展为 `dist/game/number-puzzle/main.js` + `dist/game/hanzi-hero/main.js` 双闭包（45 资源，含 hanzi 页面/样式/11 张 SVG）；`web/sw.source.js` 导航离线回退扩展至 `/hanzi.html` 入口（ignoreSearch）。
- 首页导航：数字消除首页未加游戏选择入口（交接文档 §2.3 允许首版独立页面交付；正式导航接入待数字消除侧回归评估后实施，见限制 5）。

## 自动化检查

`npm run check`：typecheck + 生产构建 + **98 项测试全部通过**（learning 15 + hanzi 6 + hanzi-hero 8 + number-puzzle 12 + session 8 + storage 13 + offline 26 + generation/courses 其余）。新增：

- `tests/hanzi.test.mjs`：单选按字身份判题（反转排列答案不变）、meaning 缺图拒绝、组字集合判题（无序/去重/部分集判错）、非法任务拒绝（候选<4、重复候选、目标不在候选、非单字符、shape 带图、部件重复、结果字混入部件、部件不在候选）、正式池 28 题仅一年级仅 hanzi-hero（数学池 18 题不受污染）、draft 隔离（独立 catalog 构造验证 select 不含 draft、preview 含 draft）。
- `tests/hanzi-hero.test.mjs`：抽题 5 题唯一、上一局避重、池不足抛错、计分档（首答 10/重试 5/答错不扣分）、组字 toggle/提交/答错清空、整局 50 分结算、快照往返恢复一致、损坏快照拒绝、全部内容题自身答案判对。
- `tests/offline.test.mjs` 扩充：hanzi 入口闭包覆盖断言（main/rules/storage/content + learning/hanzi + content/hanzi-hero）。
- `tests/learning.test.mjs` 假设更新：静态 approved 18+28、数值域断言限定数学任务、新增语文筛选断言。

## 浏览器验证（D 阶段，全部通过）

环境：无头 Chrome/156.0.8078.48（CDP 直连，独立 profile），视口默认 756×469、窄屏 390×844（Emulation.setDeviceMetricsOverride）；DOM 控件为页面内程序化点击（无头 Chrome 真实事件管线），答案从页面题面经 dist 产物（`hanziHeroExercises` + `correctHanziIds`）自算；未注入状态。验证页面用 `?nosw` 参数跳过 SW 注册以保证每次驱动当前构建（该参数仅供验证工具，不影响正式入口）。

| # | 场景 | 结果 |
| --- | --- | --- |
| V1 | 完整局（识别/配对/组字混合）| 5 题全对（含组字「日+月」提交）→ 结算「总分 50 · 首次答对 5/5 · 答错 0」；记录恰 1 条；无横向溢出、无 JS 错误 |
| V2 | 答错重试 + 暂停→刷新→恢复 | 第 1 题故意答错（✗ 再想一想）再答对得 5 分档；第 2 题暂停→刷新→恢复后题面/选项/得分逐项一致（`hanzi-v2-*`） |
| V3 | 续局结算与记录幂等 | 第二局「总分 45 · 首次答对 4/5 · 答错 1 次」（5+10×4）；记录 2 条、局次 ID 幂等、中断快照清除 |
| V4 | 窄屏 390×844 | 选择屏单屏完整（未开放年级禁用置灰）、配对题太阳配图清晰、字卡触摸目标充足、无溢出（`hanzi-v4-*`） |
| V5 | 离线断源刷新 | SW 受控后 kill 服务 → 刷新：页面由缓存完整启动、离线开局正常（第 1/5 题「找出『目』字」，`hanzi-v5-*`）；`/hanzi.html` 导航回退修复后通过 |

截图目视核对（7 张 V1–V3 + 3 张 V4 + 3 张 V5）：选择屏年级态、题面/配图、答错反馈、暂停遮罩、结算卡、离线提示均清晰可读；单选题不再显示「提交答案」按钮。

## 验证中发现并修复的缺陷

1. **SW 导航回退缺 `/hanzi.html`**：原逻辑仅 `/` 回退缓存入口，hanzi 页离线刷新落兜底页（`hanzi-v5-02` 首轮截图即失败现场）。修复为双入口 `ignoreSearch` 匹配后通过。
2. **CSS `[hidden]` 被 flex/grid 覆盖（4 处）**：`.boot-fail`、`.pause-overlay`、`.question-image`、`.parts-submit` 的 `display:flex/block` 覆盖了 `hidden` 属性的 UA `display:none`——boot-fail 横幅常显、暂停遮罩残留在结算屏、shape 题残留上一题配图（碎图标）、单选题显示提交按钮。全部补 `[hidden] { display: none; }`。
3. **答错反馈被清**：`renderGame()` 无条件隐藏反馈条，答错「再想一想」一闪即逝。改为 `renderGame(questionChanged)`——同题重渲染（答错、勾选部件）保留反馈，换题才清除。
4. **配图路径 404**：内容数据 image 带 `web/` 前缀，serve 根目录已挂 web/ 内容（实际路径 `/img/...`）。修正内容路径前缀。
5. **结算残留暂停遮罩**：局内页面后台化自动暂停后若直接结算，遮罩未关。结算时显式关闭。
6. 首跑发现的 `boot()` 未调用（页面不初始化）、`btn-start` 接线在重构中丢失，均为实现期缺陷，修复后由 V1–V3 覆盖。

## 已知限制与未验证项

1. **真实设备未验证**：本轮全部证据来自桌面无头 Chrome 模拟；iOS Safari / Android Chrome 的 hanzi 页面验证未执行（可在数字消除同套模拟器方法上补做）。
2. **首页未接入游戏选择**：汉字勇者入口为 `web/hanzi.html` 独立页面（SW 预缓存内可达），正式首页导航待接入；接入时需回归数字消除全部入口与离线缓存清单。
3. **生产部署未验证**：未推送；Cloudflare Pages 部署后的 SW 更新、离线与 MIME 待部署后按 M7 方法验证。
4. **教学有效性未验证**：28 题为代理内容审核（题意/正确性/适配性），学生可读性、图文认知效果、组字教学价值需教师/学生实测；审核记录已声明撤回条件（图示混淆即撤出）。
5. **抽题覆盖为随机抽样**：V1–V3 每局 5 题（约 3 局 ×5 = 15 题次），未穷举全部 28 题；全部任务已由 `tests/hanzi-hero.test.mjs`「自身答案判对」与窄路径测试覆盖判题面。
6. 验证脚本 `docs/evidence/m8/hanzi-browser.mjs` 依赖本机 Chrome/CDP 与本地 serve，不直接重放；断言含时序等待（轮询），在更慢环境可能需放宽超时。
