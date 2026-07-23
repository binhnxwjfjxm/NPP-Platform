# A4 — Repository, Transaction, Idempotency và Audit Ports

> Trạng thái: **COMPLETE / CONTRACT LOCKED / READ-ONLY AUDIT**  
> Ngày khóa: **2026-07-15**  
> Source baseline: `5c4a643d78f39433017d875c85c0b9755ed3bbc2`  
> Production đối chiếu: Supabase/PostgreSQL installation hiện tại, chỉ truy vấn metadata/function definition, không đọc PII và không mutation dữ liệu  
> Phạm vi thay đổi của branch: **documentation only; không sửa runtime, migration, backend, frontend hoặc production**

## 1. Mục tiêu A4

A4 khóa bốn boundary bắt buộc trước khi mở mutation lõi mới:

```text
Application use case
  -> Repository ports
  -> TransactionManager
  -> IdempotencyStore
  -> AuditEventStore
  -> PostgreSQL/Supabase adapter hiện tại
```

Kết quả cần đạt của tài liệu này:

1. Xác định transaction nào hiện đã atomic và transaction nào chỉ là chuỗi HTTP write.
2. Xác định mutation nào retry có thể duplicate hoặc ghi đè liên kết.
3. Khóa interface trung tính cho repository, transaction, idempotency và audit.
4. Khóa error/replay/concurrency behavior.
5. Lập gap matrix và thứ tự triển khai; chưa triển khai code trong audit này.

## 2. Quy ước đánh số phase

Active master plan dùng thứ tự `A1..A11`. Một số tài liệu Foundation cũ dùng `F0.x` theo thứ tự khác.

Mapping chính thức từ thời điểm khóa A4:

```text
A1 = portability/config audit               ~ F0.1
A2 = InstallationContext + actor/requestId  ~ F0.2
A3 = canonical success/error DTO            ~ F0.4 lịch sử
A4 = repository/transaction/idempotency/audit ports
                                               ~ F0.3 lịch sử
A5 = consumer audit + khóa direct mutation  ~ F0.5
A6 = production DB vs migrations            ~ F0.6
A7 = bootstrap/seed/config                   ~ F0.7
```

Quyết định:

- Tài liệu mới chỉ dùng mã `A#` của active master plan.
- Không đổi tên commit/PR/tài liệu lịch sử.
- Khi tham chiếu tài liệu cũ phải ghi rõ mapping, không suy luận A3 = F0.3.

## 3. Phạm vi audit

### 3.1 Source

Đã kiểm tra các boundary chính:

```text
apps/backend/foundation/request-context.js
apps/backend/foundation/gateway.js
apps/backend/foundation/supabase-adapter.js
apps/backend/foundation/transitional-api.js
apps/backend/foundation/*.test.js
apps/backend/server.js
src/lib/api/backend-proxy.ts
src/app/api/backend/[...path]/route.ts
src/app/api/field-checks/result/route.ts
src/app/api/mcp-market-reports/route.ts
src/app/api/mcp-report-setting-groups/route.ts
scripts/smoke-mcp-v1-api.mjs
docs/npp-plan/AUDIT_01_FOUNDATION_AUTH_ORDER_2026-07-14.md
```

### 3.2 Production DB metadata

Đã đối chiếu read-only:

- function definition của các RPC MCP core;
- row lock, `ON CONFLICT`, mutable-session guard;
- unique/check/FK/index liên quan;
- trigger chặn mutation trên session đã đóng;
- routine execute grants;
- bảng/column audit, event và idempotency hiện có.

### 3.3 Ngoài phạm vi

Các việc sau thuộc phase khác:

- đối chiếu từng function/trigger/grant production với migration trong repo: A6;
- tạo migration mới: implementation sau audit;
- khóa anon/auth direct write sau consumer audit: A5;
- clean DB rehearsal: A10;
- sửa dữ liệu legacy: phase cleanup riêng;
- thay đổi MCP v1 contract đã frozen.

## 4. Kết luận điều hành

