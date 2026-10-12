"""Photo stacks: bursts, exposure brackets, and the video in Motion Photos.

- ``detection``: finds burst and bracket sequences and builds their stacks
- ``burst_rules``: the user-configurable burst rules engine
- ``live_photo``: the video embedded in Google and Samsung Motion Photos

Exact copies and visual duplicates are ``api.duplicates``. The package imports
nothing, so ``api.models.user`` can import ``burst_rules`` for its default
without loading the models it is part of.
"""
