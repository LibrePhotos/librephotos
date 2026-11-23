---
title: "Editing photos"
description: "Crop, straighten and adjust your photos in the built-in editor, with a simple and an advanced mode. Your original files are never changed."
sidebar_position: 2.5
---

<Since version="1.7.0" /> LibrePhotos has a photo editor. Crop and straighten a photo, pick a filter, or
work on light and colour with the controls you know from desktop photo editors. The editor has two
modes: **Simple**, with a few plain sliders, and **Advanced**, with every control.

## How editing works

Editing never changes your photo file. An edit is a list of settings that LibrePhotos stores with
the photo. When you save, the server makes an edited copy of the picture from your original and
those settings, and the app shows that copy everywhere: in the grids, in the photo viewer, in
downloads and to the people you share the photo with.

Because the original stays as it is, you can open the editor again at any time to change an edit,
step back through its history, or remove it with **Revert to original...**. The edited copies are
stored in the [`/edits` folder](./internal-files.md#edits) of LibrePhotos' own files, next to the
thumbnails, not in your photo folders.

## Which photos you can edit

- **Your own photos.** Photos someone shares with you, and photos on a public link, have no edit
  button.
- **Still pictures:** JPEG, PNG, HEIC, WebP and the other image formats LibrePhotos shows, and RAW
  files (see [RAW files](#raw-files)).
- **Not videos.**

The editor runs in your browser and needs WebGL 2, which every current browser has. In a browser
without it, the edit button stays visible but does nothing, and its tooltip says *This browser
can't run the editor: it needs WebGL 2*. Turning on hardware acceleration in the browser's settings
often helps.

## Opening the editor

Open a photo in the [photo viewer](./viewing-photos.md#photo-viewer-lightbox) and click the edit
button in the toolbar, next to **Share link** (tooltip *Edit (E)*), or press `e`. On a phone the
button is in the bar at the bottom of the screen. On a photo's own [page](./viewing-photos.md#photo-page),
the **Edit** button under the title opens the editor too. When you close the editor, the focus goes
back to the edit button.

On a photo you already edited, the button is highlighted and its tooltip says *Edit (E). This
photo is edited*. The grids show no badge for edited photos: they show the edited picture.

The editor fills the window. The bar at the top holds the back arrow (*Close (Escape)*), the file
name, the **Simple** | **Advanced** switch, undo and redo, the compare buttons, *Reset all edits*,
the **⋮** (*More actions*) and **Save**. The controls are on the right, or under the photo on a
phone, where the mode switch sits above them and the controls can be hidden to see more of the
photo. The editor remembers the mode you used last in this browser. Both modes change the same
edit, so you can switch at any time without losing anything.

To look closer, scroll or pinch to zoom, drag to move around, and double-click to switch between
the whole photo and 100 %. The corner of the photo shows the zoom, with **Fit** and **100%**.

## Simple mode

Simple mode has three tabs:

| Tab | What you find there |
| --- | --- |
| **Adjust** | **Auto**, then **Brightness**, **Contrast**, **Highlights**, **Shadows**, **Saturation**, **Warmth**, **Tint**, **Sharpness** and **Vignette**. **Reset adjustments** sets them all back. |
| **Filters** | A small preview of the photo with each look: **Original**, **Vivid**, **Warm**, **Cool**, **Fade**, **Matte**, **Punch**, **Golden**, **Cinematic**, **Mono**, **Mono contrast**, **Sepia** and **Film**. **Strength** makes the chosen look weaker or stronger. |
| **Crop & rotate** | The crop frame, **Aspect ratio**, **Straighten**, and **Rotate and flip**. **Reset crop and rotation** takes them back. |

**Auto** sets the light of the photo from its histogram, as a starting point you can change. It
reads the photo as you framed it, so it is not available while the crop tool is open.
**Brightness** covers about two stops each way; a brighter or darker setting made in the advanced
mode's **Exposure** shows as it is, and the slider moves on from there.
Picking a filter replaces the filter you picked before instead of adding to it, and **Original**
takes it off again. A filter never changes the crop.

In **Crop & rotate**, drag the frame, or one of its edges or corners, over the photo. With the frame
selected, the arrow keys move it, and `Shift` + an arrow key moves it further. **Aspect ratio**
locks the frame to **Free** (no lock), **Original** (the photo's own shape), 1:1, 5:4, 7:5, 3:2,
4:3, 16:9 or 16:10; *Swap orientation* turns a ratio between landscape and portrait. **Straighten**
turns the photo by up to 45° either way to level a horizon, and the crop shrinks so no empty corner
shows. The buttons next to **Rotate and flip** are *Rotate left*, *Rotate right*, *Flip
horizontally* and *Flip vertically*. Leave the tab (or press `Escape`) to see the cropped photo
again.

Every slider shows its value in a field you can type into. Double-click a slider or its name to set
it back to where it started.

## Advanced mode

Advanced mode shows the histogram at the top and the controls in sections you can fold open and
closed. A section you changed has a reset button (*Reset* and the section's name) that sets just
that section back.

| Section | What it is for |
| --- | --- |
| Histogram | How the brightness of the edited photo is spread, in red, green, blue and overall. A marker in the left or right top corner lights up when shadows or highlights are clipped to pure black or pure white. |
| **Presets** | The same looks as the **Filters** tab, as a list, with **Strength**. |
| **Light** | **Auto**, **Exposure**, **Contrast**, **Highlights**, **Shadows**, **Whites** and **Blacks**: the brightness of the whole photo and of its bright and dark parts. |
| **Tone curve** | A curve for all channels together (**All**) or for **Red**, **Green** or **Blue** alone. Click the curve to add a point and drag it; double-click a point or drag it off the curve to remove it. |
| **Color** | **Color** or **Black & white** at the top, then the white balance (**Temperature**, **Tint**) and **Vibrance** and **Saturation**. Vibrance strengthens weak colours more than strong ones and spares skin tones. |
| **Color mixer** | One colour band at a time (red, orange, yellow, green, aqua, blue, purple, magenta), with its **Hue**, **Saturation** and **Luminance**. A dot on a band says it holds a change. Shown for colour photos. |
| **B&W mix** | How light or dark each colour band turns in grey. Shown instead of the colour mixer when you chose **Black & white**. |
| **Color grading** | Four colour wheels, **Shadows**, **Midtones**, **Highlights** and **Global**, each with its **Luminance**, to tint the dark, middle and bright parts of the photo. **Blending** sets how far the three ranges overlap and **Balance** moves the split between them. |
| **Effects** | **Texture** and **Clarity** bring out fine detail and mid-size contrast, **Dehaze** cuts through haze (or adds it). **Vignette** darkens or lightens the corners, shaped by **Midpoint**, **Feather** and **Roundness**. **Grain** adds film grain, with **Grain size** and **Roughness**. |
| **Detail** | **Sharpening** with its **Radius**, and **Noise reduction** and **Color noise** for photos taken in low light. |
| **Crop & rotate** | The same crop tool as in simple mode. Opening the section shows the whole photo with the crop frame. |
| **History** | Every step of the edit (see below). |

### Copying an edit to other photos

**Copy settings** and **Paste settings** in the **⋮** (*More actions*) of the editor, or
`Ctrl` + `Shift` + `c` and `Ctrl` + `Shift` + `v`, carry the look of one photo over to another:
everything except the crop, the rotation, the straighten angle and the flips, which belong to the
photo they were made for. Open the next photo in the editor and paste. The copied settings are kept
in this browser only.

## History, undo and redo

Every change is a step: moving a slider, picking a filter, a crop, **Auto**, a paste or a reset.
Undo and redo in the top bar, or `Ctrl` + `z` and `Ctrl` + `Shift` + `z`, go back and forward one
step. The **History** section of advanced mode lists every step, newest at the top and **Original**
at the bottom; click one to go back to it. The steps after it stay listed, dimmed, until you make a
new change.

The history is saved with the edit, up to the last 200 steps. When you open the editor again, on
this or any other device, the history is still there and you can go back to any step.

## Comparing before and after

- **Hold to compare**: hold down the compare button in the top bar (tooltip *Hold to see the photo
  before its adjustments, with its crop and rotation (\)*), or the `\` key, to see the photo without
  its adjustments. It keeps the crop and rotation, so you compare the same framing.
- **Before and after side by side**: the button next to it, or `y`, splits the photo into
  **Before** on the left and **After** on the right. Drag the divider, or move it with the arrow
  keys. The split view is not available while you crop.

## Saving

Nothing changes on the photo until you click **Save**. While the server saves, the editor says
*Saving the edit…* and takes no input, so what is saved is what you see. When the server has
answered, the editor closes, says *Edit saved*, and you are back in the photo viewer:

- The thumbnails and the photo viewer show the edit right away.
- The server makes the edited picture at full size in the background, which can take a few seconds
  for a large photo or a RAW file. Until it is ready, zooming in shows the display-size version,
  with the label *The edited photo is still being prepared at full size*.

If the save fails, the editor says why and stays open with your changes, so you can try again.

If you close the editor (or press `Escape`, go back or follow a link) with changes that are not
saved, it asks *Save your changes?*: **Discard** drops them, **Keep editing** stays in the editor and
**Save** saves them.

*Reset all edits* in the top bar (in the **⋮** on a phone) sets every control back in one step.
Like any step, you can undo it, and it is only kept when you save.

### Reverting to the original

**Revert to original...** in the editor's **⋮** removes the edit for good: its settings, its history
and the edited copies. LibrePhotos asks first (*Revert to the original?*); while it reverts the editor says *Reverting to
the original…*, then the photo shows its original again everywhere. The option is shown once a photo has a saved edit.

Rotating an edited photo with the rotate items in the photo viewer turns its edit, crop included,
and adds the turn to its history.

## Downloads and sharing {#downloads-and-sharing}

On a photo you edited, the photo viewer's **⋮** (*More actions*) and the **Download** button of the
photo's [page](./viewing-photos.md#photo-page) have two downloads:

- **Download edited**: the edited picture at full size, as a JPEG named after the original with
  `-edited` added. It is available once the server has made it.
- **Download original**: your untouched original file.

**Download** from a selection in a grid gives you the original files.

Everyone else only ever gets the edited picture: users you share the photo or an album with, members
of an album, people you [share your library](./sharing.md#sharing-your-whole-library) with, and
visitors of a public link. That holds even when you allow them to download original files, and
while the full-size picture is still being made, when they get the smaller version. The edited
picture carries no metadata from the original file, such as the GPS position.

## RAW files

:::note
A RAW file is developed by the server from the RAW data, with a neutral starting look. While the
editor opens, it shows the photo as the viewer did; the editable picture follows within a second
or two. It can look
different from the JPEG your camera makes, which has the camera maker's own colours and contrast.
There are no lens corrections and no camera profiles yet. RAW data holds more detail in the
highlights than a JPEG, so **Highlights** and **Exposure** can bring back bright areas that look
white at first.

When a photo has a RAW and a JPEG of the same shot ([a RAW+JPEG pair](./stacks-and-file-variants.md#rawjpeg-pairs)),
the editor works on the JPEG, the photo's main file. A RAW file on its own is edited from its RAW
data.
:::

## Faces and recognised text

[Face](./face-recognition.md) boxes follow a crop, a turn or a flip: they stay on the faces, and a
face cropped out keeps its name and comes back when you widen the crop again. Reverting puts the
boxes back where they were.

On a photo whose crop or rotation you changed, **Select text in photo** is not offered, but the text
found in the photo stays searchable.

## When the photo file changes

When a scan finds that the file of an edited photo was replaced on disk:

- **Only its metadata changed** (for example a date written into the file): the edit stays as it is.
- **The same picture, saved again** (for example after a small touch-up in another program): the
  edit is applied to the new file.
- **A different picture**: the edit is removed, because a crop made for one picture does not fit
  another.

## Limits

- No local adjustments: no brushes, masks, healing or red-eye removal. Every control works on the
  whole photo.
- Videos cannot be edited.
- The [mobile app](./mobile/index.md) shows edited photos, but has no editor yet.
- While you edit, the preview is a smaller version of the photo (up to 2560 pixels on the long side).
  The saved photo is made at full size, so very fine detail, such as the effect of sharpening or
  noise reduction, can look slightly different.
- The editor needs WebGL 2 in the browser (see [Which photos you can edit](#which-photos-you-can-edit)).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `e` | Open the editor (in the photo viewer) |
| `Ctrl` + `z` (`⌘` + `z` on macOS) | Undo |
| `Ctrl` + `Shift` + `z` or `Ctrl` + `y` | Redo |
| `\` (hold) | Show the photo without its adjustments |
| `y` | Before and after side by side |
| `Ctrl` + `Shift` + `c` | Copy settings |
| `Ctrl` + `Shift` + `v` | Paste settings |
| Arrow keys | Move the crop frame or the split view's divider; `Shift` moves further |
| `Escape` | Leave the crop tool, or close the editor |

The keys do nothing while you type in a value field.

For how the editor works inside, see the developer page [Photo editing pipeline](../development/photo-editing.md).
