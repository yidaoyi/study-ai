/**
 * 讲稿检索（RAG-lite）—— 让角色能引用真实讲稿原话
 *
 * 做法（刻意做轻，不引入向量库/额外费用）：
 *   1. 讲稿在构建期被切成小段，存 data/lectures/<人名>.json
 *   2. 用户提问时，用「中文二元组（bigram）重合度」给每段打分，取最相关的几段
 *   3. 把这几段拼进 system，让模型照着讲稿的语料和说法回答
 *
 * 为什么用 bigram 而不是向量：中文分词不准，但二元组重合对"关键词命中"足够好；
 * 讲稿量级只有几百段，O(n) 扫一遍开销可忽略。
 */

const LECTURE_FILES = {
  郝万山: () => require('../../data/lectures/haowanshan.json'),
};

/* 只保留汉字/数字/字母，去掉标点空白 */
const normalize = (s) => (s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');

/* 生成二元组集合。
 * 默认只用 bigram —— 单字（"的/了/我"）在大语料里遍地都是，会把闲聊也算成高分，
 * 只有查询本身很短（< 4 字，bigram 太少）时才兜底加单字，避免短查询全落空。
 */
function grams(text, withUnigram = false) {
  const t = normalize(text);
  const set = new Set();
  if (!t) return set;
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  if (withUnigram) for (const ch of t) set.add(ch);
  return set;
}

/**
 * 检索与 query 最相关的讲稿片段
 * @param {string} name 角色名（如 '郝万山'）
 * @param {string} query 用户的话
 * @param {object} opts { topK = 3, maxChars = 1200 }
 * @returns {Array<{id:string, text:string, score:number}>}
 */
function retrieve(name, query, opts = {}) {
  const topK = opts.topK || 3;
  const maxChars = opts.maxChars || 1200;
  // 相关性门槛：低于这个分说明只是闲聊，别硬塞讲稿。
  // 门槛要随查询长度变 —— 短查询 bigram 少，要么几乎全中要么不中，所以要更严。
  // 单个字无从判断相关性（"嗨""哦"都会满分命中），直接跳过
  if (normalize(query).length < 2) return [];
  const qLen0 = normalize(query).length;
  const minScore = opts.minScore != null ? opts.minScore : (qLen0 < 6 ? 0.85 : 0.6);

  const loader = LECTURE_FILES[name];
  if (!loader) return [];

  let data;
  try {
    data = loader();
  } catch (e) {
    return [];
  }
  const segs = (data && data.segments) || [];
  if (!segs.length) return [];

  // 查询很短（<4 字）时 bigram 太少，兜底启用单字
  const useUni = normalize(query).length < 4;
  const q = grams(query, useUni);
  if (!q.size) return [];

  const scored = segs.map((s) => {
    const g = grams(s.text, useUni);
    if (!g.size) return { seg: s, score: 0 };
    let hit = 0;
    for (const x of q) if (g.has(x)) hit += 1;
    // 用「查询被讲稿覆盖的比例」打分：衡量这段讲稿命中了多少提问里的词，
    // 而不是反过来 —— 否则长段、大语料会让闲聊也拿到高分。
    const score = hit / q.size;
    return { seg: s, score };
  });

  const picked = scored
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const out = [];
  let used = 0;
  for (const p of picked) {
    const text = (p.seg.text || '').trim();
    if (!text) continue;
    if (used + text.length > maxChars && out.length) break;
    out.push({ id: p.seg.id, text, score: Number(p.score.toFixed(3)) });
    used += text.length;
  }
  return out;
}

module.exports = { retrieve, normalize, grams };
