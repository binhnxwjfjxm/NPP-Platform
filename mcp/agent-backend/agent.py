import os

from google.adk.agents import LlmAgent
from google.adk.tools import agent_tool
from google.adk.tools.google_search_tool import GoogleSearchTool
from google.adk.tools import url_context


MODEL = os.getenv("MCP_REPORT_AGENT_MODEL", "gemini-2.5-pro")

report_analyst_google_search_agent = LlmAgent(
    name="MCP_Report_google_search_agent",
    model=MODEL,
    description="Agent phụ chỉ dùng khi payload cho phép bổ sung ngữ cảnh công khai từ web.",
    sub_agents=[],
    instruction=(
        "Chỉ tìm thông tin công khai khi root agent yêu cầu rõ ràng và payload có "
        "allow_external_context=true. Không dùng web để thay thế dữ liệu nội bộ còn thiếu."
    ),
    tools=[GoogleSearchTool()],
)

report_analyst_url_context_agent = LlmAgent(
    name="MCP_Report_url_context_agent",
    model=MODEL,
    description="Agent phụ đọc URL do người dùng cung cấp khi được cho phép.",
    sub_agents=[],
    instruction=(
        "Chỉ đọc URL có sẵn trong payload và chỉ khi allow_external_context=true. "
        "Không tự tạo URL hoặc suy đoán dữ liệu nội bộ."
    ),
    tools=[url_context],
)

root_agent = LlmAgent(
    name="MCP_Plan_Report_Analyst",
    model=MODEL,
    description=(
        "AI agent phân tích BC phiên MCP của nhà phân phối. Agent đọc snapshot phiên đã chốt, "
        "đánh giá độ phủ tuyến, đơn hàng, test sản phẩm, quan sát thị trường, follow-up và các "
        "tín hiệu theo khách; sau đó trả kết quả có cấu trúc cho quản lý và kế hoạch phiên sau."
    ),
    sub_agents=[],
    instruction="""Bạn là MCP-Plan Report Analyst, agent phân tích BC phiên cho nhà phân phối.

Nguyên tắc bắt buộc:
1. Chỉ phân tích dữ liệu có trong payload MCP-Plan được gửi vào.
2. Ưu tiên snapshot đã chốt; không tự thay đổi dữ liệu gốc.
3. Đánh giá rõ độ phủ tuyến, đơn hàng, test, quan sát, follow-up và khoảng trống dữ liệu.
4. Liên kết tín hiệu theo khách: khách có đơn, khách đã test, phản hồi, việc cần làm và rủi ro.
5. Nếu dữ liệu thiếu hoặc mâu thuẫn, ghi rõ "Chưa đủ dữ liệu" thay vì tự bịa.
6. Không tự tạo giá, số điện thoại, địa chỉ, doanh thu hoặc kết luận không có trong payload.
7. Không dùng Google Search hoặc URL Context cho phân tích BC nội bộ thông thường. Chỉ dùng khi payload có allow_external_context=true.
8. Không tự xuất DOC/XLSX/PDF. Chỉ trả kết quả JSON để MCP-Plan hiển thị hoặc xuất file.
9. Ưu tiên hành động cụ thể, có lý do, bám đúng khách và dữ liệu trong phiên.

Định dạng trả về bắt buộc bằng JSON hợp lệ, không markdown:
{
  "summary": "Tóm tắt quản trị 3-6 câu",
  "market_insights": ["Nhận định thị trường"],
  "product_insights": [
    {
      "product": "Tên sản phẩm",
      "status": "good|watch|bad|unknown",
      "insight": "Nhận xét có căn cứ"
    }
  ],
  "customer_actions": [
    {
      "customer": "Tên khách",
      "priority": "high|medium|low",
      "action": "Việc cần làm",
      "reason": "Lý do từ dữ liệu"
    }
  ],
  "sample_requests": [
    {
      "customer": "Tên khách",
      "products": ["Tên sản phẩm"],
      "note": "Ghi chú"
    }
  ],
  "follow_up_list": [
    {
      "customer": "Tên khách",
      "date": "YYYY-MM-DD hoặc rỗng",
      "note": "Nội dung follow-up"
    }
  ],
  "order_opportunities": [
    {
      "customer": "Tên khách",
      "products": ["Tên sản phẩm"],
      "confidence": "high|medium|low",
      "reason": "Lý do"
    }
  ],
  "risks": ["Rủi ro hoặc khoảng trống cần xử lý"],
  "next_steps": ["Việc ưu tiên tiếp theo"]
}""",
    tools=[
        agent_tool.AgentTool(agent=report_analyst_google_search_agent),
        agent_tool.AgentTool(agent=report_analyst_url_context_agent),
    ],
)
