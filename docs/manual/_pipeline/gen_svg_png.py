# -*- coding: utf-8 -*-
"""Extract inline SVG diagrams from the web manual and render them to PNG via headless Chrome."""
import re, os, subprocess, sys, tempfile

ROOT = r"C:/Users/24920/Desktop/LBJ_projects/DX-20S_releases"
WEB = os.path.join(ROOT, "docs/manual/DX-20S_用户手册_网页版.html")
OUT = os.path.join(ROOT, "docs/manual/assets")
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"

html = open(WEB, encoding="utf-8").read()
svgs = re.findall(r'<svg viewBox="0 0 680 [^"]*".*?</svg>', html, re.S)
print("found svg:", len(svgs))

names = ["fig1_body", "fig3_main", "fig5_menu", "fig7_bright", "fig10_dist"]
heights = [350, 420, 560, 130, 250]

for i, svg in enumerate(svgs):
    name = names[i] if i < len(names) else "fig%d" % (i + 1)
    h = heights[i] if i < len(heights) else 300
    page = (
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'
        'html,body{margin:0;padding:0;background:#ffffff}'
        'svg{width:680px;height:auto;display:block}'
        '</style></head><body>' + svg + '</body></html>'
    )
    tmp = os.path.join(OUT, "_svg_%s.html" % name)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(page)
    png = os.path.join(OUT, "scr_%s.png" % name)
    cmd = [
        CHROME, "--headless", "--disable-gpu", "--no-sandbox",
        "--force-device-scale-factor=2",
        "--window-size=680,%d" % (h + 20),
        "--screenshot=" + png,
        "--hide-scrollbars",
        "file:///" + tmp.replace("\\", "/"),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    ok = os.path.exists(png)
    print(name, "->", "OK" if ok else "FAIL", os.path.getsize(png) if ok else r.stderr[-300:])
    os.remove(tmp)
print("done")
