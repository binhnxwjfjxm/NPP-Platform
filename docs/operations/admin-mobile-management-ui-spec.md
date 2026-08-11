# Admin MCP/NPP — Mobile Management UI Specification

> Status: **ACTIVE — OWNER LOCKED**  
> Date: **2026-08-11**  
> Scope: **Admin MCP/NPP frontend**  
> Source: `admin/web/**`  
> Runtime: independent Vercel frontend, shared Core backend and shared Core workforce authentication  
> Integration in this phase: **frontend information architecture and UI contract only; no new backend, database, migration or production rollout**

---

## 1. Product role

Admin MCP/NPP is an independent management application for managers/owners to:

- see management-level summaries from Core and MCP;
- receive and prioritize rule-based alerts;
- review proposals or exceptions that require management authority;
- approve, reject or request more information when a decision is required;
- review management reports and trends;
- see the evidence, reason, source, requester and audit history behind a decision.

Admin is **not** a smaller copy of NPP Operations and is **not** a shortcut page that sends the manager back to Core for normal work.

The target experience is:

```text
management signal
-> understand impact
-> inspect evidence/context
-> make or defer a decision
-> retain decision history
```

The application must answer three management questions quickly:

1. What needs my decision?
2. What is abnormal or risky?
3. How is the business performing?

---

## 2. Runtime and authority boundary

### 2.1 Frontend boundary

Admin remains its own frontend application:

```text
admin/web/**
-> Vercel project: admin-mcp-npp
-> production domain: admin.nguyenlieuhungphat.com
```

Its UI, navigation, page structure and mobile interaction model are independent from NPP Operations.

### 2.2 Backend boundary

Admin does **not** gain a separate business backend.

Target runtime:

```text
Admin frontend
    -> Core backend
        -> shared PostgreSQL installation
```

Admin must not connect directly to PostgreSQL and must not introduce a frontend database client.

MCP information needed by Admin must be exposed through an approved backend contract. The frontend must not bypass Core/MCP domain ownership merely to build a dashboard.

### 2.3 Authentication boundary

Admin uses the same workforce identity/authentication authority as Core.

The Admin frontend may keep its own secure session cookie implementation for the frontend boundary, but the identity and session validity remain Core-owned and are verified against Core authentication contracts.

Do not create:

- an Admin-only user database;
- a second username/password authority;
- a separate Owner identity model;
- a parallel permission source of truth.

Admin authorization must later be enforced by backend permissions/scopes appropriate to management actions.

---

## 3. What Admin must not become

Admin must not contain normal daily operational CRUD copied from Core.

Do not move these workflows into Admin merely because a manager can view their data:

- create/edit normal Sales Orders;
- normal purchasing or Goods Receipt processing;
- stock receipt, issue, transfer or stocktake posting;
- master-data maintenance;
- routine customer creation/linking;
- route execution, MCP check-in or field data capture;
- routine delivery execution;
- normal accounting posting/allocation work.

A management tab named `Kho`, `Công nợ` or `Giao vận` means management visibility, risk, trend, alert or approval context. It does not mean the Core operational screen is duplicated inside Admin.

---

## 4. Mobile-first interaction model

Admin is a **mobile-first management application**.

The primary design target is a phone viewport and one-handed use. Desktop may use the same information architecture with more width, but desktop must not dictate the mobile layout.

### 4.1 Primary navigation

Use a fixed four-item bottom navigation:

```text
Tổng quan | Phê duyệt | Cảnh báo | Báo cáo
```

Rules:

- four primary destinations only;
- no sidebar as the primary navigation;
- no `Menu` item in the bottom navigation;
- profile/settings/logout live in a secondary account/menu surface;
- navigation labels stay short and management-oriented.

### 4.2 Secondary navigation inside each main screen

Each main screen may contain a compact set of **icon-tabs**.

An icon-tab is a clearly separate business destination inside the current module:

```text
[icon]
Label
badge/count when useful
```

Rules:

- icon + short label;
- badge only when it represents actionable quantity or meaningful status;
- selecting a tab changes the related content inside the module;
- do not build deep nested menus;
- do not use horizontally wide desktop tables as the primary mobile interaction;
- prefer cards, prioritized lists, compact KPI blocks and full-screen/mobile detail views.

### 4.3 Page rhythm

Default screen structure:

```text
compact header
-> icon-tabs when the module has subdomains
-> status/summary strip when needed
-> primary content
-> sticky or bottom actions only when the current item is actionable
-> fixed app bottom navigation
```

