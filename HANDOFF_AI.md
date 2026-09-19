# 执医伴 · AI 交接文档

> **给接手的人 / 下一任 AI**：读完这份，你就能维护前端、后端函数、人设、部署，并知道哪些地方不能乱动。
> 最后更新：2026-09-08　版本：v1.0.0

---

## 0. 一句话概况

执业医（中医）备考的 AI 陪伴自习台：**打卡 + 大纲 1025 细目轮次进度 + 热力日历 + 6 位医学主题 AI 角色陪聊/出题**。
部署在 Netlify，数据存 Blobs，AI 用智谱 GLM；顺带跨站读取海贼王运动台的真实运动数据，让 AI 同时关心学习和运动。

---

## 1. 项目来源：从 onepiece 照搬了什么

**原型项目**：onepiece-sports（海贼王运动台）
- 本地：`D:\todo代码写长一点不然真的很难找\俺写的小代码 学习项目无关\onepiece-sports`
- 线上：https://onepieceai.netlify.app

**照搬（机制，100% 沿用）**：
1. 人设「三件套」：`system` / `user` / `fallback`，集中在单一文件 `crew-data.js`
2. **【防脱题指令】4 条固定结构**：保持角色 / 不懂就按角色口吻说不装懂 / 禁"根据资料显示"等机械措辞 / 每次回答前默念角色信条
3. 按日期轮换角色出场
4. 技术栈：Netlify Functions + Blobs + 智谱 `glm-4-flash`
5. 定时提醒 → 企业微信群机器人

**改造（内容）**：
- 角色：9 位海贼王船员 → **6 位医学主题角色**（张仲景 / 李时珍 / 华佗 / 孙思邈 / 小苓 / 导师）
- 新增：大纲细目轮次进度（1025 条）
- 新增：AI 出题考你（`mode=quiz`）
- 新增：AI 自动读取学习进度 + 运动数据作为上下文注入

---

## 2. 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | 单页 `index.html` + `app.js`（无框架、零构建） |
| 后端 | Netlify Functions（Node CommonJS，esbuild 打包） |
| 存储 | Netlify Blobs（store `study-data`，key `main`） |
| AI | 智谱 open.bigmodel.cn，模型 `glm-4-flash` |
| 部署 | Netlify（`publish="."`、`functions="netlify/functions"`） |
| 提醒 | cron-job.org 定时触发 `/remind` → 企业微信群机器人 |
| 大纲数据 | 静态 `outline.json`（336KB，2025 版执业医大纲） |

---

## 3. 目录结构

| 路径 | 作用 |
| --- | --- |
| `index.html` | 全部样式 + 页面结构（6 个 page：今日/大纲/刷题/日历/陪伴/设置） |
| `app.js` | 前端全部逻辑（数据层、渲染、刷题、AI 聊天、出题） |
| `outline.json` | 2025 版执业医大纲，1025 细目（理论 842 + 技能 183） |
| `data/questions/questions.json` | **题库**，7284 题 / 3.1MB，前端懒加载（进刷题页才请求） |
| `tools/fetch_tcmle.py` | 题库下载 + 清洗 + 去重 → `questions.json`（来源见下，脚本带缓存） |
| `netlify.toml` | 构建与响应头配置 |
| `package.json` | 依赖 `@netlify/blobs` |
| `netlify/functions/crew-data.js` | **7 位医学角色人设的唯一来源** |
| `netlify/functions/chat.js` | AI 聊天代理（含出题模式、注入学习+运动上下文、访客模式、频率限制） |
| `netlify/functions/study.js` | 学习数据读写（打卡/轮次/考试日期/聊天记忆），按身份码分片 |
| `netlify/functions/remind.js` | 每日提醒：AI 生成 + 企微推送 |
| `netlify/functions/lectures.js` | 讲稿检索（bigram 打分，自适应门槛） |
| `data/lectures/haowanshan.json` | 郝万山讲稿切段结果（2256 段 / 70 万字 / 2.2MB），构建期 require 进函数包 |
| `data/lectures/raw/haowanshan_raw.md` | 讲稿**原文**（幕布导出 md，2.1MB）。保留它才能重建 json |
| `tools/build_lecture.py` | 讲稿 → 切段 json（支持 .md 与 .txt） |
| `HANDOFF_AI.md` | 本文件（给 AI 的交接文档） |
| `使用说明.md` | 给使用者（麦冬）的保姆级说明书 |
| `双击启动.bat` | 本地预览一键启动（本机起 `python -m http.server 8765` 并打开浏览器） |

