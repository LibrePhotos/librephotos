"""Per-user similarity indices over the CLIP embeddings: exact inner-product search.

Each user's index is a float32 matrix of their photos' embeddings, one row per
photo, and the image hashes in the same order. A search is one matrix-vector
product over every row, the same exhaustive inner product FAISS's
``IndexFlatIP`` computed (see ``top_k`` for its order on ties).

On disk (``store_dir``), under ``BASE_DATA/protected_media/similarity``:

* ``<user>.<generation>.f32``: the rows, raw little-endian float32, appended
  page by page. Served through a read-only memory map, so the matrix is
  never copied into the process: its pages are file cache the system can
  drop and read again.
* ``<user>.<generation>.hashes``: the image hashes, one per line (UTF-8).
* ``<user>.index.json``: the manifest, the only file that is replaced. It
  names the generation's two files and how many rows and how many bytes of
  hashes belong to the index. Anything written past those lengths (a page a
  crash interrupted) is ignored, and the next page overwrites it, so the
  vectors and the hashes cannot disagree whenever the process stops.

A rebuild writes a new generation while searches keep using the old one, then
replaces the manifest, swaps the maps and deletes the old generation's files.
Windows cannot replace or delete a mapped file, which is why no data file is
ever replaced, and the old map is closed before its files are deleted; a file
that still cannot be deleted is swept on the user's next load.

Indices written by the FAISS version (``<user>.npz``) are converted on first
use (``convert_legacy_index``).

Without a ``store_dir`` (tests) the matrices live in memory.
"""

from __future__ import annotations

import datetime
import json
import logging
import mmap
import os
import re
import secrets
import tempfile
import time
import zipfile
from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import IO, BinaryIO

import numpy as np
import numpy.typing as npt

# image_similarity/main.py points this logger at stdout (service._common.logger).
logger = logging.getLogger("image_similarity")

embedding_size = 512
ROW_BYTES = embedding_size * 4
MANIFEST_FORMAT = 1

# A rebuild whose client sent no page for this long is dropped: the client
# died, and pages without a token go to the live index again.
REBUILD_TTL_SECONDS = 600.0

# Copying a legacy index streams it in pieces of this size.
_COPY_BYTES = 8 * 1024 * 1024

Matrix = npt.NDArray[np.float32]


def _reshaped_embeddings(embeddings_array: Matrix, user_id: object) -> Matrix | None:
    """Return the array shaped as (n_vectors, embedding_size), or None if invalid."""
    if embeddings_array.size == 0:
        logger.warning("Empty embeddings array for user %s", user_id)
        return None

    dimensions = len(embeddings_array.shape)
    if dimensions == 1:
        embeddings_array = embeddings_array.reshape(1, -1)
    elif dimensions != 2:
        logger.error("Unexpected embedding shape: %s", embeddings_array.shape)
        return None
    if embeddings_array.shape[1] != embedding_size:
        logger.error(
            "Expected embedding size %s, got %s",
            embedding_size,
            embeddings_array.shape[1],
        )
        return None
    return embeddings_array


def _hash_problem(image_hashes: Sequence[object]) -> str | None:
    """Why the hashes cannot be stored one per line, or None."""
    for image_hash in image_hashes:
        if not isinstance(image_hash, str) or "\n" in image_hash or "\r" in image_hash:
            return f"image hash {image_hash!r} is not a single-line string"
    return None


def top_k(scores: Matrix, k: int) -> npt.NDArray[np.intp]:
    """The row numbers ``IndexFlatIP.search`` returns for ``k``, in no order.

    FAISS keeps a heap of the best ``k`` scores while it walks the rows in
    order: a row enters while the heap is not full or beats its worst entry
    strictly, and evicts the worst (on equal scores, the lowest row number).
    So of the rows that tie with the k-th best score, the ones read before
    the heap held ``k`` rows at least that good get in, and every better row
    after that point evicts one of them, lowest row number first.
    """
    count = scores.shape[0]
    if k >= count:
        return np.arange(count)
    kth = np.partition(scores, count - k)[count - k]
    better = scores > kth
    ties = np.flatnonzero(scores == kth)
    wanted = k - int(np.count_nonzero(better))
    if len(ties) == wanted:
        return np.flatnonzero(better | (scores == kth))
    # The row at which the heap first holds k rows scoring kth or better.
    filled = int(np.searchsorted(np.cumsum(scores >= kth), k))
    entered = ties[ties <= filled]
    evicted = int(np.count_nonzero(better[filled + 1 :]))
    return np.concatenate([np.flatnonzero(better), entered[evicted:]])


