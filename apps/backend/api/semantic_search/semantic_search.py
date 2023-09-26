import gc

import numpy as np
import PIL
from django.conf import settings
from sentence_transformers import SentenceTransformer

from api.util import logger

dir_clip_ViT_B_32_model = settings.CLIP_ROOT


class SemanticSearch:
    model_is_loaded = False

    def load(self):
        self.load_model()
        self.model_is_loaded = True
        pass

    def unload(self):
        self.model = None
        gc.collect()
        self.model_is_loaded = False
        pass

    def load_model(self):
        self.model = SentenceTransformer(dir_clip_ViT_B_32_model)

    def calculate_clip_embeddings(self, img_paths):
        import torch

        if not self.model_is_loaded:
            self.load()
        imgs = []
        if type(img_paths) is list:
            for path in img_paths:
                try:
                    img = PIL.Image.open(path)
                    imgs.append(img)
                except PIL.UnidentifiedImageError:
                    logger.info("Error loading image: {}".format(path))
        else:
            try:
                img = PIL.Image.open(img_paths)
                imgs.append(img)
            except PIL.UnidentifiedImageError:
                logger.info("Error loading image: {}".format(img_paths))

        try:
            imgs_emb = self.model.encode(imgs, batch_size=32, convert_to_tensor=True)
            if torch.cuda.is_available():
                if type(img_paths) is list:
                    magnitudes = list(
                        map(lambda x: np.linalg.norm(x.cpu().numpy()), imgs_emb)
                    )

                    return imgs_emb, magnitudes
                else:
                    img_emb = imgs_emb[0].cpu().numpy().tolist()
                    magnitude = np.linalg.norm(img_emb)

                    return img_emb, magnitude
            else:
                if type(img_paths) is list:
                    magnitudes = map(np.linalg.norm, imgs_emb)
                    return imgs_emb, magnitudes
                else:
                    img_emb = imgs_emb[0].tolist()
                    magnitude = np.linalg.norm(img_emb)

                return img_emb, magnitude
        except Exception as e:
            logger.error("Error in calculating clip embeddings: {}".format(e))
            raise e

    def calculate_query_embeddings(self, query):
        if not self.model_is_loaded:
            self.load()

        query_emb = self.model.encode([query], convert_to_tensor=True)[0].tolist()
        magnitude = np.linalg.norm(query_emb)

        return query_emb, magnitude


semantic_search_instance = SemanticSearch()
