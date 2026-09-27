# VPS production runtime manifest

> Trạng thái: ACTIVE SOURCE OF TRUTH
> Cập nhật: 2026-09-27

## Kiến trúc production

```text
Vercel frontends
├── MCP Field
├── Công Ty
├── Admin
├── Delivery
└── Website + Customer Ordering

VPS Công Ty
└── Công Ty backend

VPS MCP
└── MCP backend

VPS DB
└── PostgreSQL dùng chung cho installation
```

## Deploy boundary

- Công Ty backend chỉ deploy bằng `/deploy-vps-company-production`.
- MCP backend chỉ deploy bằng `/deploy-vps-mcp-production`.
- Hai backend deploy độc lập, có release/smoke/rollback riêng.
- Chỉ sửa frontend thì không deploy backend.
- Auto Deploy production luôn tắt.
- Không merge, deploy hoặc migrate production nếu chưa có yêu cầu rõ.

## Database boundary

- PostgreSQL là authority duy nhất của installation.
- Schema change phải có migration trong repo.
- Không sửa production DB thủ công.
- Migration lớn cần backup xác nhận được, restore rehearsal và đối soát trước/sau.
- `DATABASE_URL` chỉ là tên biến kết nối PostgreSQL phía server; không đưa secret vào GitHub, Vercel, chat hoặc screenshot.

## Smoke

Công Ty:
- `/health/live`
- `/health/ready`

MCP:
- `/health/live`
- `/health/ready`

Sau merge phải kiểm exact `main`, CI, working tree local sạch và HEAD khớp GitHub trước production rollout.
