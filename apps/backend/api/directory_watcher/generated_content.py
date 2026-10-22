"""What the machine learned about a picture that was replaced (#2041).

A file overwritten with a different picture keeps its Photo row, so the
things, the generated caption, the search embedding and the text found in the
old picture would stay attached to it. The jobs that make them select photos
that have none, so they are cleared here and the next run of each fills them
again. What a person entered (their caption, Tags, rating, albums, a date or
place set by hand) is not touched.
"""

from api.models import Photo
from api.models.album_thing import set_photo_album_things
from api.models.photo_caption import PhotoCaption
from api.models.photo_ocr import PhotoOcr
from api.models.photo_search import PhotoSearch
from api.search.semantic import OPENCLIP, TAG_THING_TYPE

# The keys of ``PhotoCaption.captions_json`` a model wrote: the generated
# caption (a historical name, whichever model wrote it) and OpenCLIP's things.
# ``user_caption`` and ``imported_description`` are the user's.
GENERATED_CAPTION_KEYS = ("im2txt", OPENCLIP)

# The search embedding and the model that made it.
_EMBEDDING_FIELDS = (
    "clip_embeddings",
    "clip_embeddings_magnitude",
    "clip_embeddings_model",
)


def _discard_generated_captions(photo: Photo) -> None:
    caption = PhotoCaption.objects.filter(photo=photo).first()
    if caption is None or not caption.captions_json:
        return
    captions = caption.captions_json
    if not any(key in captions for key in GENERATED_CAPTION_KEYS):
        return
    for key in GENERATED_CAPTION_KEYS:
        captions.pop(key, None)
    caption.captions_json = captions
    caption.save(update_fields=["captions_json", "updated_at"])


def _discard_search_embedding(photo: Photo) -> None:
    """Clear the embedding in the row and on ``photo``.

    The caller saves ``photo`` afterwards; an instance still carrying the old
    embedding would write it back.
    """
    Photo.objects.filter(pk=photo.pk).update(**dict.fromkeys(_EMBEDDING_FIELDS))
    for field in _EMBEDDING_FIELDS:
        setattr(photo, field, None)


def _rebuild_search_row(photo: Photo) -> None:
    """Index the photo again from what is left, as the tag and caption jobs do.

    Read from the database, so the captions and faces discarded above are
    gone from it too.
    """
    fresh = Photo.objects.get(pk=photo.pk)
    search, _ = PhotoSearch.objects.get_or_create(photo=fresh)
    search.photo = fresh
    search.recreate_search_captions()
    search.save()


def discard_generated_content(photo: Photo) -> None:
    """Drop the things, generated caption, search embedding and text of ``photo``.

    For a photo whose picture was replaced (``NEW_PICTURE``), after its faces
    went: the search row is rebuilt last so that no name, thing or caption of
    the old picture still finds it.
    """
    _discard_generated_captions(photo)
    set_photo_album_things(photo, [], TAG_THING_TYPE)
    _discard_search_embedding(photo)
    PhotoOcr.objects.filter(photo=photo).delete()
    _rebuild_search_row(photo)