### 4.1 Điều đã đạt

- Next proxy nhận và forward `Idempotency-Key`.
- Foundation Gateway validate request ID, idempotency key và tạo InstallationContext server-owned.
- Gateway forward request/installation/actor/idempotency headers vào legacy runtime.
- Public response đã canonical và che provider diagnostics.
- Mutation MCP core chủ yếu chạy trong PostgreSQL RPC, nên các write bên trong một RPC có transaction DB atomic.
- Trigger DB chặn thay đổi `mcp_session_customers`, `mcp_visits`, `mcp_followups` khi session đã đóng.
- Mở session có business idempotency theo unique `(route_id, session_date)`.
- Session report snapshot upsert theo unique `session_id`.
- Xóa session rỗng và cập nhật/chốt session có row lock.

### 4.2 Điều chưa đạt

- Legacy runtime không đọc Foundation context headers và không truyền context vào RPC MCP core.
- `Idempotency-Key` được validate/forward nhưng không claim, không lưu và không replay.
- Production không có bảng idempotency, audit event hoặc outbox trong schema public đã audit.
- RPC MCP core không nhận `requestId`, `actorId`, `installationId` hoặc `idempotencyKey`.
- `raw_payload.source` không phải audit log: mutable, không append-only, không đảm bảo before/after và không có actor đầy đủ.
- Backend vẫn trộn controller, validation, use case và provider access trong `server.js`.
- `transitional-api.js` import trực tiếp `supabaseRest/supabaseRpc`; chưa có repository port.
- Chưa có `TransactionManager`, `IdempotencyStore`, `AuditEventStore` hoặc repository contract tests.

### 4.3 Quyết định gate

```text
A4 design contract: LOCKED
A4 implementation: NOT IMPLEMENTED
Mutation lõi mới: NO-GO
A5/A6 read-only audit: có thể tiếp tục
Order Core implementation: chưa được bắt đầu
```

## 5. Kiến trúc hiện tại

### 5.1 Public path

```text
Browser
  -> Next.js proxy
     - X-Backend-Token
     - X-Request-Id
     - Idempotency-Key nếu client gửi
  -> Foundation Gateway
     - authenticate proxy
     - server-owned installation/actor
     - canonical response/error
  -> Legacy server hoặc Transitional API
  -> Supabase REST/RPC/Edge Function
```

### 5.2 Điểm đứt context

`Foundation Gateway` forward:

```text
x-request-id
x-installation-id
x-npp-code
x-actor-id
x-actor-type
x-actor-authentication
idempotency-key
```

Nhưng legacy `server.js` hiện:

- không parse các header này thành mutation context;
- không truyền context vào RPC;
- không persist request/actor/idempotency;
- không enforce permission theo actor.

Transitional API chỉ nhúng một phần `foundation_context` vào `raw_payload` cho vài endpoint. Đây là trace metadata tạm thời, không thay thế audit event hoặc idempotency store.

## 6. Audit mutation matrix

