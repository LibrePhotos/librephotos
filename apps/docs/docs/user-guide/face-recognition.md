---
title: "😃 Face recognition"
description: "How to use the face dashboard"
sidebar_position: 7
---

## Label a face

To label a face, click on the green plus button. A pop-up titled **Label faces** will show up where you can either search for an already existing person or add a new person. We want to add a new person, so type the name into the **Person Name** field under **New person** and click **Add Person** (the button stays disabled until you enter a name that does not already exist). Now the face is associated with the person.

Above the list of people, **Recently tagged** shows the last ten people you labelled faces as, each as a small face with the name under it. Click one to label the faces as that person without searching for the name. The section hides while you type a name.

### Writing face tags to your files

By default, labelling a face only updates the LibrePhotos database — your image files are not touched.

If you enable **Settings → Face Options → Write face tags to image files**, then every time you label a face LibrePhotos also writes the face's region and the person's name into the photo as XMP MWG-RS region tags. This makes your face data portable to other photo managers such as Lightroom, digiKam and XnView.

The switch only takes effect together with **Settings → Metadata → Write edits to files**, which decides where the tags go:

- **Save to sidecar**: the regions go into the photo's `.xmp` sidecar file; the original image is left unchanged.
- **Save to media file**: the regions are written into the original image file itself.
- **Off** (the default): nothing is written, and the switch is greyed out until you pick one of the other two.

_Not released yet: up to 1.3.0, face tags were written into the original image file while synchronization was **Off**. If you had the switch on with synchronization **Off**, your originals may already carry face regions and person names; LibrePhotos does not remove them._

## Change the label of a face

To change a face to a new person, click on the green plus button. Search for the person you want it to change to and click on them. Now the face is associated with the new person.

## Name a face from the photo itself

You do not have to go through the face dashboard. Open a photo and look at the **People** section of the sidebar: it lists every face found in that photo, including the ones nothing has named yet. Hovering a row draws a box around that face on the photo, so you can tell which face a row belongs to.

