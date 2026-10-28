# M11 几何建筑师验证记录

状态：**完成认定收口**（2026-10-28）。首版（立体图形辨认/分类/搭建三模式 + 图形判题模型 + 18 道代理审核任务 + 六游戏首页导航）完成桌面、Android/iOS 模拟器与生产环境四轮验证，全部通过。

## 内容与审核边界

- 题库：`src/content/geometry-exercises.ts`，18 道任务（辨认 6：MA-G-001–006；分类 6：MA-G-007–012；搭建 6：MA-G-013–018），全部 approved（代理审核 zcode-agent，2026-10-28T12:00:00Z），映射 MAP-030（`math.geometry.solids` → MA-01A-U05「有趣的立体图形」候选映射，sourceVerification/curriculumVerification 均 pending）。
- 配图：6 张原创等轴测 SVG（`web/img/geometry-builder/*.svg`），随构建交付并登记 SW 预缓存。
- 审核记录：[content-review-geometry-builder.md](../../content-review-geometry-builder.md)；审核局限（教学适宜性未经真人复核、渲染图辨识度未经真实学生确认、映射核验 pending）如实记录，撤回条件在案。
- 玩法规则：[gameplay-geometry-builder.md](../../gameplay-geometry-builder.md)。

## 自动化检查

- `npm run check`（typecheck + 生产构建 + node --test）：**228 项测试全部通过**（shapes 13 + geometry-builder 17 + 既有 198）。覆盖：判题矩阵与等价解集合逐成员、结构校验非法清单（死区/死槽/身份越界/路径越权）、组卷配额轮转与避重、多种子洗牌分布、计分档、快照不变式与篡改拒绝、63 种年级组合、六入口离线清单断言。
- 实施过程中由浏览器走局发现并修复三个真实缺陷（均有规则层回归测试）：① 拖拽 pointerdown 无条件 preventDefault 吞掉点选路径的 click（改为位移超 8px 阈值才启动拖拽）；② build 点选放置的 acceptable 按语义序 zones 下标取集合，呈现序洗牌后错位（改为按呈现槽位 zones 取）；③ 同形状多块的剩余计数按「形状是否出现过」跳过，第二块被误判已占用（改为总数−已放数逐块消耗）。

## 桌面浏览器轮（实现者自验 + 验收场景，无头 Chrome 156，CDP 真实鼠标事件）

- 窄路径冒烟（[geometry-smoke.mjs](geometry-smoke.mjs)，[results-smoke.json](results-smoke.json)）：G1–G6 全过（入口打开、选年级开局、完整一局 50 分、记录入库、刷新恢复布局一致、SVG 加载）。
- 验收轮（[geometry-acceptance.mjs](geometry-acceptance.mjs)，[results-acceptance.json](results-acceptance.json)）：V1–V10 共 8 场景全过——
  - V1 年级筛选（未开放年级禁用 5 卡、开始禁用）、V2 完整局 50 分（点选路径，records=1）、V3 辨认错误反馈与重试档（「不对哦，再想一想」+5）、V4 分类错块反馈（「第 N 块放错了格子」）撤回重排再提交入重试档、V5 搭建等价多解与干扰块**鼠标拖拽拒收**（accept 集合两积木均完成）、V7 视口五档（320×568 / 390 / 412×915 / 568×320 横屏 / 1280×800）零横向溢出、触摸目标 ≥44px、V8 刷新恢复布局与洗牌排列一致、V10 首页导航与六入口（hanzi/dungeon/pinyin/english/geometry）全部 boot 正常。页面错误 0。
  - 截图：v1/v2/v3/v4/v5/v7×5/v8/v10（本目录）。

## 模拟器轮（[device-simulators/](device-simulators/)，真机豁免口径下的最终验收）

