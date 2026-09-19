"use strict";

/* ============ 基础工具 ============ */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const todayStr = (d = new Date()) =>
  d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const FN = (n) => "/.netlify/functions/" + n;

/* ============ 音效（纯合成，不碰任何现成采样） ============
 * 想要的是星露谷那种「短、暖、带一点塑料味的合成音」。
 * 原版音效文件有版权，所以这里全部用 Web Audio 现合成：振荡器 + 音量包络，
 * 不引入任何 mp3/wav，也就不存在侵权问题（音色本身不受版权保护）。
 */
const Sound = {
  on: localStorage.getItem("study_sound") !== "off",
  ctx: null,
  toggle() {
    this.on = !this.on;
    localStorage.setItem("study_sound", this.on ? "on" : "off");
    return this.on;
  },
  _ctx() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    } catch (e) {
      return null;
    }
  },
  /* 一个音：freq 频率 / at 起始时刻 / dur 时长 / type 波形 / vol 音量
   * 包络是关键 —— 瞬间起音再指数衰减，衰减太快像噪声，太慢像风琴 */
  _note(ctx, freq, at, dur, type, vol) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  },
  /* 打卡：C5–E5–G5 上行琶音。三角波出木琴味，叠一层高八度正弦添亮度 */
  checkin() {
    if (!this.on) return;
    const ctx = this._ctx();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const at = t0 + i * 0.085;
      this._note(ctx, f, at, 0.45, "triangle", 0.2);
      this._note(ctx, f * 2, at, 0.24, "sine", 0.06);
    });
  },
  /* 已经打过卡了：单音闷一点，表示"无效操作"而不是报错 */
  nope() {
    if (!this.on) return;
    const ctx = this._ctx();
    if (!ctx) return;
    this._note(ctx, 392.0, ctx.currentTime + 0.01, 0.18, "sine", 0.12);
  },
};

/* ============ 身份（多用户隔离） ============
 * 数据按身份码分开存。URL 带 ?u=xxx 就用 xxx；没有就用本机存过的；
 * 都没有就随机生成一个 —— 所以别人裸开网址会自动拿到自己的空间，跟你互不干扰。
 */
const UID_KEY = "study_uid";

function sanitizeUid(s) {
  return String(s || "").trim().replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, "").slice(0, 24);
}
function randomUid() {
  return "u" + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6);
}
function currentUid() {
  const q = sanitizeUid(new URLSearchParams(location.search).get("u"));
  if (q) {
    localStorage.setItem(UID_KEY, q);   // 链接带身份码：记住它，以后裸开也是这个身份
    return q;
  }
  let s = sanitizeUid(localStorage.getItem(UID_KEY));
  if (!s) {
    s = randomUid();                    // 全新访客：随机分配一个独立空间，不碰别人的数据
    localStorage.setItem(UID_KEY, s);
  }
  return s;
}
const UID = currentUid();
const myLink = () => location.origin + location.pathname + "?u=" + encodeURIComponent(UID);

let outline = null;
let data = { checkins: [], checkedItems: {}, examDate: null, chats: {} };
let calCursor = new Date();
let outlineTab = "theory";
let searchTerm = "";
let saveTimer = null;

/* 医学陪伴角色（UI 简表，详细人设见后端 crew-data.js） */
const CREW_UI = [
  { name: "张仲景", emoji: "📜", tag: "医圣 · 考你条文" },
  { name: "李时珍", emoji: "🌿", tag: "药圣 · 温柔陪伴" },
  { name: "华佗", emoji: "⚕️", tag: "神医 · 运动养生" },
  { name: "孙思邈", emoji: "🍵", tag: "药王 · 大医精诚" },
  { name: "小苓", emoji: "🌸", tag: "实习学妹 · 战友刷题" },
  { name: "导师", emoji: "🎓", tag: "现代博导 · 问进展" },
  { name: "郝万山", emoji: "🎙️", tag: "伤寒大家 · 讲临床" },
];

/* 先贤寄语（替代原三档话术） */
const QUOTES = [
  { t: "勤求古训，博采众方。", src: "张仲景《伤寒论·原序》" },
  { t: "大医精诚，先发大慈恻隐之心。", src: "孙思邈《备急千金要方》" },
  { t: "读书如进补，贵在持之以恒，不可猛火攻。", src: "养生古训" },
  { t: "人体欲得劳动，但不当使极耳。", src: "华佗" },
  { t: "食饮有节，起居有常，不妄作劳。", src: "《素问·上古天真论》" },
  { t: "天覆地载，万物悉备，莫贵于人。", src: "《素问》" },
  { t: "学医总须得门而入，未有不得其门而能得其奥者。", src: "程钟龄" },
  { t: "医者意也，善于用意，即为良医。", src: "孙思邈" },
  { t: "背得出不等于懂，懂了才能用。今天也踏实来一轮。", src: "来都来了" },
  { t: "看了不等于会了，合上书能讲出来才算数。", src: "来都来了" },
];

/* ============ 数据层（上云 + 本地降级） ============ */
const emptyData = () => ({ checkins: [], checkedItems: {}, examDate: null, chats: {}, quiz: {} });

