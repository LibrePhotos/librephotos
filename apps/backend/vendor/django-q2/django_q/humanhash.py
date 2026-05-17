"""
humanhash: Human-readable representations of digests.

The simplest ways to use this module are the :func:`humanize` and :func:`uuid`
functions. For tighter control over the output, see :class:`HumanHasher`.
"""

import operator
import uuid as uuidlib
from argparse import ArgumentError
from functools import reduce

DEFAULT_WORDLIST = (
    "ack",
    "alabama",
    "alanine",
    "alaska",
    "alpha",
    "angel",
    "apart",
    "april",
    "arizona",
    "arkansas",
    "artist",
    "asparagus",
    "aspen",
    "august",
    "autumn",
    "avocado",
    "bacon",
    "bakerloo",
    "batman",
    "beer",
    "berlin",
    "beryllium",
    "black",
    "blossom",
    "blue",
    "bluebird",
    "bravo",
    "bulldog",
    "burger",
    "butter",
    "california",
    "carbon",
    "cardinal",
    "carolina",
    "carpet",
    "cat",
    "ceiling",
    "charlie",
    "chicken",
    "coffee",
    "cola",
    "cold",
    "colorado",
    "comet",
    "connecticut",
    "crazy",
    "cup",
    "dakota",
    "december",
    "delaware",
    "delta",
    "diet",
    "don",
    "double",
    "early",
    "earth",
    "east",
    "echo",
    "edward",
    "eight",
    "eighteen",
    "eleven",
    "emma",
    "enemy",
    "equal",
    "failed",
    "fanta",
    "fifteen",
    "fillet",
    "finch",
    "fish",
    "five",
    "fix",
    "floor",
    "florida",
    "football",
    "four",
    "fourteen",
    "foxtrot",
    "freddie",
    "friend",
    "fruit",
    "gee",
    "georgia",
    "glucose",
    "golf",
    "green",
    "grey",
    "hamper",
    "happy",
    "harry",
    "hawaii",
    "helium",
    "high",
    "hot",
    "hotel",
    "hydrogen",
    "idaho",
    "illinois",
    "india",
    "indigo",
    "ink",
    "iowa",
    "island",
    "item",
    "jersey",
    "jig",
    "johnny",
    "juliet",
    "july",
    "jupiter",
    "kansas",
    "kentucky",
    "kilo",
    "king",
    "kitten",
    "lactose",
    "lake",
    "lamp",
    "lemon",
    "leopard",
    "lima",
    "lion",
    "lithium",
    "london",
    "louisiana",
    "low",
    "magazine",
    "magnesium",
    "maine",
    "mango",
    "march",
    "mars",
    "maryland",
    "massachusetts",
    "may",
    "mexico",
    "michigan",
    "mike",
    "minnesota",
    "mirror",
    "mississippi",
    "missouri",
    "mobile",
    "mockingbird",
    "monkey",
    "montana",
    "moon",
    "mountain",
    "muppet",
    "music",
    "nebraska",
    "neptune",
    "network",
    "nevada",
    "nine",
    "nineteen",
    "nitrogen",
    "north",
    "november",
    "nuts",
    "october",
    "ohio",
    "oklahoma",
    "one",
    "orange",
    "oranges",
    "oregon",
    "oscar",
    "oven",
    "oxygen",
    "papa",
    "paris",
    "pasta",
    "pennsylvania",
    "pip",
    "pizza",
    "pluto",
    "potato",
    "princess",
    "purple",
    "quebec",
    "queen",
    "quiet",
    "red",
    "river",
    "robert",
    "robin",
    "romeo",
    "rugby",
    "sad",
    "salami",
    "saturn",
    "september",
    "seven",
    "seventeen",
    "shade",
    "sierra",
    "single",
    "sink",
    "six",
    "sixteen",
    "skylark",
    "snake",
    "social",
    "sodium",
    "solar",
    "south",
    "spaghetti",
    "speaker",
    "spring",
    "stairway",
    "steak",
    "stream",
    "summer",
    "sweet",
    "table",
    "tango",
    "ten",
    "tennessee",
    "tennis",
    "texas",
    "thirteen",
    "three",
    "timing",
    "triple",
    "twelve",
    "twenty",
    "two",
    "uncle",
    "undress",
    "uniform",
    "uranus",
    "utah",
    "vegan",
    "venus",
    "vermont",
    "victor",
    "video",
    "violet",
    "virginia",
    "washington",
    "west",
    "whiskey",
    "white",
    "william",
    "winner",
    "winter",
    "wisconsin",
    "wolfram",
    "wyoming",
    "xray",
    "yankee",
    "yellow",
    "zebra",
    "zulu",
)


