#!/usr/bin/env python3
"""Bundle web/ into a single self-contained HTML file (dist/owpuzzle.html)
suitable for hosting anywhere (no external requests)."""
import os, re

root = os.path.join(os.path.dirname(__file__), "..")
web = os.path.join(root, "web")
out_dir = os.path.join(root, "dist")
os.makedirs(out_dir, exist_ok=True)

html = open(os.path.join(web, "index.html")).read()

def inline(m):
    src = m.group(1)
    js = open(os.path.join(web, src)).read()
    return "<script>\n" + js + "\n</script>"

html = re.sub(r'<script src="([^"]+)"></script>', inline, html)

out = os.path.join(out_dir, "owpuzzle.html")
open(out, "w").write(html)
print("wrote", os.path.abspath(out), len(html), "bytes")