/* 带超时的 fetch：网络/服务异常时不许把页面卡死在"等待载入" */
async function fetchWithTimeout(url, opts = {}, ms = 4000) {
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), ms) : null;
  try {
    return await fetch(url, ac ? Object.assign({}, opts, { signal: ac.signal }) : opts);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* 是否已连上云端（本地打开时为 false） */
let online = false;

function markOnline() { online = true; $("saveDot").textContent = "已保存到云端"; $("saveDot").title = "数据存在 Netlify Blobs"; }
function markOffline() { online = false; $("saveDot").textContent = "本地模式（未上云）"; $("saveDot").title = "未部署或网络不通，数据只存在这台设备的浏览器里"; }

async function loadData() {
  try {
    const r = await fetchWithTimeout(FN("study") + "?u=" + encodeURIComponent(UID));
    if (!r.ok) throw new Error("bad");
    const j = await r.json();
    data = j.data || emptyData();
    localStorage.setItem("study_data", JSON.stringify(data));
    markOnline();
  } catch (e) {
    data = JSON.parse(localStorage.getItem("study_data") || "null") || emptyData();
    markOffline();
  }
}

async function saveData() {
  localStorage.setItem("study_data", JSON.stringify(data));
  try {
    const r = await fetchWithTimeout(FN("study"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveAll", uid: UID, data }),
    });
    if (!r.ok) throw new Error("bad");
    markOnline();
  } catch (e) {
    $("saveDot").textContent = "已存本地（未上云）";
  }
}

function markSaved() { online ? markOnline() : markOffline(); }
function saveSoon() {
  $("saveDot").textContent = "保存中…";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveData, 350);
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ============ 导航 ============ */
function bindEvents() {
  if (bindEvents.done) return;
  bindEvents.done = true;
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.addEventListener("click", () => switchPage(b.dataset.page))
  );
  $("checkinBtn").addEventListener("click", doCheckin);
  $("phraseNext").addEventListener("click", () => { phraseOffset = (phraseOffset + 1) % QUOTES.length; renderPhrase(); });
  $("tabTheory").addEventListener("click", () => { outlineTab = "theory"; renderTabs(); renderOutline(); });
  $("tabSkills").addEventListener("click", () => { outlineTab = "skills"; renderTabs(); renderOutline(); });
  $("searchBox").addEventListener("input", (e) => { searchTerm = e.target.value.trim(); renderOutline(); });
  $("calPrev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
  $("calNext").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
  $("examDate").addEventListener("change", (e) => { data.examDate = e.target.value; saveSoon(); renderToday(); toast("目标日期已保存"); });
  $("exportBtn").addEventListener("click", exportData);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", importData);
  $("clearBtn").addEventListener("click", clearData);
  $("chatSend").addEventListener("click", () => sendUserMessage($("chatInput").value));
  $("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendUserMessage($("chatInput").value); });
  $("quizBtn").addEventListener("click", toggleQuiz);

  /* 刷题 */
  $("quizStart").addEventListener("click", startQuiz);
  $("quizExit").addEventListener("click", exitQuiz);
  $("quizPrev").addEventListener("click", quizPrev);
  $("quizNext").addEventListener("click", quizNext);
  $("quizRedo").addEventListener("click", redoQuiz);
  $("quizHaoBtn").addEventListener("click", askHao);
  $("haoSwitch").addEventListener("click", () => {
    haoOn = !haoOn;
    localStorage.setItem("study_hao", haoOn ? "on" : "off");
    renderShangHan();
    toast(haoOn ? "讲题按钮已打开" : "讲题按钮已关闭");
  });
  $("shangStart").addEventListener("click", () => startShangHan(false));
  $("shangWrong").addEventListener("click", () => startShangHan(true));
  document.querySelectorAll(".qf-opts").forEach((g) => {
    g.querySelectorAll(".qf-btn").forEach((b) => {
      b.addEventListener("click", () => {
        g.querySelectorAll(".qf-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        quizFilter[g.dataset.group] = b.dataset.val;
        renderQuizCount();
      });
    });
  });
}

function switchPage(page) {
  history.replaceState(null, "", "#" + page);
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  $("page-" + page).classList.add("active");
  if (page === "outline") renderOutline();
  if (page === "quiz") renderQuiz();
  if (page === "shanghan") renderShangHan();
  if (page === "calendar") renderCalendar();
  if (page === "settings") renderSettings();
  if (page === "today") renderToday();
  if (page === "companion") renderCompanion();
}

/* ============ 统计 ============ */
const checkinDates = () => (Array.isArray(data.checkins) ? data.checkins : []).slice().sort();

function streakStats() {
  const set = new Set(checkinDates());
  const today = new Date();
  let cursor = new Date(today);
  if (!set.has(todayStr(today))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (set.has(todayStr(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  let best = 0, run = 0, prev = null;
  for (const d of checkinDates()) {
    if (prev) {
      const diff = Math.round((new Date(d + "T00:00:00") - new Date(prev + "T00:00:00")) / 86400000);
      run = diff === 1 ? run + 1 : 1;
    } else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { streak, best, total: checkinDates().length };
}

function countProgress(ids) {
  let r1 = 0, r2 = 0, sum = 0;
  for (const id of ids) {
    const v = data.checkedItems[id] || 0;
    if (v >= 1) r1 += 1;
    if (v >= 2) r2 += 1;
    sum += v;
  }
  return { total: ids.length, r1, r2, sum };
}

/* 重要：原大纲里 item.id 在每个 unit / skill block 内都从 1 重新编号
   （例如 tu1 下的 ti1 和 tu2 下的 ti1 是同一个字符串 "ti1"），
   直接拿 item.id 当 key 会互相覆盖——勾一个细目等于勾掉一片、进度统计全错。
   所以统一用「层级路径」拼成全局唯一 key：
     理论：part>subject>unit>item      技能：block>item  */
const theoryKey = (partId, subId, unitId, itemId) => partId + ">" + subId + ">" + unitId + ">" + itemId;
const skillKey = (blockId, itemId) => blockId + ">" + itemId;

const collectTheoryIds = () => {
  const ids = [];
  for (const part of outline.theory.parts)
    for (const sub of part.subjects)
      for (const unit of sub.units)
        for (const item of unit.items) ids.push(theoryKey(part.id, sub.id, unit.id, item.id));
  return ids;
};
const collectSkillIds = () =>
  outline.skills.flatMap((b) => b.items.map((it) => skillKey(b.id, it.id)));

/* ============ 今日 ============ */
let phraseOffset = 0;
function renderToday() {
  const now = new Date();
  const week = "日一二三四五六"[now.getDay()];
  $("todayDateLine").textContent = now.getFullYear() + " 年 " + (now.getMonth() + 1) + " 月 " + now.getDate() + " 日 · 星期" + week;
  const checked = checkinDates().includes(todayStr());
  const btn = $("checkinBtn");
  if (checked) { btn.textContent = "来了就好 ✓"; btn.classList.add("done"); }
  else { btn.textContent = "来都来了"; btn.classList.remove("done"); }
  const sb = $("soundBtn");
  if (sb) {
    sb.textContent = Sound.on ? "🔔 音效：开" : "🔕 音效：关";
    sb.onclick = () => {
      const on = Sound.toggle();
      sb.textContent = on ? "🔔 音效：开" : "🔕 音效：关";
      if (on) Sound.checkin();
    };
  }
  const st = streakStats();
  $("statStreak").textContent = st.streak;
  $("statMonth").textContent = checkinDates().filter((d) => d.startsWith(todayStr().slice(0, 7))).length;
  $("statTotal").textContent = st.total;

  const exam = data.examDate;
  if (exam) {
    const target = new Date(exam + "T00:00:00");
    const days = Math.ceil((target - new Date(todayStr() + "T00:00:00")) / 86400000);
    $("countdown").textContent = days >= 0 ? days + " 天" : "已过 " + (-days) + " 天";
    $("countdownSub").textContent = "目标日期 " + exam;
  } else {
    $("countdown").textContent = "还没设置目标日期";
    $("countdownSub").textContent = "去「设置」里填，公告出来再填也行。";
  }

  const sk = countProgress(collectSkillIds());
  const th = countProgress(collectTheoryIds());
  $("barSkill").style.width = sk.total ? Math.round(sk.r1 / sk.total * 100) + "%" : "0";
  $("barTheory").style.width = th.total ? Math.round(th.r1 / th.total * 100) + "%" : "0";
  $("pctSkill").textContent = progressLabel(sk);
  $("pctTheory").textContent = progressLabel(th);
  renderPhrase();
}

function renderPhrase() {
  const q = QUOTES[phraseOffset % QUOTES.length];
  $("phraseText").textContent = q.t;
  $("phraseSrc").textContent = "—— " + q.src;
}

function doCheckin() {
  const t = todayStr();
  if (checkinDates().includes(t)) { Sound.nope(); toast("今天已经来过啦，明天见"); return; }
  data.checkins.push(t);
  Sound.checkin();
  saveSoon();
  renderToday();
  renderCalendar();
  toast("来都来了，就算数。今天也辛苦你。");
}

/* ============ 大纲 ============ */
function renderTabs() {
  $("tabTheory").classList.toggle("active", outlineTab === "theory");
  $("tabSkills").classList.toggle("active", outlineTab === "skills");
}
const progressLabel = (c) => {
  let s = "已过 " + c.r1 + "/" + c.total;
  if (c.r2) s += " · 2轮+ " + c.r2;
  if (c.sum) s += " · 累计 " + c.sum + " 轮";
  return s;
};
const matches = (name, text) => !searchTerm || (name || "").includes(searchTerm) || (text || "").includes(searchTerm);

function cycleBadge(id, v) {
  const cls = v >= 2 ? " s2" : v === 1 ? " s1" : "";
  const label = v === 0 ? "·" : String(v);
  return '<span class="cycle' + cls + '" data-id="' + id + '" title="点击 +1 轮">' + label + "</span>";
}

function itemRowHTML(item, key) {
  const val = data.checkedItems[key] || 0;
  const points = (item.points || []).join("；");
  if (searchTerm && !matches(item.name, points)) return "";
  const detail = item.points && item.points.length
    ? '<details class="points"><summary>要点 ' + item.points.length + " 条</summary><p>" + points + "</p></details>"
    : "";
  return (
    '<div class="item-row s' + val + '" data-id="' + key + '">' + cycleBadge(key, val) +
    '<div class="name">' + item.name + "</div>" +
    '<span class="item-controls"><button class="mini" data-act="minus" data-id="' + key + '" title="减一轮">−</button>' +
    '<button class="mini" data-act="clear" data-id="' + key + '" title="清零">×</button></span>' +
    "</div>" + detail
  );
}

function subjectHTML(subject, partId) {
  const ids = [];
  subject.units.forEach((u) => u.items.forEach((it) => ids.push(theoryKey(partId, subject.id, u.id, it.id))));
  const c = countProgress(ids);
  const inner = subject.units.map((unit) =>
    '<div class="unit"><div class="unit-name">' + unit.name + "</div>" +
    unit.items.map((it) => itemRowHTML(it, theoryKey(partId, subject.id, unit.id, it.id))).join("") + "</div>"
  ).join("");
  return (
    '<div class="subject-block"><div class="subject-head"><span class="subject-name" style="flex:1">' + subject.name + "</span>" +
    '<span class="pct">' + progressLabel(c) + "</span></div>" +
    '<div class="subject-body" style="display:none">' + inner + "</div></div>"
  );
}

function renderOutline() {
  const root = $("outlineTree");
  root.innerHTML = "";
  if (outlineTab === "skills") {
    outline.skills.forEach((block) => {
      const c = countProgress(block.items.map((it) => skillKey(block.id, it.id)));
      const el = document.createElement("div");
      el.className = "part-block";
      el.innerHTML =
        '<div class="part-head"><span class="part-name" style="flex:1">' + block.name + "</span>" +
        '<div class="bar" style="max-width:180px"><i style="width:' + (c.total ? Math.round(c.r1 / c.total * 100) : 0) + '%"></i></div>' +
        '<span class="pct">' + progressLabel(c) + "</span></div>" +
        '<div class="subject-body">' + block.items.map((it) => itemRowHTML(it, skillKey(block.id, it.id))).join("") + "</div>";
      root.appendChild(el);
    });
  } else {
    outline.theory.parts.forEach((part) => {
      const ids = [];
      part.subjects.forEach((s) => s.units.forEach((u) => u.items.forEach((it) => ids.push(theoryKey(part.id, s.id, u.id, it.id)))));
      const c = countProgress(ids);
      const el = document.createElement("div");
      el.className = "part-block";
      el.innerHTML =
        '<div class="part-head"><span class="part-name" style="flex:1">' + part.name + "</span>" +
        '<div class="bar" style="max-width:180px"><i style="width:' + (c.total ? Math.round(c.r1 / c.total * 100) : 0) + '%"></i></div>' +
        '<span class="pct">' + progressLabel(c) + "</span></div>" +
        '<div class="subject-body">' + part.subjects.map((s) => subjectHTML(s, part.id)).join("") + "</div>";
      root.appendChild(el);
    });
  }
  root.querySelectorAll(".part-head").forEach((h) => h.addEventListener("click", () => {
    const b = h.nextElementSibling; b.style.display = b.style.display === "none" ? "" : "none";
  }));
  root.querySelectorAll(".subject-head").forEach((h) => h.addEventListener("click", () => {
    const b = h.nextElementSibling; b.style.display = b.style.display === "none" ? "" : "none";
  }));
  root.querySelectorAll(".cycle").forEach((el) => el.addEventListener("click", () => cycleProgress(el.dataset.id)));
  root.querySelectorAll(".mini").forEach((el) => el.addEventListener("click", () =>
    cycleProgress(el.dataset.id, el.dataset.act === "minus" ? -1 : 0)));
}

function cycleProgress(id, delta = 1) {
  const cur = data.checkedItems[id] || 0;
  let next = delta === 0 ? 0 : Math.min(999, Math.max(0, cur + delta));
  if (next === 0) delete data.checkedItems[id];
  else data.checkedItems[id] = next;
  saveSoon();
  renderOutline();
  renderToday();
  const v = data.checkedItems[id] || 0;
  if (delta === 0) toast("已清零");
  else if (delta < 0) toast("现在是第 " + v + " 轮");
  else if (v >= 999) toast("999 轮封顶，了不起");
  else toast("第 " + v + " 轮");
}

/* ============ 日历 ============ */
function renderCalendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  $("calTitle").textContent = y + " 年 " + (m + 1) + " 月";
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const t = todayStr();
  let html = ["日", "一", "二", "三", "四", "五", "六"].map((d) => '<div class="cal-dow">' + d + "</div>").join("");
  for (let i = 0; i < first; i++) html += '<div class="cal-day other">·</div>';
  for (let d = 1; d <= days; d++) {
    const key = y + "-" + pad(m + 1) + "-" + pad(d);
    const cls = "cal-day" + (checkinDates().includes(key) ? " checked" : "") + (key === t ? " today" : "");
    html += '<div class="' + cls + '">' + d + "</div>";
  }
  $("calGrid").innerHTML = html;
  const st = streakStats();
  $("calStreak").textContent = st.streak;
  $("calBest").textContent = st.best;
  $("calTotal").textContent = st.total;
}

/* ============ 陪伴（AI 聊天 + 出题） ============ */
let currentCrew = localStorage.getItem("study_crew") || CREW_UI[0].name;
let quizMode = false;
let chatBusy = false;

function loadLocalChats(crew) {
  try {
    const ls = JSON.parse(localStorage.getItem("study_chat_" + crew) || "null");
    if (Array.isArray(ls)) return ls;
  } catch (e) {}
  return Array.isArray(data.chats[crew]) ? data.chats[crew] : [];
}

function persistChats(crew, messages) {
  localStorage.setItem("study_chat_" + crew, JSON.stringify(messages));
  fetch(FN("study"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "saveChats", uid: UID, crew, messages }),
  }).catch(() => {});
}

function renderCrewBar() {
  const bar = $("crewBar");
  bar.innerHTML = "";
  CREW_UI.forEach((c) => {
    const el = document.createElement("div");
    el.className = "crew-card" + (c.name === currentCrew ? " on" : "");
    el.innerHTML = '<span class="crew-emoji">' + c.emoji + "</span><span>" + c.name + "</span><span class='crew-tag'>" + c.tag + "</span>";
    el.addEventListener("click", () => switchCrew(c.name));
    bar.appendChild(el);
  });
}

function switchCrew(name) {
  currentCrew = name;
  localStorage.setItem("study_crew", name);
  renderCrewBar();
  renderChat();
}

function renderChat() {
  const box = $("chatBox");
  const msgs = loadLocalChats(currentCrew);
  box.innerHTML = "";
  if (!msgs.length) {
    box.innerHTML = '<div class="chat-empty">点下面的「发送」和' + currentCrew + '聊聊，或点「考考我」让 TA 出题。<br>TA 看得到你的真实学习进度哦。</div>';
    return;
  }
  msgs.forEach((m) => {
    const div = document.createElement("div");
    div.className = "msg " + m.role;
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = m.role === "user" ? "我" : currentCrew;
    const body = document.createElement("div");
    body.textContent = m.content;
    div.appendChild(who); div.appendChild(body);
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

function renderCompanion() {
  renderCrewBar();
  renderChat();
  $("quizBtn").classList.toggle("quiz-on", quizMode);
  $("quizBtn").textContent = quizMode ? "结束出题" : "考考我";
}

async function sendUserMessage(text) {
  text = (text || "").trim();
  if (!text || chatBusy) return;
  const msgs = loadLocalChats(currentCrew);
  msgs.push({ role: "user", content: text });
  $("chatInput").value = "";
  renderChat();
  await callAI(msgs);
}

async function callAI(msgs) {
  chatBusy = true;
  const box = $("chatBox");
  const loading = document.createElement("div");
  loading.className = "msg assistant";
  loading.textContent = currentCrew + " 思考中…";
  box.appendChild(loading);
  box.scrollTop = box.scrollHeight;
  try {
    const r = await fetchWithTimeout(FN("chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crew: currentCrew, messages: msgs, mode: quizMode ? "quiz" : "chat", uid: UID }),
    }, 30000);
    const j = await r.json();
    if (j.error) {
      msgs.push({ role: "assistant", content: j.error });
    } else {
      msgs.push({ role: "assistant", content: j.reply || "（没收到回复，稍后再试）" });
      persistChats(currentCrew, msgs);
    }
  } catch (e) {
    msgs.push({ role: "assistant", content: "（连接失败，确认已部署且配好 ZHIPU_API_KEY）" });
  }
  chatBusy = false;
  renderChat();
}

function toggleQuiz() {
  quizMode = !quizMode;
  $("quizBtn").classList.toggle("quiz-on", quizMode);
  $("quizBtn").textContent = quizMode ? "结束出题" : "考考我";
  if (quizMode) sendUserMessage("请出一道题考考我");
}

/* ============ 设置 ============ */
/* ============ 刷题 ============ */
/* 题库来自开源数据集 Bolin97/TCMLE（Apache-2.0），进刷题页时才懒加载，不拖慢首屏 */
let quizBank = null;
let quizList = [];
let quizIdx = 0;
/* 当前这道题是否处于「重做中」——重做时选项解锁，历史照常保留 */
let quizRedoing = false;
/* 郝万山讲题按钮开关（默认关，不主动烧 token） */
let haoOn = localStorage.getItem("study_hao") === "on";
let quizFilter = { lv: "", src: "", year: "", kind: "", order: "seq", only: "" };
const QZ_LV = { L: "执业医师", A: "助理医师" };
const QZ_KIND = { C: "基础概念题", T: "理论题", D: "分析诊断题" };
const QZ_SRC = { P: "历年真题", M: "模拟题" };
/* 题库里的 y 字段是数据集内部编号 1~5，不对应真实年份 —— 所以叫「卷」，不叫「年」 */
const QZ_VOL = { 1: "第 1 卷", 2: "第 2 卷", 3: "第 3 卷", 4: "第 4 卷", 5: "第 5 卷" };

/* ============ 伤寒专科：哪些题郝万山接得住 ============
 * 讲稿是《伤寒论》讲课实录，只有六经辨证和经方他能引着讲。
 * 所以先分两级判定：
 *   只用强词（六经病名 / 经方名 / 伤寒论）—— 命中一个就算。
 * 试过再加一层「症状弱词」（脉浮、恶寒、汗出这类）来捞纯描述题，实测误伤严重：
 * 肺痈、热瘴、皮肤瘙痒都被判成伤寒，反而不如只要强词干净，所以弱词那层砍掉了。
 * 命中 471 题（占 7.5%），够单独成册刷。
 * 判定只用来决定「讲题按钮出不出来」和「伤寒专科刷哪些题」，不改动任何题目本身。
 */
const SHANG_STRONG = [
  "伤寒论", "伤寒杂病论", "六经", "六经辨证", "太阳病", "阳明病", "少阳病", "太阴病", "少阴病", "厥阴病",
  "太阳中风", "太阳伤寒", "经方", "条文",
  "桂枝汤", "麻黄汤", "葛根汤", "大青龙汤", "小青龙汤", "白虎汤", "白虎加人参汤",
  "调胃承气汤", "小承气汤", "大承气汤", "小柴胡汤", "大柴胡汤", "柴胡桂枝汤",
  "柴胡桂枝干姜汤", "柴胡加龙骨牡蛎汤", "理中丸", "理中汤", "四逆汤", "四逆散", "真武汤", "附子汤",
  "当归四逆汤", "吴茱萸汤", "五苓散", "猪苓汤", "苓桂术甘汤", "茯苓桂枝白术甘草汤",
  "栀子豉汤", "黄连汤", "半夏泻心汤", "生姜泻心汤", "甘草泻心汤", "旋覆代赭汤", "炙甘草汤",
  "茯苓四逆汤", "桃核承气汤", "抵当汤", "大陷胸汤", "小陷胸汤", "大陷胸丸", "三物白散",
  "麻杏石甘汤", "麻黄杏仁甘草石膏汤", "葛根黄芩黄连汤", "黄芩汤", "十枣汤", "白通汤",
  "通脉四逆汤", "乌梅丸", "干姜附子汤", "芍药甘草汤", "小建中汤", "麻黄附子细辛汤",
  "麻黄附子甘草汤", "黄连阿胶汤", "猪肤汤", "桔梗汤", "半夏散", "瓜蒂散",
  "桂枝加厚朴杏子汤", "桂枝加葛根汤", "桂枝新加汤", "桂枝去芍药汤", "桂枝附子汤",
  "白术附子汤", "甘草附子汤", "桂枝人参汤", "桂枝甘草汤", "茯苓桂枝甘草大枣汤",
  "厚朴生姜半夏甘草人参汤", "赤石脂禹余粮汤", "小柴胡", "大柴胡",
];
const shangText = (q) =>
  String(q.q || "") + " " + (q.o || []).join(" ") + " " + String(q.r || "");
function isShang(q) {
  const t = shangText(q);
  for (const k of SHANG_STRONG) if (t.includes(k)) return true;
  return false;
}

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const quizRec = () => (data.quiz && typeof data.quiz === "object" ? data.quiz : (data.quiz = {}));

async function ensureQuizBank() {
  if (quizBank) return quizBank;
  try {
    const r = await fetchWithTimeout("data/questions/questions.json", {}, 25000);
    if (!r.ok) throw new Error("bad");
    quizBank = await r.json();
  } catch (e) {
    quizBank = null;
  }
  return quizBank;
}

function quizFiltered() {
  if (!quizBank || !quizBank.questions) return [];
  const f = quizFilter;
  const rec = quizRec();
  let arr = quizBank.questions.filter(
    (q) =>
      (!f.lv || q.l === f.lv) &&
      (!f.src || q.s === f.src) &&
      (!f.year || String(q.y) === f.year) &&
      (!f.kind || q.k === f.kind)
  );
  if (f.only === "wrong") arr = arr.filter((q) => rec[q.i] && rec[q.i].ok === false);
  else if (f.only === "undo") arr = arr.filter((q) => !rec[q.i]);
  else if (f.only === "shang") arr = arr.filter(isShang);
  else if (f.only === "shangw") arr = arr.filter((q) => isShang(q) && rec[q.i] && rec[q.i].ok === false);
  if (f.order === "rand") {
    arr = arr.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
  }
  return arr;
}

function quizDoneStats() {
  const list = Object.keys(quizRec()).map((k) => quizRec()[k]);
  return { done: list.length, wrong: list.filter((x) => !x.ok).length };
}

function renderQuizCount() {
  if (!quizBank) {
    $("quizCount").innerHTML = "题库加载中…";
    return;
  }
  const n = quizFiltered().length;
  const s = quizDoneStats();
  $("quizCount").innerHTML =
    "选中 <b>" + n + "</b> 题　·　已做 " + s.done + " 题，其中错 " + s.wrong + " 题";
}

async function renderQuiz() {
  await ensureQuizBank();
  if (!quizBank) {
    $("quizCount").innerHTML = "题库加载失败，刷新页面重试";
    return;
  }
  if (quizList.length) renderQuizQuestion();
  else renderQuizCount();
}

function startQuiz() {
  quizList = quizFiltered();
  quizIdx = 0;
  if (!quizList.length) {
    toast("这个范围没有题，换个条件试试");
    return;
  }
  $("quizSetup").style.display = "none";
  $("quizPlay").style.display = "block";
  renderQuizQuestion();
}

function exitQuiz() {
  quizList = [];
  $("quizPlay").style.display = "none";
  $("quizSetup").style.display = "block";
  renderQuizCount();
}

function renderQuizQuestion() {
  const q = quizList[quizIdx];
  if (!q) return;
  quizRedoing = false;                       // 换题就退出重做态
  const rec = quizRec()[q.i];

  $("quizProgress").textContent = "第 " + (quizIdx + 1) + " / " + quizList.length + " 题";
  $("quizTags").textContent = [QZ_LV[q.l], QZ_KIND[q.k], QZ_SRC[q.s], QZ_VOL[q.y]]
    .filter(Boolean)
    .join(" · ");
  $("quizBarIn").style.width = (((quizIdx + 1) / quizList.length) * 100).toFixed(1) + "%";
  $("quizStem").textContent = q.q;

  const box = $("quizOptions");
  box.innerHTML = "";
  ["A", "B", "C", "D", "E"].forEach((L, i) => {
    const txt = q.o && q.o[i];
    if (!txt) return;
    const b = document.createElement("button");
    b.className = "quiz-opt";
    b.dataset.letter = L;
    b.innerHTML = '<span class="ok">' + L + "</span><span>" + esc(txt) + "</span>";
    b.addEventListener("click", () => answerQuiz(L));
    box.appendChild(b);
  });

  $("quizFeedback").style.display = "none";
  $("quizReason").style.display = "none";
  $("quizHaoBox").style.display = "none";
  $("quizHaoRow").style.display = "none";
  $("quizRedoRow").style.display = "none";
  $("quizPrev").disabled = quizIdx === 0;
  $("quizNext").disabled = quizIdx === quizList.length - 1;

  if (rec) {
    showQuizResult(q, rec.a, rec.ok);
    showQuizHistory(rec);
    showHaoButton(q);
  }
}

function answerQuiz(letter) {
  const q = quizList[quizIdx];
  if (!q) return;
  const rec = quizRec();
  const old = rec[q.i];
  if (old && !quizRedoing) return;            // 已答过就不再改判，除非点了「重做本题」
  const ok = letter === q.a;
  const now = Date.now();

  if (old && quizRedoing) {
    // 重做：旧答案先存进历史，再覆盖「最近一次」。历史只增不删
    const base = Array.isArray(old.hist) && old.hist.length
      ? old.hist
      : [{ a: old.a, ok: old.ok, t: old.t }];
    old.hist = base.concat([{ a: letter, ok: ok, t: now }]);
    old.a = letter;
    old.ok = ok;
    old.t = now;
    old.n = old.hist.length;
  } else {
    rec[q.i] = { a: letter, ok: ok, t: now, n: 1, hist: [{ a: letter, ok: ok, t: now }] };
  }
  quizRedoing = false;
  saveSoon();
  showQuizResult(q, letter, ok);
  showQuizHistory(rec[q.i]);
  showHaoButton(q);

  // 答对：留 900ms 看一眼就自动进下一题（蓝基因的手感）
  // 答错：不自动跳，停在这儿把解析看完，自己点「下一题」
  // at 记下答题时的题号：若这 900ms 内你自己翻页了，就不抢你的操作
  if (ok) {
    const at = quizIdx;
    setTimeout(() => {
      if (quizIdx !== at) return;
      if (at < quizList.length - 1) {
        quizIdx += 1;
        renderQuizQuestion();
      }
    }, 900);
  }
}

/* 重做本题：解锁选项、清掉本次的判题显示，但历史记录原封不动 */
function redoQuiz() {
  quizRedoing = true;
  $("quizOptions").querySelectorAll(".quiz-opt").forEach((n) =>
    n.classList.remove("locked", "right", "wrong")
  );
  $("quizFeedback").style.display = "none";
  $("quizReason").style.display = "none";
  $("quizRedoRow").style.display = "none";
  $("quizHaoRow").style.display = "none";
  $("quizHaoBox").style.display = "none";
  toast("重做这一题 —— 之前的记录都留着");
}

/* 答题区那行「做过 N 次 · 累计错 N 次」*/
function showQuizHistory(rec) {
  const hist = Array.isArray(rec.hist) && rec.hist.length
    ? rec.hist
    : [{ a: rec.a, ok: rec.ok, t: rec.t }];
  const wrong = hist.filter((h) => !h.ok).length;
  $("quizHistory").textContent =
    "做过 " + hist.length + " 次 · 累计错 " + wrong + " 次 · 上次选 " + rec.a;
  $("quizRedoRow").style.display = "flex";
}

/* 郝万山讲题按钮：只在开关打开、且这题属于伤寒范围时才出现 */
function showHaoButton(q) {
  const inShang = quizFilter.only === "shang" || quizFilter.only === "shangw";
  const show = haoOn && (inShang || isShang(q));
  $("quizHaoRow").style.display = show ? "block" : "none";
}

async function askHao() {
  const q = quizList[quizIdx];
  if (!q) return;
  const btn = $("quizHaoBtn"), box = $("quizHaoBox"), body = $("quizHaoBody");
  btn.disabled = true;
  btn.textContent = "🎙️ 郝万山正在翻讲稿…";
  box.style.display = "block";
  body.textContent = "（翻讲稿中，稍等几秒）";
  try {
    const r = await fetchWithTimeout(
      FN("chat"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crew: "郝万山",
          mode: "explain",
          uid: UID,
          question: { q: q.q, o: q.o || [], a: q.a, r: q.r || "" },
          messages: [{ role: "user", content: "讲讲这道题" }],
        }),
      },
      60000
    );
    const j = await r.json().catch(() => ({}));
    body.textContent =
      r.ok && j.reply ? j.reply : "没讲成：" + (j.error || "HTTP " + r.status);
  } catch (e) {
    body.textContent =
      "没讲成：" + ((e && e.message) || "网络不通") +
      "\n（讲题要调云端 AI 接口，本地直接打开 html 用不了，部署到 Netlify 后才行）";
  }
  btn.disabled = false;
  btn.textContent = "🎙️ 让郝万山讲讲这道题";
}

/* ============ 伤寒专科页 ============ */
async function renderShangHan() {
  await ensureQuizBank();
  $("haoSwitch").textContent = "讲题按钮：" + (haoOn ? "开" : "关");
  if (!quizBank) { $("shangCount").textContent = "题库加载失败，刷新页面重试"; return; }
  const all = quizBank.questions.filter(isShang);
  const rec = quizRec();
  const done = all.filter((q) => rec[q.i]).length;
  const wrong = all.filter((q) => rec[q.i] && rec[q.i].ok === false).length;
  $("shangCount").innerHTML =
    "伤寒相关 <b>" + all.length + "</b> 题　·　已做 " + done + " 题，其中错 " + wrong + " 题";
}

async function startShangHan(onlyWrong) {
  await ensureQuizBank();
  if (!quizBank) { toast("题库还没加载好"); return; }
  quizFilter = { lv: "", src: "", year: "", kind: "", order: "seq", only: onlyWrong ? "shangw" : "shang" };
  // 同步筛选按钮的高亮，免得页面上看着还是「全部」
  // shangw（伤寒里只刷错的）在界面上没有对应按钮，让它高亮到「伤寒相关」
  document.querySelectorAll(".qf-opts").forEach((g) => {
    const want = quizFilter[g.dataset.group] === "shangw" ? "shang" : quizFilter[g.dataset.group];
    g.querySelectorAll(".qf-btn").forEach((b) => b.classList.toggle("active", b.dataset.val === want));
  });
  switchPage("quiz");
  startQuiz();
}

function showQuizResult(q, picked, ok) {
  const nodes = $("quizOptions").querySelectorAll(".quiz-opt");
  nodes.forEach((n) => {
    const L = n.dataset.letter;
    n.classList.add("locked");
    if (L === q.a) n.classList.add("right");
    else if (L === picked) n.classList.add("wrong");
  });

  const fb = $("quizFeedback");
  fb.style.display = "block";
  fb.className = "quiz-feedback " + (ok ? "good" : "bad");
  fb.textContent = ok ? "答对了" : "答错了　你选 " + picked + "，正确答案 " + q.a;

  const text = (q.r || "").trim();
  $("quizReason").style.display = "block";
  if (text) {
    const maybeCut = text.length >= 150 || /[，。；：、]$/.test(text);
    $("quizReasonBody").textContent = text + (maybeCut ? "\n（这条解析可能不完整）" : "");
    $("quizReasonBody").className = "quiz-reason-b" + (maybeCut ? " cut" : "");
  } else {
    $("quizReasonBody").textContent = "这道题没有收录解析。";
    $("quizReasonBody").className = "quiz-reason-b cut";
  }
}

function quizPrev() {
  if (quizIdx > 0) {
    quizIdx -= 1;
    renderQuizQuestion();
  }
}
function quizNext() {
  if (quizIdx < quizList.length - 1) {
    quizIdx += 1;
    renderQuizQuestion();
  }
}

function renderSettings() {
  // 身份（多用户隔离）
  $("uidText").textContent = UID;
  $("copyLinkBtn").onclick = async () => {
    const link = myLink();
    try {
      await navigator.clipboard.writeText(link);
      toast("已复制专属链接（含身份码 " + UID + "）");
    } catch (e) {
      prompt("手动复制这个链接：", link);
    }
  };
  $("uidSwitchBtn").onclick = () => {
    const v = sanitizeUid($("uidInput").value);
    if (!v) { toast("身份码只能用中文、字母、数字、下划线"); return; }
    localStorage.setItem(UID_KEY, v);
    location.href = location.origin + location.pathname + "?u=" + encodeURIComponent(v);
  };

  $("examDate").value = data.examDate || "";
  const themes = { plain: "淡雅", mucha: "穆夏", monet: "莫奈", ukiyoe: "浮世绘" };
  const cur = document.body.dataset.theme || "plain";
  $("themeOptions").innerHTML = Object.keys(themes).map((k) =>
    '<button class="tier-pill' + (cur === k ? " on" : "") + '" data-theme="' + k + '">' + themes[k] + "</button>"
  ).join("");
  $("themeOptions").querySelectorAll(".tier-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.body.dataset.theme = pill.dataset.theme;
      localStorage.setItem("study_theme", pill.dataset.theme);
      renderSettings();
      toast("已切换：" + themes[pill.dataset.theme]);
    });
  });
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "来都来了备份-" + todayStr() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("备份已下载");
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || !Array.isArray(d.checkins) || typeof d.checkedItems !== "object") throw new Error("bad");
      if (!confirm("导入会覆盖当前的打卡与进度，确定吗？")) { e.target.value = ""; return; }
      data = d;
      await saveData();
      renderAll();
      toast("恢复完成");
    } catch (err) {
      toast("文件格式不对，没有恢复任何数据");
    }
    e.target.value = "";
  };
  reader.readAsText(file);
}

