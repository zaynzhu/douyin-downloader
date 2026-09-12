# 项目文档索引

本目录存放 douyin-downloader（zaynzhu fork）的开发决策文档。读者可能是人类，也可能是接手开发的任意 AI 模型——因此每篇文档都自包含上下文、标注证据强度，并在结尾列出"未验证项"。

## 目录结构

```text
docs/
├── 000-index.md          # 本索引
├── analysis/             # 接手分析与路线图（2026-09-12 快照）
└── superpowers/          # 历次 spec/plan 文档（文档驱动开发流程产物）
```

## analysis/ 当前快照（2026-09-12 接手分析）

| 文档 | 内容 | 用途 |
|---|---|---|
| `analysis/2026-09-12-current-state.md` | 仓库现状全景分析：调用链、模块、存储、API、测试、安全审计、文档失实清单 | 任何任务开始前先读它，避免重复探索 |
| `analysis/2026-09-12-reference-projects.md` | 四个参考项目（F2 / TikTokDownloader / res-downloader / 上游 Douzy）调研，含 License 约束 | 做新功能前查"是否已有成熟方案可借鉴" |
| `analysis/2026-09-12-roadmap.md` | 三阶段路线图，含每条建议的正反辩证、验收标准、触发条件与待用户决策项 | 选择下一步任务、理解"为什么是这个顺序" |
| `analysis/2026-09-12-intake-report.md` | 接手时终端交付报告的原始快照（12 项分析 + 三阶段路线的原始版本） | 追溯当时的原始判断与措辞；维护以另外三份文档为准 |
| `analysis/2026-09-12-desktop-evaluation.md` | 历史桌面评估，原“不做”结论已被后续用户方向取代 | 只作历史取舍背景 |
| `analysis/2026-09-12-desktop-delivery-plan.md` | 当前桌面方向：macOS DMG 优先、Windows EXE 后续，共享前端与 Python 核心的复用边界和验收 | 桌面立项与正式 Web UI 接线前阅读 |
| `design/webui3/README.md` | 合并版原型、B1/B2/B3 处理与实测结果 | 用户视觉评审与 Phase 2 接线交接 |
| `analysis/2026-09-12-webui-design-brief.md` | Web UI 设计任务书：自包含（定位/四页架构/API 契约/交互参考/交付物要求），交给设计方 | 设计交接用；设计产出回来后工程侧据此实现 |
| `analysis/2026-09-12-webui-merge-plan.md` | Web UI 合并实施计划：webui2 为骨架 + webui1 正确性要素（B1 字段搜索 / B2 窄屏修复 / B3 全局态）+ 两阶段落地（webui3 原型 → server/static 接线） | Phase 1/2 执行依据；每项含现状/改法/验收 |
| `analysis/2026-09-12-webui-phase2-handoff.md` | Phase 2 接线交接：工作区半成品盘点（RED 测试/已就位的静态骨架）、T1-T5 任务分解、接线规格与已定决策 | **执行 Phase 2 的入口文档**；自包含。**Phase 2 已完成（2026-09-12）**：T1 静态托管 + T2 app.js 接线 + T3 Playwright e2e（28 项）+ T4 文档均已落地，`server/static/` 即正式产物 |

## 使用约定

1. analysis/ 下的三份文档是 **2026-09-12 时刻的快照**，代码演进后以代码为准；文档中标注 `file:line` 的引用会随时间漂移，引用前请重新定位。
2. 新增重大决策（选型、放弃某方案、架构变更）时，在 analysis/ 下新增一篇 `YYYY-MM-DD-<主题>.md` 或在 roadmap 中追加"变更记录"，不要静默改动旧结论。
3. 文档中不含任何 Cookie、Token、用户数据；提交前仍需检查（见 roadmap 的安全红线节）。