- **Android Chrome 113 模拟器**（Android 14，CDP `Input.dispatchTouchEvent` 真实触摸；412×790，origin 经 adb reverse）：[geometry-android-round.mjs](device-simulators/geometry-android-round.mjs)
  - 在线 3 场景全过：首页菜单第六入口进入、完整局（**触摸拖拽手势放置成功**、第 1 题答错纠正入重试档、总分 45、记录 gameId=geometry-builder 且 drags=1、模式分列）、返回路径与菜单入口并存（含 geometry 链接）。全程零溢出零错误。
  - 离线 1 场景：SW 就绪（缓存 142 条含 6 张配图）→ 杀 serve 4273 → 刷新由缓存打开 → 菜单进 /geometry.html → 断网完整局 50 分、配图断网加载、记录入库。
  - 结果：[online-results.json](device-simulators/online-results.json)、[offline-results.json](device-simulators/offline-results.json)；截图 S1-*/S2-*/S3-*/android-offline-*。
- **iOS Safari 18.6 模拟器**（iPhone 16 Pro，UDID 28F2F0F0…，safaridriver 26.6.2；UA 含 iPhone 确认非桌面回退）：[geometry-ios-round.mjs](device-simulators/geometry-ios-round.mjs)
  - 在线 3 场景全过：辨认错误反馈、完整局（总分 45、模式分列、记录入库）、返回路径与六入口并存。
  - 离线 1 场景：SW 就绪（配图 6 张）→ 杀 serve 4373 → Safari 刷新（非冷导航，WebKit 口径）→ /geometry.html 由缓存打开 → 题库模块断网 import 18 任务 → 断网完整局 50 分。
  - iOS 输入口径与 M3–M10 相同：页面级合成事件（el.click()），拖拽路径属 pointermove 手势、合成输入不完整，故 iOS 轮验证点选路径；拖拽路径由 Android 轮真实触摸验证成立。
  - 结果：[online-results.json](device-simulators/online-results.json)、[offline-results.json](device-simulators/offline-results.json)；截图 ios-online-*/ios-offline-*。

## 生产环境轮（[production/](production/)，Cloudflare Pages https://pixel-academy.pages.dev）

- 部署：main 推送（45aa512 及之前提交链）自动构建，版本 `assets-v1-525bbb0f452d`（142 资源预缓存，含 /geometry.html、/geometry.css、6 张配图与 dist 闭包）。
- [geometry-prod-smoke.mjs](production/geometry-prod-smoke.mjs) 4 场景全过：P1 首页菜单第六入口（在线）、P2 生产完整局 50 分、P3 离线完整局（CDP 网络层断源 → 刷新由缓存打开 → 缓存打开 /geometry.html → 断网 50 分、配图离线加载）、P4 无扩展名路径 `/geometry` 兜底（**Pages 308 规范化 + SW redirected re-wrap 口径回归成立**，M8 修复口径）。全程零溢出零错误。
- 结果：[geometry-prod-results.json](production/geometry-prod-results.json)；截图 p1/p2/p3/p4（production 目录）。

## 已知限制（不阻塞完成认定，如实记录）

1. **教学适宜性与图形可辨性未经真人复核**（代理审核；渲染图辨识度仅代理目视 + 桌面截图核对，未经真实学生/教师确认）；MAP-030 与 MA-01A-U05 的来源核对、地区选用与映射核验均 pending，approved 不宣称教材版次对齐。
2. iOS 拖拽路径未验证（safaridriver 合成输入不完整，同 M3–M10 口径）；点选路径 iOS 已验，拖拽路径由 Android 真实触摸验证。
3. 物理真机未测（2026-10-28 裁决豁免，模拟器口径即最终验收）。
4. 生产环境版本更新自动采用未以真实内容变更演练（既有持续缺口，机制与五款已交付游戏同代码）。
5. 长方体/正方体在 320px 窄屏的形近辨认（两者都是四棱柱）依赖三面比例差异，桌面截图核对可辨；教学难度分级（哪些年级可区分）未经教师确认。
