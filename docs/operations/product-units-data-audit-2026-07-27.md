# Phase 3.3D — Product unit source audit

> Generated: 2026-07-27  
> Source files: `BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx`, `BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx`  
> Purpose: lock quantity, unit, conversion and barcode inputs before database import.

## Executive result

- Canonical conversion rows: **606**.
- Unique retail/base SKUs: **606**.
- Unique converted/carton SKUs: **606**.
- Duplicate retail/base SKUs: **0**.
- Duplicate converted/carton SKUs: **0**.
- Missing retail/carton SKU: **0**.
- Non-positive or non-integer conversion factors: **0**.
- Explicit carton barcode rows: **606**; all 606 currently equal the explicit converted SKU and are therefore classified as `INTERNAL`, not inferred EAN/UPC values.
- Venue-channel mapped SKU rows: **343 rows / 342 unique SKUs**; every mapped SKU exists in the 606-row canonical source.
- Canonical SKUs not represented in venue mapping: **264**.

The conversion count is the source of truth for stock normalization. Physical weight metadata is descriptive only and must never replace the per-product conversion factor.

## Blocking review rows

Two source rows use `THÙNG` as both the smallest/base unit label and the converted unit label. They are preserved but must not be imported automatically until reviewed:

| Source row | Product | Base SKU | Converted SKU | Conversion | Base description | Converted description |
|---:|---|---|---|---:|---|---|
| 137 | THẠCH DỪA CHANH DÂY | `TDUCDA` | `TDUCDAT` | 6 | 0 g / THÙNG | 6 THÙNG / THÙNG |
| 358 | NẮP CẦU VUÔNG 95 | `NCVG95` | `NCVG95T` | 40 | 0 g / THÙNG | 40 THÙNG / THÙNG |

## Non-blocking warnings

### Missing or zero base net-content metadata — 159 rows

These rows still have valid SKU pairs and positive conversion factors. They may be imported for quantity conversion, but the physical content fields remain `null` until reviewed. Inventory conversion must not be calculated from weight.

### Unit labels with embedded package size — 5 rows

The source labels are preserved in `sourceLabel`; the canonical unit code strips the embedded size because size belongs in net-content metadata:

- `RUOCAT` — source `BỊCH 500G` → canonical `BICH`; net content `{'value': '500', 'unitCode': 'G'}`.
- `PMANCH` — source `HỘP 1KG` → canonical `HOP`; net content `{'value': '1', 'unitCode': 'KG'}`.
- `KBTSIH` — source `HỘP 1KG` → canonical `HOP`; net content `{'value': '1100', 'unitCode': 'G'}`.
- `MCHADL` — source `BỊCH 500G` → canonical `BICH`; net content `None`.
- `BTRCAT` — source `TÚI 5KG` → canonical `TUI`; net content `{'value': '5000', 'unitCode': 'G'}`.

### `HỦ` / `HŨ` alias normalization — 36 rows

Both spellings map to canonical unit code `HU`. The original spelling is retained in source metadata.

### Package-weight difference — 349 rows

This is informational. Many carton weights include outer packaging or contain inconsistent source measurements. The system stores the source values but never derives conversion from them.

## Canonical unit codes

| Canonical code | Display name | Kind | Fractional quantity |
|---|---|---|---|
| `CHAI` | Chai | COUNT | No |
| `BICH` | Bịch | COUNT | No |
| `HOP` | Hộp | COUNT | No |
| `GOI` | Gói | COUNT | No |
| `BINH` | Bình | COUNT | No |
| `HU` | Hũ | COUNT | No |
| `LON` | Lon | COUNT | No |
| `CAN` | Can | COUNT | No |
| `KG` | Kilôgam | WEIGHT | Yes |
| `CAY` | Cây | PACKAGE | No |
| `THUNG` | Thùng | PACKAGE | No |
| `LOC` | Lốc | PACKAGE | No |
| `CUON` | Cuộn | COUNT | No |
| `TUI` | Túi | PACKAGE | No |
| `BAO` | Bao | PACKAGE | No |

## Import artifact

Blocked-row review artifact:

```text
data/imports/product-units-conversions-2026-07-23-review-required.json
```

The 604 clean rows are regenerated from the committed workbooks during rehearsal, checked against this audit summary, and then submitted through the normalized import API. They are not committed as an opaque bulk snapshot.

Rules:

- `productCode` defaults to the canonical base SKU.
- explicit converted SKU always wins; no `T` suffix is generated;
- base conversion is exactly `1`;
- converted conversion is the integer count supplied by the canonical workbook;
- converted barcode is imported as `INTERNAL` because the source value equals the converted SKU;
- prices are excluded and remain Phase 3.3E;
- rows with `blockingReview` are rejected by the import service unless explicitly approved in a revised payload.

## Production boundary

This audit does not apply migration `013` or import data to production. Production database/backend rollout remains grouped after the full Phase 3 master-data gate, with fresh provider audit, backup, restore rehearsal and reconciliation.
