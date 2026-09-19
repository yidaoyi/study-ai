# 来都来了 study-ai

中医执业医师备考 AI 陪伴自习台：打卡、大纲进度（2025 版 1025 细目）、6 位医学角色陪聊 + 出题考你、每日企微提醒。AI 同时读你的运动数据（来自海贼王运动台 onepieceai.netlify.app），学习和运动一起关心。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 全部样式 + 五个页面结构（今日/大纲/日历/陪伴/设置） |
| `app.js` | 前端逻辑：数据层、渲染、AI 聊天、出题 |
| `outline.json` | 2025 版执业医大纲，1025 细目（理论 842 + 技能 183） |
| `netlify.toml` | 构建与响应头配置 |
| `package.json` | 依赖 `@netlify/blobs` |
| `netlify/functions/crew-data.js` | **6 位医学角色人设的唯一来源** |
| `netlify/functions/chat.js` | AI 聊天代理（出题模式 + 注入学习/运动上下文） |
| `netlify/functions/study.js` | 学习数据读写（Netlify Blobs） |
| `netlify/functions/remind.js` | 每日提醒：AI 生成 + 企微推送 |
| `双击启动.bat` | 本地预览一键启动（部署前看界面用） |

## 文档

- 给人看的：[`使用说明.md`](使用说明.md)
- 给 AI 看的：[`HANDOFF_AI.md`](HANDOFF_AI.md) —— **改动先读它，改完在末尾追加版本记录**

## 部署

Netlify：New site → Import from Git → 选本仓库 → 环境变量 `ZHIPU_API_KEY`（必填，智谱 key）、`WECOM_WEBHOOK_URL`（可选，企微机器人）→ Deploy。

> 仓库里**不含**任何密钥，key 只在 Netlify 后台配置。

## 本地预览

别双击 `index.html`（`file://` 下读不到 `outline.json`）。双击 **`双击启动.bat`** → `http://127.0.0.1:8765/index.html`。本地模式 AI 不可用。
