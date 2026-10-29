# -*- coding: utf-8 -*-
"""Embed images as base64 data URIs into the Word-bound HTML."""
import re, os, base64, sys

ROOT = r"C:/Users/24920/Desktop/LBJ_projects/DX-20S_releases/docs/manual"
SRC = os.path.join(ROOT, "_pipeline/stage2/formatted-DX20S用户手册.html")
DST = os.path.join(ROOT, "_pipeline/stage2/embedded-DX20S用户手册.html")

html = open(SRC, encoding="utf-8").read()
missing = []

def repl(m):
    src = m.group(1)
    if src.startswith("data:"):
        return m.group(0)
    path = os.path.normpath(os.path.join(os.path.dirname(SRC), "..", "..", src))
    if not os.path.exists(path):
        # try relative to manual dir
        path2 = os.path.normpath(os.path.join(ROOT, src))
        if os.path.exists(path2):
            path = path2
        else:
            missing.append(src)
            return m.group(0)
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return 'src="data:image/png;base64,%s"' % b64

html2 = re.sub(r'src="([^"]+)"', repl, html)
open(DST, "w", encoding="utf-8").write(html2)

imgs = re.findall(r'src="data:image/png;base64,', html2)
print("embedded images:", len(imgs))
print("missing:", missing)
print("size:", os.path.getsize(DST))
