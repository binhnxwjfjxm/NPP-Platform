from pathlib import Path
import re

path = Path('npp-core/web/app/purchasing/goods-receipts/GoodsReceiptWorkspace.tsx')
text = path.read_text(encoding='utf-8')
cp_extra = '\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178'
span_pattern = re.compile(rf'[\x00-\xff{cp_extra}]+')
markers = ('Ã', 'Â', 'Ä', 'Æ', 'â€', 'á»', 'áº', 'ðŸ')


def score(value: str) -> int:
    return sum(value.count(marker) for marker in markers)


def repair_span(value: str) -> str:
    current = value
    for _ in range(5):
        best = current
        best_score = score(current)
        for encoding in ('latin1', 'cp1252'):
            try:
                candidate = current.encode(encoding).decode('utf-8')
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
            candidate_score = score(candidate)
            if candidate_score < best_score:
                best = candidate
                best_score = candidate_score
        if best == current:
            break
        current = best
    return current

clean = span_pattern.sub(lambda match: repair_span(match.group(0)), text)
leftovers = [(index, line) for index, line in enumerate(clean.splitlines(), 1) if any(marker in line for marker in markers)]
if leftovers:
    for index, line in leftovers:
        print(f'{index}: {line}')
    raise SystemExit('mojibake remains after controlled cleanup')
path.write_text(clean, encoding='utf-8', newline='\n')
