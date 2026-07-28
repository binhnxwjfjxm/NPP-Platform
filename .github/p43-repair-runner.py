from pathlib import Path

script_path = Path('.github/p43-comprehensive-repair.py')
source = script_path.read_text(encoding='utf-8')

source = source.replace(
    """       AND base_variant_id = $4
        AND lot_id IS NOT DISTINCT FROM $5`,""",
    """       AND base_variant_id = $4
       AND lot_id IS NOT DISTINCT FROM $5`,""",
)

exec(compile(source, str(script_path), 'exec'))
