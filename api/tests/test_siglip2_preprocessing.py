from unittest.mock import Mock

from django.test import SimpleTestCase

from service.multimodal_inference.siglip2.siglip2 import (
    MAX_TOKEN_LENGTH,
    EOS_TOKEN_ID,
    PAD_TOKEN_ID,
    SigLIP2,
    _normalize_text,
    _prompt_tag,
)


class SigLIP2PreprocessingTest(SimpleTestCase):
    def test_normalize_text_lowercases_input(self):
        self.assertEqual(_normalize_text("Straße İSTANBUL"), "straße i̇stanbul")

    def test_prompt_tag_matches_siglip2_template(self):
        self.assertEqual(_prompt_tag("Golden Retriever"), "this is a photo of golden retriever.")

    def test_tokenize_lowercases_before_encoding(self):
        model = SigLIP2()
        tokenizer = Mock()
        tokenizer.Encode.side_effect = [[11, 12, 13]]
        model.tokenizer = tokenizer

        input_ids, attention_mask = model._tokenize(["HeLLo WORLD"])

        tokenizer.Encode.assert_called_once_with("hello world")
        self.assertEqual(input_ids.shape, (1, MAX_TOKEN_LENGTH))
        self.assertEqual(attention_mask.shape, (1, MAX_TOKEN_LENGTH))
        self.assertEqual(input_ids[0, :4].tolist(), [11, 12, 13, EOS_TOKEN_ID])
        self.assertTrue(all(token == PAD_TOKEN_ID for token in input_ids[0, 4:].tolist()))
        self.assertEqual(attention_mask[0, :4].tolist(), [1, 1, 1, 1])
        self.assertTrue(all(mask == 0 for mask in attention_mask[0, 4:].tolist()))
