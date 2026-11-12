---
title: "Photo editing pipeline"
description: "The edit recipe a photo's edits are stored as, and the rendering pipeline the web preview and the server rendition both implement."
sidebar_position: 4
---

Photo edits are non-destructive: the original file is never written. An edit is a small JSON **edit recipe** stored next to the photo. Two renderers turn a recipe into pixels and have to agree:

- the **preview** in the browser, WebGL2 shaders in `apps/frontend/src/components/editor/engine`;
- the **rendition** on the server, numpy in `apps/backend/api/editing`, which writes the edited file the rest of the app shows (thumbnails, lightbox, downloads, shares, mobile).

This page is the contract between the two. A change to a formula here changes both renderers and the golden values in the same pull request. The stage order follows [LightCraft](https://github.com/storytold/lightcraft)'s develop pipeline (geometry, scene-linear, tone map, colour, display); the formulas are our own and much simpler.

Backend paths are relative to `apps/backend`, frontend paths to `apps/frontend`.

## Edit recipe

A recipe is sparse: a missing key means its default, and the default recipe (`{"version": 1}`) changes nothing. Unknown keys are rejected. Numbers outside their range are rejected, never clamped silently.

| Group | Key | Range | Default | UI label |
| --- | --- | --- | --- | --- |
| | `version` | `1` | `1` | |
| `geometry` | `orientation` | `0`, `90`, `180`, `270` (clockwise) | `0` | Rotate |
| | `flip_h`, `flip_v` | boolean | `false` | Flip |
| | `straighten` | -45 to 45 degrees | `0` | Straighten |
| | `crop` | `null` or `{cx, cy, w, h}`, each 0 to 1, `w` and `h` above 0 | `null` | Crop |
| | `aspect` | `null`, `"original"`, `"1:1"`, `"4:5"`, `"5:7"`, `"2:3"`, `"4:3"`, `"16:9"`, `"16:10"` and each ratio's inverse (`"5:4"`, ...) | `null` | Aspect ratio (UI lock only) |
| `wb` | `temp`, `tint` | -100 to 100 | `0` | Temperature, Tint |
| `light` | `exposure` | -5 to 5 (stops) | `0` | Exposure |
| | `contrast`, `highlights`, `shadows`, `whites`, `blacks` | -100 to 100 | `0` | same |
| `curve` | `master`, `red`, `green`, `blue` | 2 to 16 points `[x, y]`, each 0 to 1, x strictly increasing | `[[0, 0], [1, 1]]` | Tone curve |
| `color` | `vibrance`, `saturation` | -100 to 100 | `0` | same |
| | `treatment` | `"color"`, `"bw"` | `"color"` | Black & white |
| `mixer` | `red`, `orange`, `yellow`, `green`, `aqua`, `blue`, `purple`, `magenta` | each `{hue, sat, lum}`, -100 to 100 | `0` | Color mixer |
| `bw_mix` | the same eight bands | -100 to 100 | `0` | B&W mix |
| `grading` | `shadows`, `midtones`, `highlights`, `global` | each `{hue: 0 to 360, sat: 0 to 100, lum: -100 to 100}` | `0` | Color grading |
| | `blending` | 0 to 100 | `50` | Blending |
| | `balance` | -100 to 100 | `0` | Balance |
| `effects` | `texture`, `clarity`, `dehaze` | -100 to 100 | `0` | same |
| `vignette` | `amount` | -100 to 100 | `0` | Vignette |
| | `midpoint`, `feather` | 0 to 100 | `50` | Midpoint, Feather |
| | `roundness` | -100 to 100 | `0` | Roundness |
| `grain` | `amount` | 0 to 100 | `0` | Grain |
| | `size` | 0 to 100 | `25` | Size |
| | `roughness` | 0 to 100 | `50` | Roughness |
| | `seed` | integer, 0 to 4294967295 | `0` | |
| `detail` | `sharpen_amount` | 0 to 150 | `0` | Sharpening |
| | `sharpen_radius` | 0.5 to 3 | `1` | Radius |
| | `nr_luminance`, `nr_color` | 0 to 100 | `0` | Noise reduction, Color noise |

The simple mode and the advanced mode of the editor write the same recipe; the simple mode only shows fewer controls.

### History

An edit keeps its history: a list of at most 200 steps and a cursor. A step is the recipe after that step plus what the step did:

```json
{
  "action": "set",
  "control": "light.exposure",
  "value": 0.35,
  "at": "2026-11-12T09:30:00Z",
  "settings": { "version": 1, "light": { "exposure": 0.35 } }
}
```

`action` is one of `set` (one control, named by `control`, with its new `value` when that is a number, boolean or string), `crop`, `preset` (`value` is the preset id), `auto`, `paste`, `reset` and `import`. The UI builds the step's label from `action`, `control` and `value`, so labels are translated when shown, never stored. Going to a step moves the cursor and loads its recipe without adding a step; steps after the cursor stay listed until a new edit drops them. The edit's current recipe is the recipe of the step under the cursor (the default recipe when the cursor is `-1`). When a new step would be the 201st, the oldest one is dropped.

## Sources

The recipe is applied to the photo's **source**: the upright picture (file orientation already applied) in the sRGB primaries.

| Kind | From | Encoding | `max` |
| --- | --- | --- | --- |
| `srgb8` | JPEG, PNG, HEIC, WebP, ... | display-referred, sRGB transfer, 8 bits | `1.0` |
| `linear16` | RAW files, developed with LibRaw | scene-linear, 16 bits, value = `max * (u / 65535) ** 2` | above `1.0`: highlight headroom |

A `linear16` source is the RAW developed by LibRaw with the camera's white balance, clipped highlights, a linear transfer and no automatic brightening, so `1.0` of its output is where the sensor clips. That is multiplied by a fixed base gain of `1.4` (half a stop, about what a camera's own rendering keeps above diffuse white), so `max = 1.4`: the range from `1.0` to `1.4` is the headroom Highlights and Exposure recover, and the roll-off of stage 4.5 folds it into the picture at the default recipe. The preview works on a reduced copy of the source (its long edge at most 2560 pixels); the server renders the full size. Every spatial amount below is relative to the long edge, so both look alike at the same view size.