def ranked(scores: Matrix, rows: npt.NDArray[np.intp]) -> npt.NDArray[np.intp]:
    """``rows`` best score first, a higher row number first on equal scores.

    The order the FAISS version sorted its results in (``sorted(zip(scores,
    rows), reverse=True)``).
    """
    return rows[np.lexsort((-rows, -scores[rows]))]


# ------------------------------------------------------------------ vectors
class _Rows:
    """One index's rows and hashes, in memory or in a generation's files."""

    def __init__(self) -> None:
        self.image_hashes: list[str] = []

    @property
    def ntotal(self) -> int:
        return len(self.image_hashes)

    d = embedding_size

    def matrix(self) -> Matrix:
        raise NotImplementedError

    def append(self, vectors: Matrix, image_hashes: list[str]) -> None:
        raise NotImplementedError

    def close(self) -> None:
        """Release the memory map, if any (before its file is deleted)."""


class _MemoryRows(_Rows):
    def __init__(self) -> None:
        super().__init__()
        self._matrix: Matrix = np.empty((0, embedding_size), dtype=np.float32)

    def matrix(self) -> Matrix:
        return self._matrix[: self.ntotal]

    def append(self, vectors: Matrix, image_hashes: list[str]) -> None:
        if len(vectors) != len(image_hashes):
            raise ValueError("as many hashes as vectors")
        needed = self.ntotal + len(vectors)
        if needed > len(self._matrix):
            grown = np.empty(
                (max(needed, 2 * len(self._matrix)), embedding_size), np.float32
            )
            grown[: self.ntotal] = self._matrix[: self.ntotal]
            self._matrix = grown
        self._matrix[self.ntotal : needed] = vectors
        self.image_hashes.extend(image_hashes)


@dataclass
class _Files:
    """The two files of one generation, and how much of each is committed."""

    store_dir: str
    vectors_name: str
    hashes_name: str
    count: int = 0
    hashes_bytes: int = 0

    @property
    def vectors_path(self) -> str:
        return os.path.join(self.store_dir, self.vectors_name)

    @property
    def hashes_path(self) -> str:
        return os.path.join(self.store_dir, self.hashes_name)

    def manifest(self) -> dict[str, object]:
        return {
            "format": MANIFEST_FORMAT,
            "dim": embedding_size,
            "count": self.count,
            "vectors": self.vectors_name,
            "hashes": self.hashes_name,
            "hashes_bytes": self.hashes_bytes,
        }


class _FileRows(_Rows):
    """Rows appended to a generation's files and read through a memory map.

    A page is written at the committed end of each file (over anything a
    crash left there) and synced; ``count``/``hashes_bytes`` move only then,
    and the manifest that makes it permanent is the caller's to write.
    """

    def __init__(self, files: _Files, image_hashes: list[str]) -> None:
        super().__init__()
        self.files = files
        self.image_hashes = image_hashes
        self._file: BinaryIO | None = None
        self._map: mmap.mmap | None = None
        self._matrix: Matrix | None = None

    def matrix(self) -> Matrix:
        if self._matrix is None:
            self._open_map()
        assert self._matrix is not None
        return self._matrix

    def _open_map(self) -> None:
        if self.ntotal == 0:
            self._matrix = np.empty((0, embedding_size), dtype=np.float32)
            return
        self._file = open(self.files.vectors_path, "rb")  # noqa: SIM115 - closed in close()
        self._map = mmap.mmap(
            self._file.fileno(), self.ntotal * ROW_BYTES, access=mmap.ACCESS_READ
        )
        self._matrix = np.frombuffer(self._map, dtype="<f4").reshape(
            self.ntotal, embedding_size
        )

    def close(self) -> None:
        self._matrix = None  # the map cannot close while an array uses it
        if self._map is not None:
            self._map.close()
            self._map = None
        if self._file is not None:
            self._file.close()
            self._file = None

    def append(self, vectors: Matrix, image_hashes: list[str]) -> None:
        if len(vectors) != len(image_hashes):
            raise ValueError("as many hashes as vectors")
        lines = "".join(f"{image_hash}\n" for image_hash in image_hashes).encode()
        vector_bytes = np.ascontiguousarray(vectors, dtype="<f4").tobytes()
        _write_at(self.files.vectors_path, self.ntotal * ROW_BYTES, vector_bytes)
        _write_at(self.files.hashes_path, self.files.hashes_bytes, lines)
        self.close()  # the map covers the old rows only; reopened on demand
        self.image_hashes.extend(image_hashes)
        self.files.count = self.ntotal
        self.files.hashes_bytes += len(lines)