> **本地怎么打开（重要，别踩坑）**：
> 直接双击 `index.html`（`file://` 协议）会导致 `fetch("outline.json")` 被浏览器安全策略拦截，页面停在「大纲加载失败」。
> 必须走 HTTP：**双击 `双击启动.bat`** → 访问 `http://127.0.0.1:8765/index.html`。
> 本地模式下 `/.netlify/functions/*` 不存在，`loadData()` 会自动降级到 `localStorage`（这是设计好的兜底，不用改）。

---

## 4. 数据模型

### 4.0 多用户隔离（v1.2.0 起）

Blobs store `study-data`，**key 按身份码分片**：

| 情况 | key |
|---|---|
| 带身份码（`?u=xxx` / `body.uid`） | `u:xxx` |
| 无身份码（老数据、裸链接兼容） | `main` |

```
u:maidong   -> 主人的数据
u:小明       -> 朋友 A 的独立空间
u:xxxxxx    -> 访客随机分配的空间
main        -> 兜底/兼容
```

身份码在后端 `sanitizeUid()` 里强制清洗：只保留 `字母 数字 中文 _ -`，最长 24 字符。
**这步不能省**——它同时挡住了路径穿越（`a/b/../evil` → `abevil`）。

访客模式（`uid` 存在且 ≠ `maidong`）时，`chat.js` 会：
- 不注入运动数据（不泄露主人的 onepiece 记录）
- 在 system 末尾追加「访客模式」指令：不许叫「麦冬」、不许提私人经历、不许给确定性医疗建议

前端身份解析顺序：`?u=` 参数（并写入 localStorage）→ localStorage `study_uid` → 随机生成。
所以**裸链接给朋友是安全的**：他首次打开会被随机分配独立空间。

### 4.1 单份数据结构

```json
{
  "checkins": ["2026-09-08", "2026-09-09"],
  "checkedItems": { "tp1>ts1>tu1>ti1": 2, "sk1>sk1-1": 1 },
  "examDate": "2027-08-20",
  "chats": { "张仲景": [{ "role": "user", "content": "..." }] },
  "quiz": { "12": { "a": "B", "ok": false, "t": 1758260000000 } }
}
```

- `checkins`：打卡日期数组（`YYYY-MM-DD`，北京时间）
- `checkedItems`：**细目 key → 轮次**（1/2/3…，归零时删除该键）。key 是层级路径，**见第 9 节坑①（最重要）**
- `examDate`：目标笔试日期（可为 null）
- `chats`：按角色存最近 30 条聊天（记忆上云，跨设备连续）
- `quiz`：答题记录。**key 是题目的 `i`（题库里的序号）**，值 `{ a: 你选的, ok: 是否答对, t: 时间戳 }`。
  由 `app.js` 的 `quizRec()` 读写，随 `saveAll` 一起上云，所以错题本跨设备连续。
  ⚠️ 改题库后若题序变了，旧记录会对不上号 —— **见第 9 节坑⑩**

### 4.2 题库数据（v1.4.0 起）

**来源**：开源数据集 `Bolin97/TCMLE`（HuggingFace，**Apache-2.0**，可商用需署名）
本地镜像 `hf-mirror.com` 可直连，`tools/fetch_tcmle.py` 一键重建（自带 raw 缓存）。

结构（`data/questions/questions.json`）：

```json
{ "meta": { "total": 7284, "codes": {...}, "caveat": "..." },
  "questions": [
    { "i": 1, "l": "L", "k": "C", "y": 1, "s": "P",
      "q": "疠气致病多为", "o": ["伏而后发","徐发","继发","感邪即发","复发"],
      "a": "D", "r": "感邪即发，又称为卒发、顿发……" }
  ] }
```

字段是**短码**以压缩体积（4.4MB → 3.1MB，gzip 传输 1.06MB），映射表在 `meta.codes`：

