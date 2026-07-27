# Phase 3.3E — Pricing source audit

> Audit date: 2026-07-27  
> Production import: not performed

## Sources

- `BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx`
- `BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx`

The audit is executable through:

```text
npp-core/api/scripts/audit-pricing-workbooks.py
npp-core/api/test/pricing-source.test.js
```

Core API CI fails when the locked source counts or workbook structure change unexpectedly.

## Canonical retail/carton source

`MASTER_CHUAN` contains:

- 606 product rows;
- 606 unique retail/base SKUs;
- 606 unique carton/converted SKUs;
- no duplicate retail or carton SKU in the canonical pairs;
- 563 rows with a positive retail price after update;
- 43 rows with missing/zero retail price after update;
- 563 rows with a positive normalized carton price;
- 168 rows with a positive carton retail price in the original `GIA_THUNG_GOC` sheet.

Interpretation:

- retail and carton prices remain separate source fields;
- carton price must never be derived from retail price × conversion;
- zero/missing values are not imported as sellable prices;
- the difference between normalized carton price coverage and original carton-price coverage must remain traceable during rehearsal;
- 43 missing retail prices require administrator/business review rather than automatic substitution.

## Venue-channel source

`MAP_CHI_TIET` contains:

- 343 mapped rows;
- 342 unique SKU values;
- one repeated SKU row requiring source-key review;
- 338 rows with a positive channel price;
- five rows with missing/zero channel price;
- 69 rows marked `CẦN DUYỆT - NHIỀU SKU KHÁC QUY CÁCH/GIÁ`.

Status counts:

```text
KHỚP CHẮC - DÒNG NGUỒN                     144
KHỚP NHÓM - NHIỀU SKU CÙNG GIÁ             110
CẦN DUYỆT - NHIỀU SKU KHÁC QUY CÁCH/GIÁ     69
KHỚP CHẮC - TÊN/GIÁ                          20
```

Interpretation:

- venue prices belong to a dedicated sales channel and price list;
- all 69 review-required rows are blocked from unattended import;
- the five missing/zero prices are not imported;
- the repeated SKU is resolved only through a deterministic source key and business review;
- multiple normalized SKUs may legitimately receive the same source-channel price when the source explicitly maps them.

## Controlled import policy

During Phase 3 grouped rehearsal:

1. Apply migrations `010` through `014` on the rehearsal database.
2. Import product/SKU/unit identities first.
3. Create canonical `BASE` and venue `CHANNEL` lists.
4. Generate one source key per workbook/sheet/row/SKU/list identity.
5. Import only positive, unambiguous prices.
6. Block review-required, duplicate-source and zero-price rows.
7. Re-run the same import and prove idempotent update/no duplicate behavior.
8. Reconcile inserted/updated/skipped/review counts against this audit.
9. Do not apply the production import until backup, restore rehearsal and before/after reconciliation are complete.

No production data, migration or deployment is claimed by this document.
