from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'npp-core' / 'web' / 'app' / 'components' / 'app-shell.module.css'
text = path.read_text(encoding='utf-8')
old = """  .brandText,\n  .navCopy,\n  .navLabel,\n  .chevron,\n  .userCopy {\n    display: grid;\n  }\n\n  .brandRow {\n    flex-direction: row;\n  }"""
new = """  .shellCollapsed .brandText,\n  .shellCollapsed .navCopy,\n  .shellCollapsed .chevron,\n  .shellCollapsed .userCopy,\n  .brandText,\n  .navCopy,\n  .chevron,\n  .userCopy {\n    display: grid;\n  }\n\n  .shellCollapsed .navLabel,\n  .navLabel {\n    display: block;\n  }\n\n  .shellCollapsed .brandRow,\n  .brandRow {\n    justify-content: flex-start;\n    flex-direction: row;\n  }\n\n  .shellCollapsed .navItem {\n    justify-content: flex-start;\n    padding-inline: 10px;\n  }\n\n  .shellCollapsed .userPlaceholder {\n    justify-content: flex-start;\n  }"""
if text.count(old) != 1:
    raise RuntimeError('Expected responsive sidebar block was not found exactly once')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
