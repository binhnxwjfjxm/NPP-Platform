from pathlib import Path

path = Path('npp-core/api/src/services/purchase-order.js')
text = path.read_text(encoding='utf-8')
anchor = """function scaledToDecimal(value) {
  const integer = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer.toString();
}
"""
helper = anchor + """
function fixedScaleQuantity(value) {
  const text = String(value ?? '').trim();
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) return text;
  return `${match[1]}.${(match[2] ?? '').padEnd(6, '0')}`;
}
"""
if text.count(anchor) != 1:
    raise SystemExit('scaledToDecimal anchor mismatch')
text = text.replace(anchor, helper, 1)
replacements = {
    "String(line.received_quantity)": "fixedScaleQuantity(line.received_quantity)",
    "String(line.accepted_quantity)": "fixedScaleQuantity(line.accepted_quantity)",
    "String(line.rejected_quantity)": "fixedScaleQuantity(line.rejected_quantity)",
    "String(line.shortage_closed_quantity)": "fixedScaleQuantity(line.shortage_closed_quantity)",
    "String(line.remaining_quantity)": "fixedScaleQuantity(line.remaining_quantity)",
    "String(order.received_quantity_total)": "fixedScaleQuantity(order.received_quantity_total)",
    "String(order.accepted_quantity_total)": "fixedScaleQuantity(order.accepted_quantity_total)",
    "String(order.rejected_quantity_total)": "fixedScaleQuantity(order.rejected_quantity_total)",
    "String(order.shortage_closed_quantity_total)": "fixedScaleQuantity(order.shortage_closed_quantity_total)",
    "String(order.remaining_quantity_total)": "fixedScaleQuantity(order.remaining_quantity_total)",
}
for old, new in replacements.items():
    if text.count(old) != 1:
        raise SystemExit(f'expected one mapping target for {old}, found {text.count(old)}')
    text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8', newline='\n')
