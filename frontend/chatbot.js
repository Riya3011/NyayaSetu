/**
 * NyayaSetu — NyayaBot Chatbot (v2)
 *
 * Changes from v1:
 *  - API key removed from browser; all Groq calls go through POST /api/chat
 *  - Animated 3-dot typing indicator (CSS-driven)
 *  - Markdown-lite rendering: **bold**, *italic*, bullet lists, numbered lists
 *  - Chat history capped at 20 turns to avoid context overflow
 *  - Handles: empty input, oversized input, network errors, API errors
 *  - Input disabled while a request is in-flight (prevents double-sends)
 */

// ── Config ───────────────────────────────────────────────────────────────────
const CHAT_API_URL   = "http://localhost:5050/api/chat";
const MAX_INPUT_CHARS = 2000;   // Soft cap shown to user
const MAX_HISTORY     = 20;     // Max turns kept in memory

// ── DOM References ───────────────────────────────────────────────────────────
const chatFab        = document.getElementById("chatbotFab");
const chatPanel      = document.getElementById("chatbotPanel");
const chatOverlay    = document.getElementById("chatbotOverlay");
const chatCloseBtn   = document.getElementById("chatbotClose");
const chatMessagesEl = document.getElementById("chatbotMessages");
const chatInput      = document.getElementById("chatbotInput");
const chatSendBtn    = document.getElementById("chatbotSend");
const chatCharCount  = document.getElementById("chatbotCharCount");

// ── State ────────────────────────────────────────────────────────────────────
// Stores the full conversation as { role, content } pairs (no system msg here)
// The server prepends the system prompt automatically.
let conversationHistory = [];
let typingNode = null;
let isRequesting = false;

// ── Panel open/close ─────────────────────────────────────────────────────────
function openChatbot() {
  chatPanel.classList.add("open");
  chatOverlay.classList.add("open");
  chatFab.setAttribute("aria-expanded", "true");
  // Small delay so CSS transition plays before focus grabs keyboard on iOS
  setTimeout(() => chatInput.focus(), 50);
}

function closeChatbot() {
  chatPanel.classList.remove("open");
  chatOverlay.classList.remove("open");
  chatFab.setAttribute("aria-expanded", "false");
}

// ── Markdown-lite renderer ───────────────────────────────────────────────────
// Converts a small subset of markdown to safe HTML.
// Only processes: **bold**, *italic*, `code`, bullet lists (- / *), numbered lists.
function renderMarkdown(text) {
  if (!text) return "";

  // Escape HTML entities first to prevent injection
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Process line-by-line for lists
  const lines = html.split("\n");
  const result = [];
  let inUL = false;
  let inOL = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Unordered list item: starts with "- " or "* "
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    // Ordered list item: starts with "1. ", "2. " etc.
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);

    if (ulMatch) {
      if (!inUL) { result.push("<ul>"); inUL = true; }
      if (inOL)  { result.push("</ol>"); inOL = false; }
      result.push(`<li>${inlineFormat(ulMatch[2])}</li>`);
    } else if (olMatch) {
      if (!inOL) { result.push("<ol>"); inOL = true; }
      if (inUL)  { result.push("</ul>"); inUL = false; }
      result.push(`<li>${inlineFormat(olMatch[2])}</li>`);
    } else {
      if (inUL) { result.push("</ul>"); inUL = false; }
      if (inOL) { result.push("</ol>"); inOL = false; }

      const trimmed = line.trim();
      if (trimmed === "") {
        // Blank line → paragraph break
        result.push("<br>");
      } else {
        result.push(`<span>${inlineFormat(trimmed)}</span><br>`);
      }
    }
  }

  if (inUL) result.push("</ul>");
  if (inOL) result.push("</ol>");

  return result.join("");
}

// Apply inline formatting: **bold**, *italic*, `code`
function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/`(.+?)`/g,       "<code>$1</code>");
}

// ── Message rendering ────────────────────────────────────────────────────────
function appendMessage(role, text) {
  const msg = document.createElement("div");
  msg.className = `chatbot-msg ${role}`;

  if (role === "bot") {
    msg.innerHTML = renderMarkdown(text);
  } else {
    // User messages: plain text (already safe from direct input)
    msg.textContent = text;
  }

  chatMessagesEl.appendChild(msg);
  scrollToBottom();
  return msg;
}

