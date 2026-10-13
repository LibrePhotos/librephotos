"""Whether a TCP port can be listened on, and which program holds it if not.

The standalone build checks its web server port before it does any work
(#2323): uvicorn reports a port it cannot bind with ``SystemExit`` after the
migrations, the sidecars and the job cluster have all started, and only its
log says why. A user needs the port and, when it can be found, the program
that holds it.

Importable without Django, like ``api.runtime.sidecars``.
"""

from __future__ import annotations

import socket
import sys
from typing import NamedTuple

import psutil


class PortOwner(NamedTuple):
    """The process listening on a port. ``name`` is None when Windows or the
    OS does not say (a process of another user, an elevated one)."""

    pid: int
    name: str | None


def bind_error(host: str, port: int) -> OSError | None:
    """Why listening on ``(host, port)`` fails right now, or None when it works.

    Binds a throwaway socket the way the server does and closes it again: on
    Windows without SO_REUSEADDR (there it would let two programs share the
    port), elsewhere with it, as asyncio does, so a connection of a previous
    run in TIME_WAIT does not count as taken. A race with another program
    binding right after is still possible; the server reports that itself.
    """
    try:
        family, kind, proto, _, address = socket.getaddrinfo(
            host, port, type=socket.SOCK_STREAM, flags=socket.AI_PASSIVE
        )[0]
    except OSError as error:
        return error
    with socket.socket(family, kind, proto) as probe:
        if sys.platform != "win32":
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(address)
        except OSError as error:
            return error
    return None


def port_owner(port: int) -> PortOwner | None:
    """The process listening on TCP ``port`` on any address, or None when
    nobody listens or the OS does not tell (macOS without root, for one)."""
    try:
        connections = psutil.net_connections(kind="tcp")
    except psutil.Error:
        return None
    for connection in connections:
        if (
            connection.status == psutil.CONN_LISTEN
            and connection.laddr
            and connection.laddr.port == port
            and connection.pid
        ):
            try:
                name = psutil.Process(connection.pid).name()
            except psutil.Error:
                name = None
            return PortOwner(connection.pid, name)
    return None
