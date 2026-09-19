# -*- coding: utf-8 -*-
"""
下载开源中医执业医师题库数据集 Bolin97/TCMLE（Apache-2.0）
并合并成单一 questions.json，供 study-ai 刷题模块使用。

用法：
  python fetch_tcmle.py            # 下载 + 合并
  python fetch_tcmle.py --stats    # 只统计已下载数据

数据源：https://huggingface.co/datasets/Bolin97/TCMLE
  镜像：https://hf-mirror.com/datasets/Bolin97/TCMLE
结构： Licensed|Assistant / <题型> / Year_1..5 / Past_Paper.json | Mock.json
字段： question_num, query, options{A..E}, answer, reason
"""
import io
import json
import os
import re
import sys
import time
import urllib.request
from collections import Counter, defaultdict

BASE = "https://hf-mirror.com/datasets/Bolin97/TCMLE/resolve/main"
API = "https://hf-mirror.com/api/datasets/Bolin97/TCMLE/tree/main"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) study-ai/1.0"}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "data", "questions", "raw")
OUT = os.path.join(ROOT, "data", "questions", "questions.json")

LEVELS = ["Licensed", "Assistant"]
KINDS = [
    ("Fundamental_Concept_Questions", "基础概念题"),
    ("Theory_Questions", "理论题"),
    ("Analytical_Diagnostic_Questions", "分析诊断题"),
]


def get(url, timeout=60, retry=3):
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if i == retry - 1:
                print("  ! 失败 %s -> %s" % (url.split("/")[-1], e))
                return None
            time.sleep(1.5 * (i + 1))
    return None


def list_dir(path):
    raw = get(API + "/" + path)
    if not raw:
        return []
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return []


def clean(s):
    """清洗 OCR 噪声：多余空白、乱码字符"""
    if not s:
        return ""
    s = str(s).replace("\r", "\n")
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def fetch_all():
    paths = []
    for lv in LEVELS:
        for kdir, klabel in KINDS:
            for y in range(1, 6):
                d = "%s/%s/Year_%d" % (lv, kdir, y)
                for f in list_dir(d):
                    if f["path"].endswith(".json"):
                        paths.append((f["path"], lv, klabel, y,
                                      "真题" if "Past_Paper" in f["path"] else "模拟"))
    print("发现 %d 个 json 文件，开始下载…\n" % len(paths))

    rows = []
    for i, (path, lv, klabel, y, src) in enumerate(paths, 1):
        dest = os.path.join(RAW_DIR, path.replace("/", "__"))
        if os.path.exists(dest) and os.path.getsize(dest) > 100:
            data = json.loads(io.open(dest, encoding="utf-8").read())
        else:
            raw = get(BASE + "/" + path)
            if not raw:
                continue
            os.makedirs(RAW_DIR, exist_ok=True)
            io.open(dest, "wb").write(raw)
            data = json.loads(raw.decode("utf-8"))
        for q in data:
            rows.append({
                "lv": lv, "kind": klabel, "year": y, "src": src,
                "num": q.get("question_num"),
                "query": clean(q.get("query")),
                "options": {k: clean(v) for k, v in (q.get("options") or {}).items()},
                "answer": clean(q.get("answer")),
                "reason": clean(q.get("reason")),
            })
        print("  [%2d/%2d] %-62s %4d 题" % (i, len(paths), path.split("/")[-2] + "/" + src, len(data)))
    return rows


def build(rows):
    # 去重：题干 + 正确答案
    seen, uniq = set(), []
    for r in rows:
        key = re.sub(r"\s+", "", r["query"])[:120] + "|" + r["answer"]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    return uniq


# 短代码：减小 json 体积（映射表写进 meta，前端渲染时还原）
LV_CODE = {"Licensed": "L", "Assistant": "A"}
KIND_CODE = {"基础概念题": "C", "理论题": "T", "分析诊断题": "D"}
SRC_CODE = {"真题": "P", "模拟": "M"}

LV_NAME = {"L": "执业医师", "A": "助理医师"}
KIND_NAME = {"C": "基础概念题", "T": "理论题", "D": "分析诊断题"}
SRC_NAME = {"P": "历年真题", "M": "模拟题"}


def report(rows, uniq):
    print("\n" + "=" * 46)
    print("题库统计（合并前 %d 条 → 去重后 %d 条）" % (len(rows), len(uniq)))
    print("=" * 46)
    print("\n按类别：")
    for k, v in sorted(Counter((r["lv"], r["kind"]) for r in uniq).items()):
        print("  %-10s %-8s %5d" % (k[0], k[1], v))
    print("\n按年份：")
    for k, v in sorted(Counter(r["year"] for r in uniq).items()):
        print("  Year_%d  %5d" % (k, v))
    no_reason = sum(1 for r in uniq if len(r["reason"]) < 10)
    short_reason = sum(1 for r in uniq if 10 <= len(r["reason"]) < 60)
    print("\n解析质量：无/极短解析 %d 条（%.1f%%），疑似被截断 %d 条（%.1f%%）"
          % (no_reason, no_reason * 100.0 / max(1, len(uniq)),
             short_reason, short_reason * 100.0 / max(1, len(uniq))))
    lens = sorted(len(r["query"]) for r in uniq)
    print("题干长度：中位 %d 字，最长 %d 字" % (lens[len(lens) // 2], lens[-1]))


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    rows = fetch_all()
    if not rows:
        print("没有下载到任何数据")
        return 1
    uniq = build(rows)
    report(rows, uniq)
    compact = []
    for i, r in enumerate(uniq):
        opts = r["options"]
        compact.append({
            "i": i + 1,
            "l": LV_CODE.get(r["lv"], "L"),
            "k": KIND_CODE.get(r["kind"], "T"),
            "y": r["year"],
            "s": SRC_CODE.get(r["src"], "P"),
            "q": r["query"],
            "o": [opts.get(c, "") for c in "ABCDE"],
            "a": r["answer"],
            "r": r["reason"],
        })
    out = {
        "meta": {
            "source": "Bolin97/TCMLE（HuggingFace，Apache-2.0）",
            "sourceUrl": "https://huggingface.co/datasets/Bolin97/TCMLE",
            "note": "中医执业/助理医师资格考试题库。year 为数据集内部匿名编号(1-5)，不对应真实年份",
            "caveat": "约 47% 的解析疑似被截断；数据集存在 OCR 缺字，答案仅供参考",
            "generated": time.strftime("%Y-%m-%d"),
            "total": len(compact),
            "codes": {
                "l": {"L": "执业医师", "A": "助理医师"},
                "k": {"C": "基础概念题", "T": "理论题", "D": "分析诊断题"},
                "s": {"P": "历年真题", "M": "模拟题"},
            },
        },
        "questions": compact,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    size = os.path.getsize(OUT) / 1024.0
    print("\n已写入 %s（%.1f KB）" % (OUT, size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
