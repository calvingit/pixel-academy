# Pixel Academy

复古掌机风格学习游戏项目。当前实现 M1–M4：Learning Core 与候选内容基准、首批 18 道 approved 数学练习、数字消除可玩 H5 原型（复古掌机视觉、手机交互、暂停与音效）。本地记录、离线缓存属后续里程碑。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [PRD.md](PRD.md) | 产品目标、用户场景、范围与功能要求 |
| [PLAN.md](PLAN.md) | M1–M15 里程碑、当前状态与验收条件 |
| [AGENTS.md](AGENTS.md) | 项目协作约束与按需阅读入口 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 本地开发和变更流程 |
| [VERIFICATION.md](VERIFICATION.md) | 当前检查命令及未来验收方法 |
| [架构说明](docs/architecture.md) | 现有代码、数据关系与扩展边界 |
| [内容基准](docs/content-baseline.md) | 当前来源事实与核验缺口 |
| [内容维护流程](docs/content-workflow.md) | 数据修改、审核和来源记录 |
| [视觉与交互规范](docs/design.md) | 复古掌机方向、手机交互与 UI 验收 |
| [数字消除玩法说明](docs/gameplay-number-puzzle.md) | 首款游戏规则、界面文案与实现常量 |

## 运行

需要 Node.js 22+ 和 npm。

```sh
npm ci
npm run check   # 严格类型检查、编译及 Node.js 单元测试
npm run serve   # 构建并启动本地静态服务，访问 http://127.0.0.1:4173/ 游玩
```

无运行时依赖；页面以原生 ES 模块加载编译产物。

## 使用

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

## 已有数据

- 36 册逻辑索引：三科 × 六年级 × 上下册。
- 四册候选目录：CH-01A、MA-01A、MA-02A、EN-01A。
- 16 个稳定知识点 ID 和候选教材映射。
- 18 道原创数学练习：一年级 12 道、二年级 6 道，已按[首批审核记录](docs/content-review-first-batch.md)晋级 approved（教材版次对齐与来源核对仍为候选/pending）。
- 数字、二元运算（乘法以点阵图示呈现）、连续加减运算的数据模型与严格整数判题。

目录录入依据是用户提供的研究交接，本轮未重新访问教材原件。所有教材版本、来源核验、地方选用及教学映射均保留待核验状态；ISBN、版次和正式书名保持空值。练习数学正确性经代理审核与自动检查，不代表完成具备教学资质的人工评审。

详见 [内容基准与审核边界](docs/content-baseline.md)。剩余 32 册、后端、本地记录、离线缓存与后续游戏按 [PLAN.md](PLAN.md) 里程碑推进。
