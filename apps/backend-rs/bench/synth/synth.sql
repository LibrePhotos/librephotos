-- Grow a clone of lp_fixture into a synthetic library for alice (user 2).
--
--   psql -v n=50000 -v years=10 -v seed=0.42 -f synth.sql <db>
--
-- Every synthetic photo copies one of alice's 32 fixture photos (files,
-- thumbnail row, metadata, caption row) and gets its own timestamp, GPS,
-- flags, faces, albums, tags and search text. Distributions:
--   * active days: ~1/3 of the days in `years`, photos per day log-normal
--   * 1% without timestamp, 35% with GPS around 24 cities (trips: a day shares one city)
--   * 5% favorites (rating 4-5), 1% public, 0.5% hidden, 0.5% trashed
--   * 45% of photos have faces (1-5), 55% of faces labelled (zipf over persons),
--     15% inferred, 30% unknown
--   * user albums: contiguous time ranges, log-normal sizes; 5% shared to bob
--   * thing albums = the caption vocabulary; event albums for 40% of busy days
--   * 2% near-duplicates (same perceptual hash as the previous photo)
-- image_hash = md5(<source hash>:<n>) || '2', so the 50k set is a prefix of
-- the 250k set and bench/synth/link_thumbs.py can serve both from one tree.
\set ON_ERROR_STOP 1
\timing on
SELECT setseed(:seed);

CREATE TEMP TABLE src AS
SELECT (row_number() OVER (ORDER BY image_hash) - 1)::int AS k, p.*
FROM api_photo p WHERE owner_id = 2;
SELECT count(*) AS n_src FROM src \gset

CREATE TEMP TABLE vocab AS
SELECT (row_number() OVER ())::int AS i, w FROM unnest(ARRAY[
 'beach','mountain','forest','lake','river','city','street','bridge','tower','church',
 'castle','museum','park','garden','flower','tree','sunset','sunrise','snow','rain',
 'cloud','sky','sea','boat','ship','car','bicycle','train','airport','plane',
 'dog','cat','horse','bird','cow','sheep','duck','fish','butterfly','insect',
 'food','cake','pizza','coffee','wine','beer','breakfast','dinner','picnic','market',
 'birthday','wedding','party','concert','festival','christmas','easter','halloween','graduation','holiday',
 'baby','child','family','friends','portrait','selfie','group','couple','grandparents','school',
 'football','tennis','swimming','skiing','hiking','running','cycling','climbing','camping','fishing',
 'kitchen','livingroom','bedroom','office','desk','computer','phone','book','painting','sculpture',
 'night','lights','fireworks','fountain','statue','monument','harbor','village','farm','field',
 'desert','canyon','waterfall','island','cliff','cave','volcano','glacier','valley','meadow',
 'road','highway','tunnel','station','bus','tram','taxi','shop','restaurant','cafe',
 'playground','zoo','aquarium','stadium','theater','library','hospital','university','temple','mosque',
 'autumn','winter','spring','summer','leaves','pumpkin','apple','strawberry','icecream','chocolate',
 'document','receipt','screenshot','whiteboard','map','sign','poster','ticket','menu','text'
]) AS w;
SELECT count(*) AS n_vocab FROM vocab \gset

CREATE TEMP TABLE city (ci int, name text, district text, country text, lat float8, lon float8, weight float8);
INSERT INTO city VALUES
 (1,'Berlin','Mitte','Germany',52.52,13.405,30),(2,'Munich','Altstadt','Germany',48.137,11.575,6),
 (3,'Hamburg','Altona','Germany',53.551,9.993,5),(4,'Tokyo','Minato','Japan',35.676,139.65,3),
 (5,'Kyoto','Higashiyama','Japan',35.011,135.768,2),(6,'Paris','Le Marais','France',48.857,2.352,4),
 (7,'Nice','Vieux Nice','France',43.71,7.262,2),(8,'Rome','Trastevere','Italy',41.903,12.496,3),
 (9,'Venice','San Marco','Italy',45.44,12.316,2),(10,'Barcelona','Gracia','Spain',41.385,2.173,3),
 (11,'Madrid','Centro','Spain',40.417,-3.704,2),(12,'Lisbon','Alfama','Portugal',38.722,-9.139,2),
 (13,'London','Camden','United Kingdom',51.507,-0.128,3),(14,'Edinburgh','Old Town','United Kingdom',55.953,-3.189,1),
 (15,'New York','Manhattan','United States',40.713,-74.006,2),(16,'San Francisco','Mission','United States',37.775,-122.419,1),
 (17,'Vienna','Innere Stadt','Austria',48.208,16.373,3),(18,'Zurich','Altstadt','Switzerland',47.377,8.541,2),
 (19,'Amsterdam','Jordaan','Netherlands',52.368,4.904,2),(20,'Prague','Old Town','Czechia',50.075,14.438,2),
 (21,'Copenhagen','Nyhavn','Denmark',55.676,12.568,1),(22,'Oslo','Sentrum','Norway',59.914,10.752,1),
 (23,'Reykjavik','Midborg','Iceland',64.147,-21.942,1),(24,'Istanbul','Beyoglu','Turkey',41.008,28.978,1);