class HumanHasher:
    """
    Transforms hex digests to human-readable strings.

    The format of these strings will look something like:
    `victor-bacon-zulu-lima`. The output is obtained by compressing the input
    digest to a fixed number of bytes, then mapping those bytes to one of 256
    words. A default wordlist is provided, but you can override this if you
    prefer.

    As long as you use the same wordlist, the output will be consistent (i.e.
    the same digest will always render the same representation).
    """

    def __init__(self, wordlist=DEFAULT_WORDLIST):
        if len(wordlist) != 256:
            raise ArgumentError("Wordlist must have exactly 256 items")
        self.wordlist = wordlist

    def humanize(self, hexdigest, words=4, separator="-"):
        """
        Humanize a given hexadecimal digest.

        Change the number of words output by specifying `words`. Change the
        word separator with `separator`.

            >>> digest = '60ad8d0d871b6095808297'
            >>> HumanHasher().humanize(digest)
            'sodium-magnesium-nineteen-hydrogen'
        """

        # Gets a list of byte values between 0-255.
        bytes = [
            int(x, 16)
            for x in list(map("".join, list(zip(hexdigest[::2], hexdigest[1::2]))))
        ]
        # Compress an arbitrary number of bytes to `words`.
        compressed = self.compress(bytes, words)
        # Map the compressed byte values through the word list.
        return separator.join(self.wordlist[byte] for byte in compressed)

    @staticmethod
    def compress(bytes, target):
        """
        Compress a list of byte values to a fixed target length.

            >>> bytes = [96, 173, 141, 13, 135, 27, 96, 149, 128, 130, 151]
            >>> HumanHasher.compress(bytes, 4)
            [205, 128, 156, 96]

        Attempting to compress a smaller number of bytes to a larger number is
        an error:

            >>> HumanHasher.compress(bytes, 15)  # doctest: +ELLIPSIS
            Traceback (most recent call last):
            ...
            ValueError: Fewer input bytes than requested output
        """

        length = len(bytes)
        if target > length:
            raise ValueError("Fewer input bytes than requested output")

        # Split `bytes` into `target` segments.
        seg_size = length // target
        # fmt: off
        segments = [
            bytes[i * seg_size : (i + 1) * seg_size] for i in range(target)  # noqa: E203 E501
        ]
        # fmt: on
        # Catch any left-over bytes in the last segment.
        segments[-1].extend(bytes[target * seg_size :])  # noqa: E203 E501

        # Use a simple XOR checksum-like function for compression.
        def checksum(bytes):
            return reduce(operator.xor, bytes, 0)

        checksums = list(map(checksum, segments))
        return checksums

    def uuid(self, **params):
        """
        Generate a UUID with a human-readable representation.

        Returns `(human_repr, full_digest)`. Accepts the same keyword arguments
        as :meth:`humanize` (they'll be passed straight through).
        """

        digest = str(uuidlib.uuid4()).replace("-", "")
        return self.humanize(digest, **params), digest


DEFAULT_HASHER = HumanHasher()
uuid = DEFAULT_HASHER.uuid
humanize = DEFAULT_HASHER.humanize
