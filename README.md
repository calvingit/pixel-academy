# Pixel Academy

复古掌机风格学习游戏项目。第一阶段交付「数字消除」H5 游戏（里程碑 M1–M6 已完成，M7 验收受阻于真机验证缺口，详见 [PLAN.md](PLAN.md)）：一、二年级数学练习、年级选择、点选作答与消除、单局结算、本地记录与中断恢复、缓存后离线运行。第一阶段只覆盖以下实际已交付内容，不宣称 36 册教材或语文、英语、数学三科全部上线。

## 运行与验收入口

需要 Node.js 22+ 和 npm。在仓库根目录执行：

```sh
npm ci           # 按锁文件干净安装（唯一 devDependency：typescript）
npm run check    # 严格类型检查 + 编译 + node --test 单元测试
npm run build    # 生产构建：tsc 编译到 dist/，并生成离线 Service Worker web/sw.js（版本 assets-v1-*）
npm run serve    # 先构建，再用 Node 内置 http 启动本地服务：http://127.0.0.1:4173/
```

`npm run serve` 是当前的**验收入口**：构建生产产物并在本机启动，浏览器打开 `http://127.0.0.1:4173/` 即可游玩。正式对外部署位置尚未确认（见 PLAN.md M7「部署待确认」）；部署时需选择支持 Service Worker 的 HTTPS 或 localhost 环境。无运行时依赖；页面以原生 ES 模块加载编译产物。

持续集成：`.github/workflows/check.yml` 在 push 与 pull request 时执行 `npm ci` + `npm run check`（与本地同一命令）。

## 支持内容

- 游戏：数字消除（number-puzzle）一款。玩法规则见[玩法说明](docs/gameplay-number-puzzle.md)。
- 题库：数字消除使用本地规则生成——一年级 68 道候选（认数、10 以内加法、5 以内减法），二年级 36,775 道候选（100 以内两步加减、乘法点阵），每局 10 题；混选一二年级各 5 题。优先避开上一局题目，局内不重复；仍只用 `selectExercises()` 筛选的 approved 候选。
- 年级：任意单选或多选一至六年级。三至六年级显示「暂无已审核的数学练习」，不用其他年级内容填补。
- 单局：正式新局 10 题，首答 10 分、重过 5 分；每题限时作答，答错达到次数后开放提醒卡，限时、复活与加时道具消耗金币，结算显示总分、一次通过数、答错次数。旧局次及静态预览保留原题量。
- 本地能力：设置与成绩保存在本机浏览器（上限 100 条）；中断局次刷新后可恢复且不重复计分；可清除本地记录。
- 离线：首次在线访问完成预缓存（入口、样式与全部模块共 20 个资源）后，断网重开可动态出题并完整游玩；版本更新在非单局中途自动采用，进行中的局次不受影响。

## 设备测试覆盖

- 全部浏览器证据来自**桌面无头 Chrome 模拟**（HeadlessChrome 155 / 系统 Chrome 156 headless，经 CDP 驱动；macOS arm64）：移动端为视口与触摸事件模拟（320–430px 窄屏、412×915、横屏、平板、桌面五档）。
- **iOS Safari 与 Android Chrome 真实设备未测**——本工程环境无真机，属 M7 如实记录的汇总缺口，不声称真实设备验收完成。

## 离线前提

- Service Worker 仅在安全上下文注册：`http://127.0.0.1` / `http://localhost` 或 HTTPS 部署。
- 首次访问需联网等待缓存完成；页面提示行显示「离线缓存已就绪（版本 assets-v1-…）」后才承诺离线可玩，未完成前如实提示不承诺。
- 断网判断口径与自愈行为（缓存缺失回退兜底页、恢复后回填）见 [VERIFICATION.md](VERIFICATION.md) 与 [docs/evidence/m6/README.md](docs/evidence/m6/README.md)。

## 已知限制（摘要，完整记录见 [PLAN.md](PLAN.md) M7）

