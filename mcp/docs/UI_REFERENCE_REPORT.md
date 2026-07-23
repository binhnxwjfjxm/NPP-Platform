# UI Reference - Old Report App

Source reviewed: `gustavjung01/report`.

Purpose: learn presentation patterns only. Do not copy old business logic, data flow, or legacy runtime patches.

## Positioning

The old report app is not a design target. It is a reference mine.

Use it like this:

```text
Observe live behavior.
Extract useful interaction patterns.
Reject fragile implementation and messy visuals.
Rebuild the pattern as clean MCP-Plan React UI.
```

Do not treat any old screen as final design.

## What to keep from old report UI

### 1. Mobile-first density

The old report app is rough, but it fits mobile data work well because it keeps each screen compact:

```text
short top area
compact KPI strip
horizontal filter chips
scrollable card list
small action row
fixed bottom navigation
```

This is useful for MCP-Plan because field users need fast scanning, not large decorative blocks.

### 2. Home cards

The home screen uses four simple action cards:

```text
MCP tuyến
Đơn hàng
Test sản phẩm
Báo cáo
```

Each card has:

```text
icon
short title
one-line description
small CTA pill
```

MCP-Plan should keep this idea, but with cleaner spacing, better grouping, and real module names.

### 3. Today dashboard

The old report app has a compact `Hôm nay` block with small KPIs:

```text
MCP
Đơn
DT
Test
BC
```

This is better than one large noisy dashboard for mobile. MCP-Plan should show the daily operational summary first.

### 4. Data hub tabs

The old report app uses four large tabs:

```text
MCP
Đơn
Test
Báo cáo
```

This is easy to understand. MCP-Plan can use this pattern for switching module data views, but the implementation should be React components, not legacy DOM mutation.

### 5. MCP route screen pattern

Good presentation pattern:

```text
route hero card
small score pills
4 KPI mini cards
horizontal status filters
customer card list
fixed action buttons per customer
```

This is the best pattern to reuse for MCP-Plan's route/day session screen.

### 6. List card structure

Each customer/list card should be compact:

```text
left: title + small metadata
right: status badge
actions: 3-4 fixed buttons
```

Avoid large paragraphs inside cards. Use one-line text, ellipsis, and clear badges.

### 7. Filter style

Use horizontal chips instead of big filter panels on mobile:

```text
Tất cả
Chưa ghé
Đã ghé
Có đơn
Cần quay lại
```

Filters should be scrollable horizontally and not consume vertical space.

## What is bad in the old report UI

Do not copy these parts:

```text
inline CSS blob in index.html
legacy DOM mutation scripts
emergency CSS overrides
runtime fix files
old IndexedDB flow
old Supabase direct-write logic
old AI bridge code
```

Also reject these UI problems:

```text
too many !important overrides
hard-to-maintain one-line CSS
mixed responsibilities between HTML, CSS, and JS
unclear visual hierarchy in some cards
icons used as decoration without status meaning
small typography that can become cramped
inconsistent module colors
actions packed too tightly without priority
screens that rely on height hacks instead of clear layout regions
```

The old repo itself says many legacy files should be cleaned. Treat it as visual reference only.

## Recycle strategy

### Recycle, do not copy

For each old pattern, MCP-Plan should decide:

```text
Keep: the user workflow idea.
Improve: spacing, hierarchy, accessibility, state clarity.
Replace: implementation, data flow, and styling system.
```

### Pattern evaluation checklist

Before reusing any old UI pattern, check:

```text
1. Does it reduce decision time for sales/user in the field?
2. Can the user understand status in under 2 seconds?
3. Does each card have one main decision?
4. Is the primary action obvious?
5. Does it still work on small iPhone width?
6. Can it be implemented as reusable React components?
7. Does it depend on legacy data shape or DOM mutation? If yes, reject.
```

## MCP-Plan upgraded design rules

### 1. Clear hierarchy

Use this order on operational screens:

```text
Screen purpose
Today/session status
KPI strip
Filter chips
Primary list
Action buttons
```

### 2. One card = one decision

Each card should answer:

```text
What is this item?
What is the current status?
What should I do next?
```

### 3. Status before decoration

Badges and colors must explain state:

```text
good / watch / risk
todo / visited / skipped / ordered / follow-up
synced / pending / failed
```

Do not use color only for decoration.

### 4. Compact but not cramped

Old report app is dense, but MCP-Plan should improve readability:

```text
larger touch targets
consistent border radius
short labels
no paragraph-heavy cards
no more than 3 metadata rows visible by default
```

### 5. Stable mobile app shell

Keep MCP-Plan app-like behavior:

```text
fixed bottom navigation
controlled scroll region
safe-area handled deliberately
no web-like page jump if avoidable
```

But avoid old report's CSS hacks.

## Module-by-module recycle plan

### Phase 1 - Dashboard

Reference from old report:

```text
Today summary
compact KPI block
action list
module entry cards
```

MCP-Plan improvement:

```text
stronger today summary card
2-column KPI strip on mobile
route health as cards instead of table
show API source state cleanly
```

Status: started.

### Phase 2 - MCP daily/session screen

Reference from old report:

```text
route hero
score pills
status chip filters
customer cards
action row per customer
```

MCP-Plan improvement:

```text
session snapshot source clearly shown
customer status badge standardized
actions grouped by real workflow: visit, order, test, follow-up
skip/cancel requires reason
no hard delete from opened session
```

### Phase 3 - Orders screen

Reference from old report:

```text
compact order card
short status badge
quick actions
```

MCP-Plan improvement:

```text
show order source: MCP / visit / phone
show customer + route context first
show amount and item count compactly
separate draft/confirmed/delivered states
```

### Phase 4 - Test product screen

Reference from old report:

```text
test file card
customer result list
small result action buttons
```

MCP-Plan improvement:

```text
separate file setup from result entry
show product count and customer count
show pending/completed result count
avoid tiny action buttons if workflow is complex
```

### Phase 5 - Market report / field check

Reference from old report:

```text
report module entry
basic report cards
```

MCP-Plan improvement:

```text
field check templates
competitor / price / display / stock status
photo evidence slot later
clear follow-up task creation
```

## Component targets

Create or improve these reusable pieces:

```text
TodaySummaryCard
CompactKpiStrip
StatusChipBar
OperationalListCard
CustomerVisitCard
RouteSessionHero
ActionButtonRow
SourceBadge
SyncStatePill
```

These components should be data-shape agnostic and receive clean DTO props from API client/backend.

## What not to do

```text
Do not port old report CSS.
Do not use inline CSS blobs.
Do not add more emergency override files.
Do not let frontend calculate complex business logic.
Do not copy old IndexedDB/Supabase write flow.
Do not make every screen visually dense just because old report is dense.
```

## First UI refactor target

Start with Dashboard only:

```text
DashboardPage
KpiCard
FilterBar
mobile table/card handling
```

Then move to MCP day/session screen.
