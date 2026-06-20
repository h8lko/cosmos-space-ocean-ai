const API = "";

// ── STATE ──
let mode = "space";
let sessionId = null;
let conversationHistory = [];
let isBotTyping = false;
let currentInterval = null;
let serverOnline = false;
let retryTimer = null;

// AI names per mode — change these to match your preference
const AI_NAMES = { space: "NOVA", ocean: "MARINA" };


const AI_PORTRAITS = {
  space: "images/nova-portrait.png",
  ocean: "images/marina-portrait.png",
};


const ORB_IMGS = {
  space: "images/space-orb.png",
  ocean: "images/ocean-orb.png",
};

const QUESTIONS = {
  space: [
    "What is the James Webb Telescope?",
    "Tell me about black holes",
    "Latest Mars missions",
    "How big is the universe?",
  ],
  ocean: [
    "How deep is the Mariana Trench?",
    "What is bioluminescence?",
    "Explain hydrothermal vents",
    "Giant squid facts",
  ],
};

// ── CANVAS ──
const canvas = document.getElementById("starfield");
const ctx = canvas.getContext("2d");
let particles = [];

function initCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  particles = Array.from({ length: 130 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * (mode === "space" ? 1.4 : 3.5),
    speed: Math.random() * 0.35 + 0.08,
    o: Math.random() * 0.7 + 0.1,
    tw: Math.random() * 0.012 + 0.003,
    to: Math.random() * Math.PI * 2,
  }));
}