| 字段 | 含义 | 值 |
|---|---|---|
| `i` | 题目唯一序号（答题记录的 key） | 1…7284 |
| `l` | 类别 | `L` 执业医师 / `A` 助理医师 |
| `k` | 题型 | `C` 基础概念 / `T` 理论 / `D` 分析诊断 |
| `y` | 年份 | 1…5（**数据集内部匿名编号，不对应真实年份**） |
| `s` | 来源 | `P` 历年真题 / `M` 模拟题 |
| `q` | 题干 | |
| `o` | 选项，固定 5 个 | 下标 0–4 对应 A–E |
| `a` | 正确答案 | `A`–`E` |
| `r` | 解析（可能为空/被截断） | |

构成：执业医师 4772（真题 2413 + 模拟 2359）、助理医师 2512。

⚠️ **数据质量上限，改动前必须知道**：
- **46.8% 的解析疑似被截断**（末尾戛然而止），5% 无解析 —— 前端会对这类加「可能不完整」标注
- 数据集存在 OCR 缺字（如「烈的情绪变化」缺「剧」），**答案不能当临床依据**
- 这不是完整版历年真题，只是公开能拿到的子集

---

## 5. 接口清单

> 所有接口都支持身份隔离：GET 用 `?u=xxx`，POST 用 `body.uid`。不传则落到 `main`。

### `GET /.netlify/functions/study`
返回 `{ ok, data }`（整份学习数据）

### `POST /.netlify/functions/study`
按 `body.action` 分发：

| action | 参数 | 说明 |
| --- | --- | --- |
| `saveAll` | `data` | **前端主用**，整份覆盖写入 |
| `checkin` | — | 打卡今天（后端按北京时间去重） |
| `cycle` | `itemId`, `delta` | 轮次增减（delta<0 减，0 清零，上限 999） |
| `setExam` | `date` | 设置目标考试日期 |
| `saveChats` | `crew`, `messages` | 聊天记忆上云（截断 30 条） |
| `reset` | — | 清空全部数据 |

### `POST /.netlify/functions/chat`
- 请求：`{ crew, messages, mode }`
- `mode`：`chat`（普通陪聊）／ `quiz`（出题考你）
- 后端自动注入：角色 `system` + **学习进度摘要** + **onepiece 运动数据**
- 返回：`{ reply }`

### `GET /.netlify/functions/remind`
- 由 cron-job.org 每天 07:00 / 13:00（Asia/Shanghai）触发
- 按日期轮换角色 → AI 生成提醒 → 推企业微信；AI 失败自动用 `crew-data.js` 里的 `fallback` 兜底
- 手动测试会真实发消息并消耗一次智谱调用

---

## 6. 人设机制（最重要）

- **唯一来源**：`netlify/functions/crew-data.js`
- 每个角色字段：`name` / `emoji` / `system` / `user` / `fallback`
- `system` 内部结构固定：
  【性格内核】【说话方式】【绝对不会做的事】【和麦冬的关系】【经典台词参考】【回复规则】【防脱题指令】
- **改人设只动这一个文件**，不要在 `chat.js` 里硬编码人设
- ⚠️ 前端 `app.js` 里另有一份 `CREW_UI`（仅 name/emoji/tag，用于角色卡片展示）——**改角色名单时两边都要同步**

---

## 7. 环境变量（Netlify 后台配置）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ZHIPU_API_KEY` | ✅ | 智谱 API Key（聊天、出题、提醒都靠它） |
| `WECOM_WEBHOOK_URL` | 选填 | 企业微信群机器人地址；不配则提醒推送失败，其余功能不受影响 |

改完环境变量**必须重新 Deploy** 才生效。

---

## 8. 部署与验证

**GitHub 仓库**：https://github.com/yidaoyi/study-ai （**public**，GitHub 账号 `yidaoyi`，默认分支 `main`）
克隆地址：`git@github.com:yidaoyi/study-ai.git`
本机已有 git 仓库（`.git` 在 `study-ai/` 下），SSH key 已配好，推：`git push origin master:main`

> ⚠️ 本仓库由**主人在 GitHub 网页手动创建**（GitHub MCP 无建库权限，`create_repository` 返回 403）。
> 若以后要新建仓库，别再试 MCP，直接让主人到 github.com/new 建空仓库（**不要勾 README**），再推。
>
> ⚠️ **推送踩坑**：本机 git 走 ssh 时偶尔报 `Host key verification failed`（ssh 与 git 用的 known_hosts 不一致）。
> 已在**本仓库**写入 `git config --local core.sshCommand "ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/c/Users/麦冬/.ssh/known_hosts"`，
> 以后在本目录直接 `git push` 即可；换机器/重建仓库要重新设一次。

