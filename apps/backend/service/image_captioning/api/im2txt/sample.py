import os
import pickle

import onnxruntime as ort
import torch
from numpy import asarray
from PIL import Image
from torchvision import transforms
from torchvision.transforms.functional import InterpolationMode

from api.im2txt.blip.blip import blip_decoder
from api.im2txt.model import DecoderRNN, EncoderCNN

blip_image_size = 384

embed_size = 256
hidden_size = 512
num_layers = 1

im2txt_models_path = "/protected_media/data_models/im2txt"
im2txt_onnx_models_path = "/protected_media/data_models/im2txt_onnx"
blip_models_path = "/protected_media/data_models/blip"

encoder_path = os.path.join(im2txt_models_path, "models", "encoder-10-1000.ckpt")
decoder_path = os.path.join(im2txt_models_path, "models", "decoder-10-1000.ckpt")
vocab_path = os.path.join(im2txt_models_path, "data", "vocab.pkl")

encoder_onnx_path = os.path.join(im2txt_onnx_models_path, "encoder.onnx")
decoder_onnx_path = os.path.join(im2txt_onnx_models_path, "decoder.onnx")
vocab_onnx_path = os.path.join(im2txt_onnx_models_path, "vocab.pkl")

blip_model_url = os.path.join(blip_models_path, "model_base_capfilt_large.pth")
blip_config_url = os.path.join(blip_models_path, "med_config.json")


