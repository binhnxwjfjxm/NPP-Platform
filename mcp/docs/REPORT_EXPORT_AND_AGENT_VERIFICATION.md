# BC phiên — Xuất văn phòng và Agent

## Nhóm xuất file

### Xuất văn phòng

- PDF: xem, in hoặc gửi quản lý.
- Excel: lọc và đối chiếu danh sách khách trong phiên.
- Word: chỉnh sửa, bổ sung nhận xét và gửi nội bộ.

### Dữ liệu AI

- JSON: payload máy đọc cho Gemini/ADK/API.
- Markdown: văn bản kỹ thuật để dán vào AI hoặc lưu cùng tài liệu dự án.

JSON và Markdown không hiển thị thành nút chính trên card BC phiên.

## Agent đã xác minh

Cloud Run:

```text
https://report-agent-375343885071.asia-southeast1.run.app
```

Endpoint:

```text
GET  /health
POST /analyze
```

Kết quả kiểm tra ngày 2026-07-11:

```text
GET /health  -> HTTP 200, ok=true
POST /analyze -> HTTP 200, ok=true, source=google_adk_cloud_run
```

Phản hồi test đã nhận được tóm tắt, rủi ro độ phủ tuyến và việc tiếp theo từ Gemini/ADK.

Biến môi trường:

```text
MCP_REPORT_AGENT_URL=https://report-agent-375343885071.asia-southeast1.run.app/analyze
```

`src/lib/mcp/report-agent-config.ts` giữ endpoint đã xác minh làm fallback để local không còn lỗi `missing_mcp_report_agent_url` khi `.env.local` chưa khai báo biến.

## API MCP-Plan

```text
GET  /api/mcp-session-report/analyze
POST /api/mcp-session-report/analyze
```

- GET kiểm tra health của Cloud Run.
- POST gửi snapshot BC phiên đã chốt, nhận kết quả AI và lưu vào `mcp_session_reports.ai_result`.

Deployment trigger after verified local build: 2026-07-11.

Vercel deployment trigger after disabling verified commit requirement.