CREATE TEMP TABLE city_cdf AS
SELECT ci, sum(weight) OVER (ORDER BY ci) / sum(weight) OVER () AS hi,
       (sum(weight) OVER (ORDER BY ci) - weight) / sum(weight) OVER () AS lo
FROM city;

-- Active days with log-normal weights, each maybe tied to a city.
CREATE TEMP TABLE days AS
SELECT d::date AS day,
       exp(1.1 * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random())) AS w,
       random() AS r_city, random() AS r_pick
FROM generate_series(date '2026-06-30' - (:years * 365), date '2026-06-30', interval '1 day') AS d
WHERE random() < 0.33;
CREATE TEMP TABLE daycount AS
SELECT d.day, greatest(1, round(d.w / sum(d.w) OVER () * :n))::int AS cnt,
       CASE WHEN d.r_city < 0.35 THEN (SELECT ci FROM city_cdf WHERE d.r_pick >= lo AND d.r_pick < hi LIMIT 1) END AS ci
FROM days d;

CREATE TEMP TABLE sp AS
SELECT row_number() OVER (ORDER BY dc.day, g)::int AS n, dc.day, dc.ci, g AS nth, dc.cnt
FROM daycount dc, generate_series(1, dc.cnt) AS g;

CREATE TEMP TABLE synth AS
SELECT sp.n, sp.day, sp.ci, sp.cnt,
       s.k, s.image_hash AS src_hash, s.id AS src_id, s.main_file_id AS src_file,
       md5(s.image_hash || ':' || sp.n) || '2' AS hash,
       gen_random_uuid() AS id,
       CASE WHEN random() < 0.01 THEN NULL
            ELSE sp.day + interval '7 hours' + random() * interval '15 hours' END AS ts,
       random() AS r_flag, random() AS r_rating, random() AS r_faces, random() AS r_dup,
       random() AS r_w1, random() AS r_w2, random() AS r_w3, random() AS r_tag, random() AS r_tagpick
FROM sp JOIN src s ON s.k = sp.n % :n_src;
CREATE INDEX ON synth (n);
CREATE INDEX ON synth (id);
ANALYZE synth;
SELECT count(*) AS synth_photos, min(day), max(day), count(DISTINCT day) AS days FROM synth;

-- Files: paths are unique, so they name files under alice\synth\<year>\ that do
-- not exist on disk (API and thumbnail benchmarks never open originals).
INSERT INTO api_file (hash, path, type, missing)
SELECT y.hash,
       regexp_replace(f.path, '\\alice\\.*$', '') || '\alice\synth\' || coalesce(extract(year FROM y.day)::text, 'undated')
         || '\' || y.hash || coalesce(substring(f.path FROM '\.[^.\\]*$'), ''),
       f.type, false
FROM synth y JOIN api_file f ON f.hash = y.src_file;

-- Photos.
INSERT INTO api_photo (image_hash, added_on, exif_gps_lat, exif_gps_lon, exif_timestamp, exif_json,
    geolocation_json, hidden, public, owner_id, video, clip_embeddings_magnitude, rating, video_length,
    in_trashcan, "timestamp", size, main_file_id, last_modified, removed, clip_embeddings, perceptual_hash,
    exif_timestamp_subsec, image_sequence_number, id, local_orientation, is_screenshot, is_document,
    category_source)
