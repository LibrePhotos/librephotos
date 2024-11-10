site_settings_schema = {
    "type": "object",
    "anyOf": [
        {"required": ["allow_registration"]},
        {"required": ["allow_upload"]},
        {"required": ["skip_patterns"]},
        {"required": ["map_api_provider"]},
        {"required": ["map_api_key"]},
        {"required": ["captioning_model"]},
        {"required": ["llm_model"]},
    ],
    "properties": {
        "allow_registration": {"type": "boolean"},
        "allow_upload": {"type": "boolean"},
        "skip_patterns": {"type": "string"},
        "map_api_provider": {"type": "string"},
        "map_api_key": {"type": "string"},
        "captioning_model": {"type": "string"},
        "llm_model": {"type": "string"},
    },
}
