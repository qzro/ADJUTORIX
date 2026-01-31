import json
import traceback
from typing import Any, Callable, Dict

from fastapi import APIRouter, Request, Depends, HTTPException, status

from .auth import verify_local_request
from ..core.executor import Executor
from ..core.state_machine import StateMachine


router = APIRouter()


class RPCError(Exception):
    def __init__(self, code: int, message: str, data: Any = None):
        self.code = code
        self.message = message
        self.data = data


class RPCRegistry:
    """
    Registers and dispatches JSON-RPC methods.
    """

    def __init__(self) -> None:
        self._methods: Dict[str, Callable[..., Any]] = {}

    def register(self, name: str, fn: Callable[..., Any]) -> None:
        if name in self._methods:
            raise ValueError(f"RPC method already registered: {name}")

        self._methods[name] = fn

    def get(self, name: str) -> Callable[..., Any]:
        if name not in self._methods:
            raise RPCError(-32601, f"Method not found: {name}")

        return self._methods[name]


registry = RPCRegistry()

# Core singletons
_state_machine = StateMachine()
_executor = Executor(_state_machine)


def rpc_method(name: str):
    """
    Decorator to register RPC handlers.
    """

    def wrapper(fn: Callable[..., Any]) -> Callable[..., Any]:
        registry.register(name, fn)
        return fn

    return wrapper


@router.post("/rpc")
async def handle_rpc(
    request: Request,
    _: None = Depends(verify_local_request),
):
    """
    Main JSON-RPC 2.0 endpoint.
    """

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON",
        )

    rpc_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params", {})

    try:
        if not isinstance(payload, dict):
            raise RPCError(-32600, "Invalid Request")

        if not method or not isinstance(method, str):
            raise RPCError(-32600, "Missing method")

        handler = registry.get(method)

        result = await _maybe_await(handler, params)

        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": result,
        }

    except RPCError as e:
        return _error(rpc_id, e.code, e.message, e.data)

    except Exception as e:
        tb = traceback.format_exc()

        return _error(
            rpc_id,
            -32603,
            "Internal error",
            {
                "exception": str(e),
                "traceback": tb,
            },
        )


async def _maybe_await(fn: Callable, params: Dict[str, Any]) -> Any:
    """
    Support sync + async handlers.
    """

    result = fn(**params)

    if hasattr(result, "__await__"):
        return await result

    return result


def _error(
    rpc_id: Any,
    code: int,
    message: str,
    data: Any = None,
) -> Dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "error": {
            "code": code,
            "message": message,
            "data": data,
        },
    }
