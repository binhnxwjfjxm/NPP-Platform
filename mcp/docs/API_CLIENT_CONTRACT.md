# API Client Contract

Muc tieu cua buoc nay la tao ranh gioi giua UI va backend.

UI khong duoc query Supabase truc tiep. UI chi lam viec voi API client contract.

## Nguyen tac

```text
features -> lib/api -> backend contract -> data source
```

Duoc phep:

```text
src/features/* dung createApiClient()
src/lib/api dinh nghia DTO va contract
backend/VPS/Supabase thay doi ben duoi contract
```

Khong duoc phep:

```text
feature component import Supabase client
page component query SQL truc tiep
ui component biet database table
mock data dinh nghia lung tung trong app route
```

## Files

```text
src/lib/api/api.types.ts
src/lib/api/api-client.ts
src/lib/api/endpoints.ts
```

## Contract hien tai

```text
getDashboardSummary()
listRoutes(query)
listAccounts(query)
getCurrentDayRun(query)
listMarketChecks(query)
listOrders(query)
listActions(query)
```

## Data source hien tai

Hien tai `createApiClient()` tra ve `mockApiClient`.

Ly do:

```text
- UI can on dinh truoc
- Supabase hien chi dung de test/audit
- Sau nay co the doi sang VPS backend
- Khong khoa UI vao mot data source qua som
```

## Khi noi backend that

Chi can thay implementation trong `src/lib/api/api-client.ts`.

Vi du:

```text
createApiClient() -> httpApiClient
httpApiClient -> goi /api/* hoac VPS endpoint
backend -> Supabase/PostgreSQL/file import
```

UI va reusable components khong can sua neu DTO giu on dinh.

## Endpoint map

```text
/api/dashboard/summary
/api/routes
/api/accounts
/api/mcp/day-run
/api/field-checks
/api/orders
/api/actions
```

## Ket luan

Buoc 11 chot ranh gioi API client. Tu buoc sau co the refactor tung feature tu mock file sang api client ma khong pha UI.
