"""
The code is derived from
https://github.com/althonos/pronto/commit/3384010dfb4fc7c66a219f59276adef3288a886b
"""

import multiprocessing
import multiprocessing.queues
import sys


class SharedCounter:
    """A synchronized shared counter.

    The locking done by multiprocessing.Value ensures that only a single
    process or thread may read or write the in-memory ctypes object. However,
    in order to do n += 1, Python performs a read followed by a write, so a
    second process may read the old value before the new one is written by
    the first process. The solution is to use a multiprocessing.Lock to
    guarantee the atomicity of the modifications to Value.

    This class comes almost entirely from Eli Bendersky's blog:
    http://eli.thegreenplace.net/2012/01/04/shared-counter-with-pythons-multiprocessing/
    """

    def __init__(self, n=0):
        self.count = multiprocessing.Value("i", n)

    def increment(self, n=1):
        """Increment the counter by n (default = 1)"""
        with self.count.get_lock():
            self.count.value += n

    @property
    def value(self):
        """Return the value of the counter"""
        return self.count.value


class Queue(multiprocessing.queues.Queue):
    """A portable implementation of multiprocessing.Queue.

    Because of multithreading / multiprocessing semantics, Queue.qsize() may
    raise the NotImplementedError exception on Unix platforms like Mac OS X
    where sem_getvalue() is not implemented. This subclass addresses this
    problem by using a synchronized shared counter (initialized to zero) and
    increasing / decreasing its value every time the put() and get() methods
    are called, respectively. This not only prevents NotImplementedError from
    being raised, but also allows us to implement a reliable version of both
    qsize() and empty().
    """

    def __init__(self, *args, **kwargs):
        if sys.version_info < (3, 0):
            super(Queue, self).__init__(*args, **kwargs)
        else:
            super(Queue, self).__init__(
                *args, ctx=multiprocessing.get_context(), **kwargs
            )
        self.size = SharedCounter(0)

    def __getstate__(self):
        return super(Queue, self).__getstate__() + (self.size,)

    def __setstate__(self, state):
        super(Queue, self).__setstate__(state[:-1])
        self.size = state[-1]

    def put(self, *args, **kwargs):
        super(Queue, self).put(*args, **kwargs)
        self.size.increment(1)

    def get(self, *args, **kwargs):
        x = super(Queue, self).get(*args, **kwargs)
        self.size.increment(-1)
        return x

    def qsize(self) -> int:
        """Reliable implementation of multiprocessing.Queue.qsize()"""
        return self.size.value

    def empty(self) -> bool:
        """Reliable implementation of multiprocessing.Queue.empty()"""
        return not self.qsize() > 0
