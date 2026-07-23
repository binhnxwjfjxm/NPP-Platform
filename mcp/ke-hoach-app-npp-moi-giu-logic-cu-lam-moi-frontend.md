# Kế hoạch làm app NPP mới: giữ nguyên logic cũ, làm mới frontend

Ngày lập: 2026-07-03  
Repo audit: `minhmannguyengdp-sketch/report-02`  
Mục tiêu: làm app mới quản lý NPP, trong đó MCP là module lõi, nhưng **không viết lại toàn bộ logic cũ ngay từ đầu**. Chỉ làm mới frontend/app shell/UI để nhanh, ổn định, dễ mở rộng web/PWA/mobile.

---

## 1. Quyết định kỹ thuật chính

Không refactor sâu repo cũ ở giai đoạn đầu.

App mới sẽ đi theo hướng:

```text
Logic cũ giữ lại gần như nguyên vẹn
        ↓
Bọc qua adapter/bridge
        ↓
Frontend mới gọi adapter
        ↓
UI mới sạch, responsive, PWA-ready
```

Lý do:

- Logic MCP/Test/Order/Report đã làm rất lâu, đã có nhiều case thực tế.
- Viết lại logic ngay sẽ tốn thời gian và dễ mất nghiệp vụ ẩn.
- Vấn đề lớn nhất của repo cũ không phải logic, mà là frontend bị vá chồng lớp: CSS inline, nhiều file `*-fix`, `*-owner`, event global, import order phụ thuộc nhau.
- Cách nhanh nhất: **copy logic cũ sang app mới**, đóng gói lại, rồi dựng frontend mới sạch.

---

## 2. Nguyên tắc migrate

### Giữ

Giữ các phần sau từ app cũ:

```text
data-model.js
local-db.js
src/mcp-core.js
logic tạo test file/test customer/test result trong test-first-app.js
logic order hiện có
logic report hiện có
logic Supabase sync hiện có
logic IndexedDB/offline-first
logic GPS/check-in MCP
logic PWA manifest/service worker ở mức tham khảo
```

### Không giữ nguyên

Không bê nguyên các phần sau:

```text
index.html cũ
CSS inline trong index.html
src/ui-polish.js kiểu import vá chồng
các file chỉ để fix UI: route-visibility-guard, home-active-fix, modal-scroll-fix...
các module UI render bằng innerHTML quá dài
service worker cache asset thủ công
event listener global chồng chéo nếu không bọc lại
```

### Chấp nhận tạm thời

Trong phase đầu, có thể copy cả logic cũ vào thư mục `legacy/` để chạy nhanh, sau đó frontend mới gọi qua adapter.

---

## 3. Cấu trúc repo mới đề xuất

```text
npp-app/
  package.json
  index.html
  vite.config.ts
  tsconfig.json
  public/
    manifest.webmanifest
    icons/
  src/
    main.tsx
    app/
      App.tsx
      routes.tsx
      AppShell.tsx
      providers.tsx
    styles/
      globals.css
      tokens.css
    shared/
      ui/
        Button.tsx
        Card.tsx
        Modal.tsx
        BottomSheet.tsx
        Tabs.tsx
        Input.tsx
        Select.tsx
        Toast.tsx
      hooks/
      utils/
    legacy/
      data-model.js
      local-db.js
      supabase-sync.js
      mcp-core.js
      test-logic.js
      order-logic.js
      report-logic.js
    adapters/
      mcp.adapter.ts
      test.adapter.ts
      order.adapter.ts
      report.adapter.ts
      sync.adapter.ts
    features/
      home/
        HomePage.tsx
      mcp/
        McpPage.tsx
        McpStartSheet.tsx
        McpRouteCard.tsx
        McpCustomerCard.tsx
        McpCustomerForm.tsx
        McpStats.tsx
      customers/
        CustomersPage.tsx
      orders/
        OrdersPage.tsx
        OrderCreatePage.tsx
      tests/
        TestsPage.tsx
        TestFileCreateSheet.tsx
        TestCustomerSheet.tsx
      reports/
        ReportsPage.tsx
      ai/
        AiPage.tsx
      admin/
        AdminPage.tsx
```