| Mutation | Persistence hiện tại | Atomic | Retry behavior | Audit context | Kết luận |
|---|---|---:|---|---|---|
| Mở session | RPC `mcp_open_route_session`; unique route+date; `ON CONFLICT` | Có | Trả lại session cũ | Không | **PASS business-idempotency / PARTIAL foundation** |
| Đổi trạng thái khách | RPC; row lock; mutable guard; DB trigger | Có | Cùng state thường ổn, không replay theo key | Không | **PARTIAL** |
| Tạo đơn từ session customer | RPC tạo order/items/visit/link/counter | Có | Gọi lại tạo order mới, link có thể chuyển sang order mới | Không | **P0 MISSING** |
| Tạo test | RPC tạo/reuse file/customer và insert result | Có | Gọi lại insert result mới, `test_id` trỏ result cuối | Không | **P0 MISSING** |
| Tạo/cập nhật báo cáo khách | RPC tìm/reuse report rồi update | Có | Serial retry gần idempotent; concurrent race chưa bị unique source chặn | Không | **P1 PARTIAL** |
| Tạo follow-up | RPC insert follow-up và counter | Có | Gọi lại tạo follow-up mới | Không | **P0 MISSING** |
| Snapshot báo cáo phiên | RPC upsert unique `session_id` | Có | Cùng session update cùng row | Không | **PARTIAL** |
| Chốt/cancel session | RPC row lock; chốt gọi snapshot | Có | Không có canonical replay; lần sau bị read-only | Không | **PARTIAL** |
| Xóa session rỗng | RPC row lock + activity guard | Có | Sau thành công, retry không replay kết quả cũ | Không | **PARTIAL** |
| Tạo route | RPC insert | Có | Retry tạo route mới | Không | **P1 MISSING** |
| Tạo route customer | RPC insert | Có | Retry tạo customer mới | Không | **P1 MISSING** |
| Save route templates/rules | RPC + unique một row mỗi route | Có | Có business key; chưa có request replay/audit | Không | **PARTIAL** |
| Field-check result transitional | Supabase REST POST/PATCH trực tiếp | Một row | POST không key có thể duplicate | Chỉ raw payload | **P1 WRONG LAYER** |
| Market report transitional | Supabase REST POST trực tiếp | Một row | Mỗi retry tạo row mới | Chỉ raw payload | **P1 WRONG LAYER** |
| Setting group/item transitional | Supabase REST POST/PATCH trực tiếp | Một row | Unique có thể trả provider conflict, không replay | Chỉ một phần | **P1 WRONG LAYER** |
| Persist AI session result | Direct PATCH `mcp_session_reports` theo session | Một row | Last-write-wins; không version | Không | **P1 WRONG LAYER** |
| Edge-function result/add | Proxy sang Edge Function | Không chứng minh tại boundary | Chưa có key/replay contract | Không đầy đủ | **P1 UNKNOWN/WRONG LAYER** |

## 7. Transaction audit

### 7.1 Atomic hiện có

PostgreSQL function chạy trong transaction của statement. Nếu một insert/update hoặc trigger lỗi, toàn bộ function call rollback.

Điều này bảo vệ các RPC multi-write hiện tại khỏi trạng thái ghi nửa chừng, gồm:

- order header + items + visit + session customer + counter;
- test file/customer/results + visit + session customer + counter;
- market report + visit + session customer + counter;
- follow-up + counters;
- close session + session report snapshot;
- delete empty session.

Trigger closed-session trên child tables tạo defense-in-depth: dù một RPC chưa gọi `mcp_assert_session_mutable` trực tiếp, write vào visit/session customer/follow-up của session đã đóng sẽ làm statement rollback.

### 7.2 Gap transaction

1. Transaction hiện bị ẩn trong RPC name, không có port/application contract.
2. Không có transaction scope dùng chung cho repository adapters.
3. Direct REST transitional mutation chỉ atomic trên một HTTP statement; không thể ghép nhiều write thành một business transaction.
4. Không có optimistic version cho last-write-wins update.
5. Không có outbox để commit business state và event cần xử lý ngoài DB.
6. Không có test bắt buộc rollback giữa các bước của use case.

### 7.3 TransactionManager contract đã khóa

```ts
type TransactionIsolation =
  | "read_committed"
  | "repeatable_read"
  | "serializable";

type TransactionOptions = Readonly<{
  isolation?: TransactionIsolation;
  readOnly?: boolean;
  timeoutMs?: number;
}>;

interface TransactionContext {
  readonly kind: "transaction";
  // Opaque; application/domain không được thấy client, SQL hoặc provider.
}

interface TransactionManager {
  execute<T>(
    context: MutationContext,
    options: TransactionOptions,
    work: (tx: TransactionContext) => Promise<T>
  ): Promise<T>;
}
```

Quy tắc bắt buộc:

