# COSMOS — Space & Ocean AI

A small chat app with two expert personas, powered by LLaMA 3.3 (via Groq) and live data from NASA.

- **NOVA** — space exploration & astrophysics
- **MARINA** — oceanography & marine science

The UI is a vanilla-JS front end; the backend is FastAPI with a local SQLite store for chat history.

## Features

- Two-mode chat UI (space / ocean) with independent session history per mode
- Server-side streaming of model replies, typewriter effect on the client
- Live NASA data: near-Earth objects (NEO feed) and latest Mars Perseverance photos, surfaced in the sidebar
- Astronomy Picture of the Day (APOD) on demand
- Image lookup from the NASA Image and Video Library, surfaced inline next to relevant bot replies
- Session persistence in SQLite — close the tab, come back, pick up where you left off

## Tech stack

- **Backend:** Python 3.10+, FastAPI, Uvicorn, aiosqlite, Groq SDK, httpx
- **Frontend:** Vanilla HTML/CSS/JS, no build step, no framework
- **Storage:** SQLite (`chat_history.db`, gitignored)

## Project structure

```
.
├── server.py              # FastAPI app — chat, sessions, NASA proxy
├── index.html             # Frontend (HTML + CSS + JS in one file)
├── images/                # Static assets (icons, orbs, portraits)
├── requirements.txt
├── .env.example           # Copy to .env and fill in keys
├── .gitignore
├── LICENSE
└── README.md
```

## Setup

```bash
# 1. Clone and enter
git clone <your-repo-url>
cd cosmos

# 2. Create a virtual env
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

# 3. Install deps
pip install -r requirements.txt

# 4. Configure secrets
cp .env.example .env
# Edit .env and set GROQ_API_KEY (and optionally NASA_API_KEY)
```

### Get the API keys you need

| Key | Where | Required? |
| --- | --- | --- |
| `GROQ_API_KEY` | https://console.groq.com/keys | **Yes** |
| `NASA_API_KEY` | https://api.nasa.gov | Optional. Falls back to NASA's `DEMO_KEY` (rate-limited to ~30 req/hour/IP). |

## Run

```bash
python server.py
```

Then open <http://localhost:5000>.

The server:

- Serves `index.html` at `/`
- Serves `images/` at `/images/`
- Exposes the API at `/api/...` (full auto-generated docs at <http://localhost:5000/docs>)

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness probe |
| `POST` | `/api/chat` | Send messages, get a model reply |
| `GET` | `/api/nasa/neo` | Today's near-Earth-object counts |
| `GET` | `/api/nasa/mars` | Latest Mars Perseverance photos |
| `GET` | `/api/nasa/apod` | Astronomy Picture of the Day |
| `GET` | `/api/sessions?mode=space\|ocean` | List recent sessions |
| `POST` | `/api/sessions` | Create a session |
| `GET` | `/api/sessions/{session_id}` | Load a session's messages |
| `DELETE` | `/api/sessions/{session_id}` | Delete a session |

## Security notes

This is a portfolio / demo app, not a production service. Be aware of:

- **No authentication.** Anyone who can reach the server can read, write, and delete any session whose ID they know. Session IDs are random UUIDs (hard to guess, but the server doesn't enforce any per-user boundary).
- **CORS is closed (`allow_origins=[]`)** — the front end is served from the same origin as the API, so cross-site requests from a third-party page can't drive your Groq bill.
- **API keys stay server-side.** The NASA key is never sent to the browser; the FastAPI server proxies all NASA calls. The Groq key is read from `.env` only and never leaves the server.
- **No rate limiting.** A determined client can send unlimited `/api/chat` requests and burn Groq quota. If you expose this beyond localhost, put it behind a reverse proxy with rate limits, or add `slowapi` / similar.
- **DB file is local.** `chat_history.db` is created next to `server.py` and is gitignored. It contains every prompt and reply that has ever been sent to the model through this app — treat it as sensitive.
- **HTML rendering is mostly safe, but be careful extending the front end.** The existing `escapeHtml` and `escapeAttr` helpers cover the current render paths. If you add new code that interpolates user-controlled strings into the DOM, route them through one of those helpers (or, better, use `textContent` / DOM APIs instead of `innerHTML`).

If you fork this and your `.env` or `chat_history.db` is ever exposed, **rotate the Groq key immediately** at https://console.groq.com/keys.

## License

MIT — see `LICENSE`.