---

## 4. Chiến lược copy logic cũ

### 4.1 Copy nguyên file nền

Copy nguyên các file sau vào `src/legacy/`:

```text
data-model.js              → src/legacy/data-model.js
local-db.js                → src/legacy/local-db.js
src/mcp-core.js            → src/legacy/mcp-core.js
src/supabase-sync.js       → src/legacy/supabase-sync.js
```

Sửa import path tối thiểu.

Ví dụ trong `mcp-core.js` cũ:

```js
import { makeMcpRouteSession, makeMcpVisit, todayIsoDate, nowIso } from '../data-model.js';
import { LOCAL_STORES, getAllLocal, getLocal, putLocal, getMeta, setMeta } from '../local-db.js';
```

Sang app mới:

```js
import { makeMcpRouteSession, makeMcpVisit, todayIsoDate, nowIso } from './data-model.js';
import { LOCAL_STORES, getAllLocal, getLocal, putLocal, getMeta, setMeta } from './local-db.js';
```

---

## 5. Adapter bắt buộc

Frontend mới không gọi trực tiếp file legacy lung tung. Phải gọi qua adapter.

### 5.1 MCP adapter

File: `src/adapters/mcp.adapter.ts`

```ts
import {
  getMcpRoutes,
  getMcpRouteCustomers,
  createOrOpenMcpRouteSession,
  getActiveMcpSessionDetail,
  setActiveMcpRouteSessionId,
  upsertMcpVisitForSession,
  recalcMcpRouteSession
} from '../legacy/mcp-core.js';

import { makeMcpRoute, makeMcpRouteCustomer, todayIsoDate, nowIso } from '../legacy/data-model.js';
import { LOCAL_STORES, getAllLocal, putLocal } from '../legacy/local-db.js';

export async function listRoutes() {
  return getMcpRoutes();
}

export async function listRouteCustomers(routeId: string) {
  return getMcpRouteCustomers(routeId);
}

export async function startMcpSession(input: {
  route_id: string;
  session_date?: string;
  sales?: string;
}) {
  const session = await createOrOpenMcpRouteSession({
    route_id: input.route_id,
    session_date: input.session_date || todayIsoDate(),
    sales: input.sales || '',
    status: 'active'
  });

  await setActiveMcpRouteSessionId(session.id);
  return session;
}

export async function getActiveMcp() {
  return getActiveMcpSessionDetail();
}

export async function createRoute(input: {
  route_name: string;
  area?: string;
  weekday?: number;
}) {
  const route = makeMcpRoute({
    route_name: input.route_name,
    area: input.area || '',
    weekday: input.weekday ?? new Date().getDay(),
    sync_status: 'local'
  });

  await putLocal(LOCAL_STORES.mcpRoutes, route);
  return route;
}

export async function saveRouteCustomer(input: any) {
  const row = makeMcpRouteCustomer({
    ...input,
    sync_status: 'local',
    updated_at: nowIso()
  });

  await putLocal(LOCAL_STORES.mcpRouteCustomers, row);

  if (input.session_id) {
    await recalcMcpRouteSession(input.session_id);
  }

  return row;
}

export async function setVisitStatus(input: {
  session_id: string;
  route_customer_id: string;
  status: string;
  existing?: any;
}) {
  return upsertMcpVisitForSession({
    ...(input.existing || {}),
    session_id: input.session_id,
    route_customer_id: input.route_customer_id,
    status: input.status,
    has_order: input.status === 'order' || input.existing?.has_order,
    has_test: input.status === 'test' || input.existing?.has_test,
    has_report: input.status === 'report' || input.existing?.has_report
  });
}
```

---

### 5.2 Test adapter

File: `src/adapters/test.adapter.ts`