def _write_at(path: str, offset: int, data: bytes) -> None:
    mode = "r+b" if os.path.exists(path) else "w+b"
    with open(path, mode) as out:
        out.seek(offset)
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def search_rows(rows: _Rows, in_embedding: object, n: int, thres: float) -> list[str]:
    """The image hashes of the ``n`` rows closest to ``in_embedding``,
    best first, that score at least ``thres``.

    Raises ValueError for an embedding that is not 512 numbers or ``n`` < 1,
    which FAISS refused too.
    """
    query = np.asarray(in_embedding, dtype=np.float32)
    if query.shape != (embedding_size,):
        raise ValueError(
            f"the embedding has shape {query.shape}, not ({embedding_size},)"
        )
    if n < 1:
        raise ValueError(f"n must be at least 1, not {n}")
    if rows.ntotal == 0:
        return []
    scores = rows.matrix() @ query
    order = ranked(scores, top_k(scores, n))
    return [rows.image_hashes[row] for row in order if scores[row] >= thres]


# ------------------------------------------------------------ legacy files
class LegacyIndexError(ValueError):
    """A ``<user>.npz`` of the FAISS version that does not hold what it should."""


# FAISS's IndexFlatIP as faiss.serialize_index wrote it: fourcc, d (int32),
# ntotal (int64), two unused int64, is_trained (byte), metric (int32, 0 is
# inner product), then the vectors as a uint64 count of floats and the floats.
_FAISS_HEADER = np.dtype(
    [
        ("fourcc", "S4"),
        ("d", "<i4"),
        ("ntotal", "<i8"),
        ("dummy1", "<i8"),
        ("dummy2", "<i8"),
        ("is_trained", "u1"),
        ("metric", "<i4"),
        ("floats", "<u8"),
    ]
)


def _npy_member(archive: zipfile.ZipFile, name: str) -> tuple[IO[bytes], np.dtype, int]:
    """An open .npy member: its stream after the header, dtype and length."""
    try:
        member = archive.open(name + ".npy")
    except KeyError as error:
        raise LegacyIndexError(f"no {name} in the file") from error
    version = np.lib.format.read_magic(member)
    if version == (1, 0):
        shape, fortran, dtype = np.lib.format.read_array_header_1_0(member)
    elif version == (2, 0):
        shape, fortran, dtype = np.lib.format.read_array_header_2_0(member)
    else:
        raise LegacyIndexError(f"unknown .npy version {version}")
    if len(shape) != 1 or fortran or dtype.hasobject:
        raise LegacyIndexError(f"{name} is not a flat array")
    return member, dtype, int(shape[0])


def _read_exactly(stream: IO[bytes], size: int) -> bytes:
    data = stream.read(size)
    if len(data) != size:
        raise LegacyIndexError("the file ends early")
    return data


def convert_legacy_index(path: str, files: _Files) -> list[str]:
    """Copy the FAISS ``IndexFlatIP`` in ``path`` into ``files``; its image hashes.

    Streams the vectors from the zip member to the new file, so a 2 GB index
    is never read into memory. Raises LegacyIndexError for anything that is
    not a flat inner-product index of 512-dimensional float32 vectors with
    exactly one image hash per vector, or a damaged file.
    """
    try:
        return _convert_legacy_index(path, files)
    except LegacyIndexError:
        raise
    except (zipfile.BadZipFile, EOFError, ValueError) as error:
        raise LegacyIndexError(f"not a readable .npz: {error}") from error


