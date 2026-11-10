# Overlay Sheet Picker

**Use it online: <https://midlou.com/source-engine-overlay-sheet-picker/>**

A browser tool for Source engine mappers. Open an overlay **sheet** (one texture holding many stickers), click the sticker you want, and get the `StartU`, `EndU`, `StartV` and `EndV` values to type into Hammer's `info_overlay`. No more cropping by trial and error.

It runs entirely in the browser. Files are decoded locally and never uploaded.

## The problem

A single `.vmt`/`.vtf` can hold many decals or signs packed together, which saves texture memory and materials. Hammer has no way to pick one sticker from such a sheet: you place an `info_overlay` with the sheet's material and then crop it by hand with four numbers, each between 0 and 1:

| Keyvalue | Hammer label | Meaning |
|---|---|---|
| `StartU` | U Start | one horizontal edge of the crop |
| `EndU` | U End | the other horizontal edge |
| `StartV` | V Start | one vertical edge |
| `EndV` | V End | the other vertical edge |

U runs from 0 at the left edge of the texture to 1 at the right edge. V runs from 0 at the top to 1 at the bottom. Working these out by eye for a sheet of 40 stickers is slow and error-prone.

## Using it

1. **Open a sheet.** Use **Open sheet…** or drag a file onto the page. A built-in example sheet is shown until you do.
2. **Select a sticker**, in one of three ways:
   - **Grid mode:** set the columns and rows, then click a cell. Drag across cells for a sticker that spans several. Arrow keys move the selection.
   - **Free mode:** drag a rectangle. It snaps to whole pixels, and you can adjust it with the X, Y, W and H fields.
   - **Auto-detect:** press **Detect regions** to find every sticker automatically (see [How detection works](#how-detection-works)). Then click a sticker to select it.
3. **Match the face orientation.** Place the overlay in Hammer first and look at the U Start and V Start it gets by default. Pick the matching option under **Hammer's default values on this face** (see [Face orientation](#face-orientation)).
4. **Copy the values** into the overlay's properties. Each value has its own Copy button. **Copy keyvalues** copies a block in `.vmf` syntax:
   ```
   "material" "overlays/sheet_3"
   "StartU" "0.003418"
   "EndU" "0.20752"
   "StartV" "0.004883"
   "EndV" "0.108398"
   ```

Tick **Show help** in the top bar to show short explanations under the settings. They're hidden by default, and the choice is remembered.

### Saving your work

Name a selection and press **Save** to keep it as a region. Regions and settings are remembered per file name in your browser (`localStorage`). **Copy JSON** exports everything, including each region's UV values, and **Load JSON…** imports it again, for example on another computer.

In Free mode you can Shift+click several regions and press **Merge** to join them into one. The Delete key removes the selected region.

### Supported files

| Format | Notes |
|---|---|
| `.vtf` | VTF 7.0–7.5. Formats DXT1, DXT1 with one-bit alpha, DXT3, DXT5, RGBA8888, ABGR8888, ARGB8888, BGRA8888, BGRX8888, RGB888, BGR888, I8, IA88 and A8. Reads the largest mipmap of the first frame. |
| `.tga` | Uncompressed and RLE, 8-bit grayscale and 24/32-bit color. |
| `.png`, `.jpg`, `.webp`, `.bmp`, `.gif` | Decoded by the browser. |

The VTF format doesn't need to match the source image exactly: UV values are fractions of the sheet size, so a 1024×512 TGA and the 1024×512 VTF made from it give the same values.

## Face orientation

When you place an overlay, Hammer fills in default UV values of 0 and 1, but **the order depends on which way the face points**. On one wall you might get `U Start = 0, U End = 1`, and on the opposite wall `U Start = 1, U End = 0`. That reversal keeps the texture from appearing mirrored on that face.

VBSP copies the four values into the map exactly as entered. So if you crop with `StartU < EndU` on a face where Hammer's default was `StartU = 1`, the sticker comes out mirrored.

The **Hammer's default values on this face** setting fixes this. Pick the option that matches what Hammer showed:

| Option | Hammer showed | The picker outputs |
|---|---|---|
| U 0→1 · V 0→1 | `U Start 0, U End 1, V Start 0, V End 1` | left, right, top, bottom |
| U 1→0 · V 0→1 | `U Start 1, U End 0, V Start 0, V End 1` | right, left, top, bottom |
| U 0→1 · V 1→0 | `U Start 0, U End 1, V Start 1, V End 0` | left, right, bottom, top |
| U 1→0 · V 1→0 | `U Start 1, U End 0, V Start 1, V End 0` | right, left, bottom, top |

With the whole sheet selected and the inset at 0, each option reproduces Hammer's defaults exactly.

## How the UV values are computed

For a selection at pixel position `(x, y)` with size `w × h` on a sheet of `W × H` pixels:

```
left   = (x + inset)     / W
right  = (x + w - inset) / W
top    = (y + inset)     / H
bottom = (y + h - inset) / H
```

Then `StartU`/`EndU` are `left`/`right` (swapped when U is reversed), and `StartV`/`EndV` are `top`/`bottom` (swapped when V is reversed).

The **inset** (0.5 px by default) pulls each edge half a texel inward. Without it, texture filtering at the edge of the crop blends in pixels from the neighbouring sticker, which shows as a thin colored line. Set it to 0 if you want the exact pixel edges.

The panel also shows the selection's size in Hammer units at the default texture scale of 0.25, as a guide for sizing the overlay.

## How detection works

**Detect regions** finds every separate sticker on the sheet, whatever the layout. Sheets often aren't a regular grid: plaques of different sizes are packed together, some rotated. Detection doesn't try to recognise shapes. It looks for groups of touching pixels that aren't background and takes their bounding boxes. The code is in [`js/detect.js`](js/detect.js) and runs in five steps.

### 1. Foreground mask

Every pixel is marked as *sticker* or *background*:

- **Transparent background** (the default): a pixel is sticker when its alpha is above the **threshold** (16 out of 255). The threshold ignores faint semi-transparent fringes.
- **Solid color**: for sheets without an alpha channel. The top-left pixel is taken as the background color, and a pixel is sticker when any of its R, G or B channels differs from it by more than the threshold.

### 2. Connected components

The mask is scanned row by row. Each time the scan reaches a sticker pixel that hasn't been visited yet, a **flood fill** starts there. It visits every sticker pixel reachable through its four direct neighbours (up, down, left, right) and keeps track of the smallest and largest x and y it reaches. That gives one shape's bounding box.

```
mask                 shapes found
. . . . . . . .
. # # . . # . .      A = columns 1–2, rows 1–3
. # # . . # # .      B = columns 5–6, rows 1–2
. # . . . . . .
```

The flood fill uses an explicit stack in a typed array instead of recursion, so a large sticker can't overflow the call stack. Each pixel is visited at most once, so this step takes time proportional to the number of pixels. A 1024×1024 sheet takes a few tens of milliseconds.

### 3. Merging nearby shapes

Some stickers are made of several separate pieces: the letters of "NO PARKING", or a symbol with a separate dot. Each piece is its own shape after step 2. The **merge gap** joins any two boxes that are at most that many pixels apart horizontally *and* vertically. Overlapping boxes are always joined, whatever the gap.

The gap between two boxes on one axis is `max(startB - endA - 1, startA - endB - 1)`, using inclusive pixel coordinates. A box ending at x = 10 and one starting at x = 12 have a gap of 1. A merged box is bigger than its parts, so it may now be close to boxes that neither part was close to. The merge therefore repeats until a full pass joins nothing.

Choosing the gap:

- **0** (the default) suits tightly packed sheets. Plaques only 1 px apart stay separate.
- **Higher values** join loose parts, but they also join separate stickers that sit closer together than the gap. When the stickers on a sheet are about as close to each other as the pieces inside one sticker are, no single gap value works. Keep the gap at 0 and merge those pieces by hand: click one, Shift+click the others, then press **Merge**.

### 4. Clean-up

Boxes narrower or shorter than **min size** are dropped, to ignore specks and stray pixels. The others are grown by **padding** pixels and clipped to the sheet. Keep the padding at 0 on tightly packed sheets, where even 1 px would reach into the neighbouring sticker.

### 5. Reading order

Regions are sorted the way you read: rows from top to bottom, then left to right inside each row. A region joins the current row when its top edge is within half the height of the row's first region. They are named after the material, for example `sheet_3_01`, `sheet_3_02` and so on.

After detection, changing any detection setting re-runs it immediately, so you can tune the values while watching the result. This stops as soon as you edit a region by hand, so your changes aren't overwritten. **Undo detect** brings back the regions you had before.

## Running it locally

The page uses JavaScript modules, which browsers don't load from `file://` URLs. Serve the folder with any static web server, for example:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Publishing on GitHub Pages

There's no build step: the repository is the website.

1. Push the files to a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select your branch (for example `main`) and the `/ (root)` folder, then save.
4. After a minute the tool is live at `https://<your-user>.github.io/<repository>/`.

## Project structure

```
index.html             page layout
css/style.css          styles and the light/dark color tokens
js/main.js             entry point: wires everything together, file open, drag and drop
js/state.js            shared state, change notification, saving to localStorage
js/actions.js          everything the user can do: select, save, merge, delete, detect
js/viewer.js           draws the sheet, zoom, mouse and keyboard input
js/panel.js            the settings panel: fields, buttons, UV values, region list
js/uv.js               pixel rectangle → StartU/EndU/StartV/EndV
js/detect.js           automatic sticker detection
js/feedback.js         toast messages and clipboard copying
js/sample-sheet.js     the built-in example sheet
js/loaders/index.js    picks a decoder for each file type
js/loaders/vtf.js      Valve Texture Format reader
js/loaders/dxt.js      DXT1/DXT3/DXT5 block decompression
js/loaders/tga.js      TGA reader
```

The code has no dependencies. `actions.js` changes the state and calls `notifyChange()`, and `main.js` then redraws the viewer and the panel. `detect.js`, `uv.js` and the loaders are plain functions with no DOM access, so they can be tested on their own.

## Browser support

Any current version of Chrome, Edge, Firefox or Safari. Copy buttons need a secure page (`https://` or `localhost`). On a plain `http://` address the text is shown selected so you can press Ctrl+C instead.

## Credits

- [Midlou](https://github.com/Midlou): author
- [ALIEN31ITA](https://github.com/ALIEN31ITA): contributor

## License

[MIT](LICENSE) © 2026 Midlou
