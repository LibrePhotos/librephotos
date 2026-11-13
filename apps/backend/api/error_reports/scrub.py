"""What is left of an error before it is saved: nothing that names a person or a place.

``scrub_event`` rebuilds a Sentry event from an allowlist, so a field this
module does not know (a new SDK's, a browser's) never gets through. What it
keeps (the apps/docs page "Error reporting" lists the same):

* the event's id, time, level, platform, logger name, release and environment;
* the error's type and message, and its stack: file, function, line and the
  lines of code around it;
* a log message, with its arguments filled in;
* the name and version of the SDK, the Python runtime, the operating system
  and the browser, and the browser's User-Agent;
* the HTTP method and the matched URL pattern (``/api/photos/{pk}/``), never
  the URL itself.

Everything else goes: the request (URL, query, body, cookies, headers), the
user, breadcrumbs, local variables, extra data, tags, installed packages,
threads and the server's name.

Every kept string goes through ``scrub_text``, which replaces paths below a
library root and other absolute paths, file names of photos and videos,
usernames, the names of people, albums and tags, email and IP addresses,
URLs and this server's host names. Code paths are made relative (to the
backend, ``site-packages`` or the Python install) instead, so stacks stay
readable.

A name is replaced only where it can name someone: in text, never in the
names code goes by (a frame's file, module and function, an error's type, the
logger) nor in a code reference inside text (``api/search/semantic.py``,
``api.search.semantic``). Numbers, function words and HTTP methods are not
names at all: tags come from the keywords of files, and in 1.6.0 such tags
turned "POST", "Could not", "500 Server Error" and line numbers into ``<name>``.
"""

from __future__ import annotations

import functools
import hashlib
import ipaddress
import json
import os
import re
import socket
import sys
import sysconfig
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from django.conf import settings

from api.mime import (
    IMAGE_EXTENSIONS,
    METADATA_EXTENSIONS,
    RAW_EXTENSIONS,
    VIDEO_EXTENSIONS,
)

type Json = None | bool | int | float | str | list[Json] | dict[str, Json]
type JsonObject = dict[str, Json]

SOURCE_SERVER = "server"
SOURCE_BROWSER = "browser"

LIBRARY = "<library>"
PATH = "<path>"
FILE = "<file>"
NAME = "<name>"
EMAIL = "<email>"
IP = "<ip>"
URL = "<url>"
HOST = "<host>"

# Long enough for a message with a short traceback, short enough that 30
# reports stay small.
MAX_TEXT = 2000
MAX_CODE_LINE = 300
MAX_CONTEXT_LINES = 5
MAX_FRAMES = 50
MAX_EXCEPTIONS = 5
# A name shorter than this would also hit ordinary words in every message.
MIN_NAME = 3
# Enough for every person, album and tag of a large library.
MAX_NAMES = 20000
# Host names that are words in messages, not secrets.
COMMON_HOSTS = frozenset({"localhost", "backend", "frontend", "proxy", "db"})
# Words every message is made of: English function words of three letters or
# more (shorter names are skipped anyway) and the HTTP methods. A tag or an
# album titled like one of them would otherwise blank them out of every report.
ORDINARY_WORDS = frozenset(
    """
    about above across after again against all also among and any are around
    because been before behind being below beside between both but can cannot
    could did does doing down during each either else ever every few for from
    had has have having her here hers him his how into its just less many more
    most much must near neither nor not now off once one only onto other ought
    our ours out over own per same shall she should since some such than that
    the their theirs them then there these they this those though through thus
    till too toward under unless until upon very via was were what when where
    whether which while who whom whose why will with within without would yet
    you your yours
    get head post put patch delete options trace connect
    """.split()
)