SELECT y.hash, coalesce(y.ts, y.day::timestamptz) + random() * interval '30 days',
       CASE WHEN y.ci IS NOT NULL THEN c.lat + (random() - 0.5) * 0.08 END,
       CASE WHEN y.ci IS NOT NULL THEN c.lon + (random() - 0.5) * 0.08 END,
       y.ts, NULL, s.geolocation_json,
       y.r_flag < 0.005, y.r_flag >= 0.005 AND y.r_flag < 0.015, 2, s.video, NULL,
       CASE WHEN y.r_rating < 0.03 THEN 5 WHEN y.r_rating < 0.05 THEN 4 ELSE 0 END,
       s.video_length, y.r_flag >= 0.015 AND y.r_flag < 0.02, NULL, s.size,
       CASE WHEN s.main_file_id IS NOT NULL THEN y.hash END, now(), false, NULL,
       NULL, NULL, NULL, y.id, s.local_orientation, s.is_screenshot, s.is_document, s.category_source
FROM synth y JOIN src s ON s.k = y.k LEFT JOIN city c ON c.ci = y.ci;

-- Perceptual hashes: random, 2% equal to the previous photo's (near-duplicates).
UPDATE api_photo p SET perceptual_hash = lpad(to_hex((random() * 2147483647)::bigint), 8, '0')
                                      || lpad(to_hex((random() * 2147483647)::bigint), 8, '0')
FROM synth y WHERE p.id = y.id;
UPDATE api_photo p SET perceptual_hash = prev.perceptual_hash
FROM synth y JOIN synth yp ON yp.n = y.n - 1 JOIN api_photo prev ON prev.id = yp.id
WHERE p.id = y.id AND y.r_dup < 0.02;

INSERT INTO api_photo_files (file_id, photo_id)
SELECT y.hash, y.id FROM synth y WHERE y.src_file IS NOT NULL;

-- Thumbnails: same rows, renamed to the new hash (link_thumbs.py creates the files).
INSERT INTO api_thumbnail (thumbnail_big, square_thumbnail, square_thumbnail_small, aspect_ratio, dominant_color, photo_id)
SELECT replace(t.thumbnail_big, y.src_hash, y.hash), replace(t.square_thumbnail, y.src_hash, y.hash),
       replace(t.square_thumbnail_small, y.src_hash, y.hash), t.aspect_ratio, t.dominant_color, y.id
FROM synth y JOIN api_thumbnail t ON t.photo_id = y.src_id;

INSERT INTO api_photometadata (id, aperture, shutter_speed, shutter_speed_seconds, iso, focal_length,
    focal_length_35mm, exposure_compensation, flash_fired, metering_mode, white_balance, camera_make,
    camera_model, lens_make, lens_model, serial_number, width, height, orientation, color_space, bit_depth,
    date_taken, date_taken_subsec, date_modified, timezone_offset, gps_latitude, gps_longitude, gps_altitude,
    location_country, location_state, location_city, location_address, title, caption, keywords, rating,
    copyright, creator, source, raw_exif, raw_xmp, raw_iptc, version, created_at, updated_at, photo_id)
SELECT gen_random_uuid(), m.aperture, m.shutter_speed, m.shutter_speed_seconds, m.iso, m.focal_length,
    m.focal_length_35mm, m.exposure_compensation, m.flash_fired, m.metering_mode, m.white_balance, m.camera_make,
    m.camera_model, m.lens_make, m.lens_model, m.serial_number, m.width, m.height, m.orientation, m.color_space,
    m.bit_depth, y.ts, m.date_taken_subsec, m.date_modified, m.timezone_offset, p.exif_gps_lat, p.exif_gps_lon,
    m.gps_altitude, c.country, NULL, c.name, NULL, m.title, m.caption, m.keywords, m.rating, m.copyright,
    m.creator, m.source, m.raw_exif, m.raw_xmp, m.raw_iptc, m.version, now(), now(), y.id
FROM synth y JOIN api_photometadata m ON m.photo_id = y.src_id
JOIN api_photo p ON p.id = y.id LEFT JOIN city c ON c.ci = y.ci;

INSERT INTO api_photo_caption (captions_json, created_at, updated_at, photo_id)
SELECT pc.captions_json, now(), now(), y.id
FROM synth y JOIN api_photo_caption pc ON pc.photo_id = y.src_id;

