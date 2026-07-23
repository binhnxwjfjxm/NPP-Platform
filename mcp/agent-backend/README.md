# MCP-Plan Report Agent

Agent này được chuyển từ build ADK trong repo `report-02` và đổi instruction/input sang BC phiên MCP.

## Cấu trúc

- `agent.py`: Gemini 2.5 Pro ADK agent và schema kết quả.
- `main.py`: FastAPI `/health` và `/analyze`.
- `Dockerfile`: image chạy Cloud Run.
- `deploy-cloud-run.ps1`: build/deploy source bằng `gcloud run deploy`.

## Deploy Cloud Run

Chạy trong PowerShell tại thư mục `agent-backend`:

```powershell
.\deploy-cloud-run.ps1 -ProjectId "YOUR_GOOGLE_CLOUD_PROJECT_ID"
```

Script trả về hai URL:

```text
https://<service>.run.app/health
https://<service>.run.app/analyze
```

Sau đó cấu hình server MCP-Plan:

```text
MCP_REPORT_AGENT_URL=https://<service>.run.app/analyze
```

Nếu Cloud Run yêu cầu token riêng, cấu hình thêm:

```text
MCP_REPORT_AGENT_TOKEN=<token>
```

## Luồng gọi

```text
BC phiên đã chốt
→ /api/mcp-session-report/analyze
→ MCP_REPORT_AGENT_URL
→ ADK Agent / Gemini 2.5 Pro
→ JSON có cấu trúc
```

Agent không được gọi tự động. Chỉ phát sinh chi phí khi người dùng bấm phân tích AI.