## Notation

```text
LUMA = (0.2126, 0.7152, 0.0722)            luminance weights of linear sRGB
Y(rgb) = dot(rgb, LUMA)
oetf(x) = 12.92 x                          if x <= 0.0031308
          1.055 x^(1/2.4) - 0.055          otherwise
eotf(e) = e / 12.92                        if e <= 0.04045
          ((e + 0.055) / 1.055)^2.4        otherwise
smoothstep(a, b, x) = t t (3 - 2 t),  t = clamp((x - a) / (b - a), 0, 1)
mix(a, b, t) = a (1 - t) + b t
round(x) = floor(x + 0.5)                  halves go up, as Math.round does
L  = long edge, in pixels, of the picture being rendered (after the crop)
u  = L / 2560                              the relative pixel
```

OkLab is Björn Ottosson's, from and to linear sRGB, with his published matrices; `C = hypot(a, b)` and `h = atan2(b, a)` in degrees, 0 to 360 (`h = 0` when `C = 0`, where `atan2` is undefined in GLSL).

Every texture or array lookup outside the picture clamps to the edge. Every lookup at a fractional position is bilinear.

## Stage 1: geometry

The source has `W0 x H0` pixels. `k = orientation / 90` quarter turns clockwise give the oriented size `W x H` (`H0 x W0` when `k` is odd). The flips mirror the oriented picture. The crop is a rectangle of `w W x h H` pixels centred on `(cx W, cy H)` and turned with the straighten angle `a` (radians, positive turns the picture clockwise on screen).

Without a crop, `cx = cy = 0.5` and `w = h = s`, the largest rectangle of the picture's own aspect that fits inside it at that angle:

```text
s = min(W / (W |cos a| + H |sin a|), H / (W |sin a| + H |cos a|))
```

The full-size output has `Wout = max(1, round(w W))` by `Hout = max(1, round(h H))` pixels; a preview scales both by the same factor. Output pixel `(i, j)` reads the source at:

```text
dx = ((i + 0.5) / Wout - 0.5) w W
dy = ((j + 0.5) / Hout - 0.5) h H
x  = cx W + dx cos a + dy sin a
y  = cy H - dx sin a + dy cos a
if flip_h: x = W - x
if flip_v: y = H - y
k = 0: (xs, ys) = (x, y)
k = 1: (xs, ys) = (y, H0 - x)
k = 2: (xs, ys) = (W0 - x, H0 - y)
k = 3: (xs, ys) = (W0 - y, x)
```

