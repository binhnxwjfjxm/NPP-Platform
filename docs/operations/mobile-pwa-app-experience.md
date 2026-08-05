# Mobile PWA App Experience — MCP Field and Delivery

> Status: implementation task
> Date: 2026-08-05
> Branch: `agent/mobile-pwa-app-experience`

## Goal

Complete the mobile application experience promised by Issue #276. This task changes frontend structure and interaction hierarchy, not only theme tokens.

## MCP Field

- Keep the existing MCP domain flows and data sources.
- Use a persistent mobile dock with the field workflow at the center: Home, Routes, Today, Orders and Reports.
- Make “Đi tuyến” the primary mobile action.
- Give inner screens a contextual top bar with a back action.
- Add a compact launchpad on the home screen for starting field work without opening the full menu.
- Preserve one scroll region, safe-area support and the desktop sidebar for large screens.

## Delivery

- Keep Core Logistics APIs and existing delivery-attempt/POD behavior unchanged.
- Present the active trip as the primary home card.
- On trip detail, surface the next unfinished stop and link directly to its result form.
- Keep trip overview secondary to the next operational action.
- Add stable mobile application chrome and safe-area spacing.

## Boundary

- Frontend only.
- No backend, database, migration, provider or deployment changes.
- No invented operational status or fake delivery data.
- CI and contract tests must lock the mobile hierarchy.