class Im2txt:
    def __init__(
        self,
        device=torch.device("cuda" if torch.cuda.is_available() else "cpu"),
        blip=False,
    ):
        self._instance = self
        self.encoder = None
        self.decoder = None
        self.vocab = None
        self.device = device
        self.blip = blip
        self.model = None

    def load_image(self, image_path, transform=None):
        image = Image.open(image_path)
        # Check if the image has 3 channels (RGB)
        if image.mode != "RGB":
            # Handle grayscale or other modes here (e.g., convert to RGB)
            image = image.convert("RGB")

        if transform is not None:
            image = transform(image).unsqueeze(0)

        return image

    def load_models(self, onnx=False):
        if self.encoder is not None or self.model is not None:
            return

        if self.blip:
            self.model = blip_decoder(
                pretrained=blip_model_url,
                image_size=blip_image_size,
                vit="base",
                med_config=blip_config_url,
            )
            self.model.eval()
            self.model.to(self.device)
            return

        if onnx:
            with open(vocab_onnx_path, "rb") as f:
                self.vocab = pickle.load(f)
        else:
            with open(vocab_path, "rb") as f:
                self.vocab = pickle.load(f)

        if onnx:
            if self.device == "cuda":
                # Load ONNX models using ONNX Runtime
                self.encoder = ort.InferenceSession(encoder_onnx_path)
                self.decoder = ort.InferenceSession(decoder_onnx_path)
            else:
                # Load ONNX models using ONNX Runtime
                self.encoder = ort.InferenceSession(
                    encoder_onnx_path, providers=["CPUExecutionProvider"]
                )
                self.decoder = ort.InferenceSession(
                    decoder_onnx_path, providers=["CPUExecutionProvider"]
                )
        else:
            # Build models
            self.encoder = EncoderCNN(
                embed_size
            ).eval()  # eval mode (batchnorm uses moving mean/variance)
            self.decoder = DecoderRNN(
                embed_size, hidden_size, len(self.vocab), num_layers
            )
            self.encoder = self.encoder.to(self.device)
            self.decoder = self.decoder.to(self.device)

            # Load the trained model parameters
            self.encoder.load_state_dict(
                torch.load(encoder_path, map_location=self.device)
            )
            self.decoder.load_state_dict(
                torch.load(decoder_path, map_location=self.device)
            )

            # self.encoder = torch.compile(self.encoder)
            # self.decoder = torch.compile(self.decoder)

    def unload_models(self):
        del self.encoder
        del self.decoder
        del self.model
        self.encoder = None
        self.decoder = None
        self.model = None

    def generate_caption(
        self,
        image_path,
        onnx=False,
    ):
        self.load_models(onnx=onnx)

        transform = transforms.Compose(
            [
                transforms.Resize((224, 224), interpolation=InterpolationMode.BICUBIC),
                transforms.ToTensor(),
                transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
            ]
        )

        blip_transform = transforms.Compose(
            [
                transforms.Resize(
                    (blip_image_size, blip_image_size),
                    interpolation=InterpolationMode.BICUBIC,
                ),
                transforms.ToTensor(),
                transforms.Normalize(
                    (0.48145466, 0.4578275, 0.40821073),
                    (0.26862954, 0.26130258, 0.27577711),
                ),
            ]
        )

        if self.blip:
            image = self.load_image(image_path, blip_transform).to(self.device)
            with torch.no_grad():
                caption_blip = self.model.generate(
                    image, sample=True, num_beams=3, max_length=50, min_length=10
                )
                return caption_blip[0]

        # Prepare an image
        image = self.load_image(image_path, transform)
        if onnx:
            # image to numpy

            image_np = asarray(image)
            print("Before encoder")
            # Generate features with the ONNX Encoder
            encoder_output = self.encoder.run(["embedding"], {"image": image_np})[0]
            print("After encoder")
            inputs = {
                "embedding": encoder_output,
            }
            sampled_ids = self.decoder.run(["caption"], inputs)
            sampled_ids = sampled_ids[0][0]

            # Convert word_ids to words
            sampled_caption = []
            for word_id in sampled_ids:
                word = self.vocab.idx2word[word_id]
                sampled_caption.append(word)
                if word == "<end>":
                    break
            sentence = " ".join(sampled_caption)

        else:
            image_tensor = image.to(self.device)
            feature = self.encoder(image_tensor)
            sampled_ids = self.decoder.forward(feature)
            sampled_ids = (
                sampled_ids[0].cpu().numpy()
            )  # (1, max_seq_length) -> (max_seq_length)

            # Convert word_ids to words
            sampled_caption = []
            for word_id in sampled_ids:
                word = self.vocab.idx2word[word_id]
                sampled_caption.append(word)
                if word == "<end>":
                    break
            sentence = " ".join(sampled_caption)

        return sentence

    def export_onnx(self, encoder_output_path, decoder_output_path):
        from torch.onnx import dynamo_export, export

        self.load_models()

        # Define a sample input image tensor (adjust input size as needed)
        input_image = torch.randn(
            1, 3, 224, 224
        )  # Example input image with shape (1, 3, 224, 224)

        # Export the EncoderCNN model to ONNX
        self.encoder.eval()  # Set the model to evaluation mode
        with torch.no_grad():
            export(
                self.encoder,
                input_image,
                encoder_output_path,
                verbose=True,
                input_names=["image"],
                output_names=["embedding"],
            )

            encoder_dyn_export_path = encoder_output_path.replace(".onnx", "_dyn.onnx")
            args = (input_image,)
            dynamo_export(self.encoder, *args).save(encoder_dyn_export_path)

        # Define a sample input for the decoder (features and sampled_ids)
        sample_features = torch.randn(1, embed_size)

        # Export the DecoderRNN model to ONNX
        self.decoder.eval()  # Set the model to evaluation mode
        with torch.no_grad():
            export(
                self.decoder,
                (sample_features),
                decoder_output_path,
                verbose=True,
                input_names=["embedding"],
                output_names=["caption"],
            )

            decoder_dyn_export_path = decoder_output_path.replace(".onnx", "_dyn.onnx")
            args = (sample_features,)
            dynamo_export(
                self.decoder,
                *args,
            ).save(decoder_dyn_export_path)

        quantizedyn_encoder_output_path = encoder_output_path.replace(
            ".onnx", "_quantizedyn.onnx"
        )
        quantizedyn_decoder_output_path = decoder_output_path.replace(
            ".onnx", "_quantizedyn.onnx"
        )

        from onnxruntime.quantization import quantize_dynamic
        from onnxruntime.quantization.shape_inference import quant_pre_process

        quant_pre_process_encoder_output_path = encoder_output_path.replace(
            ".onnx", "_quant_pre_process.onnx"
        )

        quant_pre_process(
            encoder_output_path,
            quant_pre_process_encoder_output_path,
            skip_symbolic_shape=False,
        )
        # To-Do: Can't convert Conv
        quantize_dynamic(
            quant_pre_process_encoder_output_path,
            quantizedyn_encoder_output_path,
            op_types_to_quantize=[
                "MatMul",
                "Attention",
                "LSTM",
                "Gather",
                "Transpose",
                "EmbedLayerNormalization",
            ],
        )

        quant_pre_process_decoder_output_path = decoder_output_path.replace(
            ".onnx", "_quant_pre_process.onnx"
        )

        quant_pre_process(
            decoder_output_path,
            quant_pre_process_decoder_output_path,
            skip_symbolic_shape=False,
        )

        # Can't convert LSTM and hits an matrix multiplication error
        quantize_dynamic(
            quant_pre_process_decoder_output_path,
            quantizedyn_decoder_output_path,
        )


