"""The Nextcloud client: log in, list a folder, download a file. Nothing else.

It replaces pyocclient, which LibrePhotos used for these three calls only. Every
request goes through the ``requests.Session`` it is given, which
``nextcloud.server_address.guarded_session`` builds with the redirect check
and the certificate check attached, and every request has a timeout.

Paths are the ones pyocclient used: ``/Photos/Holiday 2024/`` relative to the
user's WebDAV root, starting with ``/``, a folder's ending with ``/``. They
are quoted on the way out and unquoted on the way in. A path from the server
(an ``href``) is only used when it lies under the user's WebDAV root on the
configured server and has no ``.`` or ``..`` segment, backslash or control
character; anything else is left out of the listing.

The listing XML is parsed with expat directly: a document type declaration
or an entity declaration is refused outright, and a listing larger than
``MAX_LISTING_BYTES`` is not read.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from urllib.parse import quote, unquote, urlparse
from xml.parsers import expat

if TYPE_CHECKING:
    import requests

logger = logging.getLogger(__name__)

# (connect, read) seconds for every request. A read timeout is the longest
# silence between two pieces of an answer, not the whole download.
TIMEOUT = (10, 120)
# A listing of one folder (Depth 1) larger than this is refused.
MAX_LISTING_BYTES = 256 * 1024 * 1024
DOWNLOAD_CHUNK_BYTES = 64 * 1024

_CAPABILITIES = "ocs/v1.php/cloud/capabilities"
_UNSAFE_PATH = re.compile(r"[\x00-\x1f\x7f\\]")


class ResponseError(Exception):
    """Nextcloud answered with an error status (pyocclient's message format)."""

    def __init__(self, status_code: int, kind: str = "HTTP") -> None:
        super().__init__(f"{kind} error: {status_code}")
        self.status_code = status_code


class InvalidAnswerError(ResponseError):
    """Nextcloud's answer could not be read: not the XML it should be, or too large."""

    def __init__(self, status_code: int, reason: str) -> None:
        super().__init__(status_code, "WebDAV")
        self.args = (f"WebDAV error: {status_code}: {reason}",)


class UnsafeRemotePathError(ValueError):
    """A remote path with a ``.``/``..`` segment, a backslash or a control character."""


@dataclass
class RemoteFile:
    """A file or folder of a listing (what the scan read of pyocclient's FileInfo).

    A folder's ``href`` ends with ``/``, which is how pyocclient told them apart.
    """

    path: str
    attributes: dict[str, str | None] = field(default_factory=dict)
    directory: bool = False

    def is_dir(self) -> bool:
        return self.directory


def clean_path(path: str) -> str:
    """``path`` relative to the WebDAV root, starting with ``/``.

    Raises UnsafeRemotePathError for a ``.`` or ``..`` segment, a backslash
    or a control character: none of them can name a file below the root.
    """
    if not path.startswith("/"):
        path = "/" + path
    segments = path.split("/")
    if _UNSAFE_PATH.search(path) or any(s in (".", "..") for s in segments):
        raise UnsafeRemotePathError("the remote path is not a plain path")
    return path


def _refuse(*_args: object) -> None:
    raise InvalidAnswerError(207, "the answer declares a document type or entities")


def _refuse_external_entity(*_args: object) -> int:
    raise InvalidAnswerError(207, "the answer refers to an external entity")


def parse_xml(data: bytes, status_code: int) -> ET.Element:
    """``data`` as an element tree; refuses DTDs and entity declarations."""
    builder = ET.TreeBuilder()
    parser = expat.ParserCreate(namespace_separator="}")
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    parser.StartDoctypeDeclHandler = _refuse
    parser.EntityDeclHandler = _refuse
    parser.UnparsedEntityDeclHandler = _refuse
    parser.ExternalEntityRefHandler = _refuse_external_entity

    def start(name: str, attributes: dict[str, str]) -> None:
        builder.start(_tag(name), attributes)

    def end(name: str) -> None:
        builder.end(_tag(name))

    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.CharacterDataHandler = builder.data
    try:
        parser.Parse(data, True)
        return builder.close()
    except (expat.ExpatError, AssertionError) as error:
        raise InvalidAnswerError(status_code, "the answer is not valid XML") from error


def _tag(name: str) -> str:
    """expat's ``namespace}local`` as ElementTree's ``{namespace}local``."""
    return "{" + name if "}" in name else name


class NextcloudClient:
    """WebDAV and OCS on one Nextcloud, through ``session``."""

    def __init__(self, url: str, session: requests.Session) -> None:
        self.url = url if url.endswith("/") else url + "/"
        self._session = session
        self._server = urlparse(self.url)
        # What a login against a server without the capability answer would
        # pick; login() sets both from the server's capabilities.
        self._root_paths: tuple[str, ...] = ()
        self._webdav_url = ""

    def _request(
        self,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        stream: bool = False,
    ) -> requests.Response:
        return self._session.request(
            method, url, headers=headers, stream=stream, timeout=TIMEOUT
        )

    # ---------------------------------------------------------------- login
    def login(self, user_id: str, password: str) -> None:
        """Check the credentials and pick the WebDAV root, as pyocclient did.

        Asks for the server's capabilities: a server announcing chunked
        uploads (every Nextcloud) is used at ``remote.php/webdav``, any other
        at ``remote.php/dav/files/<user>``. Raises ResponseError for an
        error status ("HTTP error: 401" for a wrong app password) or an OCS
        status other than 100.
        """
        self._session.auth = (user_id, password)
        self._update_capabilities(user_id)

    def _update_capabilities(self, user_id: str) -> None:
        response = self._request(
            "GET", self.url + _CAPABILITIES, headers={"OCS-APIREQUEST": "true"}
        )
        try:
            if response.status_code != 200:
                raise ResponseError(response.status_code)
            tree = parse_xml(_bounded_body(response), response.status_code)
        finally:
            response.close()
        status = tree.findtext("meta/statuscode")
        if status is not None and status.strip() != "100":
            raise ResponseError(int(status) if status.strip().isdigit() else 0, "OCS")
        chunking = tree.find("data/capabilities/dav/chunking")
        base = self._server.path
        webdav = base + "remote.php/webdav"
        files = base + "remote.php/dav/files/" + quote(user_id)
        root = webdav if chunking is not None else files
        self._webdav_url = f"{self._server.scheme}://{self._server.netloc}{root}"
        # Hrefs under either root are accepted; requests go to ``root``.
        self._root_paths = (root, webdav if root == files else files)

    # ----------------------------------------------------------------- list
    def list(self, path: str) -> list[RemoteFile]:
        """The files and folders directly in the folder ``path``.

        Raises ResponseError for an error status, InvalidAnswerError for an
        answer that is not a readable listing, UnsafeRemotePathError for a
        ``path`` with ``..`` and the like.
        """
        path = clean_path(path)
        if not path.endswith("/"):
            path += "/"
        response = self._request(
            "PROPFIND", self._webdav_url + quote(path), headers={"Depth": "1"}
        )
        try:
            if response.status_code not in (200, 207):
                raise ResponseError(response.status_code)
            if response.status_code != 207:
                return []  # pyocclient answered a 200 with no listing either
            tree = parse_xml(_bounded_body(response), 207)
        finally:
            response.close()
        listed = []
        skipped = 0
        for element in tree.findall("{DAV:}response"):
            item = self._remote_file(element)
            if item is None:
                skipped += 1
            elif item.path != path:  # the folder itself
                listed.append(item)
        if skipped:
            logger.warning(
                "Left %d entries out of a Nextcloud listing: they are not below "
                "the user's WebDAV folder",
                skipped,
            )
        return listed

    def _remote_file(self, element: ET.Element) -> RemoteFile | None:
        href = element.findtext("{DAV:}href")
        if href is None:
            return None
        path = self._relative_path(href.strip())
        if path is None:
            logger.debug("Left Nextcloud entry %r out of the listing", href)
            return None
        return RemoteFile(path, _properties(element), directory=path.endswith("/"))

    def _relative_path(self, href: str) -> str | None:
        """``href`` as a path below the WebDAV root, or None if it is not one."""
        target = urlparse(href)
        if target.scheme or target.netloc:
            same_server = (
                target.scheme.lower() == self._server.scheme.lower()
                and target.netloc.lower() == self._server.netloc.lower()
            )
            if not same_server:
                return None
        # Compared decoded: servers differ in how they percent-encode.
        decoded = unquote(target.path)
        for root in self._root_paths:
            prefix = unquote(root)
            if decoded == prefix or decoded.startswith(prefix + "/"):
                relative = decoded[len(prefix) :] or "/"
                break
        else:
            return None
        try:
            return clean_path(relative)
        except UnsafeRemotePathError:
            return None

    # ------------------------------------------------------------- download
    def get_file(self, remote_path: str, local_file: str) -> bool:
        """Stream ``remote_path`` into ``local_file``; whether it was there.

        Raises ResponseError for an error status. Another success status than
        200 (no content) writes nothing and answers False, as pyocclient did.
        """
        url = self._webdav_url + quote(clean_path(remote_path))
        response = self._request("GET", url, stream=True)
        try:
            if response.status_code >= 400:
                raise ResponseError(response.status_code)
            if response.status_code != 200:
                return False
            with open(local_file, "wb") as out:
                for chunk in response.iter_content(DOWNLOAD_CHUNK_BYTES):
                    out.write(chunk)
        finally:
            response.close()
        return True


def _bounded_body(response: requests.Response) -> bytes:
    """The answer's body, refused past MAX_LISTING_BYTES."""
    body = bytearray()
    for chunk in response.iter_content(DOWNLOAD_CHUNK_BYTES):
        body += chunk
        if len(body) > MAX_LISTING_BYTES:
            raise InvalidAnswerError(response.status_code, "the answer is too large")
    return bytes(body)


def _properties(element: ET.Element) -> dict[str, str | None]:
    """The properties of a ``<d:response>``, from its first successful propstat.

    pyocclient read the first propstat whatever its status; Nextcloud lists
    the found properties (200) first and the missing ones (404) after them.
    """
    propstats = element.findall("{DAV:}propstat")
    chosen = next(
        (
            propstat
            for propstat in propstats
            if " 200 " in (propstat.findtext("{DAV:}status") or " 200 ")
        ),
        propstats[0] if propstats else None,
    )
    prop = chosen.find("{DAV:}prop") if chosen is not None else None
    if prop is None:
        return {}
    return {child.tag: child.text for child in prop}
