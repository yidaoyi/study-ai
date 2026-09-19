# 来都来了 study-ai

中医执业医师备考 AI 陪伴自习台：打卡、大纲进度（2025 版 1025 细目）、**7 位**医学角色陪聊 + 出题考你、
**7284 题刷题 + 伤寒专科**、每日企微提醒。AI 同时读你的运动数据（来自海贼王运动台 onepieceai.netlify.app），
学习和运动一起关心。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 全部样式 + 七个页面结构（今日/大纲/日历/陪伴/设置/刷题/伤寒专科） |
| `app.js` | 前端逻辑：数据层、渲染、AI 聊天、出题、刷题、角色私设 |
| `outline.json` | 2025 版执业医大纲，1025 细目（理论 842 + 技能 183） |
| `data/questions/questions.json` | 题库成品 7284 题（3.0 MB，前端 fetch，不进函数包） |
| `data/lectures/haowanshan.json` | 郝万山《伤寒论》讲稿，2256 段（供 AI 检索引用） |
| `data/lectures/raw/haowanshan_raw.md` | **讲稿原件**，上面那份由它生成，别删 |
| `netlify.toml` | 构建、重定向、提醒函数的定时任务配置 |
| `package.json` | 依赖 `@netlify/blobs` |
| `netlify/functions/crew-data.js` | **7 位医学角色人设的唯一来源** + 私设拼接引擎 |
| `netlify/functions/chat.js` | AI 聊天代理（出题 / 讲题 / 注入学习+运动上下文 / 限流） |
| `netlify/functions/lectures.js` | 讲稿检索（RAG-lite，中文 bigram 重合度打分） |
| `netlify/functions/study.js` | 学习数据读写（Netlify Blobs，按身份码分片） |
| `netlify/functions/remind.js` | 每日提醒：AI 生成 + 企微推送 |
| `tools/build_lecture.py` | 讲稿原件 → `haowanshan.json` |
| `tools/fetch_tcmle.py` | 题库下载清洗（**一般不用再跑**，见文档第 15.3 节） |
| `双击启动.bat` | 本地预览一键启动（部署前看界面用） |

## 文档

- 给人看的：[`使用说明.md`](使用说明.md)
- 给 AI 看的：[`HANDOFF_AI.md`](HANDOFF_AI.md) —— **改动先读它，改完在末尾追加版本记录**；
  第 15 节是「本地空间账本 + 日常维护手册」，第 9 节是已知坑

## 部署

Netlify：New site → Import from Git → 选本仓库 → 环境变量 `ZHIPU_API_KEY`（必填，智谱 key）、
`WECOM_WEBHOOK_URL`（可选，企微机器人）→ Deploy。
本项目**无构建步骤**，push 到 `main` 后自动部署，约 1 分钟。

> 仓库里**不含**任何密钥，key 只在 Netlify 后台配置。
> 用户的打卡/进度/答题/私设存在 Netlify Blobs，**不在仓库里**。

## 本地预览

别双击 `index.html`（`file://` 下读不到 `outline.json` 和题库，页面会是空的）。
双击 **`双击启动.bat`** → 浏览器打开提示的地址。本地模式 AI 不可用（函数只在 Netlify 上）。

本地占用：**约 10.5 MB**（含 `.git` 2.8 MB），详见 `HANDOFF_AI.md` 第 15.1 节。