-- Search text: three vocabulary words (the thing albums below use the same words).
CREATE TEMP TABLE words AS
SELECT y.id, v.w FROM synth y
JOIN vocab v ON v.i IN (1 + floor(y.r_w1 * :n_vocab)::int, 1 + floor(y.r_w2 * :n_vocab)::int, 1 + floor(y.r_w3 * :n_vocab)::int);
CREATE INDEX ON words (id);
ANALYZE words;
INSERT INTO api_photo_search (search_captions, search_location, created_at, updated_at, photo_id)
SELECT (SELECT string_agg(w.w, ' ') FROM words w WHERE w.id = y.id),
       CASE WHEN y.ci IS NOT NULL THEN c.district || ', ' || c.name || ', ' || c.country END,
       now(), now(), y.id
FROM synth y LEFT JOIN city c ON c.ci = y.ci;

-- Date albums: reuse alice's existing rows per date, add the rest.
INSERT INTO api_albumdate (title, date, favorited, location, owner_id)
SELECT '', d, false, NULL, 2
FROM (SELECT DISTINCT (ts AT TIME ZONE 'UTC')::date AS d FROM synth WHERE ts IS NOT NULL) x
WHERE NOT EXISTS (SELECT 1 FROM api_albumdate a WHERE a.owner_id = 2 AND a.date = x.d);
INSERT INTO api_albumdate_photos (albumdate_id, photo_id)
SELECT a.id, y.id FROM synth y
JOIN api_albumdate a ON a.owner_id = 2 AND a.date = (y.ts AT TIME ZONE 'UTC')::date
WHERE y.ts IS NOT NULL;
INSERT INTO api_albumdate_photos (albumdate_id, photo_id)
SELECT a.id, y.id FROM synth y JOIN api_albumdate a ON a.owner_id = 2 AND a.date IS NULL
WHERE y.ts IS NULL;
UPDATE api_albumdate a SET location = jsonb_build_object('places', jsonb_build_array(c.name))
FROM (SELECT DISTINCT ON ((ts AT TIME ZONE 'UTC')::date) (ts AT TIME ZONE 'UTC')::date AS d, ci
      FROM synth WHERE ts IS NOT NULL AND ci IS NOT NULL ORDER BY (ts AT TIME ZONE 'UTC')::date, n) x
JOIN city c ON c.ci = x.ci
WHERE a.owner_id = 2 AND a.date = x.d AND a.location IS NULL;

-- Place albums: country (level 1) and city (level 2), reusing Berlin/Germany/Tokyo/Japan.
INSERT INTO api_albumplace (title, geolocation_level, favorited, owner_id, last_modified)
SELECT DISTINCT t.title, t.lvl, false, 2, now()
FROM (SELECT country AS title, 1 AS lvl FROM city UNION SELECT name, 2 FROM city) t
WHERE NOT EXISTS (SELECT 1 FROM api_albumplace a WHERE a.owner_id = 2 AND a.title = t.title AND a.geolocation_level = t.lvl);
INSERT INTO api_albumplace_photos (albumplace_id, photo_id)
SELECT a.id, y.id FROM synth y JOIN city c ON c.ci = y.ci
JOIN api_albumplace a ON a.owner_id = 2 AND ((a.geolocation_level = 1 AND a.title = c.country) OR (a.geolocation_level = 2 AND a.title = c.name));

-- Thing albums: one per vocabulary word, members = photos whose caption has the word.
INSERT INTO api_albumthing (title, thing_type, favorited, owner_id, photo_count, last_modified)
SELECT v.w, 'mobileclip_s2_tag', false, 2, 0, now() FROM vocab v
WHERE NOT EXISTS (SELECT 1 FROM api_albumthing a WHERE a.owner_id = 2 AND a.title = v.w);
INSERT INTO api_albumthing_photos (albumthing_id, photo_id)
SELECT DISTINCT a.id, w.id FROM words w JOIN api_albumthing a ON a.owner_id = 2 AND a.title = w.w;
UPDATE api_albumthing a SET photo_count = (SELECT count(*) FROM api_albumthing_photos ap WHERE ap.albumthing_id = a.id)
WHERE a.owner_id = 2;
INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id)
SELECT albumthing_id, photo_id FROM (
  SELECT ap.albumthing_id, ap.photo_id, row_number() OVER (PARTITION BY ap.albumthing_id ORDER BY ap.id DESC) AS rn
  FROM api_albumthing_photos ap JOIN api_albumthing a ON a.id = ap.albumthing_id AND a.owner_id = 2
) x WHERE rn <= 4
ON CONFLICT DO NOTHING;

