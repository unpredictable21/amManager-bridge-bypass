#!/usr/bin/env python3
"""Rebuild <firefox-dir>/omni.ja from an extracted tree, adding the PoC actor
modules. Firefox's libjar reads standard (non-optimized) zips.

Usage:
  1. unzip the current omni.ja once:   unzip -o "<firefox-dir>/omni.ja" -d omni-extract
  2. copy poc-child.sys.mjs / poc-parent.sys.mjs into omni-extract/modules/
  3. python rebuild-omni.py omni-extract <firefox-dir>
"""
import os, sys, zipfile

src = sys.argv[1] if len(sys.argv) > 1 else "omni-extract"
fdir = sys.argv[2] if len(sys.argv) > 2 else r"D:\firefox-research\poc-repro\firefox"
out = os.path.join(os.path.dirname(os.path.abspath(fdir)), "omni-new.ja")
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for dirpath, _, files in os.walk(src):
        for fn in files:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, src).replace("\\", "/")
            z.write(full, rel)
            n += 1
print("rebuilt", n, "entries ->", out)
print("back up the original omni.ja first, then copy", out, "over",
      os.path.join(fdir, "omni.ja"))
