---
title: "😃 Face recognition"
description: "How to use the face dashboard"
sidebar_position: 6
---

## Label a face

To label a face, click on the green plus button. A pop-up titled **Label faces** will show up where you can either search for an already existing person or add a new person. We want to add a new person, so type the name into the **Person Name** field under **New person** and click **Add Person** (the button stays disabled until you enter a name that does not already exist). Now the face is associated with the person.

### Writing face tags to your files

By default, labelling a face only updates the LibrePhotos database — your image files are not touched.

If you enable **Settings → Face Options → Write face tags to image files**, then every time you label a face LibrePhotos also writes the face's region and the person's name into the photo as XMP MWG-RS region tags. This makes your face data portable to other photo managers such as Lightroom, digiKam and XnView.

Where the tags are written depends on **Settings → Metadata → Synchronize metadata to disk**:

- **Save to sidecar** — the regions go into the photo's `.xmp` sidecar file; the original image is left unchanged.
- **Save to media file** or **Off** (the default) — the regions are written into the original image file itself.

Note the second case: turning on **Write face tags to image files** is enough on its own to start modifying your originals. **Synchronize metadata to disk** only chooses sidecar versus media file; leaving it **Off** does not stop face tags from being written.

## Change the label of a face

To change a face to a new person, click on the green plus button. Search for the person you want it to change to and click on them. Now the face is associated with the new person.

## Train faces

If you click on the blue button (the barbell icon) in the face dashboard, or the **Train** button on the [Library page](./library.md) (avatar menu → **Library**, under **Faces & People**), the system will try to cluster unknown faces and will try to either match them to already known faces or create a new unknown person.

The dashboard has three tabs: **Inferred** (the matches training produced), **Unknown** (faces that were not matched, or that you rejected, grouped under "Unknown - Other"), and **Labeled** (faces you have already named). To see the recommendations, go to the **Inferred** tab. There you can see, for each face, the confidence of the match. By default the dashboard only shows matches it is at least 70% confident about — use the **% confident** filter in the toolbar to lower this threshold and surface weaker recommendations (the filter applies to both the Inferred and Unknown tabs).

To confirm a whole inferred group at once, click the green check-person icon next to the person's name; it appears on the Inferred tab next to persons that already have a name. To confirm individual faces, select them and click the green plus button in the toolbar to add them to the person. To reject faces, select them and click the orange person-off button in the toolbar, which moves them back to "Unknown - Other".

## Delete faces

Sometimes the face recognition might find a face that is not actually a face. To remove it, select the face and click on the trashcan symbol; a confirmation dialog appears first. The face is then hidden everywhere in LibrePhotos — it disappears from the face dashboard, from the person's face list and from the photo's face list — and it is no longer used for training, clustering or classification. This cannot be undone from the interface. Note that hiding a face does not free disk space: the cropped face image and its embedding are kept, so the same region is not detected again on a later scan.

## Re-scan faces

Re-scan faces looks through all your photos again and adds any face it finds that does not already have a face record. This will take a while, because it has to look up all the photos again.

:::note
A re-scan will not bring back faces you removed with the delete face action. Deleting a face marks it as deleted but keeps its region on record, and the re-scan skips any newly detected face that overlaps an existing record — including deleted ones. Deleting a face cannot be undone from the user interface.
:::

## Workflow

After the first scan finished, go to the face dashboard. Label a couple of faces per person. Then train the faces with the blue button. Check if the inferred faces are accurate and add a couple of the inferred faces to the labels. Train the faces again. You will get the best results if all the persons in the pictures are known and when every label has at least a couple of faces.

## Pipeline

### Face Detection

Faces are detected with [InsightFace](https://github.com/deepinsight/insightface). Its detector (SCRFD) finds the faces in each photo and returns a bounding box for every face it sees. This replaced the older dlib detectors, so there is no longer a separate `hog` / `cnn` choice — a single detector is used for everyone.

Detection is skipped entirely for photos that already carry XMP `RegionInfo` face regions in the file or its XMP sidecar — for example ones written by digiKam, Lightroom or XnView. Any region marked `Type="Face"` with usable coordinates is taken as-is, and if the region carries a `Name`, the matching person is created and the face is labelled automatically. LibrePhotos only falls back to the InsightFace detector when a photo has no usable face regions. This bypasses detection only: those faces still get an ArcFace embedding during the next train or re-scan, so clustering and classification work on them normally.

### Face Quality

At the moment no matter, which detection methods we use, there will be face detected, which are not actually faces. The user has to manually delete these faces. In the future, we will have a new classifier, which determines if it is a face and how likely it is a face.

### Face Recognition

Creates a 512-dimension [ArcFace](https://github.com/deepinsight/insightface) embedding for each detected face, which is what makes faces comparable to one another. You can choose which model is used in **Admin Area → Site Settings → Face Recognition Model**: smaller packs (like the default `buffalo_sc`) are faster and lighter, while larger packs (`buffalo_l`, `antelopev2`) are more accurate but use more memory.

:::warning Switching the model later
Changing the model only affects faces that do not yet have an embedding. Faces that were already encoded keep the embedding produced by the previous model: **Train faces** re-encodes only faces that have no embedding yet, and **Re-scan faces** skips faces that overlap ones already stored. Embeddings from different InsightFace packs are not comparable even though they are all 512-dimensional, so until every face is re-encoded, clustering and classification will mix two embedding spaces. To fully switch packs today you have to delete the affected faces and re-scan them.
:::

:::note Upgrading from an older version
Older versions of LibrePhotos used dlib with 128-dimension encodings. When you upgrade to the ArcFace engine, those old encodings and the existing face clusters are cleared automatically because they are not compatible with the new 512-dimension embeddings. Just run **Train faces** / **Re-scan faces** once and your faces will be re-encoded with the new model.
:::

### Face Clustering

Clustering solves the issue of a system, which has no labelled persons yet. Users can get clusters they can name instead of going through a lot of faces and naming them. Clustering is stable, which means that you will get the same clusters out, when you put the same data in. Labels are not fed into the clustering algorithm itself — the encodings are grouped the same way no matter which faces you have already named. They do change the clusters that come out of it, though: any group that contains at least one labelled face is split into one cluster per labelled person, instead of producing a new unknown cluster for you to name.

If you want to change how the grouping itself is done, add images, delete wrong faces, or change the clustering settings under **[Settings](./settings/index.md) → Face Options**:

- **Minimum Cluster Size** (default **Auto**) — the smallest group the algorithm will treat as a cluster. **Auto** also applies when the stored value is 0 or 1, and grows from 2 to 4, 8 and 16 as your library passes 1,000, 10,000 and 100,000 encoded faces.
- **Minimum Samples** (default **1**) — how conservative clustering is; a higher value is more conservative and leaves more faces unclustered.
- **Cluster Selection Epsilon** (default **0.05**, shown as "Normal") — how readily nearby clusters are merged; a higher value merges more clusters together.

Steps which could be done to improve clustering are combining very similar faces from e.g. a serial recording or photo shoot, to prevent from too many small images to be clustered.

### Face Cluster Merging

We could train a classifier to merge faces, based on previous merge decisions, which could improve the clusters even more.

### Face Classification

Classification matches unknown faces against already known persons. Unlike clustering (which groups all faces from scratch), classification respects your previous labelling input and only tries to match faces to people you've already identified. This makes it much more accurate for large datasets where most persons are already known. You can filter between cluster and classification results in the face dashboard, and see the label probability for each inferred face. Classification probabilities are saved alongside clustering probabilities, so you can compare both approaches.