-- Event albums: 40% of the days with >= 10 photos.
CREATE TEMP TABLE events AS
SELECT day, min(ts) AS ts, min(ci) AS ci, count(*) AS c FROM synth
WHERE cnt >= 10 AND ts IS NOT NULL GROUP BY day HAVING random() < 0.4;
ALTER TABLE events ADD COLUMN album_id int;
WITH ins AS (
  INSERT INTO api_albumauto (title, "timestamp", created_on, gps_lat, gps_lon, favorited, owner_id, last_modified)
  SELECT to_char(e.ts, 'FMDay') || ' ' || CASE WHEN extract(hour FROM e.ts) < 12 THEN 'Morning' WHEN extract(hour FROM e.ts) < 17 THEN 'Afternoon' ELSE 'Evening' END
         || coalesce(' in ' || c.name, ''),
         e.ts, now(), c.lat, c.lon, false, 2, now()
  FROM events e LEFT JOIN city c ON c.ci = e.ci ORDER BY e.day
  RETURNING id, "timestamp"
)
UPDATE events e SET album_id = ins.id FROM ins WHERE ins."timestamp" = e.ts;
INSERT INTO api_albumauto_photos (albumauto_id, photo_id)
SELECT e.album_id, y.id FROM events e JOIN synth y ON y.day = e.day WHERE e.album_id IS NOT NULL;

-- User albums: contiguous time ranges with log-normal sizes.
CREATE TEMP TABLE ualbums AS
SELECT g AS a, 1 + floor(random() * (SELECT max(n) FROM synth))::int AS n0,
       least(2000, greatest(5, round(exp(3.3 + 1.1 * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random())))))::int AS sz,
       random() AS r_share
FROM generate_series(1, greatest(10, :n / 400)) AS g;
ALTER TABLE ualbums ADD COLUMN album_id int;
WITH ins AS (
  INSERT INTO api_albumuser (title, created_on, favorited, owner_id, cover_photo_id, last_modified)
  SELECT 'Album ' || lpad(a::text, 4, '0'), now() - (a || ' minutes')::interval, a % 17 = 0, 2, NULL, now()
  FROM ualbums ORDER BY a
  RETURNING id, title
)
UPDATE ualbums u SET album_id = ins.id FROM ins WHERE ins.title = 'Album ' || lpad(u.a::text, 4, '0');
INSERT INTO api_albumuser_photos (albumuser_id, photo_id)
SELECT u.album_id, y.id FROM ualbums u JOIN synth y ON y.n >= u.n0 AND y.n < u.n0 + u.sz;
UPDATE api_albumuser au SET cover_photo_id = (SELECT photo_id FROM api_albumuser_photos ap WHERE ap.albumuser_id = au.id ORDER BY ap.id LIMIT 1)
FROM ualbums u WHERE au.id = u.album_id;
INSERT INTO api_albumuser_shared_to (albumuser_id, user_id)
SELECT album_id, 3 FROM ualbums WHERE r_share < 0.05;

-- Persons (labelled + clusters) and faces.
SELECT coalesce(max(id), 0) AS maxp FROM api_person \gset
INSERT INTO api_person (name, kind, cluster_owner_id, face_count, cover_face_id, cover_photo_id, last_modified)
SELECT 'Person ' || lpad(g::text, 4, '0'), 'USER', 2, 0, NULL, NULL, now()
FROM generate_series(1, greatest(20, :n / 500)) g;
INSERT INTO api_person (name, kind, cluster_owner_id, face_count, cover_face_id, cover_photo_id, last_modified)
SELECT 'Cluster ' || lpad(g::text, 4, '0'), 'CLUSTER', 2, 0, NULL, NULL, now()
FROM generate_series(1, greatest(10, :n / 1000)) g;
CREATE TEMP TABLE pers AS
SELECT (row_number() OVER (PARTITION BY kind ORDER BY id) - 1)::int AS i, id, kind FROM api_person
WHERE id > :maxp;
SELECT count(*) FILTER (WHERE kind = 'USER') AS n_user_p, count(*) FILTER (WHERE kind = 'CLUSTER') AS n_cluster_p FROM pers \gset
CREATE TEMP TABLE srcface AS
SELECT (row_number() OVER (ORDER BY id) - 1)::int AS j, image, encoding, location_top, location_bottom, location_left, location_right
FROM api_face WHERE photo_id IN (SELECT id FROM src);
SELECT count(*) AS n_srcface FROM srcface \gset
CREATE TEMP TABLE newface AS
SELECT y.id AS photo_id, y.n, g AS fi, random() AS r_kind, random() AS r_person
FROM synth y JOIN src s ON s.k = y.k,
     generate_series(1, CASE WHEN s.video THEN 0 WHEN y.r_faces < 0.55 THEN 0 WHEN y.r_faces < 0.80 THEN 1
                             WHEN y.r_faces < 0.93 THEN 2 WHEN y.r_faces < 0.98 THEN 3 ELSE 5 END) AS g;