Each screen must have one primary purpose.

---

## 5. Main information architecture

The Admin frontend has four primary screens.

## 5.1 Tổng quan

Purpose: give management a concise cross-domain view of what requires attention now.

This is not a separate operational module and must not become a collection of external links to NPP Operations.

Recommended content:

- proposals waiting for decision;
- critical/high alerts;
- sales/revenue summary;
- gross margin summary;
- receivable risk summary;
- inventory risk summary;
- delivery/COD summary;
- MCP activity/market summary;
- trend versus the previous comparable period;
- data freshness/availability status when a source is incomplete.

Priority blocks should lead directly to the corresponding Admin approval, alert or report context.

The Overview page is implemented after the three management modules are structurally stable so it can summarize real Admin concepts instead of inventing disconnected cards.

---

## 5.2 Trung tâm phê duyệt

Purpose: one management decision workspace for proposals/exceptions that truly require higher authority.

### Icon-tabs

Initial frontend taxonomy:

```text
Tất cả
Thương mại
Khách hàng & công nợ
Kho
Giao vận & COD
MCP
Lịch sử
```

The exact backend event/type mapping is deferred to the integration phase, but the frontend taxonomy is locked as the management-facing structure.

### Approval list item

Each item should expose enough information for prioritization without opening detail:

- proposal type;
- source: Core or MCP;
- requester;
- affected customer/order/entity when applicable;
- value or impact when applicable;
- reason for escalation;
- priority/severity;
- submitted time and waiting age;
- current decision state.

### Approval detail

Mobile detail must present information in this order:

```text
Decision summary
-> business impact
-> reason / rule / threshold
-> proposal data
-> evidence or supporting context
-> requester and source
-> history / audit timeline
-> decision actions
```

Standard management actions:

```text
Phê duyệt
Yêu cầu bổ sung
Từ chối
```

A specific proposal type may support fewer actions if the backend lifecycle requires it. The frontend must never invent an action that does not exist in the canonical backend lifecycle.

### Decision UX rules

- actions must identify exactly what will be decided;
- rejection and request-for-information flows must capture an appropriate reason when required;
- do not hide material impact behind another application;
- do not approve from a one-line list item without opening sufficient context for consequential decisions;
- completed decisions move to history and retain audit context.

---

## 5.3 Trung tâm cảnh báo theo rule

Purpose: show abnormal conditions generated from explicit management rules or thresholds.

An alert is **not automatically an approval**.

Alerts inform and prioritize. A separate approval item is created only when the business lifecycle requires a management decision.

### Icon-tabs

Initial frontend taxonomy:

```text
Tổng hợp
Kinh doanh
Công nợ
Kho
Giao vận
MCP
Quy tắc
Lịch sử
```

### Alert item

Every actionable alert should show:

- alert title;
- severity;
- source/domain;
- observed value;
- configured rule/threshold when applicable;
- affected entity;
- first/last detected time;
- current state.

### Severity language

Use management-facing Vietnamese labels:

```text
Nghiêm trọng
Cao
Cần chú ý
Thông tin
```

Avoid vague state text such as `Ổn`, `Cần xem` or unexplained dashes when a clearer business status is available.

### Rule screen

The frontend may define and prototype a `Quy tắc` screen in this UI phase so information architecture is stable.

Backend persistence, evaluation engine, schedules and rule ownership are explicitly deferred.

The UI contract for a future rule should be able to express at least:

- rule name;
- business domain;
- measured metric/event;
- condition/threshold;
- severity;
- scope;
- enabled/disabled state;
- notification/escalation target where later supported.

No frontend-only rule may be presented as a real enforced production rule before backend integration exists.

---

## 5.4 Báo cáo quản trị Core/MCP

Purpose: management reporting, not operational CRUD reporting copied from Core.

### Icon-tabs

Initial frontend taxonomy:

```text
Điều hành
Kinh doanh & lợi nhuận
Công nợ
Kho
Giao vận & COD
MCP / thị trường
Nhân sự / hiệu suất
Phê duyệt & cảnh báo
```

### Report interaction

Reports should be readable on mobile through:

- headline KPIs;
- compact comparisons;
- trend charts;
- ranked lists/top exceptions;
- short management summaries;
- drill-in to an Admin report detail when needed.

Avoid using a wide data table as the only way to understand a report.

### Time filters

Default period controls:

```text
Hôm nay
7 ngày
Tháng này
Quý này
Tùy chọn
```