_URL = re.compile(r"\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s'\"<>]+")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_POSIX_PATH = re.compile(r"(?<![\w<>.~:/\\-])/[^\s'\"<>:]+/[^\s'\"<>]*")
_WINDOWS_PATH = re.compile(r"\b[a-zA-Z]:[\\/][^\s'\"<>|?*]*")
_IPV4 = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
_IPV6 = re.compile(r"(?<![\w:])[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7}(?![\w:])")
_MEDIA_EXTENSIONS = sorted(
    {
        ext.lstrip(".")
        for ext in IMAGE_EXTENSIONS
        | VIDEO_EXTENSIONS
        | RAW_EXTENSIONS
        | METADATA_EXTENSIONS
    },
    key=len,
    reverse=True,
)
_MEDIA_FILE = re.compile(
    rf"[^\s'\"/\\<>]+\.(?:{'|'.join(map(re.escape, _MEDIA_EXTENSIONS))})\b",
    re.IGNORECASE,
)
_CASE = re.IGNORECASE if os.name == "nt" else 0
# A Python source file, or a dotted path whose first part is a loaded module.
_CODE_REFERENCE = re.compile(
    r"[\w.\\/-]+\.py\b|\b(?P<package>[A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)+"
)


def _alternation(words: Iterable[str]) -> str:
    return "|".join(
        re.escape(word) for word in sorted(set(words), key=len, reverse=True)
    )


@dataclass(frozen=True)
class ScrubContext:
    """What this server knows is private, read once and kept for a while."""

    #: Folders photos live in: everything below one is replaced.
    library_roots: tuple[str, ...] = ()
    #: Code folders and what to show instead (``""`` makes a path relative).
    code_roots: tuple[tuple[str, str], ...] = ()
    #: Other folders that name a person (home folders).
    private_roots: tuple[str, ...] = ()
    hostnames: tuple[str, ...] = ()
    #: Usernames and the names of people, albums and tags.
    names: tuple[str, ...] = ()
    release: str = ""
    created: float = field(default_factory=time.monotonic)

    @functools.cached_property
    def _code(self) -> list[tuple[re.Pattern[str], str]]:
        roots = sorted(self.code_roots, key=lambda root: len(root[0]), reverse=True)
        return [
            (re.compile(re.escape(root.rstrip("/\\")) + r"[/\\]", _CASE), shown)
            for root, shown in roots
            if len(root.rstrip("/\\")) > 3
        ]

    @functools.cached_property
    def _roots(self) -> list[tuple[re.Pattern[str], str]]:
        found: list[tuple[re.Pattern[str], str]] = []
        for roots, shown in ((self.library_roots, LIBRARY), (self.private_roots, PATH)):
            spellings = {
                spelling
                for root in roots
                for spelling in _spellings(root.rstrip("/\\"))
                if len(spelling) > 3
            }
            if spellings:
                pattern = rf"(?:{_alternation(spellings)})(?![\w-])[^'\"\n]*"
                found.append((re.compile(pattern, _CASE), shown))
        return found

    @functools.cached_property
    def _hosts(self) -> re.Pattern[str] | None:
        hosts = [h for h in self.hostnames if h and h.lower() not in COMMON_HOSTS]
        if not hosts:
            return None
        return re.compile(rf"(?<![\w.-])(?:{_alternation(hosts)})(?![\w-])", re.I)

    @functools.cached_property
    def _names(self) -> re.Pattern[str] | None:
        names = [name for name in self.names if _is_name(name)]
        if not names:
            return None
        return re.compile(rf"(?<!\w)(?:{_alternation(names)})(?!\w)", re.IGNORECASE)


def _is_name(word: str) -> bool:
    """Whether ``word`` can name someone, rather than be part of any message."""
    return (
        len(word) >= MIN_NAME
        and any(char.isalpha() for char in word)
        and word.casefold() not in ORDINARY_WORDS
    )


def _code_spans(text: str) -> list[tuple[int, int]]:
    return [
        match.span()
        for match in _CODE_REFERENCE.finditer(text)
        if match["package"] is None or match["package"] in sys.modules
    ]


def _replace_names(text: str, names: re.Pattern[str]) -> str:
    """``text`` with the names replaced, except inside code references."""
    code = _code_spans(text)

    def name_or_code(match: re.Match[str]) -> str:
        if any(start <= match.start() < end for start, end in code):
            return match.group(0)
        return NAME

    return names.sub(name_or_code, text)


def _spellings(root: str) -> set[str]:
    """``root`` with either kind of slash: Windows paths come with both."""
    return {root, root.replace("\\", "/"), root.replace("/", "\\")}


def _replace_ips(text: str) -> str:
    def ip_or_text(match: re.Match[str]) -> str:
        try:
            ipaddress.ip_address(match.group(0))
        except ValueError:
            return match.group(0)
        return IP

    return _IPV6.sub(ip_or_text, _IPV4.sub(ip_or_text, text))


