# YouTube Comment Finder

A static, single-page tool for finding YouTube comments by **phrase**, **commenter username**, or both. It runs entirely in the browser and can be hosted for free on GitHub Pages.

Live site (after Pages is enabled): <https://poppycat1665.github.io/youtubecommentfinder/>

![No build step](https://img.shields.io/badge/build-none-2ea44f) ![Vanilla JS](https://img.shields.io/badge/JS-vanilla-f7df1e) ![License](https://img.shields.io/badge/license-MIT-blue)

## What it does

- **One video** — paste a `youtube.com/watch`, `youtu.be`, Shorts, Live, or bare 11-character video ID link. Comments on that video are scanned.
- **A channel** — leave the video URL empty and enter an `@handle`, channel URL, channel ID, or channel name. The channel's most recent uploads are scanned.
- **Best-effort YouTube-wide** — leave both the video URL and channel empty and provide a phrase. The app searches YouTube for videos matching the phrase, then scans those videos' comments.

Filters can be combined:

- Phrase match, case-insensitive by default (all occurrences highlighted).
- Commenter filter matching display name, handle URL, or channel ID.
- Top-level comments and optionally replies.
- Sort results by as-found, newest, oldest, or most liked.
- Export the current result set to CSV.
- Copy an individual comment to the clipboard.

A demo mode (`Load demo`) shows the interface with sample data and makes **no API calls**.

## Important limitation

The official YouTube Data API v3 has **no endpoint that searches comments across all of YouTube**. There is no global comment index available to this app.

- A **video URL** is exact and reliable.
- A **channel** is reliable for that channel's recent uploads.
- The **no-scope** mode only scans comments on videos returned by a normal YouTube video search for the phrase. It is a shortcut, not a complete search.

The UI states this explicitly so results are not misinterpreted.

## API key setup

You need your own YouTube Data API v3 key. The app is static, so no secret is shipped or stored on a server.

1. Open the [YouTube Data API v3 page](https://console.cloud.google.com/apis/library/youtube.googleapis.com) in Google Cloud Console and enable the API for a project.
2. Open [Credentials](https://console.cloud.google.com/apis/credentials) and create an **API key**.
3. (Recommended) Restrict the key:
   - **API restrictions** → restrict to **YouTube Data API v3**.
   - **Application restrictions** → **Websites**, then add:
     - `https://poppycat1665.github.io/*` for the deployed site
     - `http://localhost:5173/*` for local development
4. Paste the key into the **Connect YouTube** field on the site. It is stored in `localStorage` in your browser only.

The key is sent directly to `googleapis.com`. It is never sent to GitHub Pages, this repository, or any other server. As with any browser-side key, someone with access to your browser profile can read it — use restrictions and monitor quota.

### Quota

The default YouTube Data API quota is **10,000 units per day** per project.

- `search.list` costs **100 units** per call.
- `commentThreads.list`, `replies.list`, `videos.list`, `channels.list`, and `playlistItems.list` cost **1 unit** each.
- The app shows an approximate unit count while it runs.

Scanning a large channel consumes much more quota than scanning one video. Start with 5–10 videos and 100–200 comments per video.

## Run locally

There is no build step and no dependencies.

```bash
# from the repository root
npm test        # runs the Node test suite for lib.js
npm start       # serves the folder at http://localhost:5173
```

`npm start` uses Python's built-in static server. If Python is not available, any static server works, for example:

```bash
npx serve .
# or
python3 -m http.server 5173
```

ES modules require an HTTP server; opening `index.html` directly with `file://` will not work.

### Tests

```bash
npm test
```

The tests cover URL parsing, channel reference parsing, phrase/author matching, highlighting, formatting helpers, comment deep links, and CSV escaping. Tests live in `tests/lib.test.mjs` and use Node's built-in test runner.

## Deploy to GitHub Pages

The repository includes `.github/workflows/pages.yml`, which stages only the static files and deploys them with GitHub's official Pages actions.

1. Push the repository to GitHub.
2. In **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).
4. The site is published at `https://<owner>.github.io/<repo>/`.

> **Private repository caveat:** GitHub Pages for private repositories requires GitHub Pro, Team, or Enterprise. On the GitHub Free plan, make the repository public before enabling Pages.

There is no server-side code, database, or secret in this repository.

## URL parameters

Useful for sharing a pre-filled search:

| Parameter | Example | Meaning |
| --- | --- | --- |
| `url` | `?url=https://youtu.be/dQw4w9WgXcQ` | Pre-fill the video URL |
| `q` | `?q=never%20gonna` | Pre-fill the phrase |
| `author` | `?author=@RickAstleyYT` | Pre-fill the commenter |
| `channel` | `?channel=@RickAstleyYT` | Pre-fill the channel |
| `demo` | `?demo=1` | Load sample results immediately |

Example: `?url=https://youtu.be/dQw4w9WgXcQ&q=never%20gonna`

## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and form |
| `styles.css` | Dark responsive theme |
| `app.js` | YouTube API calls, search orchestration, rendering, CSV export, demo mode |
| `lib.js` | Pure helpers shared with the tests |
| `tests/lib.test.mjs` | Node test suite |
| `.github/workflows/pages.yml` | GitHub Pages deployment |
| `LICENSE` | MIT license |

## Privacy and security notes

- The API key is kept in `localStorage` and sent only to `https://www.googleapis.com`.
- Comment text is inserted into the page with DOM text nodes, never as HTML, so comment content cannot inject markup or scripts.
- External links are opened with `rel="noopener"` and URLs are restricted to `http`/`https`.
- Results are not uploaded anywhere; CSV export happens locally.
- API keys used in client-side code are inherently visible to the person using the browser. Restrict the key and rotate it if it is abused.

## License

MIT