def _convert_legacy_index(path: str, files: _Files) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        stream, dtype, length = _npy_member(archive, "index")
        with stream:
            if dtype != np.uint8:
                raise LegacyIndexError("the index is not a byte array")
            header = np.frombuffer(
                _read_exactly(stream, _FAISS_HEADER.itemsize), dtype=_FAISS_HEADER
            )[0]
            ntotal = int(header["ntotal"])
            if (
                header["fourcc"] != b"IxFI"
                or int(header["d"]) != embedding_size
                or int(header["metric"]) != 0
                or ntotal < 0
                or int(header["floats"]) != ntotal * embedding_size
                or length != _FAISS_HEADER.itemsize + ntotal * ROW_BYTES
            ):
                raise LegacyIndexError(
                    "not a flat inner-product index of "
                    f"{embedding_size}-dimensional vectors"
                )
            _copy_vectors(stream, files.vectors_path, ntotal * ROW_BYTES)
        image_hashes = _legacy_hashes(archive, ntotal)
    problem = _hash_problem(image_hashes)
    if problem is not None:
        raise LegacyIndexError(problem)
    lines = "".join(f"{image_hash}\n" for image_hash in image_hashes).encode()
    _write_at(files.hashes_path, 0, lines)
    files.count = ntotal
    files.hashes_bytes = len(lines)
    return image_hashes


def _copy_vectors(stream: IO[bytes], target: str, size: int) -> None:
    with open(target, "wb") as out:
        left = size
        while left:
            chunk = _read_exactly(stream, min(left, _COPY_BYTES))
            out.write(chunk)
            left -= len(chunk)
        out.flush()
        os.fsync(out.fileno())