Mục tiêu: tách logic từ `test-first-app.js` cũ ra hàm sạch, không dính DOM.

```ts
import {
  makeOnaTest,
  makeOnaTestItem,
  uid,
  todayIsoDate
} from '../legacy/data-model.js';

import {
  LOCAL_STORES,
  getAllLocal,
  putLocal,
  putManyLocal,
  enqueueLocalSync
} from '../legacy/local-db.js';

export async function createTestFile(input: {
  test_date?: string;
  sales?: string;
  title: string;
  products: string[];
  note?: string;
}) {
  const file = makeOnaTest({
    id: uid('test-file'),
    test_date: input.test_date || todayIsoDate(),
    sales: input.sales || '',
    customer_name: input.title || `Test sản phẩm ${todayIsoDate()}`,
    overall_status: 'pending',
    overall_note: input.note || '',
    sync_status: 'pending',
    raw_payload: { kind: 'test_file' }
  });

  const items = input.products.map((name) =>
    makeOnaTestItem({
      id: uid('test-product'),
      test_id: file.id,
      product_id: uid('manual-product'),
      product_name: name,
      status: 'pending',
      note: '',
      raw_payload: {
        kind: 'selected_product',
        source: 'manual'
      }
    })
  );

  await putLocal(LOCAL_STORES.onaTests, file);
  await putManyLocal(LOCAL_STORES.onaTestItems, items);
  await enqueueLocalSync('test_file', file.id, { test: file, items });

  return { file, items };
}

export async function listTestFiles() {
  const [tests, items] = await Promise.all([
    getAllLocal(LOCAL_STORES.onaTests),
    getAllLocal(LOCAL_STORES.onaTestItems)
  ]);

  const active = (x: any) =>
    x.status !== 'deleted' &&
    !x.deleted_at &&
    !x.raw_payload?.deleted_at &&
    !x.raw_payload?.delete_reason;

  const files = tests.filter((x: any) => active(x) && x.raw_payload?.kind === 'test_file');
  const customers = tests.filter((x: any) => active(x) && x.raw_payload?.kind === 'test_customer');

  return files.map((file: any) => ({
    ...file,
    products: items.filter((i: any) => i.test_id === file.id),
    customers: customers.filter((c: any) => c.raw_payload?.file_id === file.id)
  }));
}

export async function addCustomerToTestFile(input: {
  file_id: string;
  customer_name: string;
  customer_phone?: string;
  area?: string;
  note?: string;
  results: Array<{
    product_id: string;
    product_name: string;
    status: string;
    note?: string;
  }>;
}) {
  const resultItems = input.results.map((r) =>
    makeOnaTestItem({
      id: uid('test-result'),
      test_id: '',
      product_id: r.product_id,
      product_name: r.product_name,
      status: r.status,
      note: r.note || ''
    })
  );

  const firstStatus = resultItems.find((x: any) => x.status && x.status !== 'pending')?.status || 'pending';

  const test = makeOnaTest({
    id: uid('test-customer'),
    test_date: todayIsoDate(),
    sales: '',
    customer_name: input.customer_name,
    customer_phone: input.customer_phone || '',
    area: input.area || '',
    overall_status: firstStatus,
    overall_note: input.note || '',
    sync_status: 'pending',
    raw_payload: {
      kind: 'test_customer',
      file_id: input.file_id
    }
  });

  resultItems.forEach((item: any) => {
    item.test_id = test.id;
  });

  await putLocal(LOCAL_STORES.onaTests, test);
  await putManyLocal(LOCAL_STORES.onaTestItems, resultItems);
  await enqueueLocalSync('test_customer', test.id, { test, items: resultItems });

  return { test, items: resultItems };
}
```

---

### 5.3 Sync adapter

File: `src/adapters/sync.adapter.ts`

```ts
import { syncBusinessNow } from '../legacy/supabase-sync.js';
import { localStats } from '../legacy/local-db.js';

export async function syncNow() {
  return syncBusinessNow({ silent: false });
}

export async function getLocalStats() {
  return localStats();
}
```

