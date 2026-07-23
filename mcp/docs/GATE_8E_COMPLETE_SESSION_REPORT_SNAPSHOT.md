# Gate 8E — Complete BC phiên snapshot

## Mục tiêu

BC phiên đã chốt phải là nguồn dữ liệu quản trị hoàn chỉnh, không để `/reports` tính lại insight ở frontend.

## Dữ liệu lưu trong `mcp_session_reports`

```text
schema_version
customer_details
insights
score
health
warnings
recommended_actions
ai_prompt_context
ai_result
ai_analyzed_at
```

Schema hiện tại:

```text
mcp.session-report.snapshot.v2
```

## Customer details

`customer_details` lưu toàn bộ khách của phiên, không chỉ khách có phát sinh:

```text
id
routeId
routeCustomerId
customerId
customerName
phone
area
sortOrder
visitStatus
statusReason
note
orderId
testId
reportId
followupCount
orders[]
tests[]
observations[]
followups[]
```

Liên kết ưu tiên ID thật từ `mcp_session_customers`. Chỉ fallback theo tên khi tên khách là duy nhất trong phiên, tránh gán nhầm dữ liệu cho hai khách trùng tên.

## Snapshot flow

```text
Chốt phiên / Rebuild BC
→ buildMcpSessionReportSummary
→ buildSessionReportCustomerDetails
→ buildSessionReportEnrichment
→ upsert mcp_session_reports
→ /reports đọc trực tiếp snapshot đã lưu
```

## Enrichment

Rule-based enrichment chạy ở backend khi tạo snapshot:

```text
score: 0..100
health: good | watch | risk
insights
warnings
recommended_actions
ai_prompt_context
```

Frontend chỉ hiển thị dữ liệu đã lưu. Không tự tính lại score, health hoặc cảnh báo.

## AI result persistence

```text
POST /api/mcp-session-report/analyze
{
  "sessionId": "mrs_..."
}
```

Luồng:

```text
Đọc snapshot chính thức
→ gửi ai_prompt_context tới ADK Agent
→ nhận JSON kết quả
→ lưu ai_result + ai_analyzed_at vào đúng BC phiên
```

Không có snapshot thì API từ chối chạy AI và yêu cầu rebuild BC trước.

## Export

```text
GET /api/mcp-session-report/export?sessionId=<id>&format=json
GET /api/mcp-session-report/export?sessionId=<id>&format=markdown
```

Hai dạng export đọc dữ liệu persisted trong snapshot v2, gồm cả đủ khách và kết quả AI đã lưu nếu có.

## Trạng thái dữ liệu hiện tại

Phiên `mrs_cb8fd2bdce284568985f9864636b4f92` đã được rebuild trực tiếp trong Supabase:

```text
customer_details: 26/26
planned/visited/pending/skipped: 26/2/24/0
orders/tests: 1/1
score: 35
health: risk
AI context customers: 26
```

Không deploy Vercel trong Gate 8E khi deployment đang bị khóa để tiết kiệm quota.
