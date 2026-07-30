# Issue 104 — Acceptance checklist

## Product selection

- [ ] `Tìm nhanh` and `Chọn từ danh mục` are visible peer modes.
- [ ] `Nhập nhiều dòng` is a visible peer mode, not a technical collapsed detail.
- [ ] Browse mode filters by category, brand, product and SKU eligibility.
- [ ] A product can expand/reveal its SKUs without a separate keyword search.
- [ ] Multiple eligible SKUs can be selected and added in one action.
- [ ] Ineligible SKUs remain explainable when requested and link to setup.
- [ ] Search and browse share one server-side eligibility contract.

## Responsive editor

- [ ] No clipped discount labels or select values.
- [ ] Quantity, price, discount, tax and note controls retain usable widths.
- [ ] Amount + currency renders as one deliberate unit.
- [ ] Header and action footer remain reachable while body scrolls.
- [ ] At reduced desktop viewport widths, lines switch to grouped/card layout or another readable responsive structure.
- [ ] Horizontal scrolling, when used, does not hide row identity or make columns ambiguous.
- [ ] Tests cover at least wide desktop, reduced desktop and tablet-like viewport widths.

## Error behavior

- [ ] Backend version skew on SKU search never appears as `Purchase order was not found`.
- [ ] Product lifecycle conflicts preserve structured details and display Vietnamese action guidance.