def _legacy_hashes(archive: zipfile.ZipFile, ntotal: int) -> list[str]:
    stream, dtype, length = _npy_member(archive, "image_hashes")
    with stream:
        if dtype.kind != "U" or length != ntotal:
            raise LegacyIndexError(
                f"{length} image hashes of type {dtype} for {ntotal} vectors"
            )
        image_hashes: list[str] = []
        step = max(1, _COPY_BYTES // max(dtype.itemsize, 1))
        while len(image_hashes) < ntotal:
            take = min(step, ntotal - len(image_hashes))
            chunk = _read_exactly(stream, take * dtype.itemsize)
            image_hashes.extend(np.frombuffer(chunk, dtype=dtype).tolist())
    return image_hashes


# ------------------------------------------------------------------ errors
class IndexBuildError(ValueError):
    """A page of a rebuild could not be added; the rebuild is abandoned."""


class RebuildNotOpenError(IndexBuildError):
    """The page's token names no open rebuild of the user's index.

    ``superseded`` when a newer rebuild of the same index took over, which
    finishes the work; otherwise the rebuild expired, was committed or
    abandoned, or the sidecar restarted.
    """

    def __init__(self, message: str, *, superseded: bool) -> None:
        super().__init__(message)
        self.superseded = superseded


@dataclass
class _Rebuild:
    token: str
    rows: _Rows
    touched_at: float
    files: list[str] = field(default_factory=list)


class RetrievalIndex:
    """Per-user indices, kept on disk so a sidecar restart loses nothing.

    ``indices`` maps a user to their live rows (``ntotal``, ``d``) and
    ``image_hashes`` to the hashes in row order.

    A rebuild is a session: ``begin_rebuild`` answers a token that
    ``add_to_rebuild``, ``commit_rebuild`` and ``abandon_rebuild`` must
    present. Its pages fill a new generation while searches keep using the
    old one; the commit replaces the manifest, then swaps the indices in
    memory. A newer begin for the same user supersedes the open rebuild, and
    one without a page for ``rebuild_ttl`` seconds expires.
    """

    def __init__(
        self,
        store_dir: str | None = None,
        *,
        rebuild_ttl: float = REBUILD_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.indices: dict[int, _Rows] = {}
        self.image_hashes: dict[int, list[str]] = {}
        self.store_dir = store_dir
        self._rebuild_ttl = rebuild_ttl
        self._clock = clock
        self._staging: dict[int, _Rebuild] = {}
        self._superseded: deque[str] = deque(maxlen=64)
        self._warned_missing: set[int] = set()

    # ---------------------------------------------------------- persistence
    def _manifest_path(self, user_id: int) -> str:
        # Only reached with a store_dir: every caller checks for None first.
        assert self.store_dir is not None
        return os.path.join(self.store_dir, f"{int(user_id)}.index.json")

    def _legacy_path(self, user_id: int) -> str:
        assert self.store_dir is not None
        return os.path.join(self.store_dir, f"{int(user_id)}.npz")

    def _new_rows(self, user_id: int) -> _Rows:
        if self.store_dir is None:
            return _MemoryRows()
        os.makedirs(self.store_dir, exist_ok=True)
        generation = secrets.token_hex(8)
        files = _Files(
            self.store_dir,
            f"{int(user_id)}.{generation}.f32",
            f"{int(user_id)}.{generation}.hashes",
        )
        return _FileRows(files, [])

    def _write_manifest(self, user_id: int, rows: _Rows) -> None:
        if not isinstance(rows, _FileRows):
            return
        assert self.store_dir is not None
        handle, temporary = tempfile.mkstemp(
            dir=self.store_dir, prefix=f".{int(user_id)}.", suffix=".tmp"
        )
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as out:
                json.dump(rows.files.manifest(), out)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, self._manifest_path(user_id))
        except BaseException:
            _remove_quietly(temporary)
            raise

    def _read_manifest(self, user_id: int) -> _FileRows | None:
        """The committed rows of the user's index, or None (logged) if it is bad."""
        path = self._manifest_path(user_id)
        try:
            with open(path, encoding="utf-8") as handle:
                manifest = json.load(handle)
            rows = self._validated(user_id, manifest)
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            logger.error(
                "could not read the similarity index of user %s: %s; ignoring it",
                user_id,
                error,
            )
            return None
        return rows

    def _validated(self, user_id: int, manifest: dict[str, object]) -> _FileRows:
        assert self.store_dir is not None
        if manifest.get("format") != MANIFEST_FORMAT or manifest.get("dim") != (
            embedding_size
        ):
            raise ValueError("unknown format")
        names = (manifest["vectors"], manifest["hashes"])
        pattern = re.compile(rf"{int(user_id)}\.[0-9a-f]{{16}}\.(f32|hashes)")
        if not all(isinstance(name, str) and pattern.fullmatch(name) for name in names):
            raise ValueError("unexpected file names")
        count, hashes_bytes = manifest["count"], manifest["hashes_bytes"]
        if not isinstance(count, int) or not isinstance(hashes_bytes, int):
            raise ValueError("unexpected lengths")
        files = _Files(
            self.store_dir, str(names[0]), str(names[1]), count, hashes_bytes
        )
        if os.path.getsize(files.vectors_path) < count * ROW_BYTES:
            raise ValueError(f"{files.vectors_name} holds fewer than {count} vectors")
        with open(files.hashes_path, "rb") as handle:
            text = handle.read(hashes_bytes)
        lines = text.decode("utf-8").split("\n")
        if len(text) != hashes_bytes or lines.pop() != "" or len(lines) != count:
            raise ValueError(f"{files.hashes_name} does not hold {count} image hashes")
        return _FileRows(files, lines)

    def _load(self, user_id: int) -> bool:
        if self.store_dir is None:
            return False
        if os.path.exists(self._manifest_path(user_id)):
            rows = self._read_manifest(user_id)
        elif os.path.exists(self._legacy_path(user_id)):
            rows = self._convert(user_id)
        else:
            return False
        if rows is None:
            return False
        self._sweep(user_id, keep={rows.files.vectors_name, rows.files.hashes_name})
        self.indices[user_id] = rows
        self.image_hashes[user_id] = rows.image_hashes
        logger.info("loaded the similarity index of user %s (%s)", user_id, rows.ntotal)
        return True

    def _convert(self, user_id: int) -> _FileRows | None:
        """The FAISS version's ``<user>.npz`` as a generation; None (logged) if bad."""
        legacy = self._legacy_path(user_id)
        rows = self._new_rows(user_id)
        assert isinstance(rows, _FileRows)
        try:
            rows.image_hashes = convert_legacy_index(legacy, rows.files)
            self._write_manifest(user_id, rows)
        except (LegacyIndexError, OSError) as error:
            _remove_quietly(rows.files.vectors_path)
            _remove_quietly(rows.files.hashes_path)
            logger.error(
                "could not convert the similarity index of user %s (%s); it is "
                "rebuilt at the end of the next Calculate CLIP embeddings job",
                user_id,
                error,
            )
            return None
        _remove_quietly(legacy)
        logger.info(
            "converted the similarity index of user %s (%s photos)",
            user_id,
            rows.ntotal,
        )
        return rows

    def _sweep(self, user_id: int, keep: set[str]) -> None:
        """Delete the user's data files no manifest or open rebuild names."""
        assert self.store_dir is not None
        rebuild = self._staging.get(user_id)
        if rebuild is not None:
            keep = keep | set(rebuild.files)
        pattern = re.compile(rf"{int(user_id)}\.[0-9a-f]{{16}}\.(f32|hashes)")
        try:
            names = os.listdir(self.store_dir)
        except OSError:
            return
        for name in names:
            if pattern.fullmatch(name) and name not in keep:
                _remove_quietly(os.path.join(self.store_dir, name))

    def _live(self, user_id: int) -> _Rows | None:
        if user_id in self.indices or self._load(user_id):
            return self.indices[user_id]
        return None

    def _retire(self, rows: _Rows | None) -> None:
        """Close an index that is no longer served and delete its files."""
        if rows is None:
            return
        rows.close()
        if isinstance(rows, _FileRows):
            _remove_quietly(rows.files.vectors_path)
            _remove_quietly(rows.files.hashes_path)

    def remove_user(self, user_id: int) -> None:
        live = self.indices.pop(user_id, None)
        self.image_hashes.pop(user_id, None)
        rebuild = self._staging.pop(user_id, None)
        if self.store_dir is not None:
            _remove_quietly(self._manifest_path(user_id))  # the commit point first
            _remove_quietly(self._legacy_path(user_id))
        self._retire(live)
        if rebuild is not None:
            self._retire(rebuild.rows)
        if self.store_dir is not None:
            self._sweep(user_id, keep=set())

    # -------------------------------------------------------------- rebuild
    def _open_rebuild(self, user_id: int) -> _Rebuild | None:
        rebuild = self._staging.get(user_id)
        if rebuild is None:
            return None
        if self._clock() - rebuild.touched_at > self._rebuild_ttl:
            logger.warning(
                "the rebuild of the similarity index of user %s got no page for "
                "%.0f s; dropped",
                user_id,
                self._rebuild_ttl,
            )
            del self._staging[user_id]
            self._retire(rebuild.rows)
            return None
        return rebuild

    def _session(self, user_id: int, token: str) -> _Rebuild:
        rebuild = self._open_rebuild(user_id)
        if rebuild is not None and rebuild.token == token:
            rebuild.touched_at = self._clock()
            return rebuild
        superseded = token in self._superseded
        state = "was superseded by a newer one" if superseded else "is not open"
        raise RebuildNotOpenError(
            f"this rebuild of the index of user {user_id} {state}",
            superseded=superseded,
        )

    def staged_size(self, user_id: int, token: str) -> int:
        return self._session(user_id, token).rows.ntotal

    def abandon_rebuild(self, user_id: int, token: str) -> None:
        rebuild = self._staging.get(user_id)
        if rebuild is not None and rebuild.token == token:
            del self._staging[user_id]
            self._retire(rebuild.rows)

    def begin_rebuild(self, user_id: int) -> str:
        """Open a rebuild of the user's index; the token its pages present."""
        previous = self._open_rebuild(user_id)
        if previous is not None:
            logger.info(
                "a newer rebuild of the similarity index of user %s supersedes "
                "the open one",
                user_id,
            )
            self._superseded.append(previous.token)
            del self._staging[user_id]
            self._retire(previous.rows)
        logger.info("rebuilding the similarity index of user %s", user_id)
        token = secrets.token_hex(16)
        rows = self._new_rows(user_id)
        names = (
            [rows.files.vectors_name, rows.files.hashes_name]
            if isinstance(rows, _FileRows)
            else []
        )
        self._staging[user_id] = _Rebuild(token, rows, self._clock(), names)
        return token

    def add_to_rebuild(
        self,
        user_id: int,
        token: str,
        image_hashes: list[str],
        image_embeddings: list[list[float]],
    ) -> None:
        rebuild = self._session(user_id, token)
        if not image_embeddings:
            return
        if len(image_hashes) != len(image_embeddings):
            raise IndexBuildError(
                f"{len(image_hashes)} image hashes for "
                f"{len(image_embeddings)} embeddings"
            )
        problem = _hash_problem(image_hashes)
        if problem is not None:
            raise IndexBuildError(problem)
        embeddings_array = _reshaped_embeddings(
            np.array(image_embeddings, dtype=np.float32), user_id
        )
        if embeddings_array is None:
            raise IndexBuildError("embeddings of the wrong shape")
        rebuild.rows.append(embeddings_array, list(image_hashes))

    def commit_rebuild(self, user_id: int, token: str) -> int:
        rebuild = self._session(user_id, token)
        del self._staging[user_id]
        try:
            self._write_manifest(user_id, rebuild.rows)
        except BaseException:
            self._retire(rebuild.rows)
            raise
        previous = self.indices.get(user_id)
        self.indices[user_id] = rebuild.rows
        self.image_hashes[user_id] = rebuild.rows.image_hashes
        self._retire(previous)
        if self.store_dir is not None:
            _remove_quietly(self._legacy_path(user_id))
        self._warned_missing.discard(user_id)
        logger.info(
            "similarity index of user %s now holds %s", user_id, rebuild.rows.ntotal
        )
        return rebuild.rows.ntotal

    # ---------------------------------------------------------- incremental
    def build_index_for_user(
        self, user_id: int, image_hashes: list[str], image_embeddings: list[list[float]]
    ) -> None:
        logger.info(
            "building index for user %s - got %s photos to process",
            user_id,
            len(image_hashes),
        )
        start = datetime.datetime.now()

        # Check if we have any embeddings to process
        if not image_embeddings or len(image_embeddings) == 0:
            logger.warning("No embeddings provided for user %s", user_id)
            return

        # Initialize or get the existing index
        if self._live(user_id) is None:
            rows = self._new_rows(user_id)
            self.indices[user_id] = rows
            self.image_hashes[user_id] = rows.image_hashes

        embeddings_array = _reshaped_embeddings(
            np.array(image_embeddings, dtype=np.float32), user_id
        )
        if embeddings_array is None:
            return

        if not self._add_embeddings(user_id, list(image_hashes), embeddings_array):
            return
        self._add_to_open_rebuild(user_id, list(image_hashes), embeddings_array)

        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info(
            "finished building index for user %s - took %.2f seconds",
            user_id,
            elapsed,
        )

    def _add_embeddings(
        self, user_id: int, image_hashes: list[str], embeddings_array: Matrix
    ) -> bool:
        rows = self.indices[user_id]
        problem = _hash_problem(image_hashes)
        if problem is None and len(image_hashes) != len(embeddings_array):
            problem = (
                f"{len(image_hashes)} image hashes for {len(embeddings_array)} "
                "embeddings"
            )
        if problem is not None:
            logger.error(
                "Error adding embeddings to index for user %s: %s", user_id, problem
            )
            return False
        try:
            rows.append(embeddings_array, image_hashes)
            self._write_manifest(user_id, rows)
        except Exception as e:
            logger.error(
                "Error adding embeddings to index for user %s: %s", user_id, str(e)
            )
            return False
        return True

    def _add_to_open_rebuild(
        self, user_id: int, image_hashes: list[str], embeddings_array: Matrix
    ) -> None:
        # The commit replaces the live index with the staged one, which would
        # drop these otherwise.
        rebuild = self._open_rebuild(user_id)
        if rebuild is None:
            return
        rebuild.rows.append(embeddings_array, image_hashes)

    def close(self) -> None:
        """Release every memory map (at exit; Windows keeps a mapped file)."""
        for rows in self.indices.values():
            rows.close()
        for rebuild in self._staging.values():
            rebuild.rows.close()

    # --------------------------------------------------------------- search
    def search_similar(
        self,
        user_id: int,
        in_embedding: list[float],
        n: int = 100,
        thres: float = 27.0,
    ) -> list[str]:
        """Image hashes of the user's photos closest to the embedding.

        A user without an index (never built, or built before the index was
        kept on disk) has no similar photos yet rather than an error.
        """
        index = self._live(user_id)
        if index is None:
            if user_id not in self._warned_missing:
                self._warned_missing.add(user_id)
                logger.warning(
                    "no similarity index for user %s; it is built at the "
                    "end of the Calculate CLIP embeddings job",
                    user_id,
                )
            return []

        start = datetime.datetime.now()
        res = search_rows(index, in_embedding, n, thres)
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info(
            "searched for %d images for user %d - took %.2f seconds",
            n,
            user_id,
            elapsed,
        )
        return res


def _remove_quietly(path: str) -> None:
    """Delete ``path`` if it is there; a file Windows still holds stays for a later sweep."""
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as error:
        logger.warning("could not delete %s yet: %s", os.path.basename(path), error)
