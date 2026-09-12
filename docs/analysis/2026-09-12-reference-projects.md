# 参考项目调研（2026-09-12）

> 目的：实现任何"新"功能前，先查本文档确认哪个成熟项目已经解决过它，避免重复造轮子或从零实现更差的版本。
>
> **调研方法**：仅阅读各项目公开 README 与官方文档入口，未阅读源码。结论以各项目自我宣称为准。
>
> **License 红线**：本项目为 MIT。TikTokDownloader 是 **GPLv3——只允许参考思路，禁止复制其代码**；F2 是 Apache-2.0——可合法借鉴/署名引用；res-downloader 与上游 Douzy 桌面端未以可复用形式开放其 UI 代码。

## 1. 速查表：要什么，看谁

| 我们的缺口 / 待做功能 | 参考谁 | 参考什么 |
|---|---|---|
| ttwid / verify_fp / s_v_web_id 生成器 | F2 | `TokenManager` / `VerifyFpManager` 完整 token 族实现（我们只有 msToken） |
| 请求签名维护 | F2 | 满血 A-Bogus 已开源；`XBogusManager`/`ABogusManager` 双签名管理器模式 |
| 作者改名后目录处理 | F2 / TikTokDownloader | `create_or_rename_user_folder`；"自动更新已下载作品文件名中的昵称和标识" |
| 断点续传 | TikTokDownloader（思路） | "支持文件断点续传下载" |
| 剪贴板监听下载 | TikTokDownloader（思路） | "监听剪贴板链接下载作品" |
| 智能延时/请求节奏 | TikTokDownloader（思路） | 内置智能延时请求机制；我们已有 RateLimiter(2/s) + jitter，可对比参数 |
| 下载记录导出 CSV/XLSX | TikTokDownloader（思路） | SQLite 之外提供 CSV/XLSX 双格式导出 |
| Web API 形态 | TikTokDownloader | FastAPI + 自动 `/docs`，与我们路线一致（我们已有） |
| 直播弹幕 | F2 | `fetch_live_danmaku` / `fetch_live_im` |
| 歌词 json→lrc | F2 | `json_2_lrc` |
| "打开就会用"的产品体验 | res-downloader | 三步操作流（启动→刷页面→点下载）；资源列表即主页 |
| Web UI 页面组织 | 上游 Douzy | 本仓库 `img/desktop/001-006.png` 六张截图（fork 带入的免费素材） |

## 2. F2（Johnserf-Seed/f2，Apache-2.0）

**定位**：PyPI 库 `f2`，多平台（DouYin/TikTok/Twitter/WeiBo，规划 BiliBili/NetEaseMusic）作品下载与接口数据处理的 Python Library，CLI 是库的薄壳。

**架构要点**（可借鉴的设计模式）：

- 每个平台一组 `fetch_*` 接口方法，返回统一过滤器（filter）类型，可 `_to_raw` 转原始接口数据——**数据获取与数据塑形分离**
- ID 提取器族：`SecUserIdFetcher` / `AwemeIdFetcher` / `MixIdFetcher` / `WebCastIdFetcher`——链接解析独立成工具类而非散在各下载器
- `format_file_name` 全局文件名模板 + `create_or_rename_user_folder`——命名与目录治理集中化
- Token 供给完整：`gen_real_msToken` / `gen_ttwid` / `gen_webid` / `gen_verify_fp` / `gen_s_v_web_id` / 直播 signature
- 账号状态标注法：每个功能标注 🟣（需登录，无视自己隐私设置）/ ⚫（游客可见）——我们的文档可借鉴此标注
- 配置三层：主配置 / 初始化配置 / CLI 临时配置覆盖（我们已是四层合并，同构）
- 工程化：pytest + codecov badge + i18n + VitePress 文档站

**与本项目的渊源**：我们的真 msToken 生成依赖的 conf 即来自 F2 仓库的 GitHub raw（`auth/ms_token_manager.py:28`），且已为 GitHub 不可达做了内置快照兜底。

**不照搬的理由**：F2 是重型多平台库，集成成本高；我们只需要它的**单点思路**（token 生成、目录重命名），不需要引入整个依赖。若未来签名体系整体失效，重新评估"依赖 F2 vs 自维护"的成本对比——这是 roadmap 中签名单点风险的备选解。

## 3. TikTokDownloader / DouK-Downloader（JoeanAmier，GPLv3 ⚠️）

