import logging
import logging.handlers
import os
import os.path

BASE_LOGS = os.environ.get("BASE_LOGS", "/logs/")

logger = logging.getLogger("image_similarity")
formatter = logging.Formatter(
    "%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : %(levelname)s : %(message)s"
)
fileMaxByte = 256 * 1024 * 200  # 100MB

fileHandler = logging.handlers.RotatingFileHandler(
    os.path.join(BASE_LOGS, "image_similarity.log"),
    maxBytes=fileMaxByte,
    backupCount=10,
)

fileHandler.setFormatter(formatter)
logger.addHandler(fileHandler)
logger.setLevel(logging.INFO)
