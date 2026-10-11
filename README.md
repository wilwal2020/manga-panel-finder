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
4. Once it knows **which manga and chapter** it is (worked out from where your image was found,
   or from SauceNAO), it opens that chapter on **manga sites** (WeebCentral, Mangapill and
   MangaDex) and finds your page there. WeebCentral often has the official digital release.
   If your image is a two-page spread and the site stores the pages separately, it **joins the
   two pages** back into one spread.
5. Results are ranked by **real detail**. Sharpness is measured too, so an upscaled
   (blurry but big) copy doesn't beat a genuinely sharp one.

### The results page

The best version is shown big, with how much sharper it is than yours, a few plain-language
notes ("Lettering differs from yours", "Shows 12% more of the image than yours"…) and one
**Save** button. Switch between up to three picks:

| Pick | Meaning |
|---|---|
| **Sharpest** | Most real detail for your image, whatever the language. |
| **Same lettering** | The sharpest version whose lettering matches yours. |
| **Least cropped** | A sharp version that shows clearly more of the panel or page. |

If your own copy is already the best one online, it says so. If a much sharper copy of just
*one panel* of your image exists (common when you search with a full page or spread), it
points that out and offers **Focus on that panel**.

Below that, **All versions** shows every verified copy. Click one to make it the big one.
Small tags mark versions that only show *Part* of your image, have different lettering (*Aあ*),
look *Upscaled*, or are already in *Color*.

### Compare & save

- **Result / Compare with yours**: the preview shows exactly what you'll save, or a slider
  lined up with your image.
- **Full screen** (the ⤢ button): compare with zoom (scroll), pan (drag), hold **Space** to see
  yours, press **D** to highlight where the lettering or art differs, and **←/→** to flip
  through versions.
- **Adjust crop**: the orange box is what gets saved. It already grows out to the panel's real
  borders. Drag it or its handles, or pick *Panel / Same as yours / Whole image*. Crops are cut
  from the original file and saved losslessly as PNG. The **⋯** menu has the untouched
  original file.
- Set a **save folder** in Settings and **Save** puts the PNG straight there.

### Tips

- **Only want one panel?** (under the title): draw a box around the panel you want. Everything
  is re-ranked for that panel and the crops snap to its borders.
- The status pill next to the title (e.g. "21 versions found") opens the search details:
  which sites were searched and the activity log.
- **Not quite it?** at the bottom of the results:
  - **Search other sites** opens Google Lens, Bing and others in a new tab with your image
    already uploaded (they can't be searched automatically).
  - **Check a version you found**: drop an image or paste a link, and it is matched against
    yours and added to the list. You can also just drag an image anywhere onto the page.
  - **Check manga sites** opens the chapter on WeebCentral, Mangapill and MangaDex (every
    language and scanlation group) and finds your page there. It runs by itself when the
    chapter can be worked out; if it can't, type the title and chapter number here.
- Small or heavily cropped images are harder to find. If a panel crop finds nothing, try the
  full page.

## Settings

- **SauceNAO API key** (optional, free): make an account at <https://saucenao.com>, then copy
  your key from <https://saucenao.com/user.php?page=search-api>. It identifies the manga,
  chapter and page, and can trigger the MangaDex check automatically. Free keys allow about
  100 searches a day.
- **Images to check per round**: more finds more versions but takes longer (default 60).
- **Manga sites**: switch WeebCentral, Mangapill and MangaDex on or off, and whether they are
  checked automatically.
- **MangaDex languages**: e.g. `en, ja`; leave empty for all.

## Privacy & limits

- Your image is uploaded to the search engines you have switched on (Yandex, TinEye,
  SauceNAO). Nothing else leaves your computer. The app only listens on `127.0.0.1`.
- Searches are kept in `data/jobs` (the last 40) so you can reopen them from **History**.
  Delete them there, or delete the `data` folder.
- Search engines change their pages from time to time. If one stops working, the others
  keep going and the search details (the status pill) show the error.
- Yandex may occasionally ask for a captcha if you run many searches in a row. Wait a bit,
  or use the "Yandex" button under "Not quite it?".
- Yandex and TinEye are used through the same web endpoints their own sites use, not an
  official API. This is meant for personal, low-volume use. Please respect the sites you
  search and the rights of the artists whose work you color.

## Files

- `app.py`: the local web server. `launcher.py` installs requirements, then starts it.
- `finder/engines.py`: Yandex / TinEye / SauceNAO / MangaDex, plus thumbnail-to-original URL tricks.
- `finder/match.py`: SIFT matching, alignment and the "same picture?" check.
- `finder/imaging.py`: decoding, JPEG quality, colour detection, edge-sharpness measure.
- `finder/panels.py`: grows a box out to the panel borders (white or black gutters).
- `finder/sources.py`: manga reading sites (WeebCentral, Mangapill). Add a site by subclassing `Source`.
- `finder/pipeline.py`: one search job, start to finish.
- `static/`: the browser interface.

## License

[MIT](LICENSE)
