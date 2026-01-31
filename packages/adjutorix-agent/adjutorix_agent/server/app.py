import asyncio
import json
import logging
import os
from typing import Dict, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from .auth import verify_local_request
from .rpc import RPCDispatcher


LOG_LEVEL = os.getenv("ADJUTORIX_LOG_LEVEL", "INFO")

logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger("adjutorix.server")


class WebSocketManager:
    def __init__(self) -> None:
        self.connections: Dict[str, WebSocket] = {}

    async def connect(self, client_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.connections[client_id] = ws
        logger.info("WebSocket connected: %s", client_id)

    def disconnect(self, client_id: str) -> None:
        if client_id in self.connections:
            del self.connections[client_id]
            logger.info("WebSocket disconnected: %s", client_id)

    async def send(self, client_id: str, message: Dict[str, Any]) -> None:
        ws = self.connections.get(client_id)
        if not ws:
            return

        await ws.send_text(json.dumps(message))


app = FastAPI(
    title="Adjutorix Agent",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "vscode-webview://*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rpc_dispatcher = RPCDispatcher()
ws_manager = WebSocketManager()


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    try:
        verify_local_request(request)
    except Exception as exc:
        logger.warning("Auth failed: %s", exc)
        return JSONResponse(
            status_code=401,
            content={"error": "unauthorized"},
        )

    return await call_next(request)


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/rpc")
async def rpc_endpoint(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    JSON-RPC over HTTP
    """
    logger.debug("RPC request: %s", payload)

    try:
        response = await rpc_dispatcher.dispatch(payload)
        return response

    except Exception as exc:
        logger.exception("RPC error")

        return {
            "jsonrpc": "2.0",
            "id": payload.get("id"),
            "error": {
                "code": -32000,
                "message": "Internal error",
                "data": str(exc),
            },
        }


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(ws: WebSocket, client_id: str):
    """
    JSON-RPC over WebSocket
    """
    try:
        await ws_manager.connect(client_id, ws)

        while True:
            raw = await ws.receive_text()
            payload = json.loads(raw)

            logger.debug("WS RPC from %s: %s", client_id, payload)

            try:
                response = await rpc_dispatcher.dispatch(payload)
            except Exception as exc:
                logger.exception("WS RPC error")

                response = {
                    "jsonrpc": "2.0",
                    "id": payload.get("id"),
                    "error": {
                        "code": -32000,
                        "message": "Internal error",
                        "data": str(exc),
                    },
                }

            await ws_manager.send(client_id, response)

    except WebSocketDisconnect:
        ws_manager.disconnect(client_id)

    except Exception as exc:
        logger.exception("WebSocket fatal error: %s", exc)
        ws_manager.disconnect(client_id)


def run():
    """
    Entrypoint for CLI/dev scripts
    """
    host = os.getenv("ADJUTORIX_HOST", "127.0.0.1")
    port = int(os.getenv("ADJUTORIX_PORT", "8765"))

    logger.info("Starting Adjutorix Agent on %s:%s", host, port)

    uvicorn.run(
        "adjutorix_agent.server.app:app",
        host=host,
        port=port,
        log_level=LOG_LEVEL.lower(),
        reload=False,
    )


if __name__ == "__main__":
    run()
