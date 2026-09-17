/**
 * 学习数据 Netlify Function（医学陪伴版）
 * 负责：打卡记录、大纲细目勾选（轮次）、笔试目标日期、聊天记忆 的持久化（Netlify Blobs）
 * 照搬 onepiece 的 stats.js 写法（connectLambda + getStore）
 *
 * GET  /study          -> 返回全部学习数据
 * POST /study          -> 按 body.action 执行：checkin / cycle / setExam / saveChats / saveAll / reset
 */

const { getStore, connectLambda } = require('@netlify/blobs');

const STORE_NAME = 'study-data';
const DEFAULT_KEY = 'main';
const MAX_CHAT_HISTORY = 30;

/* 多用户隔离：每个身份码一份数据。
 * 前端通过 ?u=xxx（GET）或 body.uid（POST）传身份码。
 * 没有身份码时落到 DEFAULT_KEY（兼容老数据，也方便主人裸链接访问）。
 */
function sanitizeUid(s) {
  return String(s || '').trim().replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '').slice(0, 24);
}
function keyFor(event, body) {
  const q = sanitizeUid((event.queryStringParameters || {}).u);
  const b = sanitizeUid(body && body.uid);
  const uid = b || q;
  return uid ? 'u:' + uid : DEFAULT_KEY;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function getBeijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function emptyData() {
  return { checkins: [], checkedItems: {}, examDate: null, chats: {} };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const rawBody = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {};
    const KEY = keyFor(event, rawBody);

    connectLambda(event);
    const store = getStore(STORE_NAME);
    let data = (await store.get(KEY, { type: 'json' })) || emptyData();

    if (event.httpMethod === 'GET') {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, data }) };
    }

    if (event.httpMethod === 'POST') {
      const body = rawBody || {};
      const action = body.action;

      if (action === 'checkin') {
        const today = getBeijingToday();
        if (!data.checkins.includes(today)) data.checkins.push(today);
        await store.set(KEY, JSON.stringify(data));
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, data }) };
      }

      if (action === 'cycle') {
        const id = body.itemId;
        const delta = typeof body.delta === 'number' ? body.delta : 1;
        if (!id) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: '缺少 itemId' }) };
        const cur = data.checkedItems[id] || 0;
        let next = cur + delta;
        if (next < 0) next = 0;
        if (next > 999) next = 999;
        if (next === 0) delete data.checkedItems[id];
        else data.checkedItems[id] = next;
        await store.set(KEY, JSON.stringify(data));
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, data }) };
      }

      if (action === 'setExam') {
        data.examDate = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : null;
        await store.set(KEY, JSON.stringify(data));
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, data }) };
      }

      if (action === 'saveChats') {
        const crew = body.crew;
        const messages = Array.isArray(body.messages) ? body.messages : [];
        if (crew) {
          data.chats[crew] = messages.slice(-MAX_CHAT_HISTORY);
          await store.set(KEY, JSON.stringify(data));
        }
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
      }

      if (action === 'saveAll') {
        if (body.data && typeof body.data === 'object') {
          data = Object.assign(emptyData(), body.data);
          await store.set(KEY, JSON.stringify(data));
        }
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, data }) };
      }

      if (action === 'reset') {
        await store.set(KEY, JSON.stringify(emptyData()));
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, data: emptyData() }) };
      }

      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: '未知 action: ' + action }) };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
