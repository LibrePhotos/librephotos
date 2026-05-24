class TimeoutException(SystemExit):
    """
    Exception for when a worker takes too long to complete a task
    Raising SystemExit will make sure the function terminates gracefully.
    """

    pass
