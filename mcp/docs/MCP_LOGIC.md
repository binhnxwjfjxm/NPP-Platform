# MCP Logic

Tai lieu nay chot logic cot loi cho MCP-Plan. Nguyen tac: khong tron ke hoach goc voi phien di thuc te. Khi co loi phai sua dung logic, khong chap va UI.

## 1. Khai niem chinh

MCP co 5 tang du lieu:

```text
Route Master
  -> Route Customer Master
  -> Daily Session
  -> Session Customer Snapshot
  -> Visit Result / Order / Follow-up
```

Y nghia tung tang:

```text
Route Master              = tuyen goc / ke hoach chuan
Route Customer Master     = danh sach khach mac dinh trong tuyen
Daily Session             = phien MCP cua mot ngay cu the
Session Customer Snapshot = danh sach khach trong phien ngay
Visit Result              = ket qua ghe thuc te
```

Ket luan quan trong:

```text
Tuyen goc la ke hoach.
Phien ngay la thuc te.
Visit la ket qua sau khi da ghe.
```

## 2. Route Master

Route Master la tuyen goc, vi du:

```text
Tuyen Cho Gao
Sale A phu trach
Chay thu 2, thu 4, thu 6
Trang thai: active
```

Route Master khong phai phien di thuc te. No chi la ke hoach chuan de tao cac phien ngay.

Route Master co the sua:

```text
- ten tuyen
- khu vuc
- sale phu trach
- trang thai active/inactive
- lich chay trong tuan
```

## 3. Route Customer Master

Route Customer Master la danh sach khach mac dinh cua tuyen.

Vi du:

```text
Tuyen Cho Gao - Thu 2
1. KH A
2. KH B
3. KH C
```

Duoc phep thao tac:

```text
- them khach vao tuyen
- xoa khach khoi tuyen
- doi thu tu ghe
- sua ghi chu
- doi ngay chay
- doi tan suat ghe
- tam dung khach trong tuyen
```

Day van la du lieu master. Sua o day chi anh huong cac phien duoc mo sau do, khong duoc tu dong lam thay doi phien ngay da mo.

## 4. Daily Session

Daily Session la phien MCP cua mot ngay cu the.

Khi user bam mo MCP ngay hom nay, he thong tao session:

```text
route_id      = tuyen goc
session_date  = ngay di thuc te
sales_owner   = sale phu trach tai thoi diem mo phien
status        = opened
opened_at     = thoi diem mo phien
```

Session co cac trang thai:

```text
planned    = da tao lich nhung chua mo
opened     = dang di thuc te
completed  = da ket thuc
cancelled  = huy phien
```

Quy tac:

```text
Mot route co the co nhieu session theo ngay.
Mot session thuoc mot route.
Session la ban ghi lich su, khong nen sua lung tung sau khi completed.
```

## 5. Session Customer Snapshot

Day la bang/cau truc quan trong nhat de tranh sai logic.

Khi mo Daily Session, he thong copy danh sach khach active tu Route Customer Master sang Session Customer Snapshot.

Vi du route master co:

```text
KH A
KH B
KH C
```

Khi mo phien ngay 2026-07-03, session snapshot co:

```text
KH A - source planned - status pending
KH B - source planned - status pending
KH C - source planned - status pending
```

Quy tac quan trong:

```text
Sau khi session da mo, sua Route Customer Master khong duoc tu dong thay doi session dang chay.
```

Muon thay doi session dang chay thi phai co thao tac rieng:

```text
- them khach vao phien hom nay
- bo qua khach trong phien hom nay
- dong bo them tu route master vao phien hom nay neu admin chu dong chon
```

## 6. Trang thai khach trong session

Moi khach trong session can co status rieng:

```text
pending    = chua ghe
visited    = da ghe
skipped    = bo qua co ly do
cancelled  = huy khoi phien co ly do
```

Moi khach trong session can co source:

```text
planned = copy tu route master khi mo phien
added   = them phat sinh trong ngay
synced  = dong bo them tu route master vao session da mo
```

Khong xoa cung khach khoi session dang chay. Neu khong di thi set `skipped` va ghi ly do.

Ly do bo qua co the la:

```text
- khach dong cua
- sale khong kip di
- sai tuyen
- khach nghi ban
- trung du lieu
- ly do khac
```

## 7. Visit Result

Visit Result chi duoc tao khi co hanh dong ghe thuc te.