1. 把 `study-ai` 整个目录推到 GitHub 仓库（或 Netlify 拖拽上传）
2. Netlify 新建站点，`build command` = `npm install`，其余读 `netlify.toml`
3. Site settings → Environment variables → 配 `ZHIPU_API_KEY`（和可选的 `WECOM_WEBHOOK_URL`）
4. 等 1–2 分钟构建完成，打开站点
5. 自测地址：
   - 数据：`https://<你的站>/.netlify/functions/study`
   - 页面：点「我来了」会变「今天来过啦 ✓」；陪伴页跟角色说话能收到回复
6. 回退用 `git revert`，**不要 `git push --force`**

---

## 9. 已知坑（务必看）

### ① 细目 key 必须全局唯一（已修，2026-09-08）⚠️ 最重要
原 `outline.json` 里 `item.id` 在**每个 unit / skill block 内都从 1 重新编号**。
实测：1025 个细目里只有 **208 个唯一 id，817 条重复**（例如 `ti1` 在几十个单元里都叫 `ti1`）。

若直接用 `item.id` 当 key：**勾选一个细目会连带勾掉其他单元的同名细目，进度统计完全错误**。

解决：`app.js` 用层级路径拼全局唯一 key——
- 理论：`part.id > subject.id > unit.id > item.id`（见 `theoryKey`）
- 技能：`block.id > item.id`（见 `skillKey`）

修复后实测 1025/1025 唯一、0 重复。
👉 **以后任何读写 `checkedItems` 的新代码，都必须沿用这套 key 规则。**

### ② Blobs 初始化
Lambda 兼容模式下，使用 `@netlify/blobs` 前必须先 `connectLambda(event)`，否则报
`The environment has not been configured to use Netlify Blobs`。三个用到存储的函数已写好，别删。

### ③ 单用户、接口无鉴权
`/chat` 公开可调、会消耗智谱额度；被盗刷就加校验。目前靠"网址不公开"保护。

### ④ 本地打开时 AI 不可用（正常）
直接 `file://` 或本地 http.server 打开时，`/.netlify/functions/` 不存在。
`app.js` 已做降级：数据落 localStorage、页面照常可点，AI 对话提示"连接失败"。部署后即恢复。

### ⑤ outline.json 是静态文件
更新大纲就替换它，结构必须保持：`meta` / `skills[].items[]` / `theory.parts[].subjects[].units[].items[]`。

### ⑥ 密钥不入库
`ZHIPU_API_KEY` 只放 Netlify 环境变量，仓库里没有任何密钥。

### ⑦ 大纲原型的遗留问题
原「来都来了」单机版同样存在坑①（id 重复），因其进度数据几乎为空而未被发现。本台已修，旧项目未动。

### ⑧ git push 报 `Permission denied (publickey)`（2026-09-17 复现过）
**症状**：明明 `~/.ssh/id_rsa` 在、`known_hosts` 也对，却报
`git@github.com: Permission denied (publickey)`，`ssh -vT` 里**看不到 `Offering public key`**。
**根因**：ssh 没主动提供私钥（ssh-agent 会话掉了 / 默认 IdentityFile 没匹配上）。
**解法（已写入仓库级配置，换机器要重设）**：
```
git config --local core.sshCommand "ssh -i /c/Users/麦冬/.ssh/id_rsa -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/c/Users/麦冬/.ssh/known_hosts"
```
之后直接 `git push origin master:main` 即可。

### ⑨ 讲稿检索的打分不能照搬小样本调出来的阈值
`minScore` 是**跟语料规模强相关**的：只有 12 段时 0.3 合适，2256 段时闲聊也能拿 0.87 分。
换讲稿、扩语料后**必须重跑一遍「专业提问 vs 闲聊」对比**，别沿用旧阈值。
（当前实现已改为随查询长度自适应：<6 字 0.85 / ≥6 字 0.6）

