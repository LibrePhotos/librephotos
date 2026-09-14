---
title: "📝 Image Captioning"
description: "What is image captioning and how do I use it?"
sidebar_position: 9
---

## What is image captioning?

The goal of automatic image captioning is to understand the content of an image and then produce a coherent and contextually relevant sentence or phrase that describes what is happening in the image.

To use the feature, open one of your own photos and click the information icon in the top bar to show the details panel. In the **Caption** section, click the pencil icon in the top-right corner of the caption box to start editing, then click the wand icon that appears in its place. Once a caption has been generated, it appears as a suggestion just above the caption box — click it to drop the text into the caption field, then press the green tick below the box to save it. (If a caption has already been generated for this photo, the suggestion appears as soon as you start editing.) The wand, cancel and tick controls are only shown while you are editing, and captions cannot be generated on publicly shared photos.

## How do I change the model?

Click on your avatar in the top right and go to `Admin Area`. There is a setting for `Captioning Model` where you can choose between the different models. After selecting one of the `Florence-2 Base` variants, the model is downloaded and added to your `data_models` folder.

Moondream is the exception: its files are only downloaded when `Moondream Visual LLM` is also selected as the `LLM Model`. If you set `Captioning Model` to Moondream while `LLM Model` is left at `None`, the model files are never fetched and captioning fails. To use Moondream, set **both** `Captioning Model` and `LLM Model` to `Moondream Visual LLM`.

Selecting `Florence-2 Base (most accurate)` opens a confirmation dialog titled *Large RAM Size possible*, warning that the model needs about 2 GB of additional RAM while it captions. Click **Save** to apply it; clicking **Cancel** — or closing the dialog — resets the captioning model back to `Florence-2 Base (light, default)`.

## What is the difference between the models?

There are three captioning models to choose from — `Florence-2 Base (light, default)`, `Florence-2 Base (most accurate)`, and `Moondream Visual LLM` — plus a `None` option that turns captioning off. When `None` is selected, no captioning model is downloaded.

All of them run on ONNX Runtime or llama.cpp; LibrePhotos no longer ships PyTorch. The earlier `im2txt` and `BLIP` models were retired with it, and an install that had one of them selected is moved to `Florence-2 Base (light, default)` automatically.

### Florence-2 Base (light, default)

Microsoft's [Florence-2](https://huggingface.co/microsoft/Florence-2-base-ft) writes one-sentence captions such as "A pagoda type building with a lake in the background." This is the default. It uses int8 weights (a 280 MB download) and looks at the photo at 384 x 384 pixels, half the model's native size, which keeps it at about 0.6 GB of RAM while it captions, the same footprint the old im2txt model had, at a few seconds per photo on an older desktop CPU and under a second on a recent one.

### Florence-2 Base (most accurate)

The same model with full-precision weights at its native 768 x 768 input: about 1.1 GB to download and about 2 GB of extra RAM while it captions, for the best captions Florence-2 can give, for example "A tall red and yellow pagoda tower next to a body of water." for the same photo. Roughly three times slower than the light option. On a host with 4 GB of RAM stay with the default.

### Moondream Visual LLM

Moondream 2 is a multi-modal model (via llama-cpp-python) that can analyze both images and text together. It produces richer, more contextually aware captions compared to the other models and lays the groundwork for advanced features like visual queries. It requires more resources than the simpler models but produces the most detailed descriptions.

:::warning Moondream requires two settings
In `Admin Area`, set **both** `Captioning Model` **and** `LLM Model` to `Moondream Visual LLM`. The Moondream weights are downloaded based on the `LLM Model` setting, so leaving `LLM Model` at `None` means the files are never fetched and every caption generation fails.
:::

On x86/x64 systems Moondream additionally requires a CPU that reports the AVX and SSE4.2 instruction sets. If they are missing — including on virtual machines that mask CPU flags, such as Proxmox guests using the default `kvm64` CPU type — the backend's LLM service refuses to start and captioning fails with a "Service unavailable" error, with no automatic fallback to the other models. ARM systems (aarch64/arm64) are unaffected, as this check is skipped there.

Users can choose a model based on their specific requirements, balancing the need for speed, accuracy, and the trade-offs associated with each implementation. It's recommended to consider the performance of your system and the desired performance characteristics when selecting the most suitable model.

## Improving captions with an LLM

The captioning models above produce a caption on their own, but LibrePhotos can optionally run that caption through a large language model to refine it. This is **off by default** and needs two separate opt-ins:

- In `Admin Area`, an admin must set `LLM Model` to something other than `None` — either `Mistral 7B Instruct v0.2 Q5 K M` or `Moondream Visual LLM`. See [Settings](./settings/index.md#site-settings).
- In their own `Settings`, under **Large Language Model Settings**, each user must turn on **Enable Large Language Model For Captions** (also off by default).

Without both, the model descriptions above apply as written.

Two further switches become available once the LLM is enabled — **Add Persons to the Captions** and **Add Locations to the Captions** (both greyed out until the enable switch is on). *Add Persons* only has an effect when the photo has a recognised, named person, and *Add Locations* only when the photo has a geocoded location.

How the LLM is applied depends on the captioning model:

- With either **Florence-2 Base** variant, the model generates a caption first and the LLM then rewrites it in a second pass.
- With **Moondream Visual LLM**, there is no second pass — the caption prompt itself is rebuilt before generation, so the person and location hints steer the original output.
