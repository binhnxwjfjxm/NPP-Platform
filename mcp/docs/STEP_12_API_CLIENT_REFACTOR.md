# Step 12 - API Client Refactor

Muc tieu: tung feature khong doc mock truc tiep nua. Feature goi API client contract.

## Trang thai hien tai

Da refactor truoc:

```text
/orders
```

Orders screen hien lay data qua:

```text
createApiClient().listOrders()
```

UI khong import `orders.mock.ts` nua.

## Luong moi

```text
src/app/orders/page.tsx
  -> src/features/orders/OrdersPage.tsx
  -> src/lib/api/api-client.ts
  -> mockApiClient hien tai
  -> backend/VPS/Supabase sau nay
```

## Nguyen tac

Dung:

```text
feature component goi createApiClient()
feature component dung DTO tu src/lib/api/api.types.ts
mock data nam sau API client
```

Sai:

```text
feature component import mock file truc tiep
feature component query Supabase truc tiep
ui component biet API endpoint
```

## Modules can refactor tiep

```text
1. Dashboard
2. Routes
3. Accounts
4. MCP Day / Visits
5. Field Checks
6. Actions / MCP-Plan
```

## Khi doi sang backend that

Chi thay implementation trong:

```text
src/lib/api/api-client.ts
```

Vi du:

```text
mockApiClient -> httpApiClient
httpApiClient -> VPS backend hoac Next API
backend -> Supabase/PostgreSQL/file import
```

Neu DTO giu on dinh thi UI khong can sua.
