import type { Photo } from "../../api_client/photos/types";

/**
 * A photo detail for tests: every field at its empty value (null, "", 0,
 * false, []), owned by user 1, with what the test is about laid over it. The
 * optional fields (file variants, stacks, OCR, ...) stay absent.
 */
export function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    image_hash: "",
    image_path: [],
    camera: null,
    lens: null,
    exif_gps_lat: null,
    exif_gps_lon: null,
    exif_timestamp: null,
    search_captions: null,
    search_location: null,
    captions_json: {},
    big_thumbnail_url: null,
    small_square_thumbnail_url: null,
    geolocation_json: null,
    exif_json: null,
    people: [],
    rating: 0,
    hidden: false,
    public: false,
    in_trashcan: false,
    removed: false,
    size: 0,
    shared_to: [],
    similar_photos: [],
    video: false,
    is_screenshot: false,
    is_document: false,
    category_source: "auto",
    owner: { id: 1, username: "owner", first_name: "", last_name: "" },
    shutter_speed: null,
    height: null,
    width: null,
    fstop: null,
    iso: null,
    focal_length: null,
    focalLength35Equivalent: null,
    subjectDistance: null,
    digitalZoomRatio: null,
    embedded_media: [],
    ...overrides,
  };
}