Visit khong phai danh sach khach can di.

Visit ghi nhan:

```text
session_customer_id
session_id
customer_id
checkin_at
checkout_at
result_note
has_order
next_action
```

Quy tac:

```text
Session Customer Snapshot = danh sach can xu ly trong ngay.
Visit Result = ket qua sau khi da ghe.
```

Neu khach trong session co status `visited`, nen co visit result tuong ung.

## 8. Them khach phat sinh trong ngay

Khi sale gap khach ngoai tuyen trong ngay, khong tu dong them vao Route Customer Master.

Dung luong dung:

```text
1. Them khach vao Daily Session hien tai
2. Tao Session Customer Snapshot voi source = added
3. Neu can, tao de xuat dua khach nay vao Route Customer Master
4. Admin duyet thi moi them vao tuyen goc
```

Ly do: khach phat sinh trong ngay chua chac nen thanh khach co dinh trong tuyen.

## 9. Sua Route Master khi session da mo

Tinh huong:

```text
08:00 mo session hom nay
08:30 sale bat dau di
09:00 admin sua route master
```

Quy tac dung:

```text
Session hom nay giu nguyen snapshot.
Route master thay doi chi anh huong cac session mo sau do.
```

Neu admin muon ap thay doi vao session hom nay, can nut rieng:

```text
Dong bo thay doi vao phien hom nay
```

Can canh bao:

```text
Phien hom nay da co du lieu thuc te. Dong bo co the them/bo qua khach trong phien dang chay.
```

## 10. Ket thuc session

Khi ket thuc phien ngay:

```text
session.status = completed
completed_at = now
```

Bao cao session can tinh duoc:

```text
- tong khach theo ke hoach
- khach them phat sinh
- da ghe
- bo qua
- co don
- khong co don
- can ghe lai
- viec can xu ly tiep
```

## 11. Model database de xuat

### mcp_routes

```text
id
name
area
sales_owner_id
schedule_days
is_active
created_at
updated_at
```

### mcp_route_customers

```text
id
route_id
customer_id
day_of_week
sort_order
frequency
note
is_active
created_at
updated_at
```

### mcp_route_sessions

```text
id
route_id
session_date
sales_owner_id
status
opened_at
completed_at
cancelled_at
created_at
updated_at
```

### mcp_session_customers

Bang nay bat buoc can co.

```text
id
session_id
customer_id
route_customer_id
source
status
sort_order
added_reason
skip_reason
cancel_reason
note
created_at
updated_at
```

### mcp_visits

```text
id
session_customer_id
session_id
customer_id
checkin_at
checkout_at
result_note
has_order
next_action
created_at
updated_at
```

## 12. UI can bam theo logic nay

### Routes screen

Can the hien:

```text
- danh sach route master
- sale phu trach
- lich chay
- tong khach trong tuyen
- trang thai route
```

Route detail can co:

```text
- danh sach khach master trong tuyen
- thu tu ghe
- ngay chay
- nut mo session ngay
```

### Visits screen

Khong nen chi la bang visit result. No nen the hien phien ngay:

```text
- session dang mo
- danh sach khach trong session
- pending / visited / skipped
- khach added trong ngay
- ket qua visit neu co
```

### Plans screen

Plans nen nhan viec tu session:

```text
- khach can ghe lai
- khach chua co don
- diem ban can bo sung thong tin
- diem ban phat sinh can duyet vao route master
```

## 13. Cac loi logic can tranh

```text
Sai 1: Dung mcp_visits lam danh sach khach can di.
Dung: mcp_session_customers moi la danh sach can xu ly trong ngay.

Sai 2: Sua route master lam thay doi session da mo.
Dung: session da mo phai giu snapshot.

Sai 3: Xoa khach khoi session khi khong ghe.
Dung: set skipped va ghi ly do.

Sai 4: Khach phat sinh tu dong vao route master.
Dung: them vao session truoc, route master can admin duyet.

Sai 5: UI query truc tiep Supabase.
Dung: UI dung mock/API contract; data source nam sau backend adapter.
```

## 14. Ket luan

Logic MCP chuan cua MCP-Plan:

```text
Route Master
  -> Route Customer Master
  -> Open Daily Session
  -> Copy to Session Customer Snapshot
  -> Execute Visit
  -> Create Order / Follow-up / Plan
```

Neu sau nay code, UI, API hay database di nguoc logic nay thi phai sua tu goc, khong chap va.