`(xs, ys)` is in source pixels with pixel centres at half integers. The result is converted to linear light (`eotf` for `srgb8`, the square law above for `linear16`) and called `G`. The preview linearises before it interpolates when it can (an sRGB texture); a difference of interpolating first stays under the tolerance.

## Stage 2: noise reduction

Skipped when `nr_luminance` and `nr_color` are both 0. It works on a square-root encoding of `G`:

```text
p  = sqrt(max(G, 0))            per channel
yp = Y(p)
cp = p - yp
```

For the 25 taps `(i, j)`, `i` and `j` from -2 to 2, with `g(i, j) = exp(-(i i + j j) / 4.5)`:

```text
luminance, taps at (i, j) u pixels, al = nr_luminance / 100, sr = 0.004 + 0.06 al
  w   = g(i, j) exp(-(yp_tap - yp)^2 / (2 sr sr))
  yp' = sum(w yp_tap) / sum(w)          when al > 0, else yp
colour, taps at (i, j) 2 u pixels, ac = nr_color / 100
  w   = g(i, j) exp(-(yp_tap - yp)^2 / (2 * 0.08 * 0.08))
  cp' = mix(cp, sum(w cp_tap) / sum(w), ac)
D = max(yp' + cp', 0)^2
```

Without this stage `D = G`.

## Stage 3: planes

Three blurred planes of `D` drive the local stages. A plane is `D` averaged down to the plane size (area average), one value computed per plane pixel, then a Gaussian blur with standard deviation `sigma` plane pixels (separable, kernel radius `ceil(3 sigma)`).

| Plane | Long edge `Lp` | Value | `sigma` | Used by |
| --- | --- | --- | --- | --- |
| `lc` | `min(256, L)` | `log2(max(Y, 0.0001))` | `0.02 Lp` | Highlights, Shadows, Clarity |
| `dk` | `min(256, L)` | `clamp(min(r, g, b), 0, 1)` | `0.02 Lp` | Dehaze |
| `lf` | `min(1024, L)` | `log2(max(Y, 0.0001))` | `0.004 Lp` | Texture |

The short edge of a plane is `max(1, round(Lp * short / long))`. A plane is read at an output pixel's normalised position.

## Stage 4: develop

Per pixel, from `D` (linear) to `e` (display-encoded, 0 to 1). `rgb` starts as the pixel of `D`, and `ly = log2(max(Y(rgb), 0.0001))` is taken from it before anything else.

### 4.1 Dehaze

`a = dehaze / 100`, with `x = min(rgb, 1)` and `rest = rgb - x`:

```text
a > 0:  t = max(1 - 0.6 a dk, 0.4)
        x = max(0, 1 - (1 - x) / t)
a < 0:  t = 1 - 0.6 |a| (0.4 + 0.6 dk)
        x = x t + (1 - t)
rgb = x + rest
```

### 4.2 White balance and exposure

```text
t = temp / 100,  g = tint / 100
k = (2^(0.6 t), 2^(-0.4 g), 2^(-0.6 t))
k = k / dot(k, LUMA)
gain = 2^exposure
rgb  = rgb k gain
M    = max(1, source.max * max(k.r, k.g, k.b) * gain)
```

`M` is the largest value a channel can have here. `k`, `gain` and `M` are computed once per render.

### 4.3 Highlights and shadows

```text
dblur = clamp(2^lc gain, 0, 1)^(1 / 2.2)
dpix  = clamp(Y(rgb), 0, 1)^(1 / 2.2)
d     = clamp(dblur, dpix - 0.05, dpix + 0.05)
ws    = 1 - smoothstep(0, 0.5, d)
wh    = smoothstep(0.5, 1, d)
hl    = highlights / 100
keep  = 1 - min(max(r, g, b) / M, 1)^8        if hl < 0, else 1
rgb   = rgb 2^(1.5 (shadows / 100) ws + 0.9 hl wh keep)
```

