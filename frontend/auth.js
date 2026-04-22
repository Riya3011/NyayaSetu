// auth.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — Shared Frontend Auth Helper
//
// Exposes global `Auth` object. Include on every page:
//   <script src="auth.js"></script>
//
// KEY CHANGE: login() now requires a `role` parameter.
// The backend enforces role-match: wrong role → "Invalid role selected".
// ─────────────────────────────────────────────────────────────────────────────

const Auth = (() => {
  const API_BASE  = "http://localhost:5050/api";
  const TOKEN_KEY = "ns_token";
  const USER_KEY  = "ns_user";

  // ── Storage helpers ─────────────────────────────────────────────────────────
  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }

  function isLoggedIn() { return !!(getToken() && getUser()); }

  // ── Logout ──────────────────────────────────────────────────────────────────
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = "login.html";
  }

  // ── Role-based redirect ─────────────────────────────────────────────────────
  function redirectByRole(role) {
    const map = {
      admin:  "admin-dashboard.html",
      lawyer: "lawyer-dashboard.html",
      user:   "dashboard.html",
    };
    window.location.href = map[role] || "dashboard.html";
  }

  // ── Page guards ─────────────────────────────────────────────────────────────
  // requireAuth(["user","admin"]) — allowed roles. Pass empty/null for any role.
  function requireAuth(allowedRoles) {
    if (!isLoggedIn()) {
      window.location.href = "login.html";
      return null;
    }
    const user = getUser();
    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      redirectByRole(user.role);
      return null;
    }
    return user;
  }

  function redirectIfLoggedIn() {
    if (isLoggedIn()) redirectByRole(getUser().role);
  }

  // ── Authenticated fetch ─────────────────────────────────────────────────────
  async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };
    const res  = await fetch(API_BASE + path, { ...options, headers });
    const data = await res.json();
    if (res.status === 401) { logout(); return null; }
    return { ok: res.ok, status: res.status, data };
  }

  // ── Login (REQUIRES role parameter) ────────────────────────────────────────
  // Posts { email, password, role } to /api/auth/login.
  // If role doesn't match DB role → backend returns 403 "Invalid role selected".
  async function login(email, password, role) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password, role }),
    });
    const data = await res.json();
    if (data.success) {
      setToken(data.token);
      setUser(data.user);
    }
    return data;
  }

  // ── Register ────────────────────────────────────────────────────────────────
  async function register(name, email, password) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (data.success) {
      setToken(data.token);
      setUser(data.user);
    }
    return data;
  }

  // ── Nav user chip ───────────────────────────────────────────────────────────
  function renderUserChip() {
    const el = document.getElementById("userChip");
    if (!el) return;
    const user = getUser();
    if (!user) return;
    const roleColor = { admin: "#e74c3c", lawyer: "#2980b9", user: "#27ae60" };
    const color     = roleColor[user.role] || "#888";
    el.innerHTML = `
      <span style="color:rgba(255,255,255,0.8);font-size:13px;margin-right:8px;">
        ${user.name}
        <span style="background:${color};color:#fff;font-size:10px;font-weight:700;
          padding:2px 7px;border-radius:20px;margin-left:6px;text-transform:uppercase;">
          ${user.role}
        </span>
      </span>
      <button onclick="Auth.logout()"
        style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.25);
          color:rgba(255,255,255,0.8);padding:5px 14px;border-radius:6px;
          cursor:pointer;font-size:13px;font-family:'Outfit',sans-serif;"
        onmouseover="this.style.background='rgba(255,255,255,0.2)'"
        onmouseout="this.style.background='rgba(255,255,255,0.1)'">
        Logout
      </button>`;
  }

  // ── Dashboard link helper ───────────────────────────────────────────────────
  // Returns the correct dashboard page for the logged-in user's role.
  function myDashboard() {
    const user = getUser();
    if (!user) return "login.html";
    return { admin: "admin-dashboard.html", lawyer: "lawyer-dashboard.html", user: "dashboard.html" }[user.role] || "dashboard.html";
  }

  return {
    API_BASE, getToken, getUser, isLoggedIn,
    logout, redirectByRole, requireAuth, redirectIfLoggedIn,
    apiFetch, login, register, renderUserChip, myDashboard,
  };
})();