1. Mọi repository write phải nhận `TransactionContext`.
2. Một use case mutation chỉ có một transaction owner: application service.
3. Repository không tự commit giữa use case.
4. PostgreSQL adapter phải dùng một DB transaction thật; không mô phỏng transaction bằng chuỗi REST request.
5. RPC có thể là implementation tạm của adapter cho MCP frozen, nhưng controller/application không biết RPC name.
6. Audit event và idempotency completion phải commit cùng business mutation.
7. External call không giữ DB transaction mở. Event ra ngoài dùng transactional outbox khi xuất hiện nhu cầu.
8. Serialization/deadlock retry chỉ do adapter thực hiện với giới hạn rõ; không được replay mutation thiếu idempotency.

## 8. MutationContext contract đã khóa

```ts
type ActorContext = Readonly<{
  id: string;
  type: "user" | "employee" | "service" | "system";
  authentication: string;
  employeeId?: string;
  roles: readonly string[];
  permissions: readonly string[];
  branchIds: readonly string[];
  warehouseIds: readonly string[];
  territoryIds: readonly string[];
}>;

type MutationContext = Readonly<{
  installationId: string;
  distributorCode: string;
  requestId: string;
  idempotencyKey: string | null;
  receivedAt: string;
  actor: ActorContext;
}>;
```

Quy tắc:

- installation/distributor lấy từ server config;
- actor lấy từ auth đã xác thực hoặc system/service identity;
- client không được override installation hoặc actor bằng body/header tùy ý;
- requestId luôn có;
- permission phải được application use case enforce trước write;
- service role chỉ là credential adapter, không phải actor permission.

## 9. Repository ports đã khóa

### 9.1 Nguyên tắc

Repository port mô tả capability nghiệp vụ, không mô tả:

```text
Supabase
PostgREST
RPC name
table/column
SQL
HTTP Response/NextResponse
provider error payload
```

Read method trả domain/read model trung tính. Write method nhận transaction và context hoặc use case đã xác thực context.

### 9.2 Port tối thiểu cho MCP frozen

```ts
interface RouteRepository {
  findActiveById(tx: TransactionContext, routeId: string): Promise<Route | null>;
  create(tx: TransactionContext, input: CreateRouteInput): Promise<Route>;
  update(tx: TransactionContext, routeId: string, patch: RoutePatch): Promise<Route>;
  archive(tx: TransactionContext, routeId: string): Promise<ArchiveResult>;
}

interface RouteCustomerRepository {
  listActiveByRoute(tx: TransactionContext, routeId: string): Promise<readonly RouteCustomer[]>;
  create(tx: TransactionContext, input: CreateRouteCustomerInput): Promise<RouteCustomer>;
  update(tx: TransactionContext, id: string, patch: RouteCustomerPatch): Promise<RouteCustomer>;
  archive(tx: TransactionContext, id: string): Promise<ArchiveResult>;
}

interface McpSessionRepository {
  findByRouteAndDate(tx: TransactionContext, routeId: string, date: string): Promise<McpSession | null>;
  openWithFrozenSnapshot(tx: TransactionContext, input: OpenSessionInput): Promise<OpenSessionResult>;
  lockById(tx: TransactionContext, sessionId: string): Promise<McpSession | null>;
  updateStatus(tx: TransactionContext, input: UpdateSessionInput): Promise<UpdateSessionResult>;
  deleteEmpty(tx: TransactionContext, sessionId: string): Promise<DeleteSessionResult>;
}

interface McpSessionCustomerRepository {
  lockById(tx: TransactionContext, id: string): Promise<McpSessionCustomer | null>;
  setVisitStatus(tx: TransactionContext, input: SetVisitStatusInput): Promise<VisitStatusResult>;
}

interface OrderRepository {
  findBySource(tx: TransactionContext, source: BusinessSource): Promise<Order | null>;
  createFromMcpSessionCustomer(tx: TransactionContext, input: CreateMcpOrderInput): Promise<OrderResult>;
}

interface ProductTestRepository {
  createFromMcpSessionCustomer(tx: TransactionContext, input: CreateMcpTestInput): Promise<TestResult>;
}

interface MarketReportRepository {
  findBySource(tx: TransactionContext, source: BusinessSource): Promise<MarketReport | null>;
  saveFromMcpSessionCustomer(tx: TransactionContext, input: SaveMcpReportInput): Promise<MarketReportResult>;
}

interface FollowupRepository {
  createFromMcpSessionCustomer(tx: TransactionContext, input: CreateMcpFollowupInput): Promise<FollowupResult>;
}

interface SessionReportRepository {
  saveSnapshot(tx: TransactionContext, input: SaveSessionSnapshotInput): Promise<SessionReport>;
  saveAiResult(tx: TransactionContext, input: SaveAiResultInput): Promise<SessionReport>;
}

interface McpSettingsRepository {
  loadRouteTemplates(routeId: string): Promise<McpRouteTemplates>;
  saveRouteTemplates(tx: TransactionContext, input: SaveMcpRouteTemplatesInput): Promise<McpRouteTemplates>;
  loadReportSettings(): Promise<McpReportSettings>;
  saveReportSettings(tx: TransactionContext, input: SaveMcpReportSettingsInput): Promise<McpReportSettings>;
}
```

