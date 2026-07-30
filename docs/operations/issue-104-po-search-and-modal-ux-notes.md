# Issue 104 — PO search, browse and modal layout requirements

## Purpose

The Purchase Order editor must support both fast lookup and guided browsing. A single keyword input is not sufficient for large catalogs or users who prefer category/product navigation.

## Product/SKU selection modes

The editor must expose two equivalent entry modes that feed the same canonical SKU eligibility contract:

### 1. Tìm nhanh

- Search by product code, product name, SKU, SKU name and barcode.
- Minimum two characters before remote search.
- Accessible combobox/listbox with keyboard navigation, selection count and clear action.
- Result cards/rows show product code/name, SKU/name, unit, conversion and eligibility.
- Filters: `Có thể mua`, `Cần thiết lập`, `Tất cả`.
- Bounded server-side pagination; never preload the complete catalog.

### 2. Duyệt danh mục

- A visible button/tab such as `Chọn từ danh mục` opens a browse panel; it must not be hidden behind the keyword box.
- Filters include product category, brand, product, SKU status/eligibility and optionally barcode text.
- Product rows can expand to show their SKUs, or a product selector can populate a SKU panel beside it.
- Users can select one or multiple eligible SKUs and add them to the PO in one explicit action.
- Ineligible SKUs remain visible when the `Cần thiết lập` or `Tất cả` filter is active, with a clear reason and a link/action to Product setup.
- Search and browse use the same server-side eligibility contract and duplicate-line rules.

## Modal and line-table layout

The current modal compresses business labels and values. The redesign must not rely on making the whole browser wider.

- Use a larger desktop dialog where viewport allows, but preserve responsive behavior.
- Keep header and footer/actions sticky while the body scrolls.
- Split the editor into clear sections: header information, product/SKU selector, line editor, totals, bulk entry.
- Do not squeeze all line controls into equal-width table columns.
- Set practical minimum widths for quantity, price, discount mode, discount value, tax, amount and note.
- Discount mode labels must display fully: `% tiền hàng`, `Giảm mỗi đơn vị`, `Giảm tổng dòng`.
- Inputs/selects must not clip text or rely on placeholders to convey saved values.
- On medium/narrow viewports, render each PO line as a responsive card or grouped two-row layout instead of an unreadable compressed table.
- A horizontal scroll fallback is acceptable only when column headers and current row identity remain understandable/sticky.
- Amounts must not wrap into broken fragments such as a number on one line and `VND` on another unless intentionally designed.
- Notes need enough width to enter meaningful text.
- Browser E2E/visual assertions must cover common desktop widths with DevTools/sidebar reducing available viewport, because this reproduced the clipping issue.

## Bulk entry placement

`Nhập nhiều dòng` must be a first-class mode alongside `Tìm nhanh` and `Duyệt danh mục`, with a guided panel rather than a raw collapsed `<details>` block.

## Acceptance summary

A user must be able to add PO lines by:

1. typing a keyword and choosing a SKU;
2. browsing/filtering products and expanding/selecting SKUs;
3. importing or pasting multiple lines.

All three paths must produce the same validated draft lines without hidden eligibility differences or clipped business fields.