`d` is the brightness of the pixel's surroundings, held within 0.05 of the pixel's own so that the edge between a dark object and a bright one gets no halo or bright rim (the smoothsteps are steep there, so a wider band shows as a light band along the edge). `keep` (from `r`, `g`, `b` after 4.2) leaves alone what is already at the clip level: pulling Highlights down darkens bright areas, and a blown highlight stays white instead of turning grey.

### 4.4 Clarity and texture

```text
dc   = soft(ly - lc)
dt   = soft(ly - lf)
soft(x) = x / (1 + 1.5 |x|)
dpix = clamp(Y(rgb), 0, 1)^(1 / 2.2)
m    = 1 - (2 dpix - 1)^2
rgb  = rgb 2^(0.9 (clarity / 100) dc m + 1.2 (texture / 100) dt (0.5 + 0.5 m))
```

`soft` keeps small differences as they are and limits large ones, so fine structure gains contrast while a strong edge gets no glow.

### 4.5 Highlight roll-off and encoding

Per channel `c`, with the knee `K = 0.8`:

```text
c = clamp(c, 0, M)
if M > 1 and c > K:
    t = (c - K) / (M - K)
    p = (M - K) / (1 - K)
    c = K + (1 - K) (1 - (1 - t)^p)
c = clamp(c, 0, 1)
e = oetf(c)
```

With `M = 1` this is a plain clamp, so an unedited `srgb8` picture is unchanged.

### 4.6 Light table

`e = light(e)` per channel, a table of 1024 entries (`x = i / 1023`, linear lookup) built from Whites, Blacks and Contrast:

```text
b = blacks / 100,  w = whites / 100,  c = contrast / 100
x1 = clamp(x + 0.15 b (1 - x)^3 + 0.15 w x^3, 0, 1)
q  = 2^(0.75 c)
x2 = 0.5 (2 x1)^q                 if x1 < 0.5
     1 - 0.5 (2 (1 - x1))^q       otherwise
```

### 4.7 Colour

`(Lk, A, B) = oklab(eotf(e))`, with `C` and `h` from `A` and `B`.

The hue table has 360 entries (`h = i` degrees, linear lookup, wrapping at 360) of four values `(dh, ds, dl, bw)`. The bands sit at these hues:

```text
red 29, orange 55, yellow 105, green 142, aqua 195, blue 262, purple 298, magenta 330
```

A hue between two neighbouring bands (going round the circle, magenta to red included) weighs them linearly by its distance to each, and:

```text
dh = sum(weight mixer.band.hue) / 100 * 30        degrees
ds = sum(weight mixer.band.sat) / 100
dl = sum(weight mixer.band.lum) / 100
bw = sum(weight bw_mix.band) / 100
```

Then, with `mc = smoothstep(0, 0.05, C)` and `ml = smoothstep(0, 0.12, C)`:

```text
treatment "color":
    h  = h + dh mc
    C  = C (1 + ds mc)
    Lk = Lk (1 + 0.35 dl ml)
    skin = exp(-(hue_distance(h, 55) / 25)^2)                 hue_distance in degrees, 0 to 180
    C  = C (1 + 0.7 (vibrance / 100) (1 - smoothstep(0, 0.25, C)) (1 - 0.8 skin))
    C  = C (1 + saturation / 100)
treatment "bw":
    Lk = Lk (1 + 0.5 bw ml)
    C  = 0
```

Color grading tints by lightness. Each wheel is a vector `v = (sat / 100) (cos hue, sin hue)`:

```text
p  = 0.5 - 0.25 balance / 100
dd = 0.05 + 0.25 blending / 100
ws = 1 - smoothstep(p - 0.25 - dd, p - 0.25 + dd, Lk)
wh = smoothstep(p + 0.25 - dd, p + 0.25 + dd, Lk)
wm = max(0, 1 - ws - wh)
protect = clamp(Lk / 0.08, 0, 1) clamp((1 - Lk) / 0.04, 0, 1)
(A, B) = C (cos h, sin h) + 0.10 protect (ws v_shadows + wm v_midtones + wh v_highlights + v_global)
Lk = Lk + 0.2 protect (ws lum_shadows + wm lum_midtones + wh lum_highlights + lum_global) / 100
e  = oetf(clamp(oklab_to_linear_srgb(Lk, A, B), 0, 1))
```