Domain-specific ports cho Customer/Product/Inventory/Receivable sẽ được khóa trong module tương ứng. Không tạo generic repository kiểu `save(table, row)`.

## 10. Idempotency contract đã khóa

### 10.1 IdempotencyStore

```ts
type IdempotencyScope = Readonly<{
  installationId: string;
  operation: string;
  key: string;
}>;

type IdempotencyClaim =
  | { kind: "acquired"; recordId: string }
  | { kind: "replay"; response: StoredCanonicalResponse }
  | { kind: "in_progress"; retryAfterMs: number }
  | { kind: "key_reused" };

interface IdempotencyStore {
  claim(
    tx: TransactionContext,
    scope: IdempotencyScope,
    requestHash: string
  ): Promise<IdempotencyClaim>;

  complete(
    tx: TransactionContext,
    scope: IdempotencyScope,
    response: StoredCanonicalResponse,
    entityRefs: readonly EntityRef[]
  ): Promise<void>;
}
```

### 10.2 Storage semantics

Khóa unique:

```text
(installation_id, operation, idempotency_key)
```

Record tối thiểu:

```text
id
installation_id
operation
idempotency_key
request_hash
status: processing | completed
http_status
canonical_response
entity_refs
created_at
completed_at
expires_at
```

Claim, business mutation, audit append và completion phải nằm trong **cùng transaction**.

PostgreSQL implementation:

1. insert claim với unique key;
2. nếu conflict, lock/read record hiện có;
3. cùng hash + completed: replay;
4. cùng hash + processing: trả in-progress;
5. khác hash: reject key reuse;
6. acquired: chạy mutation, append audit, store canonical result, commit;
7. bất kỳ lỗi nào trước commit: rollback toàn bộ claim và mutation.

### 10.3 Public behavior

```text
IDEMPOTENCY_KEY_REQUIRED     -> 400, retryable=false
IDEMPOTENCY_KEY_REUSED       -> 409, retryable=false
IDEMPOTENCY_IN_PROGRESS      -> 409, retryable=true
```

Replay:

- trả cùng business result và HTTP status;
- envelope dùng requestId hiện tại để trace request replay;
- response header `Idempotency-Replayed: true`;
- không trả provider payload hoặc internal record;
- cùng key nhưng body/path params khác phải bị 409.

### 10.4 Mutation bắt buộc key

Bắt buộc `Idempotency-Key` cho create/side-effect mutation có thể retry:

```text
create order
create product test/result batch
create follow-up
create route
create route customer
add session customer
create transitional market report
create field-check result khi không có stable resultId
create setting group/item
future payment/inventory/receivable posting
```

Business-key idempotency đã đủ cho operation replace/upsert sau khi DB unique được chứng minh:

```text
open session                -> routeId + sessionDate
session report snapshot     -> sessionId
route templates/rules save  -> routeId + template kind
```

