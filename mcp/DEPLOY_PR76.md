# Production deploy marker — Orders and Reader Reports

- Latest PRs: `#78`, `#79`, `#80`, `#81`, `#82`
- Latest merge SHA: `b6118c4b55224336b4091abf2f5ff4feedf68bed`
- Scope: order operations, persisted order detail and reader-facing report/export standards
- Order detail: authenticated `GET /api/orders/:id` returns persisted header and every order item
- Production backend verification: real order `ORD-20260720-29EC5B` returned 13 persisted product lines before frontend rollout
- Detail UX: bounded right drawer on desktop; full-screen detail on mobile/PWA
- Report audience: business owners, managers, sales staff and customers—not developers
- Printable reports: Unicode Vietnamese business titles, findings, warnings, actions and detailed business rows
- Session report: printable report, Word, Markdown and Excel/CSV use reader-facing language
- Other reports: management dashboard, market report, product trial and order slip use business titles and labels
- CSV exports: business columns first; reconciliation identifiers remain translated and appear later
- CSV safety: formula-like cells are neutralized before opening in spreadsheet software
- Export errors: friendly user message plus retained internal error code
- Export menus: distinguish readable reports from operational Excel/CSV data
- Validation: Foundation F0.2 PASS; F05 UI Browser Smoke PASS; Export Reader Runtime Smoke PASS
- Database migration: not required
- Backend VPS: order detail endpoint already verified live
- Triggered: 2026-07-21
