"""Background jobs on the django-q2 workers.

- ``queue``: the one module that queues work (job rows, chains, schedules)
- ``start``: starting a job from a request (``start_job``), with one answer
  for a started job, a duplicate start and a broker failure
"""
