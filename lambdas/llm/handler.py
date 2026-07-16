"""
YMINSIGHT - LLM Consult Lambda (Bedrock Claude)

API Gateway (HTTP API) entrypoint: POST /api/consult. Backs the "AI 諮詢" drawer that's
present on every dashboard view (frontend/src/App.jsx: Drawer) plus the ship-view
"排入清潔計畫" deep-recommendation flow (RecoCard). See docs/feature-spec.md F4 (v0.2)
for the full request/response contract and the redesign rationale.

Grounded entirely in context the frontend already has in memory (the one ship or the
fleet-wide summary currently on screen) -- this Lambda does no S3/model reads of its
own, so it stays cheap and fast (boto3 only, same shape as lambdas/notify).

Response is always 200: a Bedrock timeout or an unparseable model reply degrades to a
fallback `answer` string rather than a 5xx, so the frontend drawer never needs
special-case error handling -- the same resilience pattern api.js already uses for
fleet data (multi-source fetch -> mock).
"""

import json
import logging
import os
import re
from datetime import datetime, timezone

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_bedrock = None


def bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime")
    return _bedrock


# Cross-region inference profile id -- required for on-demand invoke of this model in
# most Bedrock accounts/regions. Override via env var if the account uses a different
# model/profile. Bedrock retires model versions over time (confirmed in this account:
# claude-3-5-sonnet-20241022-v2:0 -> ResourceNotFoundException, "reached end of life") --
# check `aws bedrock list-inference-profiles` if invokes start failing with that error.
MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
MAX_TOKENS = 900
# want_detailed 除了一兩句話的回答，還要生出完整的 4 段跨部門建議 + JSON block；900 tokens
# 實測會在 JSON 中途被截斷（結尾沒有收合的 ``` /}），detailed_recommendation 因此永遠解析失敗。
MAX_TOKENS_DETAILED = 2000

PERSONA = "你是陽明海運的船體能效顧問，熟悉 Speed Loss、船體/螺旋槳汙損與清潔排程。"

DETAILED_INSTRUCTIONS = """
使用者按下「排入清潔計畫」，需要一份跨部門排程建議。先用一兩句話直接回答，接著在回答最後
附上一個 ```json 區塊（僅此區塊使用 JSON，前面的說明文字保持一般對話語氣），格式如下：
```json
{
  "recommendation": "CLEAN_NOW | DEFER | MONITOR",
  "confidence": 0.0-1.0,
  "details": {
    "for_technical_dept": "給工務部門的技術建議",
    "for_route_planning": "對航線排程的影響評估",
    "roi_analysis": "投資回收期分析",
    "risk_if_deferred": "延遲風險評估"
  }
}
```
若使用者尚未提供下一港口／預計到港天數／靠泊時數／預估清潔成本，就在回答中先簡短說明「提供這些
資訊可以讓建議更精確」，並仍然依現有資料給出上述 JSON 的初步版本（不要拒絕回答）。
"""


def _resp(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False)}


def lambda_handler(event, context):
    try:
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            import base64
            raw = base64.b64decode(raw).decode("utf-8")
        p = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(p, dict) or not p.get("question") or not p.get("view"):
            return _resp(400, {"error": "body must include view and question"})

        ship_ctx = p.get("ship_context") or None
        fleet_ctx = p.get("fleet_context") or None
        want_detailed = bool(p.get("want_detailed"))

        answer, detailed = _consult(
            view=p["view"], question=p["question"], history=p.get("history") or [],
            ship_ctx=ship_ctx, fleet_ctx=fleet_ctx, want_detailed=want_detailed,
        )

        return _resp(200, {
            "answer": answer,
            "suggested_action": _suggested_action(ship_ctx),
            "detailed_recommendation": detailed,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.error(f"consult failed before Bedrock call: {e}", exc_info=True)
        return _resp(200, {
            "answer": "AI 顧問目前無法回應，請稍後再試。",
            "suggested_action": None,
            "detailed_recommendation": None,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        })


def _suggested_action(ship_ctx):
    """Deterministic, mirrors RecoCard's st/dock logic in App.jsx -- not model output,
    so the drawer's action chip still renders even if the Bedrock call below fails."""
    if not ship_ctx:
        return None
    sl, thr = ship_ctx.get("current_pct"), ship_ctx.get("thr")
    if sl is None or thr is None:
        return None
    ship_id = ship_ctx.get("ship_id", "")
    if sl >= thr:
        dock = (ship_ctx.get("clean_count") or 0) >= 3
        return {
            "type": "ESCALATE_DRYDOCK" if dock else "SCHEDULE_CLEANING",
            "ship_id": ship_id,
            "summary": f"{ship_id} 目前 Speed Loss {sl:.1f}% 已超過警戒線 {thr}%，"
                       + ("清潔效果已遞減，建議評估進塢" if dock else "建議安排水下清潔"),
        }
    if sl >= thr / 2:
        return {"type": "MONITOR", "ship_id": ship_id,
                "summary": f"{ship_id} 目前 {sl:.1f}%，尚未超過警戒線 {thr}%，建議持續觀察"}
    return None


def _consult(view, question, history, ship_ctx, fleet_ctx, want_detailed):
    system = PERSONA + (DETAILED_INSTRUCTIONS if want_detailed else "")
    user_msg = _build_user_message(view, question, history, ship_ctx, fleet_ctx)

    try:
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": MAX_TOKENS_DETAILED if want_detailed else MAX_TOKENS,
            "system": system,
            "messages": [{"role": "user", "content": user_msg}],
        })
        raw = bedrock().invoke_model(modelId=MODEL_ID, body=body,
                                      contentType="application/json", accept="application/json")
        data = json.loads(raw["body"].read())
        text = data["content"][0]["text"]
    except Exception as e:
        logger.error(f"Bedrock invoke failed: {e}", exc_info=True)
        return "AI 顧問暫時無法連線（Bedrock 呼叫失敗），請稍後再試。", None

    if not want_detailed:
        return text.strip(), None

    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    if not m:
        return text.strip(), None
    visible = (text[:m.start()] + text[m.end():]).strip()
    try:
        detailed = json.loads(m.group(1))
    except json.JSONDecodeError:
        logger.warning("detailed_recommendation JSON block failed to parse")
        detailed = None
    return visible or text.strip(), detailed


def _build_user_message(view, question, history, ship_ctx, fleet_ctx):
    parts = [f"目前使用者在「{view}」這個畫面。"]
    if ship_ctx:
        parts.append("使用者正在看的船舶資料（來自後台已計算的資料，並非前端示意值）：\n"
                      + json.dumps(ship_ctx, ensure_ascii=False))
    if fleet_ctx:
        parts.append("目前船隊總覽的摘要：\n" + json.dumps(fleet_ctx, ensure_ascii=False))
    if history:
        convo = "\n".join(f"{'使用者' if h.get('role') == 'user' else 'AI'}：{h.get('text', '')}"
                           for h in history if h.get("role") in ("user", "ai"))
        if convo:
            parts.append("先前對話：\n" + convo)
    parts.append("請根據以上資料回答，並在回答中引用實際數字（不要只講原則性的話）。")
    parts.append(f"使用者的問題：{question}")
    return "\n\n".join(parts)
