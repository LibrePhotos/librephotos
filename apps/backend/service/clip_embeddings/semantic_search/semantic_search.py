import gc

import numpy as np
import PIL
from sentence_transformers import SentenceTransformer


class SemanticSearch:
    model = None
    model_is_loaded = False

    def load(self, model):
        self.load_model(model)
        self.model_is_loaded = True
        pass

    def unload(self):
        del self.model
        self.model = None
        gc.collect()
        self.model_is_loaded = False
        pass

    def load_model(self, model):
        self.model = SentenceTransformer(model)

    def open_images(self, img_paths):
        paths = img_paths if type(img_paths) is list else [img_paths]
        imgs = []
        for path in paths:
            try:
                imgs.append(PIL.Image.open(path))
            except PIL.UnidentifiedImageError:
                print(f"Error loading image: {path}")
        return imgs

    def batch_embeddings(self, imgs_emb, on_cuda):
        if on_cuda:
            magnitudes = list(map(lambda x: np.linalg.norm(x.cpu().numpy()), imgs_emb))
        else:
            magnitudes = map(np.linalg.norm, imgs_emb)
        return imgs_emb, magnitudes

    def single_embedding(self, imgs_emb, on_cuda):
        emb = imgs_emb[0]
        img_emb = emb.cpu().numpy().tolist() if on_cuda else emb.tolist()
        magnitude = np.linalg.norm(img_emb)
        return img_emb, magnitude

    def calculate_clip_embeddings(self, img_paths, model):
        import torch

        if not self.model_is_loaded:
            self.load(model)
        imgs = self.open_images(img_paths)

        try:
            imgs_emb = self.model.encode(imgs, batch_size=32, convert_to_tensor=True)
            on_cuda = torch.cuda.is_available()
            if type(img_paths) is list:
                return self.batch_embeddings(imgs_emb, on_cuda)
            return self.single_embedding(imgs_emb, on_cuda)
        except Exception as e:
            print(f"Error in calculating clip embeddings: {e}")
            raise e

    def calculate_query_embeddings(self, query, model):
        if not self.model_is_loaded:
            self.load(model)

        query_emb = self.model.encode([query], convert_to_tensor=True)[0].tolist()
        magnitude = np.linalg.norm(query_emb)

        return query_emb, magnitude