def scrub_text(
    text: str,
    context: ScrubContext,
    *,
    limit: int = MAX_TEXT,
    paths: bool = True,
    names: bool = True,
) -> str:
    """``text`` without anything ``ScrubContext`` or the patterns call private.

    ``paths=False`` keeps absolute paths that are not below a known folder:
    for a script's URL path or a URL pattern, which name code, not files.
    ``names=False`` keeps the names of people, albums and tags: for code.
    """
    text = _URL.sub(URL, text)
    text = _EMAIL.sub(EMAIL, text)
    for pattern, shown in context._code:
        text = pattern.sub(shown.replace("\\", "\\\\"), text)
    for pattern, shown in context._roots:
        text = pattern.sub(shown, text)
    if paths:
        text = _WINDOWS_PATH.sub(PATH, text)
        text = _POSIX_PATH.sub(PATH, text)
    text = _MEDIA_FILE.sub(FILE, text)
    text = _replace_ips(text)
    if context._hosts is not None:
        text = context._hosts.sub(HOST, text)
    if names and context._names is not None:
        text = _replace_names(text, context._names)
    return text[:limit]


def scrub_path(path: str, context: ScrubContext) -> str:
    """A stack frame's file: code relative, a script URL as its path only."""
    if "://" in path:
        return scrub_text(urlsplit(path).path, context, paths=False)
    return scrub_text(path, context, names=False)


def _text(value: Json, context: ScrubContext, *, limit: int = MAX_TEXT) -> str | None:
    return scrub_text(value, context, limit=limit) if isinstance(value, str) else None


def _code(
    value: Json, context: ScrubContext, *, limit: int = MAX_CODE_LINE
) -> str | None:
    """A name from code (a function, a module, a type), which names no one."""
    if not isinstance(value, str):
        return None
    return scrub_text(value, context, limit=limit, names=False)


def _put(target: JsonObject, key: str, value: Json) -> None:
    if value is not None:
        target[key] = value


def _object(value: Json) -> Mapping[str, Json]:
    return value if isinstance(value, dict) else {}


def _list(value: Json) -> list[Json]:
    return value if isinstance(value, list) else []


def _number(value: Json) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return value


def _frame(raw: Mapping[str, Json], context: ScrubContext) -> JsonObject:
    frame: JsonObject = {}
    for key in ("filename", "abs_path"):
        value = raw.get(key)
        if isinstance(value, str):
            frame[key] = scrub_path(value, context)
    for key in ("module", "function"):
        _put(frame, key, _code(raw.get(key), context))
    for key in ("lineno", "colno"):
        _put(frame, key, _number(raw.get(key)))
    in_app = raw.get("in_app")
    if isinstance(in_app, bool):
        frame["in_app"] = in_app
    # Lines of code are scrubbed like messages: a test or a script can spell
    # out a name, which a function or module name never does.
    _put(
        frame,
        "context_line",
        _text(raw.get("context_line"), context, limit=MAX_CODE_LINE),
    )
    for key in ("pre_context", "post_context"):
        lines = [
            scrub_text(line, context, limit=MAX_CODE_LINE)
            for line in _list(raw.get(key))[-MAX_CONTEXT_LINES:]
            if isinstance(line, str)
        ]
        if lines:
            frame[key] = list[Json](lines)
    return frame


def _exception(raw: Mapping[str, Json], context: ScrubContext) -> JsonObject:
    exception: JsonObject = {}
    _put(exception, "type", _code(raw.get("type"), context))
    _put(exception, "value", _text(raw.get("value"), context))
    _put(exception, "module", _code(raw.get("module"), context))
    mechanism = _object(raw.get("mechanism"))
    if mechanism:
        kept: JsonObject = {}
        _put(kept, "type", _code(mechanism.get("type"), context, limit=64))
        handled = mechanism.get("handled")
        if isinstance(handled, bool):
            kept["handled"] = handled
        exception["mechanism"] = kept
    frames = _list(_object(raw.get("stacktrace")).get("frames"))
    if frames:
        exception["stacktrace"] = {
            "frames": [
                _frame(frame, context)
                for frame in frames[-MAX_FRAMES:]
                if isinstance(frame, dict)
            ]
        }
    return exception