### ⑩ 答题记录用题号 `i` 当 key，题库一旦重排就会错位
`data.quiz` 的 key 是题目的 `i`（1…7284 的序号），不是题目内容。
**如果重新生成题库导致顺序变化，旧记录会挂到别的题上**（表现：明明没做过的题显示已答、错题本错乱）。

要动题库时三选一：
1. 只做**追加**（新题排在末尾，旧 `i` 不变）—— 最安全
2. 给题目加内容哈希做 key（改造量大）
3. 接受重置，让用户手动清一次答题记录

**当前 `fetch_tcmle.py` 每次都会重排**（下载顺序 + 去重），所以重跑脚本 = 答题记录失效。
只在需要更新题库时才跑，别随手重跑。

### ⑪ 题库 3.1MB，别搬进 Netlify 函数
`questions.json` 是**静态资源**，前端 `fetch` 加载，不进函数包。
Netlify 函数有打包体积限制（50MB），讲稿 2.2MB 已经进去了，题库再塞进去风险大。
刷题逻辑全在前端，后端没有题库接口 —— 这是有意的。

---

## 10. 与 onepiece 运动台的关系

- 本台通过 `GET https://onepieceai.netlify.app/.netlify/functions/stats` 读运动数据（该接口公开、CORS 已放开），喂给 AI 做上下文
- 两个站点**相互独立、各自部署**，只通过这个 URL 单向读取
- 若 onepiece 站点改名或下线，`chat.js` 与 `remind.js` 里的 `ONEMIECE_STATS_URL` 要一起改
- 本台**不写**运动数据，运动记录仍由 onepiece 自己维护

---

## 11. 改动约定（请遵守）

- 改人设 / 台词 → 只动 `crew-data.js`（涉及角色名单时同步 `app.js` 的 `CREW_UI`）
- 改界面 / 交互 → `index.html`（样式+DOM）+ `app.js`（逻辑）
- 改数据结构 → 同时看 `study.js` 与 `app.js`
- 改完 → **在本文件末尾「版本变更记录」追加一条**，不要另开新文档
- 改人设后若想验证，直接部署后到陪伴页对话即可（无构建）

---

## 12. 版本变更记录

### v1.4.0（2026-09-19）新增刷题模块（7284 题）

- **数据源**：开源数据集 `Bolin97/TCMLE`（HuggingFace，Apache-2.0）。
  构成：执业医师 4772（真题 2413 / 模拟 2359）+ 助理医师 2512，去重后 7284 题。
- **新增 `tools/fetch_tcmle.py`**：下载 → 清洗 → 去重 → 紧凑编码，输出 3.1MB。
  原始分片（38 个文件）已加进 `.gitignore`，需要时重跑脚本即可（自带缓存）。
- **新增「刷题」页**（第 3 个导航项，在大纲与打卡日历之间）：
  - 筛选：类别 / 来源 / 年份 / 题型 / 顺序（顺序·乱序）/ 只刷（全部·错题·没做过的）
  - 点选项即时判分，正确答案标绿、你的错选标红，展开解析
  - 解析疑似被截断时自动追加「（这条解析可能不完整）」标注
  - 答完 900ms 自动跳下一题；已答过的题再次点选**不改判**
  - 翻页保留作答状态
- **答题记录上云**：`data.quiz = { 题号: { a, ok, t } }`，随 `saveAll` 走，跨设备连续
- **题库懒加载**：只在首次进入刷题页时 `fetch`，不拖慢首屏
- 测试：`node --check` 通过；jsdom 冒烟 0 错误，判分一致性 / 标色 / 防改判 / 翻页 / 错题筛选 5 项全通过
- 文档：新增 4.2 题库数据结构节、坑⑩⑪

> 未做（有意留白）：科目/章节分类、收藏夹、正确率统计、背题模式、AI 讲题。
> 科目标签曾做过可行性验证（关键词匹配覆盖率 67.8%，但"方剂学"因关键词过泛误标 1519 题，需要更细的规则），暂未上线。

