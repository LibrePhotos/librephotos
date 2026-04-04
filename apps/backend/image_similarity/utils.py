import logging
import os
import os.path

from concurrent_log_handler import ConcurrentRotatingFileHandler

BASE_LOGS = os.environ.get("BASE_LOGS", "/logs/")

logger = logging.getLogger("image_similarity")
formatter = logging.Formatter(
    "%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : %(levelname)s : %(message)s"
)
fileMaxByte = 200 * 1024 * 1024  # 200 MB

fileHandler = ConcurrentRotatingFileHandler(
    os.path.join(BASE_LOGS, "image_similarity.log"),
    maxBytes=fileMaxByte,
    backupCount=10,
)

fileHandler.setFormatter(formatter)
logger.addHandler(fileHandler)
logger.setLevel(logging.INFO)
