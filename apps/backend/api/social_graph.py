import numpy as np
from django.db import connection

from api.models import Person
from api.util import logger


class _Graph:
    """Minimal undirected graph used in place of networkx.Graph."""

    def __init__(self):
        self._adj: dict = {}

    def add_edge(self, u, v):
        if u not in self._adj:
            self._adj[u] = set()
        if v not in self._adj:
            self._adj[v] = set()
        self._adj[u].add(v)
        self._adj[v].add(u)

    def nodes(self):
        return list(self._adj.keys())

    def edges(self):
        seen: set = set()
        result = []
        for u, neighbors in self._adj.items():
            for v in neighbors:
                key = (min(u, v), max(u, v))
                if key not in seen:
                    seen.add(key)
                    result.append((u, v))
        return result


def _spring_layout(G, k=None, scale=1.0, iterations=50):
    """Fruchterman-Reingold force-directed layout (vendored from NetworkX).

    Returns a dict mapping each node to a numpy array [x, y].
    """
    nodes = G.nodes()
    n = len(nodes)
    if n == 0:
        return {}

    node_index = {node: i for i, node in enumerate(nodes)}

    rng = np.random.default_rng(42)
    pos = rng.random((n, 2)) * 2.0 - 1.0

    if k is None:
        k = np.sqrt(1.0 / n)

    t = max(n * 0.1, 0.1)
    dt = t / (iterations + 1)

    edge_indices = [(node_index[u], node_index[v]) for u, v in G.edges()]

    for _ in range(iterations):
        # delta[i, j] = pos[i] - pos[j], shape (n, n, 2)
        delta = pos[:, np.newaxis, :] - pos[np.newaxis, :, :]
        distance = np.linalg.norm(delta, axis=-1)  # (n, n)
        np.fill_diagonal(distance, 1e-10)

        # Repulsive forces: k^2 / distance^2 * delta
        repulsive = (k**2 / distance**2)[:, :, np.newaxis] * delta
        displacement = repulsive.sum(axis=1)

        # Attractive forces along edges
        for i_idx, j_idx in edge_indices:
            d = delta[i_idx, j_idx]
            dist = distance[i_idx, j_idx]
            attraction = dist / k * d
            displacement[i_idx] -= attraction
            displacement[j_idx] += attraction

        # Limit displacement by temperature
        disp_norm = np.linalg.norm(displacement, axis=1, keepdims=True)
        disp_norm = np.where(disp_norm < 1e-10, 1e-10, disp_norm)
        pos += displacement / disp_norm * np.minimum(disp_norm, t)

        t -= dt

    # Scale to desired range
    if scale is not None:
        lim = np.max(np.abs(pos))
        if lim > 0:
            pos = pos * scale / lim

    return {node: pos[node_index[node]] for node in nodes}


def build_social_graph(user):
    try:
        query = """
            WITH face AS (
                SELECT photo_id, person_id, name, owner_id
                FROM api_face
                JOIN api_person ON api_person.id = person_id
                JOIN api_photo ON api_photo.id = photo_id
                WHERE person_id IS NOT NULL
                    AND owner_id = {}
            )
            SELECT f1.name, f2.name
            FROM face f1
            JOIN face f2 USING (photo_id)
            WHERE f1.person_id != f2.person_id
            GROUP BY f1.name, f2.name
        """.replace("{}", str(user.id))
        G = _Graph()
        with connection.cursor() as cursor:
            cursor.execute(query)
            links = cursor.fetchall()
            if len(links) == 0:
                return {"nodes": [], "links": []}
            for link in links:
                G.add_edge(link[0], link[1])
        pos = _spring_layout(G, k=1 / 2, scale=1000, iterations=20)
        return {
            "nodes": [
                {"id": node, "x": float(coords[0]), "y": float(coords[1])}
                for node, coords in pos.items()
            ],
            "links": [{"source": pair[0], "target": pair[1]} for pair in G.edges()],
        }
    except Exception:
        logger.exception(f"Error building social graph for user {user.id}")
        raise


def build_ego_graph(person_id):
    G = _Graph()
    person = Person.objects.prefetch_related("faces__photo__faces__person").filter(
        id=person_id
    )[0]
    for this_person_face in person.faces.all():
        for other_person_face in this_person_face.photo.faces.all():
            G.add_edge(person.name, other_person_face.person.name)
    nodes = [{"id": node} for node in G.nodes()]
    links = [{"source": pair[0], "target": pair[1]} for pair in G.edges()]
    res = {"nodes": nodes, "links": links}
    return res
