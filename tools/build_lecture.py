#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把讲稿原文切成检索片段，生成 data/lectures/<name>.json

用法：
    python tools/build_lecture.py 原文.txt 郝万山
    python tools/build_lecture.py 原文.txt 郝万山 --min 120 --max 400

切段策略（简单但够用）：
1. 先按空行/换行切成自然段
2. 太短的段（< min）与下一段合并，避免碎片段
3. 太长的段（> max）按句号/问号/感叹号再切，保证每段语义完整
4. 过滤掉明显是页码、标题、目录的噪声行
"""

import argparse
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "data", "lectures")

# 噪声行：页码、纯数字、极短标题
NOISE = re.compile(r"^\s*(\d+|第?[一二三四五六七八九十百千]+[章节篇]|[.\-—_\s]*|page\s*\d+)\s*$", re.I)


def split_long(text, max_len):
    """把过长段落按句末标点切开，尽量凑到 max_len 左右"""
    parts = re.split(r"(?<=[。！？；!?])", text)
    out, buf = [], ""
    for p in parts:
        if not p:
            continue
        if len(buf) + len(p) <= max_len:
            buf += p
        else:
            if buf:
                out.append(buf)
            # 单句本身就超长，就硬切
            while len(p) > max_len:
                out.append(p[:max_len])
                p = p[max_len:]
            buf = p
    if buf:
        out.append(buf)
    return out


def build(raw_path, author, min_len=120, max_len=400):
    with open(raw_path, encoding="utf-8") as f:
        raw = f.read()

    # 统一换行，去掉行尾空白
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n|\n", raw) if p.strip()]

    segments, buf = [], ""
    for p in paragraphs:
        if NOISE.match(p) or len(p) < 8:
            continue
        buf = (buf + p) if buf else p
        if len(buf) >= min_len:
            if len(buf) > max_len:
                segments.extend(split_long(buf, max_len))
            else:
                segments.append(buf)
            buf = ""

    if buf:
        if len(buf) > max_len:
            segments.extend(split_long(buf, max_len))
        else:
            segments.append(buf)

    data = {
        "meta": {
            "author": author,
            "title": "%s讲稿（口语化节选）" % author,
            "note": "由 tools/build_lecture.py 从原文自动切段生成；用于让该角色引用真实讲稿原话。",
            "source": os.path.basename(raw_path),
            "version": 1,
            "segmentCount": len(segments),
        },
        "segments": [
            {"id": "%s-%03d" % (_slug(author), i + 1), "text": s}
            for i, s in enumerate(segments)
        ],
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, _slug(author) + ".json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    total = sum(len(s) for s in segments)
    print("✅ 已生成 %s" % out_path)
    print("   段数：%d 段，总字数：%d 字，平均每段 %d 字" % (
        len(segments), total, (total // len(segments)) if segments else 0))
    print("   提示：段数在 100~600 之间比较理想；太多会拖慢检索，太少则覆盖不全。")
    return out_path


def _slug(name):
    """中文名转文件名：郝万山 -> haowanshan（拼音手写表，够用即可）"""
    table = {
        "郝万山": "haowanshan",
        "刘渡舟": "liuduzhou",
    }
    return table.get(name, re.sub(r"\W+", "", name).lower() or "lecture")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raw", help="讲稿原文 txt 路径")
    ap.add_argument("author", help="讲者姓名，如 郝万山")
    ap.add_argument("--min", type=int, default=120, help="最短段长，默认 120")
    ap.add_argument("--max", type=int, default=400, help="最长段长，默认 400")
    args = ap.parse_args()

    if not os.path.exists(args.raw):
        print("❌ 找不到文件：%s" % args.raw)
        sys.exit(1)
    build(args.raw, args.author, args.min, args.max)


if __name__ == "__main__":
    main()
