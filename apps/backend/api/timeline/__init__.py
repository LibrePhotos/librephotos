"""The date-grouped photo lists: the timeline and every view built like it.

A day is not stored. A photo belongs to the day of its ``exif_timestamp``
(wall-clock time, stored as UTC), or to the undated group without one, so the
day list, a day's photos and its layout are all read from the photos:

* ``api.timeline.days``: day ids, the photos of a day, their order and the
  cursor that pages through them;
* ``api.timeline.photos``: which photos a view shows (``timeline_photos``),
  the one definition the day list and the day pages share;
* ``api.timeline.rows``: the day list itself.
"""
