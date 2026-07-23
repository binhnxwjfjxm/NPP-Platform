import json
import os
import re
import traceback
import uuid
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


app = FastAPI(title="MCP-Plan Report Agent Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    input: Any = None
    snapshot: Any = None
    report_type: str | None = None
    selected_items: list[Any] | None = None
    selected_only: bool = True
    task: str | None = None


def fallback_result(reason: str) -> Dict[str, Any]:
    return {
        "summary": reason,
        "market_insights": [],
        "product_insights": [],
        "customer_actions": [],
        "sample_requests": [],
        "follow_up_list": [],
        "order_opportunities": [],
        "risks": [reason],
        "next_steps": ["Kiểm tra log Cloud Run và dữ liệu BC phiên đầu vào."],
    }


def make_prompt(payload: AnalyzeRequest) -> str:
    source = payload.snapshot if payload.snapshot is not None else payload.input
    envelope = {
        "report_type": payload.report_type or "mcp_session_report",
        "selected_only": payload.selected_only,
        "selected_items": payload.selected_items or [],
        "task": payload.task or "mcp_session_report_analysis",
        "snapshot": source or {},
    }
    text = json.dumps(envelope, ensure_ascii=False, indent=2)
    if len(text) > 48000:
        text = text[:48000] + "\n/* truncated */"

    return f"""
Dữ liệu BC phiên từ MCP-Plan:

{text}

Hãy phân tích đúng dữ liệu trên và trả JSON theo schema trong instruction của agent.
Không markdown.
Không bịa dữ liệu.
Không tự tạo giá, số điện thoại, địa chỉ, doanh thu hoặc khách hàng nếu payload không có.
Nếu thiếu dữ liệu, nêu rõ "Chưa đủ dữ liệu".
"""


def parse_json_from_text(text: str) -> Dict[str, Any]:
    if not text:
        return fallback_result("Agent không trả nội dung.")

    cleaned = text.strip()
    cleaned = re.sub(r"^```json\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"^```\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"```$", "", cleaned).strip()

    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else fallback_result("Agent trả JSON không đúng object.")
    except Exception:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(cleaned[start : end + 1])
            return parsed if isinstance(parsed, dict) else fallback_result("Agent trả JSON không đúng object.")
        except Exception:
            pass

    result = fallback_result("Agent không trả JSON hợp lệ.")
    result["summary"] = cleaned
    return result


async def run_adk_agent(prompt: str) -> str:
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    from agent import root_agent

    app_name = "mcp_plan_report_agent"
    user_id = "mcp_plan_app"
    session_id = str(uuid.uuid4())

    session_service = InMemorySessionService()
    await session_service.create_session(
        app_name=app_name,
        user_id=user_id,
        session_id=session_id,
    )

    runner = Runner(
        agent=root_agent,
        app_name=app_name,
        session_service=session_service,
    )

    content = types.Content(
        role="user",
        parts=[types.Part(text=prompt)],
    )

    final_text = ""
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=content,
    ):
        if hasattr(event, "is_final_response") and event.is_final_response():
            if event.content and event.content.parts:
                final_text = "\n".join(
                    part.text
                    for part in event.content.parts
                    if getattr(part, "text", None)
                )

    return final_text


@app.get("/")
async def root():
    return {
        "ok": True,
        "service": "mcp-plan-report-agent",
        "model": os.getenv("MCP_REPORT_AGENT_MODEL", "gemini-2.5-pro"),
        "endpoints": ["/health", "/analyze"],
    }


@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "mcp-plan-report-agent",
        "project": os.getenv("GOOGLE_CLOUD_PROJECT", ""),
        "location": os.getenv("GOOGLE_CLOUD_LOCATION", ""),
        "vertex": os.getenv("GOOGLE_GENAI_USE_VERTEXAI", ""),
        "model": os.getenv("MCP_REPORT_AGENT_MODEL", "gemini-2.5-pro"),
    }


@app.post("/analyze")
async def analyze(payload: AnalyzeRequest):
    prompt = make_prompt(payload)
    try:
        raw_text = await run_adk_agent(prompt)
        result = parse_json_from_text(raw_text)
        return {
            "ok": True,
            "source": "google_adk_cloud_run",
            "selected_only": payload.selected_only,
            "report_type": payload.report_type or "mcp_session_report",
            "result": result,
            "raw": raw_text,
        }
    except Exception as exc:
        return {
            "ok": False,
            "source": "google_adk_cloud_run_error",
            "error": str(exc),
            "trace": traceback.format_exc(),
            "result": fallback_result(f"Agent backend lỗi: {exc}"),
        }
