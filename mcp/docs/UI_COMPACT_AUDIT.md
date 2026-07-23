# UI Compact Audit

Reason: current MCP-Plan UI is cleaner than the old report app technically, but the old report app still feels more compact for field work.

## Main finding

MCP-Plan currently optimizes for clean structure, reusable components, and visible state. That is good for maintainability, but some screens now feel heavier than the old report UI.

The old report UI is rough, but it is faster to scan because it prioritizes compact operational use:

```text
short top area
compact KPI row
horizontal chips
small cards
small repeated actions
fast access to MCP / Orders / Test / Reports
```

## UX problems in current MCP-Plan

### 1. Too many layers before the main list

Many screens now have this stack:

```text
PageHeader
Today/Hero card
FilterBar
KPI strip
Section header
List cards
Secondary section
```

For mobile field usage, this delays the primary list.

### 2. Cards are clean but still too tall

Orders, Test, and Report cards use metric boxes inside each card. This improves readability but costs vertical space.

Old report cards are more compact because they show:

```text
title + status
short context line
small actions
```

### 3. Action hierarchy is unclear

Several cards show 3-5 actions at equal weight:

```text
Xem / Viec / Giao
Nhap / Anh / Viec
Xu ly / Don / Test / BC / Viec
```

Field users need one obvious primary action, then secondary actions hidden or visually reduced.

### 4. Bottom navigation is too dense

After adding Reports, bottom nav has 8 items. This is too much on small iPhone width.

Better target:

```text
Tong quan
MCP
Don
Test
Plan
```

Other modules can live inside a hub/menu:

```text
Tuyen
Khach
Bao cao
Cai dat
```

### 5. Dashboard still feels too dashboard-like

Old report app is clearer because it surfaces four operational modules:

```text
MCP
Don hang
Test san pham
Bao cao
```

MCP-Plan dashboard should lead with module entry cards, then show route health and insights below.

### 6. Some secondary tables remain

MCP day still has a DataTable for results. It should be converted to compact result cards or hidden behind a detail section to keep mobile consistency.

### 7. Unaccented Vietnamese hurts product feel

Some labels were changed to ASCII during connector-safe commits. This makes the app feel unfinished.

Restore Vietnamese accents in UI labels once safe.

## What to keep from old report UI

```text
compact operational density
simple module entry cards
short status chips
thin customer/order/test cards
repeated action row pattern
quick scan before detail
```

## What not to copy

```text
legacy DOM mutation
inline CSS blobs
old IndexedDB flow
old Supabase direct writes
emergency CSS overrides
unclear old visual hierarchy
```

## Recommended design direction: MCP-Plan Compact Mode

### Dashboard

Change from heavy dashboard to operational home:

```text
Today one-line summary
4 module cards: MCP / Don / Test / Bao cao
Priority actions
Route health collapsed/compact
Insights last
```

### MCP day

```text
Short session bar instead of large hero
No separate FilterBar if status chips exist
Customer card max target: 72-88px
Primary action: Xu ly
Secondary actions inside sheet or icon row
Convert result DataTable to result cards
```

### Orders

Current card has too many boxed metrics. Compact target:

```text
Row 1: order code + amount + status
Row 2: customer · route · date
Row 3: source · SKU · quantity
Actions: Xem / Theo doi
```

### Test product

```text
File setup as compact strip, not two large cards
Result card: product + account + status
Only primary action visible: Nhap
Photo/task actions secondary
```

### Market report

```text
Keep templates: Gia / Doi thu / Trung bay / Ton kho
Report card should show subject + account + status first
Avoid 3 boxed metrics per card
```

### Bottom nav

Reduce to 5 primary items:

```text
Tong quan
MCP
Don
Test
Plan
```

Move the rest into dashboard hub or settings/menu:

```text
Tuyen
Khach
Bao cao
Cai dat
```

## Proposed implementation phases

### Compact P0 - Restore language polish

Restore Vietnamese accents on visible UI labels.

### Compact P1 - Dashboard home redesign

Add module entry cards before route health.

### Compact P2 - Shared compact list card

Create a reusable operational list card pattern:

```text
OperationalListCard
CompactActionRow
StatusPill
MetaLine
```

### Compact P3 - MCP customer card density

Reduce MCP customer card height and move secondary actions into sheet.

### Compact P4 - Orders/Test/Report cards

Remove heavy metric boxes from repeated list cards.

### Compact P5 - Bottom nav simplification

Reduce bottom nav to five main items and add a module hub.

## Decision

Do not continue adding more UI features until this compact pass is done. The app is structurally cleaner now, but field usability should be improved before backend write flows.