function draw(t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const ts = t * 0.001;
  particles.forEach((p) => {
    const tw = mode === "space" ? Math.sin(ts * p.tw + p.to) * 0.4 + 0.6 : 1;
    ctx.globalAlpha = p.o * tw;
    if (mode === "ocean") {
      ctx.strokeStyle = "#00f2ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    p.y -= p.speed;
    if (p.y < 0) {
      p.y = canvas.height;
      p.x = Math.random() * canvas.width;
    }
  });
  ctx.globalAlpha = 1;
  requestAnimationFrame(draw);
}

// ── NASA IMAGE ──
async function fetchNasaImg(query) {
  try {
    const r = await fetch(
      "https://images-api.nasa.gov/search?q=" +
        encodeURIComponent(query) +
        "&media_type=image&page_size=5",
    );
    const d = await r.json();
    const items = d.collection?.items;
    if (!items?.length) return null;
    const item = items[Math.floor(Math.random() * Math.min(3, items.length))];
    if (item?.links && item?.data?.[0])
      return { url: item.links[0].href, title: item.data[0].title };
  } catch (e) {}
  return null;
}

function getKeyword(text) {
  const t = text.toLowerCase();
  const keys = [
    "mars",
    "saturn",
    "jupiter",
    "nebula",
    "galaxy",
    "black hole",
    "moon",
    "iss",
    "earth",
    "asteroid",
    "sun",
    "telescope",
    "rocket",
    "astronaut",
    "shark",
    "whale",
    "coral",
    "reef",
    "octopus",
    "trench",
    "bioluminescence",
    "jellyfish",
    "submarine",
    "dolphin",
  ];
  return keys.find((k) => t.includes(k)) || null;
}

// ── FETCH HELPER ──
// Same-origin calls only — backend is served from the same FastAPI app.
async function apiFetch(url, options = {}) {
  options.headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  return fetch(url, options);
}

// ── CONNECTION ──
async function checkConnection() {
  const el = document.getElementById("conn-status");
  const label = document.getElementById("conn-label");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("btn-send");
  try {
    const r = await fetch(API + "/api/health", {
      signal: AbortSignal.timeout(2500),
    });
    if (r.ok) {
      serverOnline = true;
      el.className = "live-status online";
      label.textContent = isBotTyping ? "PROCESSING..." : "SYSTEM LIVE";
      if (!isBotTyping) {
        input.disabled = false;
        sendBtn.disabled = false;
      }
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
      return;
    }
  } catch (e) {}
  serverOnline = false;
  el.className = "live-status";
  label.textContent = "SYSTEM OFFLINE";
  input.disabled = true;
  sendBtn.disabled = true;
  input.placeholder = "Server offline — run: python server.py";
  if (!retryTimer) retryTimer = setInterval(checkConnection, 3000);
}

function updateCtxCounter() {
  document.getElementById("ctx-counter").textContent =
    "CTX: " + conversationHistory.length + " MSG";
}

// ── INPUT STATE ──
function setInputState(typing) {
  isBotTyping = typing;
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("btn-send");
  const stopBtn = document.getElementById("btn-stop");
  document.getElementById("new-mission-btn").disabled = typing;
  input.disabled = typing;
  sendBtn.disabled = typing;
  sendBtn.style.display = typing ? "none" : "block";
  stopBtn.style.display = typing ? "block" : "none";
  document.querySelectorAll(".mode-btn").forEach((b) => (b.disabled = typing));
  document
    .querySelectorAll(".q-card")
    .forEach((c) => c.classList.toggle("disabled", typing));
  if (serverOnline)
    document.getElementById("conn-label").textContent = typing
      ? "PROCESSING..."
      : "SYSTEM LIVE";
}

function stopAI() {
  if (currentInterval) {
    clearInterval(currentInterval);
    currentInterval = null;
  }
  document.getElementById("typing-dots-el")?.remove();
  const bubbles = document.querySelectorAll(".bot .bubble");
  const last = bubbles[bubbles.length - 1];
  if (last) {
    last.classList.remove("typing-cursor");
    last.textContent += " [TRANSMISSION ABORTED]";
  }
  setInputState(false);
}

// ── TYPEWRITER — fast at 3ms per character ──
function typewriter(element, text) {
  return new Promise((resolve) => {
    let i = 0;
    element.classList.add("typing-cursor");
    currentInterval = setInterval(() => {
      // Add 3 chars at a time so it feels fast but still animated
      for (let j = 0; j < 3 && i < text.length; j++, i++) {
        element.textContent += text.charAt(i);
      }
      document.getElementById("chat-wrap").scrollTop = 999999;
      if (i >= text.length) {
        clearInterval(currentInterval);
        currentInterval = null;
        element.classList.remove("typing-cursor");
        resolve();
      }
    }, 8);
  });
}

// ── SEND ──
async function sendMessage() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || isBotTyping || !serverOnline) return;

  // Create session on first message
  if (!sessionId) {
    sessionId = "sid_" + crypto.randomUUID().slice(0, 12);
    localStorage.setItem("cosmos_sid_" + mode, sessionId);
    document.getElementById("hud-sid").textContent = "ID: " + sessionId;
    try {
      await apiFetch(API + "/api/sessions", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, mode }),
      });
    } catch (e) {}
  }

  document.getElementById("welcome-screen")?.remove();
  appendMessage("user", text);
  conversationHistory.push({ role: "user", content: text });
  updateCtxCounter();

  input.value = "";
  input.style.height = "auto";
  setInputState(true);
  addTypingDots();

  const keyword = getKeyword(text);
  let reply = null,
    nasaImg = null;

  try {
    const [res, img] = await Promise.all([
      apiFetch(API + "/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: conversationHistory,
          mode,
          session_id: sessionId,
        }),
      }),
      keyword ? fetchNasaImg(keyword) : Promise.resolve(null),
    ]);
    const data = await res.json();
    reply = data.reply;
    nasaImg = img;
  } catch (e) {
    removeTypingDots();
    appendMessage("bot", "ERR: CONNECTION DISRUPTED. Check server status.");
    setInputState(false);
    checkConnection();
    return;
  }

  removeTypingDots();

  // Build bot bubble
  const botDiv = document.createElement("div");
  botDiv.className = "msg bot";
  const now = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  let nasaHtml = "";
  if (nasaImg) {
    nasaHtml =
      '<div class="nasa-card"><img src="' +
      nasaImg.url +
      '" onerror="this.parentElement.style.display=\'none\'">' +
      '<div class="nasa-cap">DATABASE MATCH: ' +
      escapeAttr(nasaImg.title).toUpperCase() +
      "</div></div>";
  }
  botDiv.innerHTML =
    '<div class="msg-body">' +
    nasaHtml +
    '<div class="bubble"></div><div class="msg-ts">' +
    now +
    "</div></div>";
  document.getElementById("chat-wrap").appendChild(botDiv);
  document.getElementById("chat-wrap").scrollTop = 999999;

  await typewriter(botDiv.querySelector(".bubble"), reply);

  // Push to history only after complete
  conversationHistory.push({ role: "assistant", content: reply });
  if (conversationHistory.length > 20)
    conversationHistory = conversationHistory.slice(-20);
  updateCtxCounter();
  setInputState(false);
  loadSessions();
}

