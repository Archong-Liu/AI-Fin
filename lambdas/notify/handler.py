"""
YMINSIGHT - Notify Lambda (on-demand emailing)

API Gateway (HTTP API) entrypoint: POST /api/notify. Composes a vessel-performance
email for a given ship and sends it via Amazon SES. User-initiated (trigger model C):
the dashboard supplies the ship context it already has, so this Lambda stays light
(boto3 only, no data/model dependencies).

Request body (JSON):
    {
      "ship_id":         "S1",              # required
      "current_pct":     6.9,               # optional — current Speed Loss %
      "days_since_hull": 180,               # optional — days since last hull clean
      "recipients":      ["a@b.com"],       # optional — defaults to SES_RECIPIENT
      "note":            "free text"        # optional — extra body line
    }

SES note: the sender must be a verified identity; in sandbox recipients must be
verified too. Sender/recipient default to the same verified address for the demo.
"""

import base64
import json
import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_ses = None


def ses():
    global _ses
    if _ses is None:
        _ses = boto3.client("ses")
    return _ses


SES_SENDER = os.environ.get("SES_SENDER", "aaarrchong@gmail.com")
SES_RECIPIENT = os.environ.get("SES_RECIPIENT", "aaarrchong@gmail.com")
SENDER_NAME = os.environ.get("SES_SENDER_NAME", "YMINSIGHT 效能告警")


def _resp(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body)}


def lambda_handler(event, context):
    """HTTP API entrypoint. Composes and sends the notification email via SES."""
    try:
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        p = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(p, dict) or not p.get("ship_id"):
            return _resp(400, {"error": "body must be a JSON object with ship_id"})

        recipients = p.get("recipients") or [SES_RECIPIENT]
        subject, html, text = compose(
            ship=p["ship_id"],
            current_pct=p.get("current_pct"),
            days_since_hull=p.get("days_since_hull"),
            note=p.get("note", ""),
        )

        result = ses().send_email(
            Source=f"{SENDER_NAME} <{SES_SENDER}>",
            Destination={"ToAddresses": recipients},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Html": {"Data": html, "Charset": "UTF-8"},
                    "Text": {"Data": text, "Charset": "UTF-8"},
                },
            },
        )
        logger.info(f"sent email {result['MessageId']} to {recipients}")
        return _resp(200, {"sent": True, "message_id": result["MessageId"], "recipients": recipients})
    except Exception as e:
        logger.error(f"notify failed: {e}", exc_info=True)
        return _resp(500, {"error": str(e)})


def compose(ship: str, current_pct, days_since_hull, note: str):
    sl = f"{current_pct}%" if current_pct is not None else "N/A"
    dc = f"{days_since_hull} 天" if days_since_hull is not None else "N/A"
    status = _status(current_pct)

    subject = f"[YMINSIGHT] 船舶 {ship} 效能通知 — Speed Loss {sl}"
    text = (
        f"船舶 {ship} 效能狀態通知\n"
        f"----------------------------------------\n"
        f"目前 Speed Loss：{sl}（{status}）\n"
        f"距離上次船體清潔：{dc}\n"
        + (f"\n備註：{note}\n" if note else "")
        + "\n— YMINSIGHT 智慧船舶效能監控\n"
    )
    html = (
        '<html><body style="font-family:sans-serif;color:#1a2b3c">'
        f'<h2>船舶 {ship} 效能通知</h2>'
        '<table cellpadding="6" style="border-collapse:collapse">'
        f'<tr><td><b>目前 Speed Loss</b></td><td>{sl} <span style="color:{_color(current_pct)}">({status})</span></td></tr>'
        f'<tr><td><b>距離上次船體清潔</b></td><td>{dc}</td></tr>'
        '</table>'
        + (f'<p>{note}</p>' if note else "")
        + '<hr><small>YMINSIGHT 智慧船舶效能監控與跨部門排程協調系統</small>'
        '</body></html>'
    )
    return subject, html, text


def _status(pct) -> str:
    if pct is None:
        return "未知"
    if pct >= 12:
        return "嚴重 / 建議儘速清潔"
    if pct >= 8:
        return "警示 / 建議安排清潔"
    return "良好"


def _color(pct) -> str:
    if pct is None:
        return "#888"
    if pct >= 12:
        return "#c0392b"
    if pct >= 8:
        return "#e67e22"
    return "#27ae60"
