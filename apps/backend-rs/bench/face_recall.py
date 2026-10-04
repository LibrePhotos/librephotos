"""python faces.py dump <db> <out.json> | compare <ref.json> <variant.json>...  (face recall + embedding drift)"""
import json, subprocess, sys
import numpy as np
PSQL = r"C:\Users\Niaz\librephotos\rust-pg\pginstall\bin\psql.exe"

def dump(db, out):
    r = subprocess.run([PSQL, "-h", "localhost", "-p", "5433", "-U", "postgres", "-X", "-q", "-At", "-d", db, "-c",
        "SELECT f.path, fa.location_top, fa.location_right, fa.location_bottom, fa.location_left, fa.encoding "
        "FROM api_face fa JOIN api_photo p ON p.id = fa.photo_id JOIN api_file f ON f.hash = p.main_file_id ORDER BY 1"],
        capture_output=True, text=True, encoding="utf-8", check=True)
    faces = []
    for line in r.stdout.splitlines():
        path, t, rr, b, l, enc = line.split("|")
        e = np.frombuffer(bytes.fromhex(enc), dtype="<f8").tolist() if enc else None
        faces.append({"photo": path.replace("\\", "/").rsplit("/", 1)[-1], "box": [int(t), int(rr), int(b), int(l)], "enc": e})
    json.dump(faces, open(out, "w"))
    print(len(faces), "faces ->", out)

def iou(a, b):
    t, r, bo, l = a; t2, r2, b2, l2 = b
    ix = max(0, min(r, r2) - max(l, l2)); iy = max(0, min(bo, b2) - max(t, t2))
    inter = ix * iy
    u = (r - l) * (bo - t) + (r2 - l2) * (b2 - t2) - inter
    return inter / u if u else 0

def compare(ref, *vs):
    R = json.load(open(ref))
    for v in vs:
        V = json.load(open(v))
        found, cos, extra = 0, [], 0
        used = set()
        for f in R:
            best, bi = 0, None
            for i, g in enumerate(V):
                if g["photo"] == f["photo"] and i not in used:
                    x = iou(f["box"], g["box"])
                    if x > best:
                        best, bi = x, i
            if best >= 0.5:
                found += 1; used.add(bi)
                a, b = np.array(f["enc"]), np.array(V[bi]["enc"])
                cos.append(float(a @ b / np.linalg.norm(a) / np.linalg.norm(b)))
        extra = len(V) - len(used)
        print(f"{v}: {len(V)} faces, recall {found}/{len(R)} vs ref, extra {extra}, cosine min {min(cos):.4f} mean {np.mean(cos):.4f}" if cos else f"{v}: none")
        missed = [f["photo"] for f in R if not any(g["photo"] == f["photo"] for g in V)]
        if missed: print("   photos with all faces missed:", sorted(set(missed)))

if __name__ == "__main__":
    dump(*sys.argv[2:]) if sys.argv[1] == "dump" else compare(*sys.argv[2:])
