/**
 * 定时学习+运动提醒 Netlify Function（医学陪伴版）
 * 每天选一位医学角色，用智谱生成该角色风格的提醒，推企业微信群。
 * 读取：①学习数据（本 store，由 study.js 写入）②运动数据（跨站读 onepiece 的 /stats）
 * 让提醒既问学习进度，也顺带关心运动。
 * 环境变量：ZHIPU_API_KEY、WECOM_WEBHOOK_URL
 */

const { getStore, connectLambda } = require('@netlify/blobs');
const { CREW } = require('./crew-data');

const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MODEL = 'glm-4-flash';

const STUDY_STORE = 'study-data';
const STUDY_KEY = 'main';
const ONEMIECE_STATS_URL = 'https://onepieceai.netlify.app/.netlify/functions/stats';

function getBeijingHour(date = new Date()) {
  return new Date(date.getTime() + 8 * 3600 * 1000).getUTCHours();
}

function resolveSlot(event) {
  const slot = event.queryStringParameters?.slot;
  if (slot === 'morning' || slot === 'afternoon') return slot;
  return getBeijingHour() < 12 ? 'morning' : 'afternoon';
}

// 9 位船员 -> 6 位医学角色，按日期轮换（早晚各一位）
function pickCrew(date = new Date(), slotIndex = 0) {
  const dayKey = Math.floor(date.getTime() / 86400000);
  const idx = (dayKey * 2 + slotIndex) % CREW.length;
  return CREW[idx];
}

async function getStudyStats() {
  try {
    const store = getStore(STUDY_STORE);
    const d = await store.get(STUDY_KEY, { type: 'json' });
    return d || null;
  } catch (err) {
    console.error('读取学习数据失败：', err.message);
    return null;
  }
}

async function getExerciseStats() {
  try {
    const r = await fetch(ONEMIECE_STATS_URL);
    if (r.ok) return await r.json();
    return null;
  } catch (err) {
    console.error('读取运动数据失败：', err.message);
    return null;
  }
}

function summarizeStudy(d) {
  if (!d) return '暂时还没有学习记录（把麦冬当成刚开始备考的新手）';
  const checked = d.checkedItems || {};
  const done = Object.keys(checked).filter((k) => checked[k]).length;
  const total = d.meta?.totalItems || 1025;
  const pct = ((done / total) * 100).toFixed(1);
  const last = d.checkins?.length ? d.checkins[d.checkins.length - 1] : null;
  const parts = [];
  parts.push(`大纲已掌握 ${done}/${total} 个细目（约 ${pct}%）`);
  if (last) parts.push(`最近打卡：${last}`);
  else parts.push('还没有打卡记录');
  if (d.examDate) parts.push(`目标考试日期：${d.examDate}`);
  return parts.join('；');
}

function summarizeExercise(j) {
  const s = j?.stats;
  if (!s) return '运动数据暂时读不到（可顺带问一句今天动了吗）';
  const parts = [];
  parts.push(`近7天锻炼 ${s.weeklyCount ?? '?'} 次，连续 ${s.streakDays ?? '?'} 天`);
  if (s.lastWorkout) parts.push(`最近一次：${s.lastWorkout.date} ${s.lastWorkout.type} ${s.lastWorkout.count || ''}`);
  return parts.join('；');
}

async function generateReminder(crew, slot, studyLine, exerciseLine) {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error('缺少环境变量 ZHIPU_API_KEY');
  const slotLabel = slot === 'morning' ? '早上7点' : '下午1点';
  const prompt = [
    crew.user,
    `现在是${slotLabel}（北京时间）。`,
    `麦冬最近的学习情况：${studyLine}。`,
    `她的运动情况：${exerciseLine}。`,
    '请像朋友一样自然地提到这些真实情况（夸夸坚持、温柔督促、结合学习进度开个玩笑都可以），自然地兼顾学习和运动，不要罗列数据、不要超出角色人设、不要使用markdown格式。',
  ].join('\n');

  const resp = await fetch(ZHIPU_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: crew.system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 150,
    }),
  });
  if (!resp.ok) throw new Error(`智谱 API 返回 ${resp.status}`);
  const data = await resp.json();
  const text = (data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('智谱 API 返回空内容');
  return text.slice(0, 200);
}

async function sendToWeCom(title, content, siteUrl) {
  const webhookUrl = process.env.WECOM_WEBHOOK_URL;
  if (!webhookUrl) throw new Error('缺少环境变量 WECOM_WEBHOOK_URL');
  const mdContent = `## ${title}\n${content}\n[📋 打开学习陪伴台](${siteUrl})`;
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { content: mdContent } }),
  });
  if (!resp.ok) throw new Error(`企业微信 返回 ${resp.status}`);
  return resp.json();
}

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const date = new Date();
  const slot = resolveSlot(event);
  const slotIndex = slot === 'morning' ? 0 : 1;
  const crew = pickCrew(date, slotIndex);
  const studyLine = summarizeStudy(await getStudyStats());
  const exerciseLine = summarizeExercise(await getExerciseStats());

  let reminder;
  let aiUsed = true;
  try {
    reminder = await generateReminder(crew, slot, studyLine, exerciseLine);
  } catch (err) {
    aiUsed = false;
    reminder = crew.fallback || '该温书啦！今天也动一动～';
  }

  const title = `${crew.emoji} ${crew.name}喊你学习啦`;
  const siteUrl = process.env.URL || process.env.SITE_URL || 'https://studyai.netlify.app';

  try {
    const result = await sendToWeCom(title, reminder, siteUrl);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, date: date.toISOString(), slot, crew: crew.name, emoji: crew.emoji, title, reminder, aiUsed, studyLine, exerciseLine, siteUrl, wecom: result }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ ok: false, error: err.message, slot, title, reminder, siteUrl }),
    };
  }
};