function clearData() {
  if (!confirm("确定要清空所有打卡记录和大纲轮次吗？")) return;
  if (!confirm("再次确认：清空后无法恢复。仍要清空吗？")) return;
  data = emptyData();
  saveData();
  renderAll();
  toast("已清空。一切从头开始，也完全没问题。");
}

/* ============ 总渲染 / 启动 ============ */
function renderAll() {
  renderTabs();
  renderToday();
  renderOutline();
  renderCalendar();
  renderSettings();
}

async function init() {
  try {
    outline = await fetchWithTimeout("outline.json", {}, 15000).then((r) => r.json());
  } catch (e) {
    $("todayDateLine").textContent = "大纲加载失败：请双击「双击启动.bat」打开，或直接双击 index.html 会读不到数据";
    markOffline();
    return;
  }
  await loadData();
  bindEvents();
  const qt = new URLSearchParams(location.search).get("theme");
  document.body.dataset.theme = ["plain", "mucha", "monet", "ukiyoe"].includes(qt)
    ? qt : (localStorage.getItem("study_theme") || "plain");
  try {
    renderAll();
  } catch (e) {
    console.error(e);
    toast("页面渲染出错，已记入控制台");
  }
  markSaved();
  const hash = location.hash.replace("#", "");
  if (["today", "outline", "calendar", "companion", "settings"].includes(hash)) switchPage(hash);
  window.addEventListener("hashchange", () => {
    const h = location.hash.replace("#", "");
    if (["today", "outline", "calendar", "companion", "settings"].includes(h)) switchPage(h);
  });
}

init();