def _name_and_version(raw: Json, context: ScrubContext) -> JsonObject | None:
    kept: JsonObject = {}
    for key in ("name", "version"):
        _put(kept, key, _text(_object(raw).get(key), context, limit=64))
    return kept or None


def _user_agent(event: Mapping[str, Json]) -> str | None:
    headers = _object(_object(event.get("request")).get("headers"))
    for key, value in headers.items():
        if key.lower() == "user-agent" and isinstance(value, str):
            return value[:MAX_CODE_LINE]
    return None


def _header(
    event: Mapping[str, Json], context: ScrubContext, *, source: str
) -> JsonObject:
    out: JsonObject = {}
    for key in ("event_id", "platform", "level", "logger", "environment"):
        _put(out, key, _code(event.get(key), context, limit=64))
    timestamp = event.get("timestamp")
    if isinstance(timestamp, str):
        out["timestamp"] = timestamp[:64]
    else:
        _put(out, "timestamp", _number(timestamp))
    # The server's release: the web app it serves is the same build.
    out["release"] = context.release
    transaction = event.get("transaction")
    if source == SOURCE_SERVER and isinstance(transaction, str):
        # A URL pattern (``/api/photos/{pk}/``), not the URL.
        out["transaction"] = scrub_text(
            transaction, context, limit=256, paths=False, names=False
        )
    return out


def _messages(event: Mapping[str, Json], context: ScrubContext) -> JsonObject:
    out: JsonObject = {}
    message = event.get("message")
    if isinstance(message, str):
        out["message"] = scrub_text(message, context)
    logentry = _object(event.get("logentry")) or _object(message)
    if logentry:
        kept: JsonObject = {}
        _put(kept, "message", _text(logentry.get("message"), context))
        _put(kept, "formatted", _text(logentry.get("formatted"), context))
        out["logentry"] = kept
    values = _list(_object(event.get("exception")).get("values"))
    if values:
        out["exception"] = {
            "values": [
                _exception(value, context)
                for value in values[-MAX_EXCEPTIONS:]
                if isinstance(value, dict)
            ]
        }
    return out


def _environment(
    event: Mapping[str, Json], context: ScrubContext, *, source: str
) -> JsonObject:
    out: JsonObject = {}
    _put(out, "sdk", _name_and_version(event.get("sdk"), context))
    contexts: JsonObject = {}
    for key in ("runtime", "os", "browser"):
        raw = _object(event.get("contexts")).get(key)
        _put(contexts, key, _name_and_version(raw, context))
    if contexts:
        out["contexts"] = contexts
    request: JsonObject = {}
    method = _object(event.get("request")).get("method")
    _put(request, "method", _text(method, context, limit=16))
    user_agent = _user_agent(event) if source == SOURCE_BROWSER else None
    if user_agent is not None:
        request["headers"] = {"User-Agent": user_agent}
    if request:
        out["request"] = request
    return out


def scrub_event(
    event: Mapping[str, Json], context: ScrubContext, *, source: str
) -> JsonObject:
    """The parts of ``event`` that may be saved and sent, scrubbed."""
    return {
        **_header(event, context, source=source),
        **_messages(event, context),
        **_environment(event, context, source=source),
        "tags": {"source": source},
    }


def title(event: Mapping[str, Json]) -> str:
    """One line for the list: the error and its message, or the log message."""
    values = _list(_object(event.get("exception")).get("values"))
    last = _object(values[-1]) if values else {}
    if last:
        kind = last.get("type")
        value = last.get("value")
        text = f"{kind}: {value}" if value else str(kind)
    else:
        logentry = _object(event.get("logentry"))
        text = str(
            logentry.get("formatted")
            or logentry.get("message")
            or event.get("message")
            or "Error"
        )
    return text.splitlines()[0][:512] if text.strip() else "Error"


# Ids in a message that change between repeats of one error: UUIDs, long hex
# ids (a django-q process name) and numbers. Grouping ignores them.
_VOLATILE_ID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    r"|\b(?=[a-f]*\d)[0-9a-f]{8,}\b"
    r"|\d+",
    re.IGNORECASE,
)


