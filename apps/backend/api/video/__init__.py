"""Video conversion: what a browser plays, HDR to SDR, and the cached copy.

- ``color``: the scan-time video probe and the ffmpeg filter chain that maps
  HDR to SDR (tone mapping)
- ``playback``: the codec string a browser checks to say whether it plays a video
- ``transcode_cache``: the converted copy kept on disk for videos a browser cannot play
- ``ffmpeg_budget``: how much of the host one ffmpeg conversion may take
- ``no_metadata``: the ffmpeg arguments that keep the source's metadata out
"""