INSERT INTO api_face (image, cluster_probability, location_top, location_bottom, location_left, location_right,
    encoding, person_id, cluster_id, classification_probability, deleted, classification_person_id,
    cluster_person_id, photo_id)
SELECT sf.image, CASE WHEN f.r_kind < 0.7 THEN 0.9 ELSE 0 END,
       sf.location_top, sf.location_bottom, sf.location_left, sf.location_right, sf.encoding,
       CASE WHEN f.r_kind < 0.55 THEN up.id END, NULL,
       CASE WHEN f.r_kind >= 0.55 AND f.r_kind < 0.7 THEN 0.7 ELSE 0 END, false,
       CASE WHEN f.r_kind >= 0.55 AND f.r_kind < 0.7 THEN cp.id END,
       CASE WHEN f.r_kind < 0.55 THEN up.id WHEN f.r_kind < 0.7 THEN cp.id END,
       f.photo_id
FROM newface f
JOIN srcface sf ON sf.j = (f.n + f.fi) % :n_srcface
JOIN pers up ON up.kind = 'USER' AND up.i = floor(:n_user_p * power(f.r_person, 2.5))::int
JOIN pers cp ON cp.kind = 'CLUSTER' AND cp.i = floor(:n_cluster_p * power(f.r_person, 2.5))::int;
UPDATE api_person pe SET face_count = x.c, cover_face_id = x.fid, cover_photo_id = x.pid
FROM (SELECT coalesce(person_id, classification_person_id) AS pid_, count(*) AS c, min(id) AS fid,
             (array_agg(photo_id ORDER BY id))[1] AS pid
      FROM api_face WHERE coalesce(person_id, classification_person_id) IN (SELECT id FROM pers)
      GROUP BY 1) x
WHERE pe.id = x.pid_;
-- Person names are searchable, as Django's search_captions carries them.
UPDATE api_photo_search ps SET search_captions = ps.search_captions || ' ' || x.names
FROM (SELECT f.photo_id, string_agg(DISTINCT pe.name, ' ') AS names FROM api_face f
      JOIN api_person pe ON pe.id = f.person_id
      WHERE f.photo_id IN (SELECT id FROM synth) GROUP BY f.photo_id) x
WHERE ps.photo_id = x.photo_id;

-- User tags: 8% of photos carry one of 40 tags (zipf).
INSERT INTO api_tag (name, photo_count, owner_id, last_modified)
SELECT 'tag-' || lpad(g::text, 2, '0'), 0, 2, now() FROM generate_series(1, 40) g;
INSERT INTO api_tag_photos (tag_id, photo_id)
SELECT t.id, y.id FROM synth y
JOIN api_tag t ON t.owner_id = 2 AND t.name = 'tag-' || lpad((1 + floor(40 * power(y.r_tagpick, 2)))::int::text, 2, '0')
WHERE y.r_tag < 0.08;
UPDATE api_tag t SET photo_count = (SELECT count(*) FROM api_tag_photos tp WHERE tp.tag_id = t.id) WHERE t.owner_id = 2;

SELECT (SELECT count(*) FROM api_photo WHERE owner_id = 2) AS alice_photos,
       (SELECT count(*) FROM api_albumdate WHERE owner_id = 2) AS date_albums,
       (SELECT count(*) FROM api_face) AS faces,
       (SELECT count(*) FROM api_person) AS persons,
       (SELECT count(*) FROM api_albumuser) AS user_albums,
       (SELECT count(*) FROM api_albumauto) AS auto_albums,
       (SELECT count(*) FROM api_albumthing) AS thing_albums,
       (SELECT count(*) FROM api_albumplace) AS place_albums;

-- hash -> source hash, for link_thumbs.py
COPY (SELECT hash, src_hash FROM synth ORDER BY n) TO STDOUT WITH (FORMAT csv) \g :mapfile
