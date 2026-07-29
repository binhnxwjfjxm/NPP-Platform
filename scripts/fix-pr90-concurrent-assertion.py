from pathlib import Path

path = Path('npp-core/api/test/supplier-return.test.js')
text = path.read_text(encoding='utf-8')
old = "    assert.equal(await errorCode(rejectedPost), 'RETURN_QUANTITY_EXCEEDS_RETURNABLE');\n"
new = "    assert.equal(await errorCode(rejectedPost), 'SOURCE_LINE_NOT_RETURNABLE');\n"
if text.count(old) != 1:
    raise SystemExit(f'expected one concurrent assertion, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8', newline='\n')