Nếu `supabase-sync.js` cũ chưa export `syncBusinessNow` được ổn, thêm export rõ ràng ở cuối file legacy:

```js
export { syncBusinessNow };
```

---

## 6. UI mới: màn hình chính

### 6.1 Navigation mobile

Bottom tabs:

```text
Home
MCP
Đơn
Dữ liệu
Admin
```

### 6.2 Navigation desktop

Sidebar:

```text
Tổng quan
MCP tuyến
Khách hàng
Đơn hàng
Test sản phẩm
Báo cáo thị trường
AI báo cáo
Admin
```

---

## 7. MCP UI mới

### 7.1 Trang MCP

Màn MCP mới phải có layout rõ:

```text
Header:
  Tuyến đang đi
  Ngày
  Sales
  Nút đổi tuyến

Stats:
  Tổng khách
  Đã ghé
  Có đơn
  Có test
  Không mua

Filter:
  Tất cả
  Chưa ghé
  Đã ghé
  Có đơn
  Có test
  Không mua

Danh sách khách:
  Card khách
    Tên khách
    Khu vực/SĐT/Địa chỉ
    GPS/Maps
    Trạng thái
    Nút: Check-in / Có đơn / Có test / Không mua
    Nút phụ: Sửa / Ẩn / Đổi thứ tự
```

### 7.2 Component MCP

```text
McpPage.tsx
McpStartSheet.tsx
McpStats.tsx
McpCustomerCard.tsx
McpCustomerForm.tsx
McpRoutePicker.tsx
```

### 7.3 Flow MCP mới dùng logic cũ

```text
User bấm MCP
  ↓
McpStartSheet mở
  ↓
Chọn ngày + tuyến
  ↓
adapter.startMcpSession()
  ↓
adapter.getActiveMcp()
  ↓
Render McpPage
  ↓
Bấm Check-in/Có đơn/Có test
  ↓
adapter.setVisitStatus()
  ↓
Reload state
```

---

## 8. Test sản phẩm UI mới

### 8.1 Flow

```text
Test sản phẩm
  ↓
Tạo file test
  ↓
Nhập sản phẩm cần test
  ↓
Lưu file test
  ↓
Mở file
  ↓
Thêm khách
  ↓
Chấm trạng thái từng sản phẩm
  ↓
Lưu kết quả
```

### 8.2 Component

```text
TestsPage.tsx
TestFileCard.tsx
TestFileCreateSheet.tsx
TestCustomerSheet.tsx
TestResultTable.tsx
```

### 8.3 Trạng thái giữ từ app cũ

```text
pending      Chưa thử
ok           OK
interested   Quan tâm
sample       Cần mẫu
follow       Báo sau
bad          Chưa tốt
retry        Thử lại
```

---

## 9. Design system mới

### 9.1 Token

File: `src/styles/tokens.css`

```css
:root {
  --color-bg: #f6faf8;
  --color-surface: #ffffff;
  --color-text: #082337;
  --color-muted: #63727c;
  --color-border: #dce8e5;
  --color-primary: #00957f;
  --color-primary-dark: #007866;
  --color-primary-soft: #e6f8f3;

  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;

  --shadow-card: 0 10px 24px rgba(12, 55, 50, 0.08);
  --safe-bottom: env(safe-area-inset-bottom);
}
```

### 9.2 Luật CSS

Không dùng:

```text
!important tràn lan
height: 100dvh cho mọi thứ
overflow hidden toàn app
CSS viết trong index.html
CSS patch bằng JS
```

Dùng:

```text
component class rõ
layout riêng desktop/mobile
scroll container rõ ràng
bottom sheet cho mobile
modal/drawer cho desktop
```

---

## 10. PWA mới

Không cache thủ công danh sách dài như app cũ.

Dùng:

```text
vite-plugin-pwa
workbox
auto manifest
auto cache build assets
runtime cache API GET
```

Manifest:

```json
{
  "name": "NPP MCP-Plan",
  "short_name": "MCP-Plan",
  "display": "standalone",
  "orientation": "portrait-primary",
  "theme_color": "#00957f",
  "background_color": "#f6faf8",
  "categories": ["business", "productivity"]
}
```

---

## 11. Các bước làm cụ thể

### Bước 1: Tạo repo mới

```powershell
npm create vite@latest npp-mcp-plan -- --template react-ts
cd npp-mcp-plan
npm install
npm install dexie zustand @tanstack/react-query lucide-react
npm install -D vite-plugin-pwa
```

### Bước 2: Copy legacy

```text
copy report-02/data-model.js        → npp-mcp-plan/src/legacy/data-model.js
copy report-02/local-db.js          → npp-mcp-plan/src/legacy/local-db.js
copy report-02/src/mcp-core.js      → npp-mcp-plan/src/legacy/mcp-core.js
copy report-02/src/supabase-sync.js → npp-mcp-plan/src/legacy/supabase-sync.js
```

### Bước 3: Tạo adapter

```text
src/adapters/mcp.adapter.ts
src/adapters/test.adapter.ts
src/adapters/sync.adapter.ts
```

### Bước 4: Làm App Shell mới

```text
src/app/AppShell.tsx
src/app/routes.tsx
src/features/home/HomePage.tsx
src/features/mcp/McpPage.tsx
```

### Bước 5: Làm MCP trước

Ưu tiên MCP vì là lõi quản lý NPP ngoài thị trường.

Checklist MCP v1:

```text
[ ] Chọn tuyến/ngày
[ ] Tạo tuyến nhanh
[ ] Mở phiên MCP
[ ] Danh sách khách trong tuyến
[ ] Thêm khách
[ ] Sửa khách
[ ] Ẩn khách
[ ] GPS khách
[ ] Check-in
[ ] Có đơn
[ ] Có test
[ ] Không mua
[ ] Bộ lọc trạng thái
[ ] Thống kê tuyến
[ ] Sync Supabase
```

### Bước 6: Làm Test sản phẩm

Checklist Test v1:

```text
[ ] Danh sách file test
[ ] Tạo file test
[ ] Thêm sản phẩm test
[ ] Mở chi tiết file test
[ ] Thêm khách test
[ ] Chấm kết quả từng sản phẩm
[ ] Sync Supabase
```

### Bước 7: Bổ sung Order/Report

Sau khi MCP + Test ổn, mới gắn:

```text
[ ] Tạo đơn từ MCP visit
[ ] Tạo báo cáo từ MCP visit
[ ] Lịch sử khách
[ ] Dashboard
[ ] AI báo cáo
```

---

## 12. Chiến lược tránh mất logic cũ

Không xóa repo cũ.

Trong app mới, tạo file:

```text
MIGRATION_NOTES.md
```

Ghi rõ mỗi logic lấy từ đâu:

```text
MCP session logic       ← report-02/src/mcp-core.js
MCP UI flow             ← report-02/src/mcp-ui-shell.js
Test file logic         ← report-02/test-first-app.js
Local DB schema         ← report-02/local-db.js
Data model              ← report-02/data-model.js
Supabase sync           ← report-02/src/supabase-sync.js
PWA config tham khảo    ← report-02/manifest.webmanifest + sw.js
```

---

## 13. Kết luận

Hướng nhanh nhất và ít rủi ro nhất:

```text
Không viết lại logic.
Không vá tiếp UI cũ.
Copy logic cũ vào legacy.
Bọc adapter.
Làm frontend mới hoàn toàn.
MCP làm module đầu tiên.
Sau đó gắn Test, Order, Report, AI.
```

Đây là hướng phù hợp vì app cũ có nghiệp vụ thật, nhưng frontend cũ không còn đủ sạch để phát triển dài hạn.
