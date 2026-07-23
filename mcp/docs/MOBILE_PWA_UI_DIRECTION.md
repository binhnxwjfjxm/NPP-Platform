# Mobile PWA UI Direction

MCP-Plan uu tien mobile/PWA som de tranh lap lai loi UI web bi don va nat khi them module.

## Huong tham khao

Khong copy app nao, chi lay nguyen tac:

```text
Notion       = ro rang, card-based, it nhieu vien phu
Shopify POS  = thao tac nhanh, card lon, phu hop ban hang
Linear       = spacing gon, danh sach sach, trang thai ro
```

## Nguyen tac UI mobile

```text
1. Mobile first cho nghiep vu field sales
2. Bottom navigation thay sidebar tren man nho
3. Bang dai tren desktop phai thanh card tren mobile
4. KPI card 2 cot tren mobile
5. Touch target toi thieu khoang 44px
6. Filter chip scroll ngang, khong ep xuong qua nhieu dong
7. Noi dung quan trong nam tren dau man
8. Moi tab co popup/sheet rieng theo nghiep vu, khong ep chung mot form
```

## Da lam

```text
src/app/mobile.css
src/app/order-popups.css
src/app/manifest.ts
src/app/layout.tsx
src/ui/overlay/BottomSheet.tsx
src/ui/shell/AppShell.tsx
src/ui/shell/navigation.ts
src/ui/table/DataTable.tsx
src/features/orders/OrdersClientPage.tsx
src/features/market-checks/MarketChecksClientPage.tsx
```

Thay doi:

```text
- an sidebar tren mobile
- them bottom nav fixed
- them short label va icon cho nav
- DataTable co desktop table + mobile card mode
- toi uu spacing, card, filter chip, KPI mobile
- them manifest cho PWA standalone
- them theme color va apple web app metadata
- them bottom sheet primitive
- /orders co popup chi tiet don mau
- /field-checks co popup chi tiet kiem tra mau
```

## Popup pattern theo tab

```text
/orders       -> chi tiet don, trang thai, tao viec theo doi
/field-checks -> ghi nhan san pham/gia/doi thu, tao viec xu ly
/visits       -> check-in, bo qua khach, ket qua ghe
/plans        -> cap nhat viec, doi owner, doi han
/routes       -> xem tuyen, mo phien MCP
/customers    -> thong tin diem ban, lich su giao dich
```

## Man can soi sau buoc nay

```text
/
/orders
/field-checks
/plans
/routes
/customers
/visits
```

## Buoc tiep theo

```text
1. Test /orders va /field-checks popup tren mobile viewport
2. Chinh lai card neu qua dai
3. Lam popup mau cho /plans hoac /visits
4. Them app icon PNG day du kich thuoc
5. Them offline shell sau
```
