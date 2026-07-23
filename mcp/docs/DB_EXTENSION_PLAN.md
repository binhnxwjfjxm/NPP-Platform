# DB Extension Plan - MCP-Plan

## Nguyen tac

DB hien co dang chua du lieu route/test/order. Khong sua truc tiep cac bang goc neu muc tieu la luu plan/action cua MCP-Plan.

Dung chien luoc:

```text
Bang goc: route/test/order/report -> read/aggregate
Bang moi MCP-Plan: plans/items/logs/snapshots -> write rieng
```

## Khong lam ngay

- Khong them FK vao bang goc khi chua check orphan data.
- Khong xoa index bi advisor bao unused vi DB con it query, chua du du lieu de ket luan.
- Khong tat RLS.
- Khong cho frontend ghi truc tiep bang service role.

## Bang moi de xuat

### `mcp_plans`

Luu ke hoach ngay/tuan/thang.

Cot de xuat:

- `id text primary key`
- `plan_type text not null` -- daily, weekly, monthly, campaign
- `title text not null`
- `period_start date`
- `period_end date`
- `sales text`
- `area text`
- `status text default 'open'`
- `source text` -- manual, rule, ai
- `summary text`
- `created_by uuid null`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

### `mcp_plan_items`

Luu tung viec can lam trong plan.

Cot de xuat:

- `id text primary key`
- `plan_id text not null`
- `item_type text not null` -- route, customer, visit, test, order, report, note
- `priority text default 'medium'`
- `title text not null`
- `description text`
- `route_id text null`
- `route_customer_id text null`
- `customer_id text null`
- `test_file_id text null`
- `order_id text null`
- `due_date date null`
- `status text default 'open'`
- `result_note text null`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

### `mcp_action_logs`

Luu lich su hanh dong da lam.

Cot de xuat:

- `id text primary key`
- `plan_item_id text null`
- `action_type text not null`
- `target_type text`
- `target_id text`
- `note text`
- `created_by uuid null`
- `created_at timestamptz default now()`

### `mcp_plan_snapshots`

Luu KPI tai thoi diem tao plan de sau nay so sanh.

Cot de xuat:

- `id text primary key`
- `plan_id text not null`
- `snapshot_date date not null`
- `kpi jsonb not null default '{}'::jsonb`
- `source_filter jsonb not null default '{}'::jsonb`
- `created_at timestamptz default now()`

### `mcp_user_settings`

Luu cau hinh ca nhan sau khi co auth.

Cot de xuat:

- `id text primary key`
- `user_id uuid not null`
- `settings jsonb not null default '{}'::jsonb`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

## Migration phase sau

Truoc khi tao migration phai lam:

1. Check app da co auth chua.
2. Chot role nao duoc tao/sua/xoa plan.
3. Chot id strategy: text nanoid/uuid.
4. Chot naming status enum hay text constraint.
5. Viet RLS policy theo authenticated user, khong dung `anon update true`.

## Security fix migration rieng

Can tach khoi migration tao bang plan.

### Fix function search_path

- Xem definition cua `public.set_updated_at`.
- Sua function voi `set search_path = public` hoac schema phu hop.

### Fix public SECURITY DEFINER function

- Xem `public.rls_auto_enable()` co con can dung khong.
- Neu khong can public RPC:

```sql
revoke execute on function public.rls_auto_enable() from anon, authenticated;
```

### Fix RLS ghi qua mo

Can lam theo tung bang:

- Liet ke policy hien co.
- Xac dinh app hien tai co dang phu thuoc anon insert/update khong.
- Neu co, chuyen ghi qua backend truoc.
- Sau do drop policy anon insert/update qua mo va tao policy authenticated/service hop ly.

## Performance migration rieng

Advisor bao FK `test_customer_results.customer_id` chua co covering index.

Migration de xuat sau khi xac nhan query pattern:

```sql
create index if not exists idx_test_customer_results_customer_id
on public.test_customer_results(customer_id);
```

Khong xoa index unused luc nay vi data/query con moi, advisor unused co the chua co y nghia.
