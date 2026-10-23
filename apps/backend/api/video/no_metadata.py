"""The ffmpeg arguments that leave the source's metadata out of a file.

ffmpeg copies the source's global metadata into its output, and with it a
phone video's recorded location (the mp4 "location" tag). Thumbnails, the
playback conversions and the copies a library recipient gets (#2731) are
written without it.
"""

NO_METADATA = ("-map_metadata", "-1", "-map_chapters", "-1")