// ── Typing indicator ─────────────────────────────────────────────────────────
function showTyping() {
  if (typingNode) return;
  typingNode = document.createElement("div");
  typingNode.className = "chatbot-msg bot typing";
  typingNode.innerHTML = `
    <div class="typing-dots">
      <span></span><span></span><span></span>
    </div>`;
  chatMessagesEl.appendChild(typingNode);
  scrollToBottom();
}

function hideTyping() {
  if (!typingNode) return;
  typingNode.remove();
  typingNode = null;
}

// ── Scroll ───────────────────────────────────────────────────────────────────
function scrollToBottom() {
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// ── Character counter ─────────────────────────────────────────────────────────
function updateCharCount() {
  const len = chatInput.value.length;
  if (chatCharCount) {
    chatCharCount.textContent = `${len} / ${MAX_INPUT_CHARS}`;
    chatCharCount.classList.toggle("over-limit", len > MAX_INPUT_CHARS);
  }
}

// ── Lock/unlock input ────────────────────────────────────────────────────────
function setInputLocked(locked) {
  isRequesting = locked;
  chatSendBtn.disabled = locked;
  chatInput.disabled   = locked;
  if (!locked) chatInput.focus();
}

// ── API call ─────────────────────────────────────────────────────────────────
async function fetchBotReply(messages) {
  const response = await fetch(CHAT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || `Server error (${response.status})`);
  }

  return data.reply;
}

// ── Send message ─────────────────────────────────────────────────────────────
async function sendMessage() {
  if (isRequesting) return;

  const userText = chatInput.value.trim();

  // Empty input guard
  if (!userText) {
    chatInput.focus();
    return;
  }

  // Length guard
  if (userText.length > MAX_INPUT_CHARS) {
    appendMessage("bot",
      `⚠️ Your message is too long (${userText.length} characters). Please keep it under ${MAX_INPUT_CHARS} characters.`
    );
    return;
  }

  // Render user message
  appendMessage("user", userText);
  chatInput.value = "";
  updateCharCount();
  setInputLocked(true);
  showTyping();

  // Add to history
  conversationHistory.push({ role: "user", content: userText });

  // Trim history if over limit
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY);
  }

  try {
    const botReply = await fetchBotReply(conversationHistory);
    hideTyping();
    appendMessage("bot", botReply);
    conversationHistory.push({ role: "assistant", content: botReply });

  } catch (err) {
    hideTyping();

    // Friendly fallback messages based on error type
    let userMessage = "I'm having trouble connecting right now. Please try again in a moment.";
    if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      userMessage = "⚠️ Connection failed. Make sure the NyayaSetu server is running at localhost:5050.";
    } else if (err.message.includes("unavailable") || err.message.includes("503")) {
      userMessage = "⚠️ NyayaBot is temporarily busy. Please try again in a few seconds.";
    } else if (err.message) {
      userMessage = `⚠️ ${err.message}`;
    }

    appendMessage("bot", userMessage);
    // Remove the failed user message from history so it doesn't corrupt context
    conversationHistory.pop();

    console.error("[NyayaBot] API error:", err.message);
  } finally {
    setInputLocked(false);
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────────
chatFab.addEventListener("click", () => {
  const isOpen = chatPanel.classList.contains("open");
  isOpen ? closeChatbot() : openChatbot();
});

chatCloseBtn.addEventListener("click", closeChatbot);
chatOverlay.addEventListener("click", closeChatbot);
chatSendBtn.addEventListener("click", sendMessage);

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

chatInput.addEventListener("input", updateCharCount);

// ── Welcome message ───────────────────────────────────────────────────────────
appendMessage("bot",
  "Namaste! I'm **NyayaBot**, your AI legal guide for Indian law. 🙏\n\n" +
  "Tell me your legal concern — whether it's about property, family, employment, cybercrime, or any other matter — and I'll guide you with practical next steps."
);