nodes_to_exclude = (
    [
        "/resnet/resnet.0/Conv",
        "/resnet/resnet.4/resnet.4.0/conv1/Conv",
        "/resnet/resnet.4/resnet.4.0/downsample/downsample.0/Conv",
        "/resnet/resnet.4/resnet.4.0/conv2/Conv",
        "/resnet/resnet.4/resnet.4.0/conv3/Conv",
        "/resnet/resnet.4/resnet.4.1/conv1/Conv",
        "/resnet/resnet.4/resnet.4.1/conv2/Conv",
        "/resnet/resnet.4/resnet.4.1/conv3/Conv",
        "/resnet/resnet.4/resnet.4.2/conv1/Conv",
        "/resnet/resnet.4/resnet.4.2/conv2/Conv",
        "/resnet/resnet.4/resnet.4.2/conv3/Conv",
        "/resnet/resnet.5/resnet.5.0/conv1/Conv",
        "/resnet/resnet.5/resnet.5.0/conv2/Conv",
        "/resnet/resnet.5/resnet.5.0/conv3/Conv",
        "/resnet/resnet.5/resnet.5.0/downsample/downsample.0/Conv",
        "/resnet/resnet.5/resnet.5.1/conv1/Conv",
        "/resnet/resnet.5/resnet.5.1/conv2/Conv",
        "/resnet/resnet.5/resnet.5.1/conv3/Conv",
        "/resnet/resnet.5/resnet.5.2/conv1/Conv",
        "/resnet/resnet.5/resnet.5.2/conv2/Conv",
        "/resnet/resnet.5/resnet.5.2/conv3/Conv",
        "/resnet/resnet.5/resnet.5.3/conv1/Conv",
        "/resnet/resnet.5/resnet.5.3/conv2/Conv",
        "/resnet/resnet.5/resnet.5.3/conv3/Conv",
        "/resnet/resnet.5/resnet.5.4/conv1/Conv",
        "/resnet/resnet.5/resnet.5.4/conv2/Conv",
        "/resnet/resnet.5/resnet.5.4/conv3/Conv",
        "/resnet/resnet.5/resnet.5.5/conv1/Conv",
        "/resnet/resnet.5/resnet.5.5/conv2/Conv",
        "/resnet/resnet.5/resnet.5.5/conv3/Conv",
        "/resnet/resnet.5/resnet.5.6/conv1/Conv",
        "/resnet/resnet.5/resnet.5.6/conv2/Conv",
        "/resnet/resnet.5/resnet.5.6/conv3/Conv",
        "/resnet/resnet.5/resnet.5.7/conv1/Conv",
        "/resnet/resnet.5/resnet.5.7/conv2/Conv",
        "/resnet/resnet.5/resnet.5.7/conv3/Conv",
        "/resnet/resnet.6/resnet.6.0/conv1/Conv",
        "/resnet/resnet.6/resnet.6.0/conv2/Conv",
        "/resnet/resnet.6/resnet.6.0/conv3/Conv",
        "/resnet/resnet.6/resnet.6.0/downsample/downsample.0/Conv",
        "/resnet/resnet.6/resnet.6.1/conv1/Conv",
        "/resnet/resnet.6/resnet.6.1/conv2/Conv",
        "/resnet/resnet.6/resnet.6.1/conv3/Conv",
        "/resnet/resnet.6/resnet.6.2/conv1/Conv",
        "/resnet/resnet.6/resnet.6.2/conv2/Conv",
        "/resnet/resnet.6/resnet.6.2/conv3/Conv",
    ],
)