**定位**：抖音/TikTok 下载采集领域功能最全的成熟项目之一，终端交互 + Web API + Docker + 预编译可执行文件（cx_Freeze + GitHub Actions）。

**值得研究的功能规划与交互思路**（只能参考思路）：

- 交互细节：Cookie "从剪贴板读取"（已弃用浏览器直读，说明该路径在 OS 权限上不可靠）；程序退出清空临时文件夹；输入回车=返回上级、`Q`=退出
- 数据治理："批量下载账号/合集时若昵称变化，自动更新已下载文件名中的昵称和标识"；"先下载至临时文件夹，完成后移动"
- 运维形态：Fork + Actions 自动构建可执行文件分发给普通用户——若未来想做"非开发者也能用"的分发，这套 CI 产线思路直接可用
- Web API：FastAPI，启动后访问 `:5555/docs` 自动生成接口文档——与我们现有 `--serve` 方案同构，说明方向正确

**重要警示**：

1. **GPLv3**：复制其任何代码会使本仓库整体受 GPL 传染，与 MIT 冲突。**禁止复制，只可学习交互与功能规划。**
2. 其加密参数算法因合规原因**已停止维护**、要求用户自备——印证了"静态复刻签名是持续性负债"，我们 roadmap 中把签名供给链列为长期风险是正确的。
3. 其 Web UI 模式在 6.0 重构后**已废弃**，只留 Web API——"先 API 后 UI"被同行验证；也警示 UI 与核心耦合的代价。

## 4. res-downloader（putyy，Go + Wails）

**定位**：跨平台 GUI 资源嗅探下载器（视频号/小程序/抖音/快手/小红书/音乐），技术路线是本地代理抓包（系统代理 127.0.0.1:8899 + 证书安装），与我们"API 直连"路线根本不同。

**只借鉴产品体验**：

- 零学习成本操作流：启动代理 → 用户正常刷 App/网页 → 回软件看资源列表 → 点下载。**资源列表即主界面**，没有"任务"概念对用户的暴露
- 按资源类型（视频/音频/图片/m3u8/直播流）做筛选 Tab
- 承认下载不是强项，直接推荐 NDM/Motrix 等外部下载器——**专注自己最强的环节**的产品克制
- 失败自愈提示写进 FAQ 首页（抓不到→检查代理；关软件断网→检查系统代理）

**不可借鉴**：代理抓包需要装证书、改系统代理，对我们的抖音 API 直连场景无必要；不要为了它改变下载机制。

## 5. 上游 jiji262/douyin-downloader + Douzy 桌面端

**关系**：本仓库的直接上游；CLI 部分与我们完全同源，上游 README 的能力描述即我们的能力描述。

**上游重心已转向 Douzy 桌面端**（闭源内测，Releases 分发构建）：

- 三平台工作台：Douyin / TikTok / YouTube 各有独立工作台
- 关键页面（截图就在本仓库 `img/desktop/`）：
  - 链接下载工作台（粘贴链接一键开始，自动识别视频/图文/主页/合集）
  - Task Center（任务状态、失败重试、打开输出目录）
  - Following Management（同步关注创作者、筛选新作品、加备注、列表内直接下载）
  - Favorites（浏览当前账号收藏的视频/合集/点赞）
  - Download Archive（本地下载归档、过滤、快速重下）
- 多链接队列、任务进度可视化

**借鉴规则**（用户明确约束）：只参考交互与页面组织，**禁止引入**邀请码/内测资格/会员/License 验证/在线账号等商业化机制；我们的版本保持本地、自用、开源、免费。

**跟踪上游的价值**：上游 CLI 侧仍在活跃维护（msToken、门禁、增量等修复持续产生），定期 rebase/merge 上游 main 能免费获得风控对抗的维护成果。这也是"短期内不要大面积重写核心"的重要论据——重写会切断这条免费维护线。

## 6. 结论

四个项目回答四个不同问题：F2 回答"底层接口怎么组织"，TikTokDownloader 回答"功能还能做到多全、分发怎么做"，res-downloader 回答"产品怎样才算打开就会用"，上游 Douzy 回答"UI 页面怎么摆"。本项目当前阶段的定位（CLI 已成熟、API 待补、UI 未做）决定：现在该消化的是 F2 的单点工具思路和 Douzy 的 UI 蓝图，而不是任何一个项目的整体架构。
