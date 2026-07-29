from pathlib import Path

path = Path('npp-core/web/app/purchasing/goods-receipts/GoodsReceiptWorkspace.tsx')
text = path.read_text(encoding='utf-8')
line = "                    const varianceReasonRequired = varianceAllowed && (rejectedPositive || line.finalizeLine);\n"
if text.count(line) != 3:
    raise SystemExit(f'expected 3 duplicate declarations, found {text.count(line)}')
text = text.replace(line * 3, line, 1)
path.write_text(text, encoding='utf-8', newline='\n')
