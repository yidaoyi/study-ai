/**
 * 智谱 AI 聊天代理 Netlify Function（医学陪伴版）
 * 前端 POST { crew, messages, mode } 转发给智谱，返回 { reply }
 *  - mode='chat'：正常陪聊（照搬 onepiece）
 *  - mode='quiz'：出题考麦冬（根据真实学习进度挑薄弱点）
 * 自动注入：①学习进度（本 store）②运动数据（跨站读 onepiece 的 /stats）
 * 环境变量：ZHIPU_API_KEY
 */

const { getStore, connectLambda } = require('@netlify/blobs');
const { CREW } = require('./crew-data');
const { retrieve } = require('./lectures');

const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MODEL = 'glm-4-flash';

// onepiece 运动台（已上线，公开接口、CORS 放开）— 用于让本台 AI 读到真实运动数据
const ONEMIECE_STATS_URL = 'https://onepieceai.netlify.app/.netlify/functions/stats';

const STORE_NAME = 'study-data';
const DEFAULT_KEY = 'main';
const OWNER_UID = 'maidong'; // 主人的身份码；其他人来访时 AI 不会叫错名字

function sanitizeUid(s) {
  return String(s || '').trim().replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '').slice(0, 24);
}

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: '仅支持 POST 请求' }) };
  }

  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: '未设置 ZHIPU_API_KEY 环境变量' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: '请求体不是合法的 JSON' }) };
  }

  let messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'messages 必须是包含至少一条消息的数组' }) };
  }

  const crew = body.crew ? CREW.find((c) => c.name === body.crew) : null;
  if (!crew) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: '未知的船员/角色名' }) };
  }

  // 0) 身份（多用户隔离）
  const uid = sanitizeUid(body.uid);
  const KEY = uid ? 'u:' + uid : DEFAULT_KEY;
  const isGuest = !!uid && uid !== OWNER_UID;
  const who = isGuest ? '对方' : '麦冬';

  // 1) 拉学习进度（本 store）
  let studyCtx = '';
  try {
    connectLambda(event);
    const store = getStore(STORE_NAME);
    const data = (await store.get(KEY, { type: 'json' })) || {};
    const checked = data.checkedItems || {};
    const total = data.meta?.totalItems || 1025;
    const done = Object.keys(checked).filter((k) => checked[k]).length;
    const pct = ((done / total) * 100).toFixed(1);
    const lastCheckin = data.checkins?.length ? data.checkins[data.checkins.length - 1] : null;
    studyCtx = `【${who}当前学习情况（仅供你了解，用角色口吻自然提及，不要罗列数据）】
- 大纲总细目 ${total} 个，已勾选掌握 ${done} 个（约 ${pct}%）
- 最近打卡：${lastCheckin || '还没有打卡记录'}
- 目标考试日期：${data.examDate || '未设置'}`;
  } catch (err) {
    studyCtx = `【学习数据暂时读不到，照常陪${who}即可】`;
  }

  // 2) 拉运动数据（跨站读 onepiece）—— 只给主人看，朋友来访时不泄露你的运动记录
  let exerciseCtx = '';
  if (!isGuest) {
    try {
      const r = await fetch(ONEMIECE_STATS_URL);
      if (r.ok) {
        const j = await r.json();
        const s = j.stats || {};
        exerciseCtx = `【麦冬近期运动情况（仅供你了解，顺带关心即可，不要喧宾夺主）】
- 近7天锻炼 ${s.weeklyCount ?? '?'} 次，连续 ${s.streakDays ?? '?'} 天
- 最近一次：${s.lastWorkout ? s.lastWorkout.date + ' ' + s.lastWorkout.type + ' ' + (s.lastWorkout.count || '') : '暂无'}`;
      }
    } catch (err) {
      exerciseCtx = '';
    }
  }

  // 2.5) 讲稿检索（RAG-lite）：若该角色配了讲稿，取最相关的几段原话喂进去
  let lectureCtx = '';
  try {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const query = (lastUser && lastUser.content) || '';
    const hits = retrieve(crew.name, query, { topK: 3, maxChars: 1200, minScore: 0.3 });
    if (hits.length) {
      lectureCtx = `【${crew.name}讲稿原话（与${who}当前问题相关，可引用、可化用，但要用你自己的口气说出来，不要整段照抄）】\n`
        + hits.map((h) => `- ${h.text}`).join('\n');
    }
  } catch (err) {
    lectureCtx = '';
  }

  // 3) 组装 system
  let system = crew.system + '\n\n' + studyCtx + '\n\n' + exerciseCtx;
  if (lectureCtx) system += '\n\n' + lectureCtx;

  if (isGuest) {
    system += `\n\n【重要：访客模式】
现在和你对话的**不是麦冬**，是她的朋友在试用这个页面。
- 不要称呼「麦冬」，也不要提她的私人经历、课题组、既往记录，一律用「你」称呼。
- 把对方当成一位正在准备中医执业医师考试的普通考生即可。
- 涉及方药、剂量、诊断标准时，拿不准必须明说，并提醒以官方大纲和教材为准，不要给确定性医疗建议。`;
  }

  if (body.mode === 'quiz') {
    system += `\n\n【当前任务：出题考${who}】
你是${crew.name}。根据上面的学习进度，挑 1~2 个她还没掌握的细目出一道开放式题（例如"解释XXX""XXX与XXX有何区别""XXX的临床意义是什么"），控制在一道题、篇幅短。
- 如果对话历史里你上一句已经是考题、且${who}刚刚作答，就转为【点评】：判对错、点出关键知识点、给一句鼓励，不要再出新题。
- 一次只考一题。用你的角色口吻，不要破坏人设，不要使用 markdown。`;
  }

  if (!messages.some((m) => m.role === 'system')) {
    messages = [{ role: 'system', content: system }, ...messages];
  }

  try {
    const resp = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.85 }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: `智谱 API 请求失败：${resp.status} ${detail}` }) };
    }
    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || '抱歉，我没有收到回复，请再试一次。';
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ reply }) };
  } catch (err) {
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: `调用智谱 API 失败：${err.message}` }) };
  }
};
