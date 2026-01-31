import os
import secrets
from typing import Optional

from fastapi import Request, HTTPException, status


# Token is generated once and stored locally
# Used by VSCode extension / CLI to authenticate
TOKEN_FILE = os.path.expanduser("~/.adjutorix/token")


def _load_or_create_token() -> str:
    """
    Load existing token or create a new one.
    Token is stored locally and never sent over network.
    """

    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)

    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()

    token = secrets.token_hex(32)

    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        f.write(token)

    os.chmod(TOKEN_FILE, 0o600)

    return token


LOCAL_TOKEN = _load_or_create_token()


def get_local_token() -> str:
    """
    Exposed for client tools
    """
    return LOCAL_TOKEN


def require_local_token(token: str) -> None:
    """
    Validate token string (e.g. from RPC params). Raises HTTPException if invalid.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing token",
        )
    if not secrets.compare_digest(token, LOCAL_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )


def extract_token(request: Request) -> Optional[str]:
    """
    Extract token from header or query param. Public for use in RPC dispatch.
    """

    auth = request.headers.get("Authorization")
    if auth and auth.startswith("Bearer "):
        return auth.replace("Bearer ", "").strip()

    return request.query_params.get("token")


def verify_local_request(request: Request) -> None:
    """
    Ensure request is:
    - From localhost
    - Has valid token
    """

    client = request.client

    if not client:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown client",
        )

    ip = client.host

    if ip not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Remote connections forbidden",
        )

    token = extract_token(request)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing token",
        )

    if not secrets.compare_digest(token, LOCAL_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
