"""Request-ID middleware (pure ASGI so it also wraps error responses)."""
from __future__ import annotations

import logging
import re

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from logging_setup import new_request_id, reset_request_id, set_request_id

logger = logging.getLogger("ps16.http")
_VALID_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        incoming = ""
        for k, v in scope.get("headers", []):
            if k == b"x-request-id":
                incoming = v.decode("latin-1")
                break
        rid = incoming if _VALID_ID.match(incoming) else new_request_id()
        token = set_request_id(rid)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"x-request-id"]
                headers.append((b"x-request-id", rid.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        try:
            logger.info("%s %s", scope.get("method", "WS"), scope.get("path"))
            await self.app(scope, receive, send_wrapper)
        finally:
            reset_request_id(token)