1. 真机（iOS Safari / Android Chrome）未验证；真实部署环境下的 SW 注册/更新/缓存行为未验证（部署位置待确认）。
2. 题库审核为**代理审核**（静态样例 zcode-agent、生成规则 Codex），未经具备教学资质者复核；教材版次对齐、来源核对、地区选用核验均为 pending；乘法点阵的教学有效性需真实学生/教师观察。
3. 音效可听性未经真人试听（无头环境无音频输出，仅验证开关状态机与视觉反馈完整）。
4. 所有教材 ISBN、版次、正式书名保持空值；候选目录只是内容准备线索，不等于可发布练习。

## 题库审核情况

- 18 道练习的逐条审核记录（表述、正确性、适配性、依据与结果，含 3 道乘法题点阵呈现重审）见[首批审核记录](docs/content-review-first-batch.md)。
- 动态生成规则及边界见[生成规则审核](docs/content-review-generation.md)，由 Codex 进行代理工程审核；17 类选择题扩展的规则与候选审核见[题型扩展审核记录](docs/content-review-question-expansion.md)（Codex 代理审核，2026-10-26）。静态样例与原导出 API 保留，用于旧存档兼容及回归。生成规则审核不代表教师评审，二年级点阵仅 5 种组合，连续两局各 4 题时至少重复 3 道。
- 静态样例审核执行者为代理（zcode-agent，2026-10-25），已在记录中标明代理身份；不代表教师、家长或教材专家评审，不能完成的教学核对保持缺口。
- 界面正式入口只走 `selectExercises`；`?preview=candidate` 为显式隔离的候选预览入口（`previewExercises`，含草稿），不读写正式记录、不作为内容不足时的降级。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [PRD.md](PRD.md) | 产品目标、用户场景、范围与功能要求 |
| [PLAN.md](PLAN.md) | M1–M15 里程碑、当前状态与验收条件 |
| [AGENTS.md](AGENTS.md) | 项目协作约束与按需阅读入口 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 本地开发和变更流程 |
| [VERIFICATION.md](VERIFICATION.md) | 当前检查命令、CI 与浏览器验收路径 |
| [架构说明](docs/architecture.md) | 现有代码、数据关系与扩展边界 |
| [内容基准](docs/content-baseline.md) | 当前来源事实与核验缺口 |
| [内容维护流程](docs/content-workflow.md) | 数据修改、审核和来源记录 |
| [视觉与交互规范](docs/design.md) | 复古掌机方向、手机交互与 UI 验收 |
| [数字消除玩法说明](docs/gameplay-number-puzzle.md) | 首款游戏规则、界面文案与实现常量 |
| [端到端验收证据](docs/evidence/m7/README.md) | M7 汇总记录，链接 M3–M6 各轮浏览器证据 |

## 作为数据层使用

```ts
import { selectExercises, previewExercises, evaluateAnswer } from './src/index.js';

const query = {
  subject: 'math' as const,
  grades: [1, 2] as const,
  gameId: 'number-puzzle',
};

const published = selectExercises(query); // 18 道 approved：一年级 12 道、二年级 6 道
const candidates = previewExercises(query); // 同一集合；新增草稿时计入候选，仅用于显式预览入口
const correct = evaluateAnswer(candidates[0]!.task, '0');
```

编译后 JavaScript 使用者从 `dist/index.js` 导入。筛选按教材关联取得年级，选择 `[2]` 不混入一年级，选择 `[4]` 返回空数组，空年级列表或非法年级抛出异常。结果保持内容文件顺序，不随机取题、不重复条目。`previewExercises` 包含草稿和已审核内容，不能用于正式游戏取题；页面正式入口只走 `selectExercises`。

目录录入依据是用户提供的研究交接，未重新访问教材原件。剩余 32 册与后续游戏按 [PLAN.md](PLAN.md) 里程碑推进（M8–M15 为暂缓的后续规划）。
