import logging
import logging.handlers

logger = logging.getLogger('image_similarity')
fomatter = logging.Formatter(
            '%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : %(levelname)s : %(message)s')
fileMaxByte = 256 * 1024 * 200  # 100MB
fileHandler = logging.handlers.RotatingFileHandler(
            'logs/image_similarity.log', maxBytes=fileMaxByte, backupCount=10)
fileHandler.setFormatter(fomatter)
logger.addHandler(fileHandler)
logger.setLevel(logging.INFO)
