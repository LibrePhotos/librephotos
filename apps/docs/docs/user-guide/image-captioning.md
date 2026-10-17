---
title: "📝 Image Captioning"
description: "What is image captioning and how do I use it?"
sidebar_position: 9
---

## What is image captioning?

The goal of automatic image captioning is to understand the content of an image and then produce a coherent and contextually relevant sentence or phrase that describes what is happening in the image.

To use the feature, open one of your own photos and click the information icon in the top bar to show the details panel. In the **Caption** section, click the pencil icon in the top-right corner of the caption box to start editing, then click the wand icon that appears in its place. Once a caption has been generated, it appears as a suggestion just above the caption box — click it to drop the text into the caption field, then press the green tick below the box to save it. (If a caption has already been generated for this photo, the suggestion appears as soon as you start editing.) The wand, cancel and tick controls are only shown while you are editing, and captions cannot be generated on publicly shared photos.

## Captioning the whole library {#captioning-the-whole-library}

<Since version="1.4.0" /> To caption many photos at once, open **Account menu > Library**. Under the **Captions** heading is the **Generate captions** row:

- **Generate** captions the photos that have no generated caption yet. The first time, that is all of your photos; after that, the photos added since. A run you cancelled continues where it stopped the next time you click **Generate**.
- The arrow next to **Generate** opens **Generate captions again for all photos**, which writes a new generated caption for every photo. It asks first, because on a large library it runs for hours.

Both start a **Generate Captions** job, which you can follow under **Account menu > My Jobs** and cancel there. It captions photos only, not videos, and skips photos in the trash and photos that have no thumbnail yet. Each user runs it for their own photos. A caption you wrote yourself is never changed: the job only writes the generated caption, which search finds next to yours.

The job does not run by itself after a scan. When you have added new photos, click **Generate** again. It takes the time of one caption per photo (see below), so a library of 30,000 photos at about 2 seconds a photo keeps the job queue busy for around 17 hours; other jobs, such as a scan, wait until it has finished or you cancel it. A job that keeps making progress is not stopped by the [stuck-job check](./job-system.md#what-to-do-when-a-job-gets-stuck), however long it runs.

The **Captions** section is only shown while captioning is on: the **Image captioning** switch in the [Features card](./feature-toggles.md#site-settings-switches) is on and `Captioning Model` is not `None`. When the captioning model is not downloaded yet, the job downloads it first and then starts captioning.

## Which model writes the captions?

Captions come from [LFM2.5-VL](https://huggingface.co/LiquidAI/LFM2.5-VL-450M), a small vision-language model from Liquid AI that runs on ONNX Runtime like every other model in LibrePhotos. There is nothing to pick: the files (about 370 MB) are fetched with the other models while captioning is on. <Since version="1.4.0" /> With captioning turned off they are not downloaded; turning it on again downloads them when you save the site settings or ask for a caption. The model needs about 0.9 GB of RAM while it captions and takes a few seconds per photo on an older desktop CPU, under a second on a recent one.

It writes one natural sentence, for example "A rocket is taking off from a launch pad at night, with two tall metal towers flanking the launch site." Because it is a vision-language model it also takes instructions, which is what the caption context settings below use.

To turn automatic captioning off, set `Captioning Model` to `None` in the `Admin Area`; an administrator can also switch the feature off for the whole deployment with the `FEATURE_IMAGE_CAPTIONING` environment variable. The earlier captioning models (im2txt, BLIP, Florence-2 and Moondream) and the separate Mistral language model were retired; an install that had any of them selected is moved to LFM2.5-VL automatically.

## Caption context: names and places

A caption is better when it can say who is in the photo and where it was taken. LibrePhotos already knows both, from face recognition and reverse geocoding, and passes them to the captioning model in its prompt. Each user controls this in their own `Settings`, under **Caption Context**:

- **Tell the captioning model what LibrePhotos knows about a photo** turns the context on. Default `On`.
- **Use the names of recognised people in captions** adds the recognised, named person to the prompt. The model is asked to use the name directly, as a friend tagging a photo would ("Grace in a simple gray shirt, standing against a blue background"). Only has an effect when the photo has a recognised, named person. Default `On`.
- **Mention where the photo was taken in captions** adds the photo's geocoded location. Only has an effect when the photo has one. Default `On`.

With the context switched off, the model is simply asked to describe the photo.
