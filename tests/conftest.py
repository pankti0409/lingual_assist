"""Shared fixtures: network block, live marker, app/client."""
from __future__ import annotations

import ipaddress
import socket

import pytest
from fastapi.testclient import TestClient

from config import load_settings
from main import create_app


def _is_loopback(host: object) -> bool:
    if not isinstance(host, str):
        return True
    if host in ("localhost", ""):
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


@pytest.fixture(autouse=True)
def _block_network(request, monkeypatch):
    """Block non-loopback connections for tests not marked `live`."""
    if request.node.get_closest_marker("live"):
        return
    real_connect = socket.socket.connect

    def guarded(self, address):
        if isinstance(address, tuple) and not _is_loopback(address[0]):
            raise RuntimeError(
                f"Network access blocked in offline test (attempted {address[0]}); mark it @pytest.mark.live"
            )
        return real_connect(self, address)

    monkeypatch.setattr(socket.socket, "connect", guarded)


@pytest.fixture
def settings():
    return load_settings({}, use_dotenv=False)


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