Các operation này vẫn có thể nhận key để replay HTTP result, nhưng DB business key là invariant cuối cùng.

### 10.5 Source identity lâu dài

Idempotency key chống transport retry. Business source reference chống duplicate lâu dài.

Đơn từ MCP phải có permanent identity:

```text
source_type = mcp_session_customer
source_id   = session_customer_id
operation   = create_order
```

DB phải có unique phù hợp sau cleanup/backfill. Không chỉ dựa vào TTL của idempotency record.

## 11. Audit event contract đã khóa

### 11.1 AuditEventStore

```ts
interface AuditEventStore {
  append(tx: TransactionContext, event: AuditEvent): Promise<void>;
}

type AuditEvent = Readonly<{
  eventId: string;
  installationId: string;
  requestId: string;
  idempotencyKey: string | null;
  actorId: string;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  before: unknown | null;
  after: unknown | null;
  metadata: Readonly<Record<string, unknown>>;
}>;
```

### 11.2 Persistence semantics

Audit store phải:

- append-only;
- không cho application update/delete event;
- ghi cùng transaction với business mutation;
- rollback business mutation nếu mandatory audit append thất bại;
- không chứa secret, token, credential hoặc raw provider error;
- sanitize PII theo policy module;
- có index theo entity, actor, requestId và occurredAt;
- giữ requestId và idempotency key để nối trace.

`raw_payload` hiện tại không đáp ứng các yêu cầu này và không được dùng làm audit store chính thức.

### 11.3 Action bắt buộc audit

```text
route.created / route.updated / route.archived
route_customer.created / updated / archived
mcp_session.opened / status_changed / closed / cancelled / deleted
mcp_session_customer.status_changed / added / removed
order.created_from_mcp
product_test.recorded
market_report.created / updated
followup.created / completed / cancelled
mcp_template.saved
session_report.snapshot_saved / ai_result_saved
permission/config changed
```

## 12. Concurrency contract đã khóa

1. Load-then-write invariant phải lock row hoặc dùng expected version.
2. Create theo business source phải có unique constraint; application pre-check không đủ.
3. `OrderRepository.createFromMcpSessionCustomer` phải lock session customer và xác nhận session mutable trước insert.
4. Concurrent cùng idempotency key chỉ một transaction được thực thi.
5. Concurrent khác key nhưng cùng permanent business source phải bị unique business conflict và map về existing result hoặc stable conflict.
6. Report save theo `(session_customer_id, report_type)` cần unique source hoặc serialized lock; lookup trong JSON không đủ để chống race.
7. AI result save phải có expected version hoặc compare-and-set khi nhiều analyzer có thể ghi.
8. Error unique/FK/serialization phải map sang domain error trung tính.

## 13. Test contract đã khóa

### 13.1 Repository contract tests

Mỗi adapter phải chạy cùng contract suite:

```text
create/find/update mapping
not-found behavior
unique/source conflict mapping
closed-session behavior
optimistic concurrency behavior
transaction participation
provider error normalization
```

### 13.2 Transaction tests

```text
failure after first write rolls back all rows
mandatory audit failure rolls back business mutation
idempotency completion failure rolls back business mutation
closed-session trigger rollback leaves no orphan order/test/report/followup
serialization/deadlock retry is bounded
```

### 13.3 Idempotency/concurrency tests

```text
same key + same payload -> one mutation, same result
same key + different payload -> IDEMPOTENCY_KEY_REUSED
concurrent same key -> one mutation
concurrent different keys + same source -> one permanent entity
retry after transport timeout -> no duplicate
retry delete with same key -> replay original success
```

### 13.4 Audit tests

```text
actor/request/installation persisted
before/after correct and sanitized
audit append is atomic with mutation
no token/provider error in audit payload
replayed request does not create duplicate business audit event
```

### 13.5 Gap của test hiện tại

Đã có:

