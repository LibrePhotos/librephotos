# api/metadata — organized metadata reading, writing, and tag constants.
#
# Submodules:
#   api.metadata.tags          — Tag name constants (Tags class)
#   api.metadata.reader        — get_metadata(), sidecar file helpers
#   api.metadata.writer        — write_metadata()
#   api.metadata.face_regions  — face region coordinate conversion & tag building
#
# Import directly from submodules to avoid circular import issues:
#   from api.metadata.tags import Tags
#   from api.metadata.reader import get_metadata
#   from api.metadata.writer import write_metadata
#   from api.metadata.face_regions import get_face_region_tags
