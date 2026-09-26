"""Decide whether a user's Nextcloud server address may be contacted.

The Nextcloud server address is typed in by the user, and the backend is the
one that connects to it. Without a check, any user could make the backend send
requests to places only the backend can reach: its own services on localhost,
or the cloud provider's metadata endpoint on a link-local address.

``validate_server_address`` resolves the host name and looks at every address
it resolves to, so a DNS name cannot smuggle in an address a literal IP would
have been refused for. Loopback, link-local, multicast, unspecified and
reserved addresses are always refused. Private network addresses (RFC 1918,
IPv6 unique local, the 100.64.0.0/10 shared space Tailscale uses, Docker's
networks) are allowed by default, because a Nextcloud on the same LAN or in the
same Compose project is how most people run it; ``NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES``
turns that off for instances whose users should not reach the local network.

The check runs before the connection is made, so it does not pin the address:
a DNS answer that changes between the check and the connection is not caught.
Redirects are checked hop by hop by ``GuardedClient``.
"""

import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import owncloud as nextcloud
from django.conf import settings

_ALLOWED_SCHEMES = {"http", "https"}
_NAT64 = ipaddress.ip_network("64:ff9b::/96")
# 0.0.0.0/8 is "this network"; Linux connects 0.0.0.0 to the local host.
_THIS_NETWORK = ipaddress.ip_network("0.0.0.0/8")


class UnsafeServerAddress(ValueError):
    """The Nextcloud server address must not be contacted."""


def private_addresses_allowed() -> bool:
    return bool(getattr(settings, "NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES", True))


def _embedded_ipv4(addr):
    """Return the IPv4 address an IPv6 address carries, if it carries one."""
    if addr.version != 6:
        return None
    if addr.ipv4_mapped is not None:
        return addr.ipv4_mapped
    if addr.sixtofour is not None:
        return addr.sixtofour
    if addr in _NAT64:
        return ipaddress.IPv4Address(int(addr) & 0xFFFFFFFF)
    return None


def _refusal(addr, allow_private: bool):
    """Name the kind of address ``addr`` is if it must be refused, else None."""
    addr = _embedded_ipv4(addr) or addr
    if addr.is_unspecified or (addr.version == 4 and addr in _THIS_NETWORK):
        return "an unspecified"
    if addr.is_loopback:
        return "a loopback"
    if addr.is_link_local:
        return "a link-local"
    if addr.is_multicast:
        return "a multicast"
    if addr.is_reserved:
        return "a reserved"
    if not addr.is_global and not allow_private:
        return "a private network"
    return None


def _resolve(host: str, port):
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError) as e:
        raise UnsafeServerAddress(
            f"The Nextcloud server address could not be resolved: {host}"
        ) from e
    addresses = []
    for info in infos:
        try:
            addresses.append(ipaddress.ip_address(info[4][0]))
        except ValueError:
            continue
    if not addresses:
        raise UnsafeServerAddress(
            f"The Nextcloud server address could not be resolved: {host}"
        )
    return addresses


def validate_server_address(url: str) -> None:
    """Raise ``UnsafeServerAddress`` unless ``url`` may be contacted."""
    if not (url or "").strip():
        raise UnsafeServerAddress("No Nextcloud server address is set.")
    try:
        parsed = urlparse((url or "").strip())
        port = parsed.port
    except ValueError as e:
        raise UnsafeServerAddress("The Nextcloud server address is not a URL.") from e
    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        raise UnsafeServerAddress(
            "The Nextcloud server address has to start with http:// or https://."
        )
    host = parsed.hostname
    if not host:
        raise UnsafeServerAddress("The Nextcloud server address has no host name.")

    allow_private = private_addresses_allowed()
    for addr in _resolve(host, port or (443 if parsed.scheme == "https" else 80)):
        kind = _refusal(addr, allow_private)
        if kind:
            hint = (
                " An administrator can allow it with "
                "NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES=true."
                if kind == "a private network"
                else ""
            )
            raise UnsafeServerAddress(
                f"The Nextcloud server address points to {kind} address, which "
                f"LibrePhotos does not connect to.{hint}"
            )


def is_safe_server_address(url: str) -> bool:
    try:
        validate_server_address(url)
    except UnsafeServerAddress:
        return False
    return True


def _refuse_unsafe_redirect(response, *args, **kwargs):
    if response.is_redirect:
        validate_server_address(urljoin(response.url, response.headers["location"]))
    return response


class GuardedClient(nextcloud.Client):
    """A pyocclient ``Client`` that refuses to follow redirects to unsafe hosts.

    pyocclient creates its ``requests`` session inside ``login()``, so the
    redirect check is attached whenever a session is assigned.
    """

    @property
    def _session(self):
        return self.__dict__.get("_guarded_session")

    @_session.setter
    def _session(self, session):
        if session is not None:
            session.hooks["response"].append(_refuse_unsafe_redirect)
        self.__dict__["_guarded_session"] = session


def connect(user) -> nextcloud.Client:
    """Log in to ``user``'s Nextcloud after checking the server address."""
    address = (user.nextcloud_server_address or "").strip()
    validate_server_address(address)
    nc = GuardedClient(address)
    nc.login(user.nextcloud_username, user.nextcloud_app_password)
    return nc
