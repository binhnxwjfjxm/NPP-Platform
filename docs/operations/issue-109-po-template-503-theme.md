# Issue 109 — Purchase-order template, live 503 provenance and subtle theme adjustment

## Production evidence

- Vercel production source is commit `a2e2cdea99847110b41fa30a29530e8dea4756a4`.
- Vercel runtime logs recorded 10 responses with HTTP 503 at `/api/purchase-orders/sku-search` during the inspected six-hour window.
- The web gateway intentionally maps backend `PURCHASE_ORDER_NOT_FOUND` from an older purchase-order backend to `PURCHASE_ORDER_SKU_SEARCH_UNAVAILABLE` with HTTP 503. This is a backend/frontend rollout mismatch, not a browser or static asset failure.
- Backend rollout remains a separate production operation and must happen before frontend smoke acceptance.

## Source fixes

1. Replace the tiny `.tsv` template download with an Excel-friendly UTF-8 CSV template using a semicolon delimiter and a `.csv` filename.
2. Strip a leading UTF-8 BOM before parsing uploaded/pasted rows so the downloaded template round-trips without treating the header as data.
3. Clarify the download label for office users.
4. Lighten only the purchase-order brown accents slightly; do not change the application-wide palette.
5. Add focused regression tests.

## Boundaries

- No `mcp/**` changes.
- No migration.
- No production database mutation.
- No attempt to hide or downgrade the 503 capability mismatch.
- No production deploy in the source-change PR.
