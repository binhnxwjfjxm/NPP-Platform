# Architecture Decision - MCP-Plan

Ngay chot: 2026-07-03

## 1. Quyet dinh chinh

MCP-Plan se phat trien theo huong:

```text
Frontend Next.js
  -> API client abstraction
  -> Backend contract
  -> Backend that co the tach ra VPS sau nay
  -> Supabase/PostgreSQL/file import chi la data source
```

Trong giai doan hien tai, uu tien lam lai UI report cho sach, de mo rong thanh tool lon cho nha phan phoi. Supabase chua phai trong tam, chi dung de test ket noi va lam data source sau.

## 2. Ly do

Report cu bi loi UI va kho mo rong vi logic hien thi, query data va nghiep vu bi dinh vao nhau. Neu tiep tuc lam kieu do, app cang lon cang kho sua.

MCP-Plan can ban duoc cho NPP, nen can kien truc tach ro:

- UI sach, de mo rong nhieu module.
- Backend co the dua len VPS rieng.
- Data source co the thay doi: Supabase, PostgreSQL VPS, Excel/CSV import, API ngoai.
- Khong khoa UI vao Supabase.
- Khong viet logic report lung tung trong component.

## 3. Nguyen tac bat buoc

### UI khong goi Supabase truc tiep

Cam:

```text
React component -> Supabase query
Page component -> SQL/data source
UI component -> service role key
```

Cho phep:

```text
React component -> feature service/mock/api client
API client -> backend endpoint
Backend -> data source
```

### Backend co the tach VPS

Hien tai co the dung mock data hoac Next API route tam. Nhung code frontend phai goi qua API client abstraction de sau nay chi doi:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.mcp-plan.vn
```

UI khong can sua khi backend chuyen qua VPS.

### Supabase chi la data source

Supabase hien dung cho report/test data, nhung khong phai kien truc trung tam cua frontend.

Dung:

```text
Backend -> Supabase/PostgreSQL
```

Khong dung:

```text
Frontend -> Supabase truc tiep
```

### Mock data duoc dung trong phase UI

Giai doan dau dung mock data de lam UI nhanh va sach:

- Dashboard
- Routes
- Customers
- Visits
- Field Checks
- Orders
- Plans

Sau khi UI on dinh moi noi data that.

## 4. Cau truc thu muc muc tieu

```text
src/
  app/
    page.tsx
    routes/page.tsx
    customers/page.tsx
    visits/page.tsx
    field-checks/page.tsx
    orders/page.tsx
    plans/page.tsx

  features/
    dashboard/
      DashboardPage.tsx
      dashboard.types.ts
      dashboard.mock.ts
    routes/
      RoutesPage.tsx
      routes.types.ts
      routes.mock.ts
    customers/
      CustomersPage.tsx
      customers.types.ts
      customers.mock.ts
    visits/
      VisitsPage.tsx
      visits.types.ts
      visits.mock.ts
    field-checks/
      FieldChecksPage.tsx
      field-checks.types.ts
      field-checks.mock.ts
    orders/
      OrdersPage.tsx
      orders.types.ts
      orders.mock.ts
    plans/
      PlansPage.tsx
      plans.types.ts
      plans.mock.ts

  ui/
    shell/
      AppShell.tsx
      navigation.ts
    layout/
      PageHeader.tsx
      FilterBar.tsx
    cards/
      KpiCard.tsx
    table/
      DataTable.tsx
    state/
      EmptyState.tsx
      ErrorState.tsx
      LoadingState.tsx

  lib/
    api/
      api-client.ts
      endpoints.ts

  shared/
    types/
      common.ts
```

## 5. Import rule

Cho phep:

```text
app -> features
features -> ui
features -> lib/api hoac mock data
lib/api -> endpoint config
server/backend -> data source
```

Cam:

```text
ui -> server
ui -> Supabase
features -> Supabase service role
features -> SQL
app/page -> query data source truc tiep
```

## 6. Backend strategy

### Phase hien tai

- Dung mock data de dung UI.
- Co the giu Next API route de test nhanh.
- Chua dau tu backend VPS ngay.

### Phase tiep theo

- Viet `docs/API_CONTRACT.md`.
- Moi module UI bam theo contract, khong bam theo DB schema.

### Phase VPS

Backend co the tach thanh service rieng:

```text
mcp-api
  Node.js/Fastify hoac NestJS
  PostgreSQL/Supabase connector
  file import worker
  AI/report planning worker
  auth/role/permission
```

Frontend chi doi `NEXT_PUBLIC_API_BASE_URL`.

## 7. Module uu tien

Lam UI theo thu tu:

1. Dashboard
2. Routes
3. Customers
4. Visits
5. Field Checks
6. Orders
7. Plans

Khong lam AI/mindmap truoc khi dashboard va report UI sach.

## 8. Tieu chuan hoan thanh buoc 1

- Da chot frontend la Next.js.
- Da chot backend co the tach VPS.
- Da chot Supabase chi la data source.
- Da chot UI khong goi Supabase truc tiep.
- Da chot phase hien tai dung mock data de lam UI san pham.
- Da chot cau truc thu muc va import rule.

## 9. Buoc tiep theo

Buoc 2: Dung UI shell sach.

Can lam:

- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/ui/shell/AppShell.tsx`
- `src/ui/shell/navigation.ts`
- `src/app/globals.css`

Muc tieu: mo `http://localhost:3000` thay khung app MCP-Plan ro rang, co sidebar, header, main content, style sach va de mo rong.
