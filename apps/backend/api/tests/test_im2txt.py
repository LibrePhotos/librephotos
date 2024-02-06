import json
import os
import statistics
import threading
import time
from unittest import skip

import psutil
import torch
from django.test import TestCase
from rest_framework.test import APIClient

from api.image_captioning import export_onnx, generate_caption, unload_model
from api.tests.utils import create_test_user
from api.util import logger


def test_coco(testcase, device="cpu", model="im2txt", onnx=False):
    from pycocoevalcap.eval import COCOEvalCap
    from pycocotools.coco import COCO

    logger.info(f"{device} {model}" if not onnx else f"{device} {model} onnx")
    blip = model == "blip"

    # Path to the annotations file
    annotation_file = (
        os.path.dirname(os.path.abspath(__file__))
        + "/fixtures/coco/captions_val2017.json"
    )

    # Initialize COCO API for annotations
    coco_caps = COCO(annotation_file)

    # Get a list of all image IDs in the dataset
    all_image_ids = coco_caps.getImgIds()

    # Load all images using the COCO API
    all_images = coco_caps.loadImgs(all_image_ids)

    # Save the generated captions together with the image IDs
    generated_captions = []
    counter = 0
    # Iterate through the valdation images
    for image_info in all_images:
        image = (
            os.path.dirname(os.path.abspath(__file__))
            + "/fixtures/coco/val2017/"
            + image_info["file_name"]
        )
        caption = generate_caption(blip=blip, image_path=image, onnx=onnx)
        # The LSTM adds a <start> and <end> token to the generated caption
        caption = caption.replace("<start>", "").replace("<end>", "").strip().lower()
        generated_captions.append({"image_id": image_info["id"], "caption": caption})
        counter += 1
        if counter > 100000:
            break

    testcase.end_time = time.time()

    # Define the path to the output JSON file
    output_json_file = (
        os.path.dirname(os.path.abspath(__file__))
        + "/fixtures/coco/"
        + "generated_captions.json"
    )

    # Write the generated_captions to the JSON file
    with open(output_json_file, "w") as json_file:
        json.dump(generated_captions, json_file)

    # create coco object and coco_result object
    coco = COCO(annotation_file)
    coco_result = coco.loadRes(output_json_file)

    # create coco_eval object by taking coco and coco_result
    coco_eval = COCOEvalCap(coco, coco_result)

    # evaluate on a subset of images by setting
    coco_eval.params["image_id"] = coco_result.getImgIds()

    # evaluate results
    # SPICE will take a few minutes the first time, but speeds up due to caching
    coco_eval.evaluate()

    # print output evaluation scores
    for metric, score in coco_eval.eval.items():
        logger.info(f"{metric}: {score:.3f}")


