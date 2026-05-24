site_settings_schema = {
    "type": "object",
    "anyOf": [
        {"required": ["allow_registration"]},
        {"required": ["allow_upload"]},
        {"required": ["skip_patterns"]},
        {"required": ["map_api_provider"]},
        {"required": ["map_api_key"]},
        {"required": ["geocode_throttle_profiles"]},
        {"required": ["captioning_model"]},
        {"required": ["llm_model"]},
        {"required": ["tagging_model"]},
        {"required": ["face_recognition_model"]},
    ],
    "properties": {
        "allow_registration": {"type": "boolean"},
        "allow_upload": {"type": "boolean"},
        "skip_patterns": {"type": "string"},
        "map_api_provider": {"type": "string"},
        "map_api_key": {"type": "string"},
        "geocode_throttle_profiles": {
            "type": "object",
            "properties": {
                "nominatim": {"$ref": "#/$defs/geocode_throttle_profile"},
                "mapbox": {"$ref": "#/$defs/geocode_throttle_profile"},
                "maptiler": {"$ref": "#/$defs/geocode_throttle_profile"},
                "opencage": {"$ref": "#/$defs/geocode_throttle_profile"},
                "tomtom": {"$ref": "#/$defs/geocode_throttle_profile"},
            },
            "additionalProperties": False,
        },
        "captioning_model": {"type": "string"},
        "llm_model": {"type": "string"},
        "tagging_model": {"type": "string"},
        "face_recognition_model": {"type": "string"},
    },
    "$defs": {
        "geocode_throttle_profile": {
            "type": "object",
            "properties": {
                "enabled": {"type": "boolean"},
                "requests_per_second": {"type": "number", "minimum": 0},
                "burst_size": {"type": "integer", "minimum": 1},
            },
            "required": ["enabled", "requests_per_second", "burst_size"],
            "additionalProperties": False,
        }
    },
}