- context parsing/forward tests;
- gateway canonical/auth/CORS tests;
- transitional service-role/context raw-payload test;
- full MCP smoke và open-session duplicate check.

Chưa có:

- repository contract suite;
- transaction rollback injection;
- idempotency store/replay tests;
- concurrent order/test/follow-up tests;
- actor/audit persistence test cho MCP core RPC;
- retry test cho mutation ngoài open session;
- optimistic version test;
- urgent follow-up contract test.

## 14. Gap matrix

| ID | Mức | Trạng thái | Gap | Hệ quả | Gate sửa |
|---|---|---|---|---|---|
| A4-G01 | P0 | MISSING | Không có IdempotencyStore/persistence | Retry tạo duplicate | Trước migration mutation lõi mới |
| A4-G02 | P0 | MISSING | Core RPC không nhận/persist actor, requestId, installation | Không audit được ai làm gì | Trước A5 lock/deploy |
| A4-G03 | P0 | MISSING | Không có append-only AuditEventStore | Không có lịch sử tin cậy | Trước mutation Order Core |
| A4-G04 | P0 | WRONG LAYER | `server.js` trộn transport/use case/provider | Khó test/thay adapter | Trước Order Core |
| A4-G05 | P0 | MISSING | Order create không lock source/unique/idempotency | Duplicate order và đổi link | Fix đầu tiên của implementation |
| A4-G06 | P0 | MISSING | Test/follow-up create không retry-safe | Duplicate kết quả/việc | Cùng A4 implementation |
| A4-G07 | P1 | PARTIAL | Report lookup không có unique source, race concurrent | Duplicate report | Migration + concurrency test |
| A4-G08 | P1 | WRONG LAYER | Transitional write gọi Supabase REST trực tiếp | Không transaction/audit/replay | Migrate về use case/repository |
| A4-G09 | P1 | PARTIAL | AI result last-write-wins | Ghi đè analyzer result | Expected version/CAS |
| A4-G10 | P1 | CONTRACT MISMATCH | API/function chấp nhận `urgent`, DB check chỉ `low/medium/high` | `urgent` fail ở DB | Migration + regression test |
| A4-G11 | P1 | MISSING | Không có repository/transaction/concurrency test suite | Regression khó phát hiện | Trước merge implementation |
| A4-G12 | P2 | DUPLICATED | Legacy server còn helper direct-write cũ song song V1 RPC | Dễ sửa nhầm path | Xóa sau consumer/route coverage test |
| A4-G13 | P2 | CARRYOVER A6 | Production có overload RPC route-customer cũ/mới | Drift/migration ambiguity | Đối chiếu ở A6 |
| A4-G14 | P2 | OBSERVED | Smoke script có literal tiếng Việt bị mojibake từ commit local encoding | Giảm chất lượng fixture/log | Maintenance commit riêng, không gộp A4 audit |

## 15. Decision log

```text
[A4-D01] Active master A# là numbering chính thức; F0.x chỉ là alias lịch sử.
[A4-D02] Application service sở hữu transaction boundary.
[A4-D03] Repository write luôn tham gia transaction được truyền vào.
[A4-D04] PostgreSQL/Supabase là adapter, không xuất hiện trong port/domain contract.
[A4-D05] RPC được giữ làm adapter tạm cho MCP frozen, không được gọi trực tiếp từ controller mới.
[A4-D06] Idempotency claim + business mutation + audit + completion commit cùng transaction.
[A4-D07] Transport idempotency không thay thế permanent business source uniqueness.
[A4-D08] Audit event append-only là nguồn lịch sử; raw_payload không phải audit store.
[A4-D09] Mandatory audit failure làm rollback mutation.
[A4-D10] Không mô phỏng multi-write transaction bằng chuỗi Supabase REST request.
[A4-D11] External side effect tương lai dùng outbox; không giữ DB transaction qua network call.
[A4-D12] MCP v1 public behavior giữ frozen trong quá trình tách adapter.
```

## 16. Thứ tự implementation sau audit

Không gộp tất cả thành một PR lớn.