### v1.3.0（2026-09-17）郝万山讲稿入库 + 检索算法修正
- **讲稿入库**：麦冬从幕布导出 md（2.1MB / 1851 行）→ `data/lectures/raw/haowanshan_raw.md`
  - `tools/build_lecture.py` 新增 **Markdown 清洗**（`.md` 自动触发）：去制表符缩进、多级编号 `1. 2.`、加粗 `**`/`__`、
    markdown 链接、转义符 `\.`，并丢弃网盘链接等噪声行
  - 切段结果：**2256 段 / 70 万字 / 平均 311 字 / json 2.2MB**
  - 段数远超原建议的 100~600，但实测性能无虞：require 6ms、单次检索 64~150ms
- **检索算法修正（重要，原算法在大语料下失效）**：
  - 原打分 `hit / sqrt(段长)` 且**单字参与计算** → 70 万字语料下"的/了/我"遍地命中，闲聊也能拿 0.87 分
  - 改为：① 默认**只用二元组**，仅查询 <4 字时兜底单字 ② 打分改 `hit / 查询gram数`（查询被覆盖比例）
    ③ **门槛随查询长度自适应**：<6 字用 0.85，≥6 字用 0.6 ④ 单字查询（<2 字）直接返回空
  - 实测：专业提问 **8/8 命中**（桂枝汤/麻黄汤/小柴胡汤/白虎汤/太阳中风…），闲聊误命中 1/6（"我心情不太好"）
  - 取舍说明：**优先保召回**。漏注入代价（该引用时没引用）> 误注入代价（AI 有判断力，多半不会硬用）
- `chat.js`：不再传死门槛 `minScore=0.3`，改用 `lectures.js` 的自适应门槛

### v1.2.0（2026-09-17）多用户隔离 + 修复 saveAll 崩溃
- **多用户隔离（重要）**：原设计全站共用一份数据（`study-data/main`），把网址发给别人 = 别人能看且能改主人的进度
  - `study.js` / `chat.js` 新增 `sanitizeUid()` + `keyFor()`：key 变为 `u:<身份码>`，无身份码才落 `main`
  - 身份码只允许 `中英文 数字 _ -`，最长 24 字 —— 顺带挡住路径穿越（`a/b/../evil` → `abevil`）
  - 前端 `app.js`：`?u=` 优先 → localStorage `study_uid` → 随机生成。**裸链接给访客 = 自动独立空间**
  - `chat.js` 访客模式（uid ≠ `maidong`）：不注入运动数据 + system 追加「别叫麦冬 / 别提私人经历 / 别给确定性医疗建议」
  - 设置页新增「我的身份」卡片：显示身份码、复制专属链接、切换身份
- **修复真 bug**：`study.js` 的 `saveAll` 分支给 `const data` 重新赋值 → 运行时 TypeError，保存必然失败。已改 `let data`
  （此前「云端保存」一直是坏的，但因为本地 localStorage 兜底，表面看不出来）
- **AI 频率限制**：`chat.js` 新增 `DAILY_GUEST_LIMIT = 40`（访客每天 40 条，主人不限），计数存 Blobs `quota:<uid>:<日期>`
  - 原因：AI 接口无鉴权，网址扩散后别人狂聊会烧掉主人的智谱 key
  - 超限时返回 429 + 中文提示，前端已能显示 `j.error`（原先只显示"没收到回复"）
- 验证：`node --check` 全过；jsdom 冒烟 5 页切换 + 打卡 + 842 细目渲染，0 错误；身份分片 7 组用例通过

### v1.1.0（2026-09-17）新增郝万山角色 + 讲稿检索（RAG-lite）
- **新角色「郝万山」**（🎙️）：口语化、先讲临床故事再落条文、强调抓主证。人设在 `crew-data.js` 末尾，`app.js` 的 `CREW_UI` 同步加了条目
- **讲稿检索 `netlify/functions/lectures.js`**：中文二元组（bigram）重合度打分，**不引入向量库、零额外成本**
  - 数据源 `data/lectures/<讲者>.json`（`require` 进包，构建期内联）
  - 相关性门槛默认 `minScore=0.3`（实测：相关命中 ≈1.0，闲聊 ≈0.09）→ 闲聊不注入讲稿
  - 取 topK=3、总长 ≤1200 字
- `chat.js`：按「最后一条 user 消息」检索，命中则拼进 system，要求"化用而非照抄"
- **切段脚本 `tools/build_lecture.py`**：`python tools/build_lecture.py 原文.txt 郝万山 [--min 120 --max 400]`
  自动合并过短段、切分过长段、过滤页码噪声，目标 100~600 段