function addTypingDots() {
  const wrap = document.getElementById("chat-wrap");
  const div = document.createElement("div");
  div.className = "msg bot";
  div.id = "typing-dots-el";
  div.innerHTML =
    '<div class="msg-body"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
  wrap.appendChild(div);
  wrap.scrollTop = 999999;
}
function removeTypingDots() {
  document.getElementById("typing-dots-el")?.remove();
}

function appendMessage(role, text, timestamp) {
  const wrap = document.getElementById("chat-wrap");
  const div = document.createElement("div");
  div.className = "msg " + role;
  const ts = timestamp
    ? formatDate(timestamp)
    : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  div.innerHTML =
    '<div class="msg-body"><div class="bubble">' +
    escapeHtml(text) +
    '</div><div class="msg-ts">' +
    ts +
    "</div></div>";
  wrap.appendChild(div);
  wrap.scrollTop = 999999;
  return div;
}

function escapeHtml(t) {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}


function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── SESSIONS ──
async function loadSessions() {
  try {
    const r = await apiFetch(API + "/api/sessions?mode=" + mode);
    const data = await r.json();
    const list = document.getElementById("sessions-list");
    if (!data.length) {
      list.innerHTML =
        '<div style="padding:12px 4px;font-size:10px;font-family:var(--font-mono);color:rgba(255,255,255,0.18);">NO MISSIONS YET</div>';
      return;
    }
    list.innerHTML = data
      .map((s) => {
        const isActive = s.session_id === sessionId ? "active" : "";
        const title = escapeAttr(s.title || "Inbound Mission");
        const sid = escapeAttr(s.session_id);
        const date = formatDate(s.updated_at);
        return (
          '<div class="session-item ' +
          isActive +
          '" onclick="openSession(\'' +
          sid +
          "',event)\">" +
          '<div class="session-info">' +
          '<div class="session-title-text">' +
          title +
          "</div>" +
          '<div class="session-date">' +
          date +
          "</div>" +
          "</div>" +
          '<button class="session-del" onclick="deleteSession(event,\'' +
          sid +
          '\')" title="Delete">✕</button>' +
          "</div>"
        );
      })
      .join("");
  } catch (e) {}
}

async function openSession(sid, e) {
  if (isBotTyping) return;
  sessionId = sid;
  // Store per-mode so switching modes doesn't restore wrong session
  localStorage.setItem("cosmos_sid_" + mode, sid);
  document.getElementById("hud-sid").textContent = "ID: " + sid;

  try {
    const r = await apiFetch(API + "/api/sessions/" + sid);
    const msgs = await r.json();
    const wrap = document.getElementById("chat-wrap");
    wrap.innerHTML = "";
    conversationHistory = [];

    if (!msgs.length) {
      renderWelcome();
    } else {
      msgs.forEach((m) => {
        appendMessage(
          m.role === "user" ? "user" : "bot",
          m.content,
          m.created_at,
        );
        conversationHistory.push({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        });
      });
      if (conversationHistory.length > 20)
        conversationHistory = conversationHistory.slice(-20);
    }
    updateCtxCounter();
    loadSessions();
  } catch (e) {
    console.error(e);
  }
}

