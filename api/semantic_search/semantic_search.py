from sentence_transformers import SentenceTransformer, util
from PIL import Image
import os
import torch
import numpy as np
import ownphotos

dir_clip_ViT_B_32_model = ownphotos.settings.CLIP_ROOT

class SemanticSearch():
    model_is_loaded = False

    def load(self):
        self.load_model()
        model_is_loaded = True
        pass

    def unload(self):
        self.model = None
        model_is_loaded = False
        pass

    def load_model(self):
        self.model = SentenceTransformer(dir_clip_ViT_B_32_model)

    def calculate_clip_embeddings(self, img_path):
        if not self.model_is_loaded:
            self.load()
        
        imgs = [Image.open(img_path)]
        imgs_emb = self.model.encode(imgs, batch_size=1, convert_to_tensor=True)
        img_emb = imgs_emb[0].tolist()
        magnitute = np.linalg.norm(img_emb)

        return img_emb, magnitute

    def calculate_query_embeddings(self, query):
        if not self.model_is_loaded:
            self.load()

        query_emb = self.model.encode([query], convert_to_tensor=True)[0].tolist()
        magnitute = np.linalg.norm(query_emb)

        return query_emb, magnitute


semantic_search_instance = SemanticSearch()