class Im2TxtBenchmark(TestCase):
    gpu_available = torch.cuda.is_available()
    # Start monitoring RAM usage
    process = psutil.Process(os.getpid())
    start_ram_usage = process.memory_info().rss
    # Start measuring timepycocoevalcap
    start_time = time.time()
    ram_usages = []  # List to store RAM usage samples
    ram_monitor_thread = None
    end_time = None

    def setUp(self) -> None:
        # Check if the required files exist in the fixtures directory
        self.coco_fixture_path = os.path.join(self.fixtures_dir, "coco")
        self.val2017_fixture_path = os.path.join(self.fixtures_dir, "coco", "val2017")
        self.val2017captions_fixture_path = os.path.join(
            self.fixtures_dir, "coco", "captions_val2017.json"
        )

        if not os.path.exists(self.coco_fixture_path):
            logger.warn(
                f"Skipping tests. Directory not found: {self.coco_fixture_path}. Please add a coco folder to the fixtures directory."
            )
            self.skipTest("Directory not found")

        if not os.path.exists(self.val2017_fixture_path):
            logger.warn(
                f"Skipping tests. Directory not found: {self.val2017_fixture_path}. Validation images are required for the COCO benchmark. Please download the COCO validation images and place them in the fixtures/coco/val2017 directory."
            )
            self.skipTest("Directory not found")
        if not os.path.exists(self.val2017captions_fixture_path):
            logger.warn(
                f"Skipping tests. Directory not found: {self.val2017captions_fixture_path}. Captions of Validation images are required for the COCO benchmark. Please download the COCO validation images and place them in the fixtures/coco/ directory."
            )
            self.skipTest("Directory not found")
        unload_model()
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.gpu_available = torch.cuda.is_available()
        self.process = psutil.Process(os.getpid())
        self.start_ram_usage = self.process.memory_info().rss
        self.start_time = time.time()
        self.ram_usages = []  # List to store RAM usage samples
        self.ram_monitor_thread = threading.Thread(
            target=self.monitor_ram_usage, args=(self.process, self.ram_usages, 5)
        )  # Monitor RAM for 5 seconds
        self.ram_monitor_thread.start()

    def tearDown(self) -> None:
        if self.end_time is None:
            execution_time = time.time() - self.start_time
        else:
            execution_time = self.end_time - self.start_time
            self.end_time = None
        self.ram_monitor_thread.join()
        # Calculate RAM usage statistics
        mean_ram_usage_mb = statistics.mean(self.ram_usages) / (
            1024 * 1024
        )  # Convert bytes to MB
        median_ram_usage_mb = statistics.median(self.ram_usages) / (
            1024 * 1024
        )  # Convert bytes to MB

        # Log the results using the logger function
        logger.info("Test Result:")
        logger.info(f"GPU Used: {'Yes' if self.gpu_available else 'No'}")
        logger.info(f"Mean RAM Usage: {mean_ram_usage_mb:.2f} MB")
        logger.info(f"Median RAM Usage: {median_ram_usage_mb:.2f} MB")
        logger.info(f"Execution Time: {execution_time:.2f} seconds")

    def monitor_ram_usage(self, process, ram_usages, duration):
        # Monitor RAM usage for the specified duration
        start_time = time.time()
        while time.time() - start_time < duration:
            ram_usage = process.memory_info().rss
            ram_usages.append(ram_usage)
            time.sleep(0.1)  # Poll every 1 second

    @skip
    def test_im2txt_cpu(self):
        file = os.path.dirname(os.path.abspath(__file__)) + "/fixtures/niaz.jpg"
        self.gpu_available = "False"
        caption = generate_caption(
            device=torch.device("cpu"), image_path=file, onnx=False
        )

        self.assertEqual(
            "<start> a man with a beard is holding a remote control . <end>", caption
        )

        logger.info(f"Caption: {caption}")

    @skip
    def test_im2txt_onnx_cpu(self):
        file = os.path.dirname(os.path.abspath(__file__)) + "/fixtures/niaz.jpg"
        self.gpu_available = "False"
        caption = generate_caption(
            device=torch.device("cpu"), image_path=file, onnx=True
        )

        self.assertEqual(
            "<start> a man with a beard is holding a remote control . <end>", caption
        )

        logger.info(f"Caption: {caption}")

    @skip
    def test_im2txt_gpu(self):
        file = os.path.dirname(os.path.abspath(__file__)) + "/fixtures/niaz.jpg"
        caption = generate_caption(
            device=torch.device("cuda"), image_path=file, onnx=False
        )

        self.assertEqual(
            "<start> a man with a beard is holding a remote control . <end>", caption
        )

        logger.info(f"Caption: {caption}")

    @skip
    def test_im2txt_cpu_100(self):
        file = os.path.dirname(os.path.abspath(__file__)) + "/fixtures/niaz.jpg"
        self.gpu_available = "False"

        for i in range(100):
            caption = generate_caption(
                device=torch.device("cpu"), image_path=file, onnx=False
            )
            self.assertEqual(
                "<start> a man with a beard is holding a remote control . <end>",
                caption,
            )

    @skip
    def test_im2txt_gpu_100(self):
        file = os.path.dirname(os.path.abspath(__file__)) + "/fixtures/niaz.jpg"

        for i in range(100):
            caption = generate_caption(
                device=torch.device("cuda"), image_path=file, onnx=False
            )
            self.assertEqual(
                "<start> a man with a beard is holding a remote control . <end>",
                caption,
            )

    @skip
    def test_im2txt_coco_cpu(self):
        test_coco(testcase=self, device="cpu", model="im2txt")

    @skip
    def test_im2txt_coco_gpu(self):
        test_coco(testcase=self, device="cuda", model="im2txt")

    @skip
    def test_im2txt_coco_cpu_onnx(self):
        test_coco(self, "cpu", "im2txt", True)

    @skip
    def test_im2txt_coco_gpu_onnx(self):
        test_coco(self, "cuda", "im2txt", True)

    @skip
    def test_blip_coco_cpu(self):
        test_coco(self, "cpu", "blip")

    @skip
    def test_blip_coco_gpu(self):
        test_coco(self, "cuda", "blip")

    @skip
    def test_export(self):
        export_onnx(
            os.path.dirname(os.path.abspath(__file__)) + "/fixtures/coco/encoder.onnx",
            os.path.dirname(os.path.abspath(__file__)) + "/fixtures/coco/decoder.onnx",
        )