### A4-I1 — Neutral contracts

```text
MutationContext
TransactionManager
IdempotencyStore
AuditEventStore
MCP repository interfaces
shared domain errors
contract test harness
```

Chỉ interface/test doubles, chưa đổi production path.

### A4-I2 — PostgreSQL foundation adapter

```text
transaction adapter
idempotency persistence
append-only audit persistence
provider error mapper
repository contract tests
```

Có migration riêng, forward-fix và rollback strategy.

### A4-I3 — Order-from-MCP vertical slice đầu tiên

```text
controller -> use case -> ports -> PostgreSQL adapter
lock session customer
assert session mutable
claim idempotency
permanent source unique
create order/items/visit/link/counters
audit append
canonical response
```

Giữ endpoint và DTO MCP v1.

### A4-I4 — Test/report/follow-up/session

Migrate lần lượt, mỗi mutation có contract/rollback/retry/concurrency tests.

### A4-I5 — Route/customer/settings/transitional

Loại direct REST mutation khỏi application/controller. Edge Function path chỉ giữ sau khi có port và contract rõ.

### A4-I6 — Cleanup

Xóa helper dead/duplicate sau route coverage và production smoke; không xóa trước.

### A4-I7 — Deploy verification

```text
backend verify
canonical API tests
idempotency concurrency tests
full MCP smoke
public Vercel smoke
production audit event sample bằng aggregate, không đọc PII
rollback/forward-fix rehearsal
```

## 17. Acceptance checklist cho implementation

```text
[ ] Domain/application không import Supabase SDK, REST helper, RPC name hoặc SQL
[ ] Controller không gọi supabaseRest/supabaseRpc trực tiếp
[ ] TransactionManager có PostgreSQL adapter và rollback tests
[ ] IdempotencyStore có unique scope + replay + hash conflict + concurrency tests
[ ] AuditEventStore append-only, atomic và sanitized
[ ] Core mutation persist installation/request/actor context
[ ] Order/test/follow-up retry không duplicate
[ ] Report concurrent save không duplicate
[ ] AI result có expected version/CAS
[ ] urgent follow-up contract đồng nhất API/function/constraint
[ ] Permanent business source unique đã cleanup/backfill trước khi add constraint
[ ] Repository contract suite pass
[ ] Canonical API tests pass
[ ] Full MCP smoke pass
[ ] Không thay public MCP v1 DTO/behavior ngoài lỗi đã version hóa
[ ] Production deploy có forward-fix và smoke
```

## 18. A4 completion checklist

```text
[x] Audit source provider coupling
[x] Audit context và idempotency header propagation
[x] Audit core RPC transaction/lock/upsert behavior
[x] Audit unique/check/index liên quan retry
[x] Audit closed-session DB trigger protection
[x] Audit presence of idempotency/audit/event storage
[x] Audit current tests và smoke coverage
[x] Khóa MutationContext
[x] Khóa TransactionManager contract
[x] Khóa repository port rules và MCP port set
[x] Khóa IdempotencyStore semantics/error/replay behavior
[x] Khóa AuditEventStore schema/atomicity/sanitization behavior
[x] Khóa concurrency rules
[x] Khóa implementation order
[x] Ghi decision log
[x] Không sửa runtime/DB/deploy trong audit
```

## 19. Kết luận cuối

A4 đã hoàn tất ở mức audit và design contract.

Nền hiện tại có transaction DB tương đối tốt cho MCP frozen nhờ RPC/trigger, nhưng chưa có foundation port thực thi cho application layer. Idempotency hiện mới dừng ở việc nhận và forward header; audit hiện mới là metadata rời rạc trong `raw_payload`.

Bước tiếp theo theo master plan:

```text
A5 consumer audit trước khi khóa direct DB mutation
```

A4 implementation có thể được chuẩn bị theo các slice `A4-I1..A4-I7`, nhưng không được mở mutation Order Core hoặc thay contract MCP v1 trước khi các gate liên quan pass.
