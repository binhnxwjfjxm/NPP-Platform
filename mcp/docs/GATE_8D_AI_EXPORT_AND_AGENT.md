# Gate 8D — AI-ready export và ADK Agent

## Mục tiêu

- BC phiên đã chốt xuất được JSON có schema ổn định.
- Có bản Markdown dễ đọc/dán vào AI.
- Export ưu tiên snapshot chính thức trong `mcp_session_reports`; chỉ fallback về live aggregation khi chưa có snapshot.
- Có proxy server-side để gọi ADK Agent khi người dùng chủ động bấm phân tích.
- Chuyển agent Gemini 2.5 Pro từ repo `report-02` sang MCP-Plan và đổi instruction sang dữ liệu BC phiên.

## API

### JSON

```text
GET /api/mcp-session-report/export?sessionId=<id>&format=json
```

Schema:

```text
mcp.session-report.ai.v1
```

### Markdown

```text
GET /api/mcp-session-report/export?sessionId=<id>&format=markdown
```

### Phân tích ADK Agent

```text
POST /api/mcp-session-report/analyze
Content-Type: application/json

{
  "sessionId": "mrs_..."
}
```

Server tự đọc snapshot chính thức, tạo payload AI và gọi:

```text
MCP_REPORT_AGENT_URL
```

Không nhận URL agent từ client.

## Agent backend

Thư mục:

```text
agent-backend/
```

Nguồn được chuyển từ build ADK trong `report-02`:

```text
agent.py
main.py
Dockerfile
requirements.txt
```

Repo cũ không có file deploy Cloud Run trong thư mục agent. MCP-Plan bổ sung:

```text
deploy-cloud-run.ps1
```

## Nguyên tắc chi phí

- Không tự gọi agent khi mở BC.
- Rule-based summary chạy tại app, không tốn token AI.
- Chỉ gọi Gemini/ADK khi người dùng bấm `Phân tích bằng ADK Agent`.
- JSON/Markdown export không gọi AI.

## Test local

```powershell
cd "F:\1_A_Disk_D\Tool\mcp-plan"
git pull origin main
npm run build
```

Sau đó test:

```text
/reports
→ mở BC phiên
→ Xuất JSON
→ Xuất Markdown
→ tab AI Summary
```

Khi chưa cấu hình `MCP_REPORT_AGENT_URL`, nút phân tích phải báo rõ chưa cấu hình agent, không làm hỏng JSON/Markdown export.
