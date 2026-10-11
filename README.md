# Manga Panel Finder

Give it a manga page or panel you saved, and it finds the **best-quality version online**:
the sharpest scan, at the highest real resolution, and the least cropped.
It then helps you save that panel, uncropped, as a lossless PNG ready for coloring.

It runs locally on your computer as a small web app: a Python backend does the searching and
image matching, and you use it from your browser.

## Installing and starting it

You need **Python 3.10 or newer** ([python.org](https://www.python.org/downloads/); on
Windows, tick "Add python.exe to PATH" during setup).

**Windows:** download or clone this repository, then double-click **`Start Panel Finder.bat`**.

**macOS / Linux:**

```bash
python3 -m venv .venv
.venv/bin/python launcher.py
```

- The first start sets itself up (a private Python environment in `.venv`), which takes a
  minute or two. After that it starts in a few seconds.
- Your browser opens at `http://127.0.0.1:8765`. Keep the terminal window open while you use
  it; close it to stop the app.

## Using it

1. **Drop** a page or panel onto the page, paste it with **Ctrl+V**, or paste an image link.
   You can also drag an image straight from another browser tab.
2. It searches **Yandex** (the best engine for finding other sizes of an image), **TinEye**,
   and, if you add a free key, **SauceNAO**. Every hit is downloaded and **checked against your
   image** with feature matching, so you only see real copies of your panel.
3. It searches a **second round** using the best full page it found. This is how a small
   saved crop leads to a 2000×3000 version of the whole page.
4. Results are ranked by **real detail**. Sharpness is measured too, so an upscaled
   (blurry but big) copy doesn't beat a genuinely sharp one.

The three picks at the top:

| Pick | Meaning |
|---|---|
| **Best version** | Most real detail for your panel, whatever the language. |
| **Best with your text** | The best version whose lettering matches yours. |
| **Least cropped** | A sharp version that shows clearly more of the panel or page. |

Badges on each result: *Crisp lines / Soft*, *Looks upscaled*, *Different text* (another
language, a raw, or edits), *+X% more visible* (less cropped than yours), *Colored*,
*Mirrored*, and the JPEG quality.

### Compare & save

- **Compare**: a before/after slider lined up exactly with your image. Scroll to zoom, drag to
  pan, hold **Space** to see yours, press **D** to highlight where the text or art differs,
  and use **←/→** to flip through versions.
- **Crop & save**: the orange box is what gets saved. It already grows out to the panel's
  real borders. Drag it or its handles to adjust, then **Download this crop (PNG)**. Crops are
  cut from the original file and saved losslessly. **Download original file** gives you the
  untouched file.
- Set a **Save-to folder** in Settings to get a one-click "Save crop to my folder" button.

### Tips

- **Focus on one panel…** (left side): if you searched with a full page but only want one
  panel, draw a box around it. Everything is re-ranked for that panel and the crops snap to it.
- **What is it?**: the tool guesses the manga and chapter from where your image was found
  (or from SauceNAO). **Check every MangaDex version** then pulls that chapter in every
  language and scanlation group on MangaDex and finds your page in each.
- **Search by hand**: Google Lens and Bing can't be searched automatically, but these
  buttons open them in a new tab with your image already uploaded. If you find something
  better there, drag the image (or paste its link) back into the
  "Found a version yourself?" bar. It gets checked, compared and cropped like the rest.
- Small or heavily cropped images are harder to find. If a panel crop finds nothing, try the
  full page.

## Settings

- **SauceNAO API key** (optional, free): make an account at <https://saucenao.com>, then copy
  your key from <https://saucenao.com/user.php?page=search-api>. It identifies the manga,
  chapter and page, and can trigger the MangaDex check automatically. Free keys allow about
  100 searches a day.
- **Images to check per round**: more finds more versions but takes longer (default 60).
- **MangaDex languages**: e.g. `en, ja`; leave empty for all.

## Privacy & limits

- Your image is uploaded to the search engines you have switched on (Yandex, TinEye,
  SauceNAO). Nothing else leaves your computer. The app only listens on `127.0.0.1`.
- Searches are kept in `data/jobs` (the last 40) so you can reopen them from **History**.
  Delete them there, or delete the `data` folder.
- Search engines change their pages from time to time. If one stops working, the others
  keep going and its row in "Search progress" shows the error.
- Yandex may occasionally ask for a captcha if you run many searches in a row. Wait a bit,
  or use the "Yandex" button under "Search by hand".
- Yandex and TinEye are used through the same web endpoints their own sites use, not an
  official API. This is meant for personal, low-volume use. Please respect the sites you
  search and the rights of the artists whose work you color.

## Files

- `app.py`: the local web server. `launcher.py` installs requirements, then starts it.
- `finder/engines.py`: Yandex / TinEye / SauceNAO / MangaDex, plus thumbnail-to-original URL tricks.
- `finder/match.py`: SIFT matching, alignment and the "same picture?" check.
- `finder/imaging.py`: decoding, JPEG quality, colour detection, edge-sharpness measure.
- `finder/panels.py`: grows a box out to the panel borders (white or black gutters).
- `finder/pipeline.py`: one search job, start to finish.
- `static/`: the browser interface.

## License

[MIT](LICENSE)