A face the clustering and classification have not matched to anyone is shown as **Who is this?**. Click the row (or the person-question button next to it) to open the same **Label faces** dialog the dashboard uses, and pick or create a person. Rows that carry a name the classification guessed also offer the green check-person button to confirm that guess, the orange person-off button to reject it, and the trashcan to remove a detection that is not a face at all. The trashcan asks first, as it does on the face dashboard (see [Delete faces](#delete-faces)).

A row labelled **Unknown 001** (or a similar number) is a face that clustering grouped together with others like it, without anybody naming the group. That label is the group's name, not a person's, so there is nothing to confirm and no green check-person button — name such a row the same way you name a **Who is this?** one.

## Add a face the scan missed

The detector does not find every face. Someone turned away from the camera, a child, a face behind a hat or sunglasses, a face too small or too blurred — none of those get a face record, so there is nothing to label and the person never appears on the photo.

Open the photo, then click the green person-plus button at the top of the **People** section of the sidebar. The photo dims and the pointer becomes a crosshair: drag a box around the face, and the **Label faces** dialog opens so you can pick an existing person or type a new name. Press **Escape**, or use the **Cancel** button in the sidebar, to leave without adding anything.

A few things worth knowing:

- **The face you add counts as your own labelling.** It is stored exactly like a face you named on the dashboard, and classification trains on it, so adding a few faces the detector missed also helps it recognise that person elsewhere. It never starts a cluster of its own.
- **It is encoded straight away** by the face recognition service. If that service is unavailable, the face is still saved with its name — the next **Train faces** run gives it an embedding.
- **You cannot draw a second face on top of one that already exists.** If the box you drag lands on a face that is already recorded, LibrePhotos says so and asks you to label that face instead. A face you _deleted_ does not block you, though: drawing a box there is you overruling the deletion.
- **Zoom and pan are fine, rotation is not.** You can zoom in to draw a box around a small face. While the photo is turned, the button is disabled — the box could not be lined up with the photo reliably — so turn it back upright first.
- **The photo needs a thumbnail.** Boxes are measured against the photo's big thumbnail, so a photo that has not been fully processed yet cannot take a face.

If **Settings → Face Options → Write face tags to image files** is enabled, a face you add by hand is written into the photo (or its sidecar) as an XMP region just like any other, so the work is portable to other photo managers.

## Train faces

If you click on the blue button (the barbell icon) in the face dashboard, or the **Train** button on the [Library page](./library.md) (avatar menu → **Library**, under **Faces & People**), the system will try to cluster unknown faces and will try to either match them to already known faces or create a new unknown person.

The dashboard has four tabs: **Inferred** (the matches training produced), **Unknown** (faces that were not matched, or that you rejected, grouped under "Unknown - Other"), **Labeled** (faces you have already named) and **Deleted** (faces you deleted, so you can [restore them](#restore-deleted-faces)). To see the recommendations, go to the **Inferred** tab. There you can see, for each face, the confidence of the match. By default the dashboard only shows matches it is at least 70% confident about — use the **% confident** filter in the toolbar to lower this threshold and surface weaker recommendations (the filter applies to both the Inferred and Unknown tabs).

Each tab shows how many faces it holds. Hover over a tab to see how many people (and, on the Inferred tab, groups) those faces belong to. The numbers follow the sort, Clusters/Classifications and confidence settings, so they always match the faces on screen.

To confirm a whole inferred group at once, click the green check-person icon next to the person's name; it appears on the Inferred tab next to persons that already have a name. To confirm individual faces, select them and click the green plus button in the toolbar to add them to the person. To reject faces, select them and click the orange person-off button in the toolbar, which moves them back to "Unknown - Other".

### Browse people

_Not released yet: the faces, tiles and order of people below come with the release after 1.3._

Each group starts with a row that shows the person's face, their name and how many faces they have. The face is the cover from the **People** page; a cluster such as "Unknown 001" uses its first face. Click the arrow next to the face to collapse the person: they shrink to a single tile with their face, name and face count, and collapsed people sit side by side. The double-arrow button in the toolbar collapses every group at once, which turns the tab into a grid of people. A collapsed person loads none of their faces apart from the cover, so a large library opens faster this way. Click a tile to open that person's faces again. The dashboard remembers which people you collapsed, per tab.

Next to the face order (**Confidence** or **Date**, which sorts the faces inside each group) two small buttons choose the order of the people (point at one to see its name): **A–Z** (the letters icon) sorts them by name, **Most faces** (the numbers icon) puts the people with the most faces first. "Unknown - Other" always comes last. The letter scrubber on the right is only shown in **A–Z** order.

To label one circle of people at a time, use the group button next to the order buttons (it says **All people** until you pick one): the **Labeled** and **Inferred** tabs then only show the people in that [group](./albums.md#groups-of-people), and the tab counts follow. The **Unknown** tab has no people, so the button is hidden there. _Not released yet: groups come with the release after 1.3.0._

### Act on one face

You can also review faces one at a time, without selecting them first. Point at a face (or move to it with the **Tab** key) and two buttons appear on it; on a phone or tablet they are always shown:

- The round green check-person button in the bottom-right corner confirms the face as the person of its group, in one click. It is only there on the Inferred tab, and only in the groups of people that have a name: a cluster such as "Unknown 001" names nobody, so there is nothing to confirm.
- The ⋮ button in the top-left corner opens the face's menu (a right click on the face opens it too, and so does a long press on Android):
  - **Not _name_** sends a wrongly matched face back to "Unknown - Other". In a cluster it reads **Move to Unknown - Other**.
  - **Label as…** opens the **Label faces** dialog for just this face, to give it the right person straight away.
  - **Show photo** opens the photo the face is in.
  - **Delete face** removes the face after you confirm, as described in [Delete faces](#delete-faces).

On the Deleted tab the menu only offers **Restore face** and **Show photo**.

A face you acted on fades out and leaves the group once the list has refreshed. While you have faces selected, the menu only offers **Show photo**: the toolbar buttons act on the selection.

A face whose thumbnail is missing (faces from old versions, or a thumbnail that could not be saved) shows a grey person icon instead of the face. It is a face like any other: you can select it, label it, open its photo with **Show photo** to see who it is, or delete it. The next face scan (see [Re-scan faces](#re-scan-faces)) cuts its thumbnail from the photo again. _Not released yet: this comes with the release after 1.3._

## Delete faces

Sometimes the face recognition might find a face that is not actually a face. To remove it, select the face and click on the trashcan symbol, or choose **Delete face** in the face's ⋮ menu; a confirmation dialog appears first. The face is then hidden everywhere in LibrePhotos — it disappears from the face dashboard, from the person's face list and from the photo's face list — and it is no longer used for training, clustering or classification. Note that hiding a face does not free disk space: the cropped face image and its embedding are kept, so the same region is not detected again on a later scan, and so the face can be [restored](#restore-deleted-faces).

If **Write face tags to image files** is on, deleting faces also takes them out of the files: each affected photo's face regions are written again from the faces it has left, in a background job, and the deleted person's name is removed from the photo's keywords. Deleting the last face of a photo clears its regions, including ones another photo manager such as digiKam wrote and LibrePhotos imported: the media file loses `XMP-mwg-rs:RegionInfo`, and with **Save to sidecar** the sidecar gets an empty region list, which hides the regions still stored in the original. A name you also added to the photo as a tag stays a keyword. Only XMP MWG regions are changed: Microsoft Photo regions (`XMP-MP:RegionInfo`) and digiKam's `People/…` entries in `XMP-digiKam:TagsList` stay in the file. _Not released yet: up to 1.3.0, deleting a face left its region and name in the file._

## Undo a face action

_Not released yet: Undo and the Deleted tab come with the release after 1.3._

The message that confirms a delete, a label (**Label as…**, the green plus button, the check-person buttons) or a wrong match (**Not _name_**, the orange person-off button) has an **Undo** button. It stays for 8 seconds, longer while you point at it. Undo puts the faces back exactly as they were: deleted faces come back to their person, and labelled faces go back to the tab they came from, with the suggestion they had (a face you confirmed on the Inferred tab is a suggestion on the Inferred tab again). When you act on several faces one after the other, the message adds them up, and its Undo takes back all of them.

### Restore deleted faces

The **Deleted** tab lists every face you deleted, grouped by the person each face had; deleted faces that had no person are under "Unknown - Other". To bring faces back:

- select them and click **Restore** in the toolbar,
- click the green restore button next to a person's name to restore all of that person's faces, or
- choose **Restore face** in a face's ⋮ menu.

A restored face goes back to its person (or to the unknown faces), counts for that person again and is found by search under their name. If **Write face tags to image files** is on, the face's region and the person's name are written to the photo again.

## Re-scan faces

Re-scan faces looks through all your photos again and adds any face it finds that does not already have a face record. This will take a while, because it has to look up all the photos again.

Every face scan, the one after a photo scan as well as Re-scan faces, first gives each face whose thumbnail is missing a new one, cut from the photo where the face was found. A face whose photo has no thumbnail keeps the grey person icon until the photo has one. _Not released yet: this comes with the release after 1.3._

:::note
A re-scan will not bring back faces you removed with the delete face action. Deleting a face marks it as deleted but keeps its region on record, and the re-scan skips any newly detected face that overlaps an existing record — including deleted ones. To get a deleted face back, restore it from the **Deleted** tab (see [Restore deleted faces](#restore-deleted-faces)).
:::

### Detect faces again in some photos or a folder

<Since version="1.4.0" />

Re-scan faces on the Library page looks at every photo, which takes hours on a large library. To look at a few photos or one folder only:

- **Some photos**: select them, open the **⋮** (Photo Actions) and choose **Detect faces again** in the **Files** group (up to 1,000 photos). In the photo viewer it is in the **⋮** after the rotate buttons, and on a photo's page under **More**.
- **A folder**: on the folder's page (open it from **Folders**), open the **⋮** (Folder actions) and choose **Detect faces again in this folder**. It covers the folder and its subfolders and asks first, saying how many photos that is.

It works like Re-scan faces for those photos: faces already found and named stay as they are, and a face you deleted is not found again; restore it from the **Deleted** tab instead. The other photos are not touched, and the next face scan after a photo scan still looks at every photo whose faces have not been looked for yet. Only your own photos can be scanned, and a folder must be inside your scan directory or upload folder.

## Workflow

After the first scan finished, go to the face dashboard. Label a couple of faces per person. Then train the faces with the blue button. Check if the inferred faces are accurate and add a couple of the inferred faces to the labels. Train the faces again. You will get the best results if all the persons in the pictures are known and when every label has at least a couple of faces.

## Pipeline

### Face Detection

Faces are detected with [InsightFace](https://github.com/deepinsight/insightface). Its detector (SCRFD) finds the faces in each photo and returns a bounding box for every face it sees. This replaced the older dlib detectors, so there is no longer a separate `hog` / `cnn` choice — a single detector is used for everyone.

Photos that already carry XMP `RegionInfo` face regions in the file or its XMP sidecar, for example ones written by digiKam, Lightroom or XnView, are read first. Any region marked `Type="Face"` with usable coordinates is taken as-is, and if the region carries a `Name`, the matching person is created and the face is labelled automatically. The InsightFace detector then still looks at the photo, because other photo managers usually store regions only for the faces someone tagged there. A detected face that overlaps a region is the same face: it is not added again, and it gives that face its ArcFace embedding. Every other detected face is added as usual. Regions without an overlapping detection get their embedding during the next train or re-scan, so clustering and classification work on them normally.

_Not released yet: up to 1.3.0, a photo with even one face region was not given to the detector at all, so the other people in it were never found, not even by **Re-scan faces**. Run **Re-scan faces** once after updating to find them._

*Not released yet: up to 1.3.0, the face regions of a HEIC or AVIF photo whose EXIF Orientation disagrees with the file's own rotation (for example one turned with **Save to media file** in an earlier version) were read from, and written to, the wrong part of the photo.*

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
- **Cluster Selection Epsilon** (default **0.95**, shown as "Normal") — how readily nearby clusters are merged; a higher value merges more clusters together. Clustering compares face encodings scaled to length 1, so two faces are 0 to 2 apart and two photos of one person about 0.9. **Small** to **Very High** (0.9 to 1.05) merge more and more of one person's clusters; **Very High** can also put look-alikes, such as siblings, into one cluster.

Steps which could be done to improve clustering are combining very similar faces from e.g. a serial recording or photo shoot, to prevent from too many small images to be clustered.

### Face Cluster Merging

We could train a classifier to merge faces, based on previous merge decisions, which could improve the clusters even more.

### Face Classification

Classification matches unknown faces against already known persons. Unlike clustering (which groups all faces from scratch), classification respects your previous labelling input and only tries to match faces to people you've already identified. This makes it much more accurate for large datasets where most persons are already known. You can filter between cluster and classification results in the face dashboard, and see the label probability for each inferred face. Classification probabilities are saved alongside clustering probabilities, so you can compare both approaches.