- 当前 `haowanshan.json` 仍为空（等麦冬提供讲稿原文），空数组时检索自动跳过，不影响功能
- ⚠️ **版权/隐私提醒**：讲稿会进 GitHub 仓库（当前 public）。若要避免公开，建议把仓库转 Private（Netlify 不受影响）

### v1.0.3（2026-09-17）代码已推送 GitHub
- 仓库 https://github.com/yidaoyi/study-ai 已建立（**public**），14 个文件全部推送到 `main`（3 个 commit）
- 修复本机 git over ssh 的 `Host key verification failed`：写入仓库级 `core.sshCommand`
- 状态：**等待 Netlify 建站 + 配 `ZHIPU_API_KEY`**，尚未部署上线
- 提醒：仓库 public + 站点无登录 ⇒ 任何人拿到网址都能读写那份学习数据（数据无隐私，可接受）

### v1.0.2（2026-09-17）防卡死加固 + 准备部署
- **修复「页面一直显示等待载入」**：所有网络请求加超时（`fetchWithTimeout`：study 4s / chat 30s / outline 15s），请求挂起时不再永久卡在初始文案
- 新增 `online` 状态与 `markOnline/markOffline`，`saveDot` 明确显示「已保存到云端」或「本地模式（未上云）」，不再用模糊的「等待载入…」（初始文案改为「连接中…」）
- `init()` 中 `renderAll()` 包 `try/catch`，单页渲染异常不再导致整页交互瘫痪
- 大纲加载失败文案改为可操作提示（引导用 `双击启动.bat`）
- jsdom 冒烟测试通过：5 个页面切换正常、842 细目渲染、打卡生效、0 运行时错误
- 本地 git 仓库已初始化并提交（2 个 commit），待主人创建 GitHub 空仓库后自动推送

### v1.0.1（2026-09-16）新增本地预览入口
- **新增** `双击启动.bat`：本机一键起静态服务（端口 8765）并自动打开浏览器，供部署前看界面
- **原因**：用户误以为项目已上线，去外网搜索 `study-ai.*` 域名。本项目**截至今日仍未部署**，只存在于本机
- **澄清记录**：`study-ai.me` 等外网同名站点与本仓库**无关**，不得向其提交任何账号/数据
- 已在 `使用说明.md` 前置「二、先在本地打开看看」章节，明确"本地能干啥/不能干啥"；并补一条 FAQ 说明外网同名站不是本人所有
- 本地服务验证：`index.html` / `app.js` / `outline.json` 均 200

---

### v1.0.0（2026-09-08）建站
- 从 onepiece-sports 照搬人设机制（三件套 + 防脱题 4 条 + 轮换），角色替换为 6 位医学主题
- 完成功能：打卡 / 大纲 1025 细目轮次 / 热力日历 / 笔试倒计时 / AI 陪伴（聊天 + 出题考你）/ 定时提醒推企微
- 数据上云：Netlify Blobs（store `study-data`），聊天记忆按角色上云
- 运动数据：跨站读取 onepiece `/stats`，AI 同时关心学习与运动
- **修复**：细目 key 重复导致勾选串位、进度统计错误（1025 条中 817 条重复 id）→ 改用层级路径 key
- **修复**：补齐大纲行尾 −/× 小按钮（`.mini` / `.item-controls`）缺失的样式
- 测试：5 个 JS 文件 `node --check` 通过；DOM id 交叉检查 38/38 命中；本地静态服务 4 个资源均 200

## 13. 项目产物盘点与收尾审视（麦冬要求：项目结束时逐条过一遍）

> 这一节是**给收尾用的**。全部东西按「留 / 删 / 待定」分类，收尾时照着过一遍就行。
> 规则：**只删"不再需要的原件"，不删"能重新生成东西的原料"。**

### 13.1 study-ai（主项目，5.1MB）— 全部保留

