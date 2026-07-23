# VPS Backend Apps

Ghi chú vận hành VPS `backend-DO-02` để tránh backend khác ảnh hưởng MCP production.

## VPS

```text
IP: 165.22.109.61
SSH root:
ssh -i "F:\1_A_Disk_D\khuong-binh\TK\DIGI-OCEAN\DO-backend-02\backend-DO-02" root@165.22.109.61
```

## MCP production

```text
Folder: /var/www/mcp-plan-backend
Port nội bộ: 3001
PM2 app: mcp-plan-backend
Health: http://127.0.0.1:3001/health
Deploy/pull: pullmcp
```

Không đụng khi thêm app khác:

```text
/var/www/mcp-plan-backend
pullmcp
PM2 app mcp-plan-backend
Port 3001
.env MCP
Nginx route/proxy đang phục vụ MCP
```

## QR Milk Tea backend

```text
Folder: /var/www/milktea
Port nội bộ: 3002
PM2 app: milktea-backend
Health: http://127.0.0.1:3002/health
```

## Quy ước thêm backend mới

Mỗi backend mới phải tách riêng:

```text
Folder riêng: /var/www/<ten-app>
Port riêng: 3003, 3004, ...
PM2 name riêng: <ten-app>-backend
Nginx server/location riêng
Deploy script riêng
Không dùng pullmcp
```

Trước khi sửa Nginx phải backup:

```bash
sudo cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak.$(date +%F-%H%M)
```

Sau khi sửa phải check:

```bash
sudo nginx -t
pm2 list
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3002/health
```

## Trạng thái đã xác nhận

Đã thêm backend QR Milk Tea riêng trên VPS và không đụng MCP production:

```text
Không sửa /var/www/mcp-plan-backend
Không sửa pullmcp
Không đổi PM2 app mcp-plan-backend
Không dùng port 3001
Không sửa .env MCP
```

Đã check sau khi thêm:

```bash
sudo nginx -t
pm2 list
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3002/health
```