The colour stage is skipped when Vibrance, Saturation, the mixer, the B&W mix and the grading are all at their defaults and the treatment is `"color"`.

### 4.8 Tone curve table

`e = curve(e)` per channel, a table of 1024 entries (`x = i / 1023`, linear lookup) with three channels: the channel's own curve applied after the master curve, `curve_c(master(x))`, clamped to 0 to 1. A curve passes through its points with a monotone cubic (Fritsch and Carlson):

```text
h_k = x_(k+1) - x_k,  s_k = (y_(k+1) - y_k) / h_k
tangent at an inner point k:
    0                                       if s_(k-1) s_k <= 0
    (w1 + w2) / (w1 / s_(k-1) + w2 / s_k)   otherwise, w1 = 2 h_k + h_(k-1), w2 = h_k + 2 h_(k-1)
tangent at the first point: s_0;  at the last point: s_(n-2)
between two points: the cubic Hermite segment of those values and tangents
left of the first point: y_0;  right of the last point: y_(n-1)
```

## Stage 5: finish

On the display-encoded picture `E` that stage 4 produced, `Ye = Y(e)`.

### 5.1 Sharpening

Skipped when `sharpen_amount` is 0. With `sigma = 0.8 sharpen_radius u` pixels and the 25 taps `(i, j)` at `(i, j) sigma` pixels, weighted `exp(-(i i + j j) / 2)` and normalised:

```text
blur = sum(weight Ye_tap)
e    = clamp(e + 1.2 (sharpen_amount / 100) (Ye - blur), 0, 1)        the same amount on each channel
```

### 5.2 Vignette

Skipped when `amount` is 0. `(qx, qy) = (2 uvx - 1, 2 uvy - 1)` for the pixel's normalised position `uv = ((i + 0.5) / Wout, (j + 0.5) / Hout)` (its centre), `ar = Wout / Hout`, `r = roundness / 100`:

```text
r > 0, ar > 1:  qx = qx mix(1, ar, r)
r > 0, ar < 1:  qy = qy mix(1, 1 / ar, r)
n  = 2 - 6 min(r, 0)
d  = (|qx|^n + |qy|^n)^(1 / n)
r0 = 0.2 + midpoint / 100
r1 = r0 + 0.2 + feather / 100
v  = smoothstep(r0, r1, d)
a  = amount / 100
a < 0:  e = e (1 + 0.85 a v)
a > 0:  e = e + (1 - e) 0.85 a v
```

### 5.3 Grain

Skipped when `amount` is 0. Value noise on a grid of `F = 2560 / (1 + 3 size / 100)` cells along the long edge, so the pattern is the same at every render size:

```text
(gx, gy) = (uvx F Wout / L, uvy F Hout / L)
hash(ix, iy) on unsigned 32-bit integers, wrapping:
    n = ix * 0x8da6b343 ^ iy * 0xd8163841 ^ seed * 0xcb1ab31f
    n = n ^ (n >> 15);  n = n * 0x2c1b3c6d
    n = n ^ (n >> 12);  n = n * 0x297a2d39
    n = n ^ (n >> 15)
    value = n / 4294967295 * 2 - 1
noise(gx, gy) = bilinear mix of hash at the four cell corners around (gx, gy)
rough = roughness / 100
n = (1 - 0.5 rough) noise(gx, gy) + 0.5 rough noise(2 gx + 17, 2 gy + 31)
e = clamp(e + 0.18 (amount / 100) n sqrt(clamp(4 Ye (1 - Ye), 0, 1)), 0, 1)        the same amount on each channel
```

`Ye` here is taken after the vignette.

## Before view

"Before" is the recipe with only its `geometry` group kept, so the framing matches the edited picture.

## Storage and API

An edit is one `PhotoEdit` row per photo (`api/models/photo_edit.py`): the recipe, the history, the cursor, a `version`, the state of the rendition and, while the edit changes the geometry, the face boxes on the unedited picture (below). Only the photo's owner reads or writes it; anyone else gets the 404 of an unknown photo.

`version` goes up by one on every save and on every revert, and never goes back: clients put it into media URLs that are cached for a year, so a number names one picture of a photo for good. A revert therefore resets the row instead of deleting it; the row goes only with its photo.