| 文件 | 体积 | 处置 | 说明 |
|---|---|---|---|
| `index.html` / `app.js` / `netlify.toml` / `package.json` | 小 | ✅ 保留 | 站点本体 |
| `outline.json` | 336KB | ✅ 保留 | 1025 细目大纲，核心数据 |
| `netlify/functions/*.js`（5 个） | 小 | ✅ 保留 | 后端全部逻辑 |
| `data/lectures/haowanshan.json` | 2.2MB | ✅ 保留 | 检索用，**必需** |
| `data/lectures/raw/haowanshan_raw.md` | 2.1MB | ✅ 保留 | **原料**：删了就得重新导幕布 |
| `tools/build_lecture.py` | 小 | ✅ 保留 | 原料 → json 的唯一工具 |
| `data/questions/questions.json` | 3.1MB | ✅ 保留 | 题库，刷题页直接读 |
| `tools/fetch_tcmle.py` | 小 | ✅ 保留 | 题库的唯一获取途径（**但别随手重跑，见坑⑩**） |
| `HANDOFF_AI.md` / `使用说明.md` | 小 | ✅ 保留 | 交接 + 自用说明 |
| `双击启动.bat` | 小 | ⚠️ 待定 | 只在本地看界面时有用；以后全靠线上版可以删 |

### 13.2 工作区根目录 — 收尾时清

| 文件/目录 | 体积 | 处置 | 理由 |
|---|---|---|---|
| `tools/` | **46MB** | 🗑 **优先删** | 只含 `extract_outline.py` 等一次性脚本 + `node_modules`。大纲已提取完、结果已存进 `study-ai/outline.json`，**原料价值已耗尽**。删前可只留 `extract_outline.py` 一个文件（换新版大纲时可能重用到，约几 KB） |
| `来都来了/` | 4.8MB | 🗑 归档后删 | 被 study-ai 完全取代的旧台子。⚠️ 它的数据（`data/state.json`）里可能有你打过的卡，删前先看一眼要不要导出 |
| `预览图/` | 1.6MB | 🗑 可删 | 旧版截图，纯回忆 |
| `参考_官方大纲全文_2025版.docx` | 1.7MB | ⚠️ 待定 | 大纲的**原始来源**。2025 版用完了；换 2026 版大纲时这份就没用了 |
| `官方大纲_2025版….pdf` | 5.4MB | ⚠️ 待定 | 同上，原件。网盘存一份后可删本地 |
| `参考_WB原版_zhiye-study.html` | 41KB | 🗑 可删 | 原版参考实现，study-ai 已完全超越它 |
| `_screenshot.png` | 155KB | 🗑 可删 | 过程截图 |
| `工作台提示词_执业医AI陪伴版.md` | 18KB | ⚠️ 转存后删 | 给「工作台搭建师」的提示词，**使命已完成**。有纪念/复用价值，建议挪到别处存，别留在项目根目录 |
| `交接手册_HANDOFF.md` | 12KB | ✅ 保留 | 根目录总交接，是「以后改东西先读它」的约定入口 |

### 13.3 云上的东西 — 收尾时确认

| 项 | 位置 | 说明 |
|---|---|---|
| GitHub 仓库 | https://github.com/yidaoyi/study-ai | 当前 **public**（麦冬确认讲稿可公开）。若不希望讲稿公开，转 Private 即可，Netlify 不受影响 |
| Netlify 站点 | 麦冬账号下 | 含 `ZHIPU_API_KEY`、`WECOM_WEBHOOK_URL` |
| Netlify Blobs | store `study-data` | 数据按 `u:<身份码>` 分片。**清理方式**：设置页「清空打卡与进度」只清当前身份 |
| 每日提醒 | cron-job.org | 若不再需要企微提醒，去那边停掉，或删掉 `WECOM_WEBHOOK_URL` |

### 13.4 收尾检查清单（按顺序打勾）

- [ ] 确认线上版用着顺手（打卡 / 大纲 / AI 三个角色都聊过）
- [ ] 导出一次 JSON 备份存档
- [ ] 决定 GitHub 仓库 public 还是 private
- [ ] 备份 `来都来了/data/state.json`（若有历史打卡），然后删 `来都来了/`
- [ ] 删 `tools/`（可先只留 `extract_outline.py`）
- [ ] 删 `预览图/`、`_screenshot.png`、`参考_WB原版_zhiye-study.html`
- [ ] 两份大纲原件（docx/pdf）挪网盘后删本地
- [ ] `工作台提示词_…md` 挪走或删
- [ ] 本文件第 12 节补一条「v2.0.0 收尾清理」

---