async function deleteSession(e, sid) {
  e.stopPropagation();
  if (!confirm("Delete this mission?")) return;
  try {
    await apiFetch(API + "/api/sessions/" + sid, { method: "DELETE" });
    if (sid === sessionId) startNewMission();
    else loadSessions();
  } catch (e) {}
}

function startNewMission() {
  if (isBotTyping) return;
  sessionId = null;
  conversationHistory = [];
  localStorage.removeItem("cosmos_sid_" + mode);
  document.getElementById("hud-sid").textContent = "ID: —";
  updateCtxCounter();
  renderWelcome();
  loadSessions();
}

// ── WELCOME ──
function renderWelcome() {
  const wrap = document.getElementById("chat-wrap");
  wrap.innerHTML = "";
  const orbImg = ORB_IMGS[mode];
  const portrait = AI_PORTRAITS[mode];
  const aiName = AI_NAMES[mode];
  const label = mode === "space" ? "COMMAND CENTER" : "DEEP OCEAN OPS";

  const div = document.createElement("div");
  div.className = "welcome";
  div.id = "welcome-screen";
  div.innerHTML =
    '<div class="orb-container">' +
    '<div class="orb">' +

    '<img class="orb-img" src="' +
    orbImg +
    '" onerror="this.style.display=\'none\'" alt="">' +
    "</div></div>" +
    '<div class="welcome-header">' +

    '<img class="ai-portrait" src="' +
    portrait +
    '" onerror="this.onerror=null; this.src=\'' +
    (mode === "space" ? "images/space-icon.png" : "images/ocean-icon.png") +
    '\';" alt="' +
    aiName +
    '">' +
    "<h2>" +
    label +
    "</h2>" +
    "</div>" +
    "<p>AWAITING TRANSMISSION...</p>";
  wrap.appendChild(div);
}

// ── MODE SWITCH — separate session per mode ──
function switchMode(m) {
  if (isBotTyping) return;
  mode = m;
  document.body.className = m === "ocean" ? "ocean" : "space";
  document.getElementById("logo-text").textContent = AI_NAMES[m];
  document.getElementById("logo-icon").src =
    m === "space" ? "images/space-icon.png" : "images/ocean-icon.png";
  document
    .getElementById("btn-space")
    .classList.toggle("active", m === "space");
  document
    .getElementById("btn-ocean")
    .classList.toggle("active", m === "ocean");
  document.getElementById("chat-input").placeholder =
    m === "space"
      ? "Enter transmission command..."
      : "Enter deep ocean query...";
  renderQuestions();
  initCanvas();

  // Restore the last session for THIS mode, or start fresh
  const savedSid = localStorage.getItem("cosmos_sid_" + m);
  if (savedSid) {
    sessionId = savedSid;
    document.getElementById("hud-sid").textContent = "ID: " + sessionId;
    openSession(sessionId);
  } else {
    sessionId = null;
    conversationHistory = [];
    document.getElementById("hud-sid").textContent = "ID: —";
    updateCtxCounter();
    renderWelcome();
    loadSessions();
  }
}

function renderQuestions() {
  document.getElementById("questions-box").innerHTML = QUESTIONS[mode]
    .map(
      (q) =>
        "<div class=\"q-card\" onclick=\"if(!isBotTyping){document.getElementById('chat-input').value='" +
        escapeAttr(q) +
        "';sendMessage();}\">" +
        escapeAttr(q) +
        "</div>",
    )
    .join("");
}

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}
function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const utcStr = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T");
  const d = new Date(utcStr + (utcStr.endsWith("Z") ? "" : "Z"));
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return d.toLocaleDateString();
}

// ── INIT ──
window.addEventListener("resize", initCanvas);
initCanvas();
requestAnimationFrame(draw);
renderQuestions();
checkConnection();
setInterval(checkConnection, 4000);

// Restore last space session or show welcome
const savedSid = localStorage.getItem("cosmos_sid_space");
if (savedSid) {
  sessionId = savedSid;
  document.getElementById("hud-sid").textContent = "ID: " + sessionId;
  openSession(sessionId);
} else {
  renderWelcome();
  loadSessions();
}
