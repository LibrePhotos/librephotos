import pickle
from collections import Counter

from tqdm import tqdm

caption_path = "api/im2txt/data/annotations/captions_train2014.json"
vocab_path = "api/im2txt/data/vocab.pkl"
threshold = 4


class Vocabulary:
    """Simple vocabulary wrapper."""

    def __init__(self):
        self.word2idx = {}
        self.idx2word = {}
        self.idx = 0

    def add_word(self, word):
        if word not in self.word2idx:
            self.word2idx[word] = self.idx
            self.idx2word[self.idx] = word
            self.idx += 1

    def __call__(self, word):
        if word not in self.word2idx:
            return self.word2idx["<unk>"]
        return self.word2idx[word]

    def __len__(self):
        return len(self.word2idx)


def build_vocab(json, threshold):
    import nltk
    from pycocotools.coco import COCO

    """Build a simple vocabulary wrapper."""
    coco = COCO(json)
    counter = Counter()
    ids = coco.anns.keys()
    for i, id in tqdm(enumerate(ids)):
        caption = str(coco.anns[id]["caption"])
        tokens = nltk.tokenize.word_tokenize(caption.lower())
        counter.update(tokens)

    #         if (i+1) % 1000 == 0:
    #             print("[{}/{}] Tokenized the captions.".format(i+1, len(ids)))

    # If the word frequency is less than 'threshold', then the word is discarded.
    words = [word for word, cnt in counter.items() if cnt >= threshold]

    # Create a vocab wrapper and add some special tokens.
    vocab = Vocabulary()
    vocab.add_word("<pad>")
    vocab.add_word("<start>")
    vocab.add_word("<end>")
    vocab.add_word("<unk>")

    # Add the words to the vocabulary.
    for i, word in enumerate(words):
        vocab.add_word(word)
    return vocab


def main():
    vocab = build_vocab(json=caption_path, threshold=threshold)
    with open(vocab_path, "wb") as f:
        pickle.dump(vocab, f)
    print(f"Total vocabulary size: {len(vocab)}")
    print(f"Saved the vocabulary wrapper to '{vocab_path}'")
