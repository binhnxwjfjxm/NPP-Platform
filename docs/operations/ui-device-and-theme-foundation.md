# UI device and theme foundation

> Status: implementation baseline for Issue #276.

## Device ownership

| Frontend | Primary device | Secondary device | Runtime truth |
|---|---|---|---|
| NPP Operations | Desktop web | Tablet; phone for quick review only | Browser runtime. No separate desktop app exists today. |
| Admin MCP/NPP | Desktop and mobile web | Tablet | Responsive browser runtime. Mobile focuses on alerts, summaries and exception approval. |
| MCP Field | Phone | Tablet | Mobile-first PWA. Desktop is support/inspection only. |
| Delivery | Phone | Tablet | Mobile-first PWA for drivers and delivery staff. |
| Website + customer ordering | Desktop and phone | Tablet | Separate repository and independent Vercel project. |

A future desktop wrapper for NPP may reuse the web runtime, but this foundation does not create or claim a sixth runtime.

## Shared visual language

The reference portal contributes the enterprise mood, not its cramped density. The Hưng Phát system uses:

- warm ivory canvas `#f7f5f1`;
- white primary surfaces `#ffffff`;
- warm gray secondary surfaces `#efebe4` and table headers `#e5e1da`;
- bronze primary `#98600f` and dark bronze `#754706`;
- charcoal text `#2d2924` and muted text `#70685f`;
- warm border `#d8d0c4`;
- semantic green, amber and red remain independent for success, warning and danger.

## Mobile app layout rules

MCP Field and Delivery must not render a desktop page at a narrower width.

1. One fixed app header, one independently scrolling content region and one bottom navigation owner.
2. No desktop sidebar on phones.
3. Four or five persistent bottom destinations maximum; additional actions belong in the app menu or contextual bottom sheet.
4. Touch controls are at least 44–46 px high.
5. Filters become chips or a bottom sheet; they do not remain a wide desktop toolbar.
6. Work is presented as task cards, route/stop cards and stacked detail sections rather than wide tables.
7. The primary action stays easy to reach with one hand and respects safe-area insets.
8. Sheets and dialogs have a sticky action footer, clear close control and one internal scroll owner.
9. Offline/sync and error states remain visible and do not rely on color alone.

## Per-app intent

### NPP Operations

Keep the left navigation, dense operational tables, filters and master-detail workflows. Use the warm-gold chrome and table system without sacrificing desktop information density.

### Admin MCP/NPP

Desktop keeps summary grids and drill-down panels. Mobile stacks cards, keeps alerts and exception approvals prominent, and avoids reproducing daily NPP CRUD.

### MCP Field

Use a compact top app bar, five-item bottom navigation, task-first dashboard, route/session cards, scan/photo actions and bottom sheets. The phone shell hides the desktop sidebar completely.

### Delivery

Make the active trip, next stop, customer/address and result action the visual priority. Cards are compact, tap targets are large, and the page chrome remains stable while the route list scrolls.

## Operational boundary

This foundation is frontend-only. It does not change APIs, permissions, database schema, migration state, providers or production deployment.