| Route | Does |
| --- | --- |
| `GET /api/photos/<photo_id>/edit/` | The photo's edit. A photo that was never edited answers the default recipe with `version` 0 and `updated_at` `null`; no row is made. A reverted photo answers the default recipe with its last `version`. |
| `PUT /api/photos/<photo_id>/edit/` | Saves `{settings, history, history_cursor}` and renders; answers the edit. |
| `DELETE /api/photos/<photo_id>/edit/` | Reverts the photo to its original: the default recipe, an empty history, the cursor at `-1`, rendition `none`, its files removed, the thumbnails and the face boxes of the original back, and `version` up by one. A later save goes on from that version. 204, also for a photo never edited, which keeps no row. |
| `GET /api/photos/<photo_id>/edit/source/` | The reduced source the preview works on, as an edit source file (below). |

```json
{
  "photo_id": "4f1c2d3e-0000-4000-8000-000000000001",
  "settings": { "version": 1, "light": { "exposure": 0.35 } },
  "history": [],
  "history_cursor": -1,
  "version": 3,
  "rendition": "pending",
  "updated_at": "2026-11-12T09:30:00Z"
}
```

`rendition` is `none` (no edit, a revert, or a recipe that changes nothing), `pending`, `ready` or `failed`. The recipes are stored and answered in their sparse normal form (`recipe_to_json`): a value at its default is left out, whatever the request wrote out. A photo has something to revert when its `history` is not empty or its `settings` are not the default recipe; a `version` above 0 only says that it was edited at some point.

A `PUT` is refused with a 400 whose `errors` entry names the field at fault:

| Code | Field | When |
| --- | --- | --- |
| `invalid_recipe` | the dotted path, `settings.light.exposure`, `history.3.settings.curve.master` | the recipe parser refuses a recipe (unknown key, out of range, not a finite number or too large for a float, a curve's points) |
| `invalid_history` | `history` | it is not a list |
| `too_many_steps` | `history` | more than 200 steps |
| `too_large` | `history` | over 2 MB of JSON |
| `invalid_step` | `history.<i>` or `history.<i>.<key>` | a step that is not an object, has another key, an `action` outside the list, a `control` that is not a dotted path of at most 64 characters, a `value` that is not a finite number, a boolean or a string of at most 64 characters, an `at` that is not an ISO 8601 timestamp |
| `invalid_cursor` | `history_cursor` | above the last step (`-1` with an empty history) |
| `settings_mismatch` | `settings` | `settings` is not the recipe of the step under the cursor (the default recipe at `-1`), compared as recipes |
| `not_editable` | `non_field_errors` | the photo is a video |
| `not_decodable` | `non_field_errors` | the file cannot be read as a picture |

With an empty history `settings` stands alone. A photo whose file is not on disk is a 404 `file_missing` on `PUT` and on the source route.

A save does two renders. The first one runs in the request at the size the big thumbnail needs (its long edge at most 2048 pixels, never larger than the source), and the thumbnails are regenerated from it, so the edit shows everywhere as soon as the save returns. The source it renders from is loaded with its long edge at most 4096 pixels, so the first render of a tiny crop comes out smaller and the rendition makes the thumbnails again. The second render runs in a background task at full size and writes the rendition, a JPEG (quality 92, sRGB, no metadata) at `protected_media/edits/<image_hash>.jpg`. The task marks the row `ready` with one update conditional on its version, then puts the file in place, in one transaction: a task whose version is no longer the edit's (after a newer save, a revert or the photo's deletion) writes nothing. A failed one leaves `failed`, and the thumbnails keep the first render. A recipe that changes nothing has no rendition: the thumbnails come from the original again and the history stays.

The first render is kept until the rendition is ready, as `protected_media/edits/<image_hash>.preview.jpg`. Whatever regenerates a photo's thumbnails (a rotation, a regenerate job, a new big thumbnail height, a rescan) makes them from the rendition when it is ready, else from that file (`api/editing/thumbnail_source.py`), so nothing renders the recipe again only to make a thumbnail; the photo's rotation is in both already. When the first render was smaller than the big thumbnail wants, the thumbnails are made again once the rendition is ready. The perceptual hash stays the original's, which is what a rescan compares the file with.

