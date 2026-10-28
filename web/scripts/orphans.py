"""列出 src 下从 src/app 入口出发不可达的源文件（按 import 静态分析）。

用法：python3 web/scripts/orphans.py web [--delete]（删减 NewAPI 前端时用）
"""
import re
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
src = root / 'src'
EXTS = ['.ts', '.tsx', '.json', '.css', '.svg', '.png']
spec_re = re.compile(r"""(?:from|import)\s*\(?\s*['"]([^'"]+)['"]""")


def resolve(base: Path, spec: str) -> Path | None:
    if spec.startswith('@/'):
        target = src / spec[2:]
    elif spec.startswith('.'):
        target = (base.parent / spec).resolve()
    else:
        return None
    candidates = [target] + [target.with_name(target.name + e) for e in EXTS]
    candidates += [target / f'index{e}' for e in EXTS]
    for c in candidates:
        if c.is_file():
            return c
    return None


entries = [p for p in (src / 'app').rglob('*') if p.is_file()]
entries += [p for p in src.glob('*.d.ts')]
seen: set[Path] = set()
stack = list(entries)
while stack:
    f = stack.pop()
    if f in seen:
        continue
    seen.add(f)
    if f.suffix not in ('.ts', '.tsx', '.css'):
        continue
    for spec in spec_re.findall(f.read_text()):
        r = resolve(f, spec)
        if r and r not in seen:
            stack.append(r)

orphans = sorted(
    p for p in src.rglob('*')
    if p.is_file() and p not in seen and p.suffix in ('.ts', '.tsx') and not p.name.endswith('.d.ts')
)
lines = sum(len(p.read_text().splitlines()) for p in orphans)
for p in orphans:
    print(p.relative_to(root))
print(f'{len(orphans)} orphan files, {lines} lines')
if '--delete' in sys.argv:
    for p in orphans:
        p.unlink()
    print('deleted')
