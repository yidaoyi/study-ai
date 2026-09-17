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

/* 生成二元组集合（同时保留单字，防止短查询全落空） */
function grams(text) {
  const t = normalize(text);
  const set = new Set();
  if (!t) return set;
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  for (const ch of t) set.add(ch);
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
  // 相关性门槛：低于这个分说明只是闲聊，别硬塞讲稿（实测：相关命中 ~1.0，闲聊 ~0.09）
  const minScore = opts.minScore || 0.3;

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

  const q = grams(query);
  if (!q.size) return [];

  const scored = segs.map((s) => {
    const g = grams(s.text);
    if (!g.size) return { seg: s, score: 0 };
    let hit = 0;
    for (const x of q) if (g.has(x)) hit += 1;
    // 除以长度的平方根：避免长段天然占便宜
    const score = hit / Math.sqrt(g.size);
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
