import os
import re
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
import aiosqlite
import groq as groq_module
import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from groq import AsyncGroq
from pydantic import BaseModel, Field

# ── CONFIG ──
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY not found — check your .env file")


NASA_API_KEY = os.getenv("NASA_API_KEY", "DEMO_KEY")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "chat_history.db")

VALID_MODES = {"space", "ocean"}
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")

groq_client = AsyncGroq(api_key=GROQ_API_KEY)

# ── SYSTEM PROMPTS ──
SYSTEM_PROMPTS = {
    "space": """You are NOVA, a space exploration assistant powered by LLaMA (via Groq).
You specialize in: space exploration, NASA missions, planets, moons, galaxies,
black holes, dark matter, James Webb Telescope, Hubble, ISS, Mars rovers, Artemis program,
SpaceX, astrophysics, cosmology, stars, asteroids, comets, and space history.
If asked about ANYTHING outside space/astronomy, respond:
"I'm NOVA, your space exploration guide. I can only help with space and astronomy topics."
Answer with enthusiasm and precision. Use specific facts, numbers, and dates. Keep answers 2-4 paragraphs.
IMPORTANT: Do NOT use markdown formatting (like asterisks for bolding or hashes for headers). Respond in plain text only.""",

    "ocean": """You are MARINA, an ocean and marine science assistant powered by LLaMA (via Groq).
You specialize in: oceans, seas, marine life, deep sea exploration, Mariana Trench,
bioluminescence, hydrothermal vents, coral reefs, ocean currents, tides, marine ecosystems,
ocean chemistry, NOAA research, NASA ocean satellites, and ocean conservation.
If asked about ANYTHING outside ocean/marine topics, respond:
"I'm MARINA, your deep ocean guide. I can only help with ocean and marine topics."
Answer with enthusiasm and precision. Use specific facts, numbers, and dates. Keep answers 2-4 paragraphs.
IMPORTANT: Do NOT use markdown formatting (like asterisks for bolding or hashes for headers). Respond in plain text only."""
}

# ── PYDANTIC MODELS ──
class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1, max_length=8000)

class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=50)
    mode: str = "space"
    session_id: str | None = Field(default=None, max_length=64)

class SessionCreateRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    mode: str = "space"

class ChatResponse(BaseModel):
    reply: str

class SessionInfo(BaseModel):
    session_id: str
    title: str | None
    mode: str
    created_at: str
    updated_at: str

# ── DATABASE ──
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                user_token TEXT NOT NULL DEFAULT 'anonymous',
                mode TEXT NOT NULL,
                title TEXT,
                created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
        ''')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
        ''')

        try:
            await db.execute(
                "ALTER TABLE sessions ADD COLUMN user_token TEXT NOT NULL DEFAULT 'anonymous'"
            )
        except aiosqlite.OperationalError:
            pass
        await db.commit()

# ── LIFESPAN ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    print("DB initialized")
    yield

# ── APP ──
app = FastAPI(
    title="COSMOS Space & Ocean AI",
    description="Space and ocean exploration AI powered by LLaMA via Groq",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

# ── STATIC FILES ──

STATIC_DIR = Path(BASE_DIR)
app.mount("/images", StaticFiles(directory=STATIC_DIR / "images"), name="images")
app.mount("/css", StaticFiles(directory=STATIC_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=STATIC_DIR / "js"), name="js")

@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(STATIC_DIR / "index.html")

# ── HELPERS ──
def _validate_session_id(session_id: str) -> None:
    if not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id format")

def _validate_mode(mode: str) -> str:
    if mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {sorted(VALID_MODES)}")
    return mode

async def _nasa_proxy(path: str) -> JSONResponse:
    """Forward a request to api.nasa.gov so the key never reaches the browser."""
    url = f"https://api.nasa.gov{path}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params={"api_key": NASA_API_KEY})
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="NASA API unreachable")
    # Pass through NASA's response body and status. If NASA returns an error
    # JSON, forward it so the frontend can show a useful message.
    return JSONResponse(content=r.json(), status_code=r.status_code)

# ── GROQ CALL ──
async def call_groq(messages: list[Message], system_prompt: str) -> str:
    formatted = [{"role": m.role, "content": m.content} for m in messages]
    completion = await groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        max_tokens=1024,
        messages=[{"role": "system", "content": system_prompt}] + formatted
    )
    return completion.choices[0].message.content

# ── ROUTES ──
@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat() + "Z"}


@app.get("/api/nasa/neo")
async def nasa_neo():
    return await _nasa_proxy("/neo/rest/v1/feed/today")


@app.get("/api/nasa/mars")
async def nasa_mars():
    return await _nasa_proxy("/mars-photos/api/v1/rovers/perseverance/latest_photos")


@app.get("/api/nasa/apod")
async def nasa_apod():
    return await _nasa_proxy("/planetary/apod")


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    mode = _validate_mode(req.mode)
    system_prompt = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["space"])
    try:
        reply = await call_groq(req.messages, system_prompt)
    except groq_module.RateLimitError:
        return ChatResponse(reply="I'm receiving too many requests right now. Please try again in a moment.")
    except groq_module.AuthenticationError:
        raise HTTPException(status_code=500, detail="Service configuration error")
    except (groq_module.APIConnectionError, groq_module.APITimeoutError):
        return ChatResponse(reply="I'm having trouble connecting. Please try again shortly.")
    except Exception as e:
        print(f"Unexpected error: {e}")
        return ChatResponse(reply="Something unexpected happened. Please try again in a moment.")

    if req.session_id and req.messages:
        _validate_session_id(req.session_id)
        user_msg = req.messages[-1].content
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT title FROM sessions WHERE session_id = ?", (req.session_id,)) as cur:
                row = await cur.fetchone()
            if row and not row["title"] and user_msg:
                title = user_msg[:50] + ("..." if len(user_msg) > 50 else "")
                await db.execute(
                    "UPDATE sessions SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE session_id = ?",
                    (title, req.session_id)
                )
            await db.execute("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)", (req.session_id, "user", user_msg))
            await db.execute("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)", (req.session_id, "assistant", reply))
            await db.execute("UPDATE sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE session_id = ?", (req.session_id,))
            await db.commit()

    return ChatResponse(reply=reply)


@app.get("/api/sessions", response_model=list[SessionInfo])
async def get_sessions(mode: str = "space"):
    _validate_mode(mode)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT session_id, title, mode, created_at, updated_at FROM sessions WHERE mode = ? ORDER BY updated_at DESC LIMIT 30",
            (mode,)
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


@app.post("/api/sessions")
async def create_session(req: SessionCreateRequest):
    _validate_mode(req.mode)
    _validate_session_id(req.session_id)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO sessions (session_id, user_token, mode, title) VALUES (?, ?, ?, ?)",
            (req.session_id, "anonymous", req.mode, None)
        )
        await db.commit()
    return {"ok": True}


@app.get("/api/sessions/{session_id}")
async def get_session_messages(session_id: str):
    _validate_session_id(session_id)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT session_id FROM sessions WHERE session_id = ?", (session_id,)
        ) as cur:
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="Session not found")
        async with db.execute(
            "SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC", (session_id,)
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    _validate_session_id(session_id)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        await db.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        await db.commit()
    return {"ok": True}


if __name__ == "__main__":
    print("COSMOS Space & Ocean AI — FastAPI Server")
    print("App:      http://localhost:5000")
    print("API docs: http://localhost:5000/docs")
    uvicorn.run("server:app", host="0.0.0.0", port=5000, reload=True)
