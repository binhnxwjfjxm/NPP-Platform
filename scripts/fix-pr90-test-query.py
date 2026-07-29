from pathlib import Path

path = Path('npp-core/api/test/supplier-return.test.js')
text = path.read_text(encoding='utf-8')
old = """    const postedMovement = await pool.query(
      `SELECT movement_type, direction
         FROM inventory.inventory_movements
        WHERE installation_id = $1 AND id = $2`,
      [config.installationId, postedReturn.inventoryMovementId],
    );
"""
new = """    const postedMovement = await pool.query(
      `SELECT movement.movement_type, line.direction
         FROM inventory.inventory_movements movement
         JOIN inventory.inventory_movement_lines line
           ON line.installation_id = movement.installation_id
          AND line.movement_id = movement.id
        WHERE movement.installation_id = $1 AND movement.id = $2
        ORDER BY line.line_number
        LIMIT 1`,
      [config.installationId, postedReturn.inventoryMovementId],
    );
"""
if text.count(old) != 1:
    raise SystemExit(f'expected one movement query, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8', newline='\n')
