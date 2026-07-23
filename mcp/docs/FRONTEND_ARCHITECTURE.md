# Frontend Architecture - MCP-Plan

## Muc tieu

UI phai sach, tach han khoi DB/backend logic de tranh lap lai loi report cu khi app lon dan.

## Nguyen tac bat buoc

- `src/app` chi lam routing va page composition.
- `src/ui` chi chua component thuan hien thi.
- `src/features` chua UI theo module nghiep vu.
- `src/server` chua DB adapter, service, business logic va API support.
- Frontend khong import truc tiep `src/server/db`.
- Frontend khong dung Supabase service key.
- Moi API read/write phai di qua backend route.

## Cau truc de xuat

```text
src/
  app/
    api/
      dashboard/summary/route.ts
      routes/route.ts
      routes/[routeId]/customers/route.ts
      route-sessions/route.ts
      visits/route.ts
      field-checks/files/route.ts
      field-checks/files/[fileId]/results/route.ts
      orders/route.ts
      orders/[orderId]/items/route.ts
    layout.tsx
    page.tsx
  server/
    db/
      types.ts
      readonly-adapter.ts
      supabase-readonly-adapter.ts
    domain/
      tables.ts
    http/
      api-response.ts
      query.ts
    modules/
      dashboard/service.ts
      routes/service.ts
      visits/service.ts
      field-checks/service.ts
      orders/service.ts
  ui/
    shell/
      AppShell.tsx
      navigation.ts
    data/
      DataTable.tsx
      EmptyState.tsx
    kpi/
      KpiCard.tsx
  features/
    dashboard/
      DashboardPage.tsx
    routes/
      RoutesPage.tsx
    visits/
      VisitsPage.tsx
    field-checks/
      FieldChecksPage.tsx
    orders/
      OrdersPage.tsx
    plans/
      PlansPage.tsx
```

## Rule import

Cho phep:

```text
app -> features
app/api -> server/modules
features -> ui
features -> lib/api-client
server/modules -> server/db
```

Cam:

```text
ui -> server
features -> server/db
features -> Supabase client truc tiep
app page -> Supabase query truc tiep
```

## Cach tach UI de app lon van sach

### UI component

Dung cho component dung lai, khong biet nghiep vu:

- AppShell
- KpiCard
- DataTable
- EmptyState
- PageHeader
- FilterBar

### Feature component

Moi module co folder rieng:

- DashboardPage
- RoutesPage
- VisitsPage
- FieldChecksPage
- OrdersPage
- PlansPage

Feature duoc phep goi API client, nhung khong duoc query DB truc tiep.

### Server module

Moi module co service rieng:

- `dashboard/service.ts`
- `routes/service.ts`
- `visits/service.ts`
- `field-checks/service.ts`
- `orders/service.ts`

Service la noi duy nhat biet table nao can doc.

## Trang thai hien tai

Da tao duoc:

- `.gitignore`
- `.env.example`
- `tsconfig.json`
- `next.config.mjs`
- `src/server/env.ts`
- `src/server/db/types.ts`
- `src/server/db/readonly-adapter.ts`
- `src/server/http/api-response.ts`
- `src/server/http/query.ts`
- `src/server/domain/tables.ts`
- `src/server/modules/dashboard/service.ts`
- `src/server/modules/routes/service.ts`
- `src/server/modules/visits/service.ts`
- `src/app/api/dashboard/summary/route.ts`
- `src/app/globals.css`
- `src/ui/shell/navigation.ts`

Mot so file bi GitHub connector chan luc tao tu ChatGPT, can tao tiep tren may local:

- `package.json`
- `src/server/db/supabase-readonly-adapter.ts`
- `src/server/modules/field-checks/service.ts`
- `src/server/modules/orders/service.ts`
- `src/app/layout.tsx`
- `src/ui/shell/AppShell.tsx`
- cac page feature ban dau

## Uu tien tiep theo

1. Hoan thanh DB adapter that.
2. Wire API read-only.
3. Tao AppShell va DashboardPage.
4. Chay `npm install` va `npm run typecheck`.
5. Sau khi API doc so lieu khop Supabase moi tiep tuc UI module con.
