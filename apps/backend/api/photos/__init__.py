"""Photos: the files behind a photo, and the work done on whole sets of photos.

- ``media_files``: what a file on disk is (type, content hash, loadable) and
  its ``File`` row
- ``files``: detaching a photo's missing files, removing a photo with the
  files only it uses
- ``file_cleanup``: the receivers that delete face crops and thumbnails once
  their rows are gone
- ``selection``: the user's own photos matching a "Select All" payload
- ``zip_downloads``: the download archive job and its one-day cleanup
- ``retention``: the daily trash purge and sync tombstone pruning (scheduled
  by ``start_cleaning_service``)
"""
