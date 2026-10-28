"""根据 tsc 的未使用诊断删掉 import 里没用的名字（不重排、不动其他代码）。

用法：python3 web/scripts/prune_imports.py web
只处理落在 import 语句里的 TS6133 / TS6192 / TS6196，其余诊断原样打印出来。
"""
import re
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
out = subprocess.run(['npx', 'tsc', '--noEmit'], cwd=root, capture_output=True, text=True).stdout
diag = re.compile(r"^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$")

per_file: dict[Path, list[tuple[int, int, str]]] = {}
for line in out.splitlines():
    m = diag.match(line)
    if not m or m.group(4) not in ('6133', '6192', '6196'):
        continue
    name = re.match(r"'([^']+)'", m.group(5))
    per_file.setdefault(root / m.group(1), []).append(
        (int(m.group(2)), int(m.group(4)), name.group(1) if name else '')
    )

import_re = re.compile(r"^import (type )?([\s\S]*?) from ('[^']+'|\"[^\"]+\")\n", re.M)
leftover = []
for path, items in per_file.items():
    src = path.read_text()
    edits = []
    for m in import_re.finditer(src):
        start_line = src.count('\n', 0, m.start()) + 1
        end_line = src.count('\n', 0, m.end() - 1) + 1
        hits = [it for it in items if start_line <= it[0] <= end_line]
        if not hits:
            continue
        for it in hits:
            items.remove(it)
        if any(code == 6192 for _, code, _ in hits):
            edits.append((m.start(), m.end(), ''))
            continue
        drop = {n for _, _, n in hits}
        clause = m.group(2)
        default = None
        named: list[str] = []
        brace = re.search(r"\{([\s\S]*)\}", clause)
        head = clause[: brace.start()] if brace else clause
        head = head.strip().rstrip(',').strip()
        if head:
            default = head
        if brace:
            for spec in brace.group(1).split(','):
                spec = spec.strip()
                if not spec:
                    continue
                local = spec.split(' as ')[-1].replace('type ', '').strip()
                if local not in drop:
                    named.append(spec)
        if default and default.split(' as ')[-1].strip() in drop:
            default = None
        if not default and not named:
            edits.append((m.start(), m.end(), ''))
            continue
        parts = [default] if default else []
        if named:
            one = '{ ' + ', '.join(named) + ' }'
            parts.append(one if len(one) <= 60 else '{\n  ' + ',\n  '.join(named) + ',\n}')
        text = f"import {m.group(1) or ''}{', '.join(parts)} from {m.group(3)}\n"
        edits.append((m.start(), m.end(), text))
    for s, e, t in sorted(edits, reverse=True):
        src = src[:s] + t + src[e:]
    if edits:
        path.write_text(src)
        print(f"{path.relative_to(root)}: {len(edits)} import(s) edited")
    leftover += [f"{path.relative_to(root)}:{ln} {name}" for ln, _, name in items]

if leftover:
    print('not in imports (fix by hand):')
    print('\n'.join('  ' + x for x in leftover))