def _grouping_text(text: Json) -> Json:
    """``text`` with its volatile ids replaced, for the fingerprint only."""
    return _VOLATILE_ID.sub("<id>", text) if isinstance(text, str) else text


def fingerprint(event: Mapping[str, Json]) -> str:
    """The same error from the same place gives the same digest.

    The error types and the functions on their stacks, not the message, which
    often carries an id that changes; a log message or an error without a
    stack is told apart by its text, without its ids and numbers.
    """
    parts: list[Json] = [_object(event.get("tags")).get("source")]
    for value in _list(_object(event.get("exception")).get("values")):
        exception = _object(value)
        frames = _list(_object(exception.get("stacktrace")).get("frames"))
        parts.append(exception.get("type"))
        parts.extend(
            f"{_object(frame).get('module') or _object(frame).get('filename')}:"
            f"{_object(frame).get('function')}"
            for frame in frames
        )
        if not frames:
            parts.append(_grouping_text(exception.get("value")))
    if len(parts) == 1:
        message = _object(event.get("logentry")).get("message") or title(event)
        parts.append(_grouping_text(message))
    return hashlib.sha256(json.dumps(parts).encode()).hexdigest()


# --- What this server knows is private ---------------------------------------

# Seconds a ScrubContext is reused: a new person or album is scrubbed from the
# next errors on within this time.
CONTEXT_SECONDS = 60
_cache: dict[str, ScrubContext] = {}


def _code_roots() -> tuple[tuple[str, str], ...]:
    paths = sysconfig.get_paths()
    roots = [(str(settings.BASE_DIR), "")]
    for key in ("purelib", "platlib"):
        roots.append((paths[key], "site-packages/"))
    roots.append((paths["stdlib"], "python/"))
    roots.append((sys.prefix, "python/"))
    return tuple(roots)


def _hostnames() -> tuple[str, ...]:
    hosts: set[str] = {socket.gethostname()}
    for host in settings.ALLOWED_HOSTS:
        hosts.add(host.lstrip("."))
    for url in (*settings.CSRF_TRUSTED_ORIGINS, settings.FRONTEND_BASE_URL):
        url_host = urlsplit(url).hostname
        if url_host:
            hosts.add(url_host)
    return tuple(host for host in hosts if host and host != "*")


def _private_names() -> tuple[str, ...]:
    from api.models import AlbumAuto, AlbumUser, Person, Tag, User

    names: set[str] = set()
    for username, first, last, email in User.objects.values_list(
        "username", "first_name", "last_name", "email"
    ):
        names.update(part for part in (username, first, last, email) if part)
    for name in Person.objects.values_list("name", flat=True)[:MAX_NAMES]:
        names.add(name)
        names.update(name.split())
    names.update(AlbumUser.objects.values_list("title", flat=True)[:MAX_NAMES])
    names.update(AlbumAuto.objects.values_list("title", flat=True)[:MAX_NAMES])
    names.update(Tag.objects.values_list("name", flat=True)[:MAX_NAMES])
    return tuple(name.strip() for name in names if name and name.strip())


def _library_roots() -> tuple[str, ...]:
    from api.models import LibraryFolder, User

    roots = {str(settings.DATA_ROOT), str(settings.MEDIA_ROOT)}
    if str(settings.BASE_DATA).strip("/\\"):
        roots.add(str(settings.BASE_DATA))
    roots.update(
        User.objects.exclude(scan_directory="").values_list("scan_directory", flat=True)
    )
    roots.update(LibraryFolder.objects.values_list("path", flat=True))
    return tuple(root for root in roots if root)


def release() -> str:
    """The release reports carry: the image's tag, ``dev`` from source."""
    return settings.IMAGE_TAG.strip() or "dev"


def scrub_context() -> ScrubContext:
    """This server's ``ScrubContext``, read from the database every few minutes."""
    cached = _cache.get("context")
    if cached is not None and time.monotonic() - cached.created < CONTEXT_SECONDS:
        return cached
    context = _cache["context"] = ScrubContext(
        library_roots=_library_roots(),
        code_roots=_code_roots(),
        private_roots=(os.path.expanduser("~"),),
        hostnames=_hostnames(),
        names=_private_names(),
        release=release(),
    )
    return context