The first render and the thumbnails are replaced inside the save's transaction, each replaced file kept beside it until the transaction commits (`DiskChange` in `api/editing/files.py`). When the save fails at any step, they are put back as they were; when the photo was deleted meanwhile, they are removed. The old rendition and the share copies go once the save commits.

### Who gets which picture

`/media/photos/<image_hash>` of an edited photo, a still whose recipe changes something, never hands its original to anyone but its owner:

| Requester | `?original=1` | Gets |
| --- | --- | --- |
| the owner | no | the edited picture |
| the owner | yes | the original file |
| anyone else: a direct share, an album member, a library share with or without originals, a public link | either | the edited picture; the parameter is ignored, never an error |

The edited picture is the rendition when it is `ready`, else the first render (while `pending`, and after `failed`), else a rendition of an earlier version still on disk; a lost first render is made again, and an edit none of whose files can be made answers 404, never the original. A library share without originals, a public link without every switch on and an album that keeps originals back get their metadata-free copy made from that same edited picture. A copy is named after the version and the file it was made from (`<image_hash>.edit3.jpg`, `<image_hash>.edit3-preview.jpg`), so a copy of another picture of the photo is never served, and every save and revert clears the copies once it commits. A photo whose recipe changes nothing serves its original as before, and so do videos; zip downloads and the downloads of a photo's files are its owner's only and use the original files.

### Grid thumbnails

The photo summaries the grids list carry `thumbnail_version`: the edit's `version`, 0 for a photo without an edit row. The web grid adds `?v=` to its tile URLs, a digest of the ThumbHash and `thumbnail_version` together (`withThumbhashVersion` in `src/components/react-pig/utils/thumbhashDataUrl.ts`), and the server lets the browser keep a versioned thumbnail for a year. A subtle edit such as sharpening or grain may leave the ThumbHash as it was; the version still changes, so the tile URL does. A photo without an edit keeps the URL it always had.

### Rotations, face boxes and replaced files

Rotating an edited photo (`POST /api/photosedit/rotate/`) turns its recipe instead of `local_orientation`, whose frame the crop is expressed in: the orientation, the flips, the crop's centre and size and the aspect lock turn with the picture (`turn_geometry` and `mirror_geometry` in `api/editing/geometry.py`), a `set` step of `geometry.orientation` (or `geometry.flip_h`) is added after the cursor, and the photo is saved and rendered again. A photo without an edit, or whose edit changes nothing, rotates as before.

The photo detail (`GET /api/photos/<image_hash>/`) carries `edit`, for the photo's owner only: `null` for a photo without a rendition (no edit, a revert, or one that changes nothing), else `{version, rendition, width, height}` with the size of the edited picture at full size. Clients add `?v=<version>` to a thumbnail or full-size URL of an edited photo so a cached picture of an earlier version is not shown; the full-size picture changes once more when `rendition` turns `ready`.

Face boxes are stored in pixels of the big thumbnail, which shows the edit. While the edit changes the geometry, `PhotoEdit.face_boxes` keeps each face's box on the unedited picture, keyed by the face's id (`api/editing/faces.py`):

```json
{
  "42": {
    "unedited": [0.25, 0.25, 0.5, 0.5],
    "shown": [0, 0, 30, 20],
    "original": [30, 20, 60, 40],
    "size": [120, 80]
  }
}
```

`unedited` is `[left, top, right, bottom]`, 0 to 1 across the upright source, and every shown box is derived from it through the current geometry, clamped to the picture: a box left entirely outside the crop keeps its face, one pixel wide at the edge it left by, and comes back whole with the next crop that shows it. `shown` is the box last written to the face. A face whose box no longer matches it (moved or resized by the user), or that has no entry (found or drawn while the photo is edited), is taken back onto the unedited picture from its box, unclamped, the next time the boxes are placed. `original` and `size` are the face's box and the big thumbnail's size before the first geometry edit: a revert, a reset or a save without a geometry change puts that box back exactly and empties the map. Entries of deleted faces are dropped. Face regions read from the file are of the unedited picture too and are placed on the big thumbnail the same way, and the regions written back to the file are the faces' unedited boxes (`to_original_box`). The positions of recognised text are left out for a photo whose edit changes the geometry (the text stays searchable).

When a scan finds the file of an edited photo replaced (`rekey_replaced_file` in `api/directory_watcher/file_handlers.py`), the edit follows the verdict:

| Verdict | The edit |
| --- | --- |
| the same picture (a metadata write) | kept as it is |
| a similar picture (saved again) or one that cannot be compared | rendered again from the new file: a new version, a new first render and thumbnails, the rendition queued, the old rendition removed; `failed`, its files removed, when the new file cannot be rendered |
| a new picture | reset like a revert, its files under the old hash removed: a crop made for another picture is not applied to this one; the thumbnails are made from the new original |

Deleting a photo deletes its edit and both files.

### Edit source file

`GET .../edit/source/` answers `application/octet-stream` with `Cache-Control: private, no-cache` and an `ETag` that changes with the file and the photo's rotation (a matching `If-None-Match` is a 304):

```text
bytes 0-3    "LPES"
byte  4      format version, 1
byte  5      kind: 0 = srgb8, 1 = linear16
bytes 6-7    0
bytes 8-11   length N of the header, unsigned 32-bit little-endian
bytes 12...  the header, N bytes of UTF-8 JSON:
             {"kind", "width", "height", "full_width", "full_height", "max"}
then         the payload, to the end of the file
```

`width` and `height` are the size of the payload picture, `full_width` and `full_height` the size of the full source (both upright). The payload of an `srgb8` source is a JPEG (quality 95, no chroma subsampling, no metadata, long edge at most 2560). The payload of a `linear16` source (long edge at most 2048) is a zlib stream of six planes of `width * height` bytes each, in the order red high bytes, red low bytes, green high, green low, blue high, blue low. A channel's values are `u = round(65535 * sqrt(clamp(v, 0, max) / max))` with the low four bits cleared, then replaced along each row by the difference to the pixel on their left (modulo 65536; the first pixel of a row keeps its value) before they are split into bytes.

## Agreement between the renderers

- The light table, the tone curve table, the hue table and the white balance values are computed by plain functions on both sides (`api/editing/tables.py`, `src/components/editor/engine/tables.ts`). `api/editing/testdata/goldens.json` holds their values for a set of recipes; the backend suite fails when the file is stale and the frontend suite fails when its tables differ from it by more than `1e-4`.
- The same file holds per-pixel cases (input colour, recipe, expected output) for stage 4 and for the vignette and the grain, checked by the backend suite and by the editor's browser test.
- Per-pixel stages agree within 2/255. The spatial stages (noise reduction, planes, sharpening) use the same definitions on different resampling code and are only compared by eye.

### Golden file

`api/editing/testdata/goldens.json` is written by `python -m api.editing.goldens --write` (from `apps/backend`), computed in float64 and rounded to 6 decimals. Its keys:

| Key | Holds |
| --- | --- |
| `format` | `1` |
| `table_indices` | the 65 table entries sampled, `round(k * 1023 / 64)` for `k` from 0 to 64 |
| `hue_degrees` | the hue table entries sampled: every 5th degree, 0 to 355 |
| `pixel_inputs` | per `source_max` (`1.0` and `1.4`), the stage 4 inputs: `{rgb, lc, lf, dk}`, a linear colour and the plane values it is developed with |
| `cases` | stage 4 cases: `{name, recipe, light, curve, hue, runs}` |
| `finish_points` | the stage 5 inputs: `{uv, e}`, a normalised position and a display-encoded colour |
| `finish_cases` | vignette and grain cases: `{name, recipe, runs}` |

In a stage 4 case, `recipe` is the sparse recipe, `light` the light table at `table_indices` (a list of 65 numbers), `curve` the tone curve table there (65 `[r, g, b]`) and `hue` the hue table at `hue_degrees` (72 `[dh, ds, dl, bw]`). A table that is the identity (`light`, `curve`) or all zero (`hue`) for that recipe is `null`. Each of its `runs` is `{source_max, wb: {k, gain, M}, e}`, where `e` lists, in the order of that `source_max`'s `pixel_inputs`, the `[r, g, b]` stage 4 produces. Geometry, noise reduction and sharpening have no golden values, being spatial.

In a finish case each run is `{width, height, e}`: the output size (`Wout`, `Hout`, which the vignette's aspect and the grain cells depend on) and, in the order of `finish_points`, the colour after the vignette and then the grain (`Ye` of the grain taken after the vignette), each applied only when its `amount` is not 0.
