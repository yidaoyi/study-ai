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
| `index.html` | 全部样式 + 页面结构（5 个 page：今日/大纲/日历/陪伴/设置） |
| `app.js` | 前端全部逻辑（数据层、渲染、AI 聊天、出题） |
| `outline.json` | 2025 版执业医大纲，1025 细目（理论 842 + 技能 183） |
| `netlify.toml` | 构建与响应头配置 |
| `package.json` | 依赖 `@netlify/blobs` |
| `netlify/functions/crew-data.js` | **6 位医学角色人设的唯一来源** |
| `netlify/functions/chat.js` | AI 聊天代理（含出题模式、注入学习+运动上下文） |
| `netlify/functions/study.js` | 学习数据读写（打卡/轮次/考试日期/聊天记忆） |
| `netlify/functions/remind.js` | 每日提醒：AI 生成 + 企微推送 |
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
  "chats": { "张仲景": [{ "role": "user", "content": "..." }] }
}
```

- `checkins`：打卡日期数组（`YYYY-MM-DD`，北京时间）
- `checkedItems`：**细目 key → 轮次**（1/2/3…，归零时删除该键）。key 是层级路径，**见第 9 节坑①（最重要）**
- `examDate`：目标笔试日期（可为 null）
- `chats`：按角色存最近 30 条聊天（记忆上云，跨设备连续）

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

### v1.2.0（2026-09-17）多用户隔离 + 修复 saveAll 崩溃
- **多用户隔离（重要）**：原设计全站共用一份数据（`study-data/main`），把网址发给别人 = 别人能看且能改主人的进度
  - `study.js` / `chat.js` 新增 `sanitizeUid()` + `keyFor()`：key 变为 `u:<身份码>`，无身份码才落 `main`
  - 身份码只允许 `中英文 数字 _ -`，最长 24 字 —— 顺带挡住路径穿越（`a/b/../evil` → `abevil`）
  - 前端 `app.js`：`?u=` 优先 → localStorage `study_uid` → 随机生成。**裸链接给访客 = 自动独立空间**
  - `chat.js` 访客模式（uid ≠ `maidong`）：不注入运动数据 + system 追加「别叫麦冬 / 别提私人经历 / 别给确定性医疗建议」
  - 设置页新增「我的身份」卡片：显示身份码、复制专属链接、切换身份
- **修复真 bug**：`study.js` 的 `saveAll` 分支给 `const data` 重新赋值 → 运行时 TypeError，保存必然失败。已改 `let data`
  （此前「云端保存」一直是坏的，但因为本地 localStorage 兜底，表面看不出来）
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

### v1.0.0（2026-09-08）建站
- 从 onepiece-sports 照搬人设机制（三件套 + 防脱题 4 条 + 轮换），角色替换为 6 位医学主题
- 完成功能：打卡 / 大纲 1025 细目轮次 / 热力日历 / 笔试倒计时 / AI 陪伴（聊天 + 出题考你）/ 定时提醒推企微
- 数据上云：Netlify Blobs（store `study-data`），聊天记忆按角色上云
- 运动数据：跨站读取 onepiece `/stats`，AI 同时关心学习与运动
- **修复**：细目 key 重复导致勾选串位、进度统计错误（1025 条中 817 条重复 id）→ 改用层级路径 key
- **修复**：补齐大纲行尾 −/× 小按钮（`.mini` / `.item-controls`）缺失的样式
- 测试：5 个 JS 文件 `node --check` 通过；DOM id 交叉检查 38/38 命中；本地静态服务 4 个资源均 200