Where meaningful, show comparison with the previous equivalent period.

### Core/MCP separation

A report may combine Core and MCP information at management level, but the UI should keep source lineage understandable. Combined metrics must not imply that MCP owns Core business facts or vice versa.

---

## 6. Professional product language

Admin UI copy is written for management users, not developers.

Do not expose implementation vocabulary such as:

- phase numbers;
- canonical contract;
- backend boundary;
- drill-down;
- provider terminology;
- database or API wording;
- internal migration language;
- developer-only authorization terminology.

Poor UI copy:

```text
Phase 8.7 · Control Tower
Cảnh báo & drill-down
Backend phân loại ngoại lệ riêng
Ranh giới duyệt ngoại lệ
```

Target UI copy:

```text
7 đề xuất đang chờ quyết định
3 khoản công nợ đã vượt ngưỡng cảnh báo
Tỷ lệ giao thất bại tăng so với kỳ trước
Đề xuất điều chỉnh giá vượt chính sách
```

Copy rules:

- concise;
- factual;
- professional Vietnamese;
- state the business event and impact;
- use the same term for the same concept across all screens;
- avoid slang and engineering language.

---

## 7. Data-state UX

Frontend must explicitly design these states for every major module:

```text
loading
empty
partial data
error/unavailable
normal
warning
critical
permission denied
```

Rules:

- empty state means there is genuinely nothing to show;
- unavailable data must not be presented as zero;
- partial data must identify that the view is incomplete;
- error text must be user-facing and must not expose raw provider/database details;
- mock/demo data used during frontend construction must be visibly isolated from production data adapters and must not masquerade as live business data.

---

## 8. Frontend implementation sequence

Implementation after this specification is approved/merged:

### Stage A — Replace the old Admin shell

- replace current `Tổng hợp / Ngoại lệ / Menu` navigation;
- introduce `Tổng quan / Phê duyệt / Cảnh báo / Báo cáo`;
- remove `Menu` from bottom navigation;
- create the reusable mobile header, icon-tab and screen primitives;
- remove the current UX dependency on opening NPP Operations for normal Admin exploration.

### Stage B — Approval Center first

Build the full frontend interaction model for:

- icon-tabs;
- list;
- status/badges;
- mobile detail;
- decision action presentation;
- history.

Use frontend fixtures/adapters where backend contracts do not yet exist. Do not create fake production mutation endpoints.

### Stage C — Rule-based Alert Center

Build alert list/detail, severity model, history and rule-management UI shell without claiming backend rule persistence exists.

### Stage D — Core/MCP Management Reports

Build the reporting navigation, KPI/report layouts, filters and mobile chart/list structure.

### Stage E — Overview

Build Overview from the stable concepts of Approval, Alert and Reporting so the home screen reflects real management priorities.

---

## 9. Existing Admin UI migration rule

The current Admin UI is a legacy implementation relative to this specification.

The migration is a **replacement/refactor**, not an additive second UI beside the old one.

During implementation:

- obsolete routes, labels, navigation and tests must be updated or removed deliberately;
- do not preserve an old screen only to avoid changing a regression test;
- update regression tests to enforce this specification instead of the old `drill into NPP Operations` model;
- keep valid authentication/security behavior unless a separate task explicitly changes it;
- do not change backend, database or production deployment as a side effect of the UI refactor.

---

## 10. Acceptance gate for the frontend redesign

The Admin frontend redesign is structurally correct only when all of the following are true:

1. Mobile is the primary interaction model.
2. Bottom navigation is exactly the four management destinations.
3. Each main management module uses clear icon-tabs for smaller business areas where needed.
4. Admin can understand approvals, alerts and reports without being routinely redirected to NPP Operations.
5. No normal Core operational CRUD is duplicated in Admin.
6. UI language is professional business Vietnamese and does not expose developer terminology.
7. Approval and alert are separate concepts.
8. Core/MCP data lineage remains understandable.
9. Admin continues to use the shared Core backend and Core workforce authentication authority.
10. Backend/DB integration work is performed only after the frontend business/UI model is approved.

---

## 11. Deferred integration work

This specification intentionally does not implement or claim completion of:

- canonical approval APIs for every proposal type;
- rule storage/evaluation engine;
- alert persistence;
- new management reporting contracts;
- MCP-to-Admin aggregation contracts;
- backend authorization changes;
- database schema changes;
- migrations;
- production deployment.

Those items are follow-up integration work after the frontend product structure is stable.
