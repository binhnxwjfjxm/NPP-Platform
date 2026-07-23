# MCP Session Snapshot Contract

## Model dung

```text
Route Master
  -> Route Customer Master
  -> Daily Session
  -> Session Customer Snapshot
  -> Visit Result / Order / Follow-up
```

## Vai tro tung lop

- Route Master: tuyen goc, ke hoach chuan.
- Route Customer Master: danh sach khach mac dinh cua tuyen.
- Daily Session: phien MCP cua mot ngay cu the.
- Session Customer Snapshot: danh sach khach da copy vao phien ngay.
- Visit Result: ket qua ghe thuc te cua mot khach trong phien.

## Quy tac bat buoc

1. Mo phien MCP ngay phai tao snapshot khach tu Route Customer Master.
2. Sua Route Master sau khi mo phien khong duoc tu dong sua snapshot da mo.
3. Khach phat sinh trong ngay phai co `source = added`.
4. Khach dong bo bo sung phai co `source = synced`.
5. Khong hard delete khach khoi phien.
6. Bo qua hoac huy phai co ly do.
7. `mcp_visits` chi la ket qua ghe thuc te, khong phai danh sach khach phai ghe.
8. Don hang, test san pham, bao cao thi truong va follow-up phai bam vao session customer snapshot.

## Mapping Supabase sau nay

Can them bang moi:

```text
mcp_session_customers
```

Bang nay nam giua `mcp_route_sessions` va `mcp_visits`.

`mcp_visits` chi nen tham chieu ve `mcp_session_customers.id` de luu ket qua ghe.

## Ly do

Neu dung `mcp_visits` lam danh sach khach phai ghe, app se bi sai logic khi:

- Mo phien nhung chua ghe.
- Khach bi bo qua co ly do.
- Khach phat sinh trong ngay.
- Sua tuyen goc sau khi phien ngay da mo.
- Can doi chieu ke hoach ban dau voi ket qua thuc te.
