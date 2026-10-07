"""Create the thumbnail files of a synthetic dataset as NTFS hard links.

    python link_thumbs.py <mapfile.csv> <fixture_root> <media_root>

<mapfile.csv> is written by synth.sql (new hash, source hash). For every
thumbnail kind the new `<hash>.<ext>` is a hard link to the source photo's
thumbnail. NTFS allows 1023 links per file, so every 1000 links the source is
copied into `_linkbase/` and later links point at the fresh copy. Existing
targets are skipped, so the 50k and 250k sets can share one tree.
"""

import csv
import os
import shutil
import sys
import time

KINDS = ("thumbnails_big", "square_thumbnails", "square_thumbnails_small")
LINKS_PER_BASE = 1000


def main():
    mapfile, fixture_root, media_root = sys.argv[1:4]
    src_pm = os.path.join(fixture_root, "protected_media")
    dst_pm = os.path.join(media_root, "protected_media")
    if not os.path.isdir(dst_pm):
        shutil.copytree(src_pm, dst_pm)
    sources = {}
    for kind in KINDS:
        for name in os.listdir(os.path.join(src_pm, kind)):
            stem, ext = os.path.splitext(name)
            sources[(kind, stem)] = ext
    bases = {}
    made = skipped = missing = 0
    started = time.time()
    with open(mapfile, newline="") as fh:
        for new_hash, src_hash in csv.reader(fh):
            for kind in KINDS:
                ext = sources.get((kind, src_hash))
                if ext is None:
                    missing += 1
                    continue
                target = os.path.join(dst_pm, kind, new_hash + ext)
                if os.path.exists(target):
                    skipped += 1
                    continue
                key = (kind, src_hash)
                base, count = bases.get(key, (None, LINKS_PER_BASE))
                if count >= LINKS_PER_BASE:
                    base_dir = os.path.join(dst_pm, "_linkbase", kind)
                    os.makedirs(base_dir, exist_ok=True)
                    i = 0
                    while os.path.exists(os.path.join(base_dir, f"{src_hash}_{i}{ext}")):
                        i += 1
                    base = os.path.join(base_dir, f"{src_hash}_{i}{ext}")
                    shutil.copyfile(os.path.join(src_pm, kind, src_hash + ext), base)
                    count = 0
                os.link(base, target)
                bases[key] = (base, count + 1)
                made += 1
                if made % 50000 == 0:
                    print(f"{made} links, {made / (time.time() - started):.0f}/s", flush=True)
    print(f"links made {made}, already present {skipped}, sources without thumbnail {missing}")


if __name__ == "__main__":
    main()
