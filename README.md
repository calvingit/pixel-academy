# Pixel Academy

复古掌机风格学习游戏项目。当前实现 M1：Learning Core 与首批候选内容；尚无网页、游戏引擎或可游玩游戏。

## 运行

需要 Node.js 22+ 和 npm。

```sh
npm ci
npm run check
```

`check` 执行严格类型检查、编译及 Node.js 单元测试。无运行时依赖。

## 使用

```ts
import { selectExercises, previewExercises, evaluateAnswer } from './src/index.js';

const query = {
  subject: 'math' as const,
  grades: [1, 2] as const,
  gameId: 'number-puzzle',
};

const published = selectExercises(query); // 当前 []，尚无经过审核的练习
const candidates = previewExercises(query); // 18 道草稿，仅用于内容审核和原型
const correct = evaluateAnswer(candidates[0]!.task, '0');
```

编译后 JavaScript 使用者从 `dist/index.js` 导入。筛选按教材关联取得年级，选择 `[2]` 不混入一年级，选择 `[4]` 返回空数组，空年级列表或非法年级抛出异常。结果保持内容文件顺序，不随机取题、不重复条目。`previewExercises` 包含草稿和已审核内容，不能用于正式游戏取题。

## 已有数据

- 36 册逻辑索引：三科 × 六年级 × 上下册。
- 四册候选目录：CH-01A、MA-01A、MA-02A、EN-01A。
- 16 个稳定知识点 ID 和候选教材映射。
- 18 道原创数学草稿：一年级 12 道、二年级 6 道。
- 数字、二元运算、连续加减运算的数据模型与严格整数判题。

目录录入依据是用户提供的研究交接，本轮未重新访问教材原件。所有教材版本、来源核验、地方选用及教学映射均保留待核验状态；ISBN、版次和正式书名保持空值。练习数学正确性经自动检查，也不代表完成教学审核。

详见 [内容基准与审核边界](docs/content-baseline.md)。剩余 32 册、后端、UI、离线缓存和数字消除游戏后续实施。
