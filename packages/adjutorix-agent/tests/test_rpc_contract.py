"""
Contract test: capabilities must return protocol === 1 and methods including "job.run".
Prevents drift between agent and controller (e.g. PROTOCOL_VERSION mismatch).

Run with the same interpreter that has the package installed (avoids skip when
pip install -e . was done with e.g. Python 3.9 but pytest runs under 3.14):

  python3.9 -m pytest tests/test_rpc_contract.py -v

Or use a venv and one interpreter for everything:

  python3 -m venv .venv && source .venv/bin/activate
  pip install -e ".[dev]"
  python -m pytest tests/test_rpc_contract.py -v
"""
import tempfile

import pytest

try:
    from adjutorix_agent.server.rpc import JOB_METHODS, PROTOCOL_VERSION, RPCDispatcher
except ModuleNotFoundError:
    pytest.skip(
        "adjutorix_agent not installed or deps missing; run pip install -e . from package root",
        allow_module_level=True,
    )


def test_capabilities_protocol_and_job_run():
    """Agent capabilities must advertise protocol 1 and job.run so controller gate passes."""
    with tempfile.TemporaryDirectory() as tmp:
        dispatcher = RPCDispatcher(repo_root=tmp)
        cap = dispatcher.rpc_capabilities({})
    assert cap.get("ok") is True
    assert cap.get("protocol") == 1, "Controller expects protocol 1; drift would disable actions"
    assert cap["protocol"] == PROTOCOL_VERSION, "Single source of truth"
    methods = cap.get("methods") or []
    assert "job.run" in methods, "Controller gate requires methods.includes('job.run')"
    assert set(methods) == set(JOB_METHODS), "Advertised methods must match implementation"
