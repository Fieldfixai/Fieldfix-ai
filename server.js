const express = require("express");
const cors = require("cors");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const app = express();

app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] === "http") {
    return res.redirect(301, "https://" + req.headers.host + req.url);
  }
  next();
});

app.use(cors());
app.use(express.json());

// Serve app static files from /public
app.use("/app", express.static(path.join(__dirname, "public")));

const API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FREE_LIMIT = 3;

function supabase(method, table, body, query = "") {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}${query}`);
    const bodyStr = body ? JSON.stringify(body) : "";
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": "return=representation",
      }
    };
    if (bodyStr) options.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data || "[]") }); }
        catch (e) { resolve({ status: res.statusCode, data: [] }); }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password + "fieldfix_salt_2026").digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function requireAuth(req, res, next) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    const sessionResult = await supabase("GET", "sessions", null, `?token=eq.${token}`);
    if (!sessionResult.data || !sessionResult.data[0]) return res.status(401).json({ error: "Session not found" });
    const session = sessionResult.data[0];
    if (new Date(session.expires_at) < new Date()) return res.status(401).json({ error: "Session expired" });
    const userResult = await supabase("GET", "users", null, `?id=eq.${session.user_id}`);
    if (!userResult.data || !userResult.data[0]) return res.status(401).json({ error: "User not found" });
    req.user = userResult.data[0];
    req.userId = session.user_id;
    // Update last active timestamp
    await supabase("PATCH", "sessions", { last_active: new Date().toISOString() }, `?token=eq.${token}`);
    next();
  } catch (e) {
    res.status(401).json({ error: "Auth error: " + e.message });
  }
}

app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  try {
    const existing = await supabase("GET", "users", null, `?email=eq.${encodeURIComponent(email.toLowerCase())}`);
    if (existing.data && existing.data.length > 0) return res.status(400).json({ error: "Email already registered" });
    const userResult = await supabase("POST", "users", {
      email: email.toLowerCase(),
      password_hash: hashPassword(password),
      plan: "free", queries_used: 0,
      queries_reset_date: new Date().toISOString().split("T")[0]
    });
    if (!userResult.data || !userResult.data[0]) return res.status(500).json({ error: "Failed to create account: " + JSON.stringify(userResult.data) });
    const user = userResult.data[0];
    await supabase("DELETE", "sessions", null, `?user_id=eq.${user.id}`);
    const token = generateToken();
    await supabase("POST", "sessions", { user_id: user.id, token, last_active: new Date().toISOString() });
    res.json({ token, email: user.email, plan: user.plan, queriesUsed: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  try {
    const result = await supabase("GET", "users", null, `?email=eq.${encodeURIComponent(email.toLowerCase())}`);
    if (!result.data || !result.data[0]) return res.status(401).json({ error: "Invalid email or password" });
    const user = result.data[0];
    if (user.password_hash !== hashPassword(password)) return res.status(401).json({ error: "Invalid email or password" });
    const today = new Date().toISOString().split("T")[0];
    let queriesUsed = user.queries_used;
    if (user.queries_reset_date !== today && user.plan === "free") {
      await supabase("PATCH", "users", { queries_used: 0, queries_reset_date: today }, `?id=eq.${user.id}`);
      queriesUsed = 0;
    }
    // Delete ALL existing sessions for this user — prevents account sharing
    await supabase("DELETE", "sessions", null, `?user_id=eq.${user.id}`);
    const token = generateToken();
    await supabase("POST", "sessions", { user_id: user.id, token, last_active: new Date().toISOString() });
    res.json({ token, email: user.email, plan: user.plan, queriesUsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/logout", requireAuth, async (req, res) => {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  await supabase("DELETE", "sessions", null, `?token=eq.${token}`);
  res.json({ success: true });
});

app.get("/api/me", requireAuth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  let queriesUsed = req.user.queries_used;
  if (req.user.queries_reset_date !== today && req.user.plan === "free") {
    await supabase("PATCH", "users", { queries_used: 0, queries_reset_date: today }, `?id=eq.${req.userId}`);
    queriesUsed = 0;
  }
  res.json({ email: req.user.email, plan: req.user.plan, queriesUsed, queriesLeft: req.user.plan === "free" ? Math.max(0, FREE_LIMIT - queriesUsed) : 999 });
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const user = req.user;
  const today = new Date().toISOString().split("T")[0];
  let queriesUsed = user.queries_used;
  if (user.queries_reset_date !== today) queriesUsed = 0;
  if (user.plan === "free" && queriesUsed >= FREE_LIMIT) return res.status(403).json({ error: "upgrade_required" });
  if (user.plan === "free") {
    await supabase("PATCH", "users", { queries_used: queriesUsed + 1, queries_reset_date: today }, `?id=eq.${req.userId}`);
  }
  const body = JSON.stringify(req.body);
  const options = {
    hostname: "api.anthropic.com", path: "/v1/messages", method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "x-api-key": API_KEY, "anthropic-version": "2023-06-01" }
  };
  const request = https.request(options, (response) => {
    let data = "";
    response.on("data", chunk => { data += chunk; });
    response.on("end", () => {
      try { res.json(JSON.parse(data)); }
      catch (e) { res.status(500).json({ error: "Parse error" }); }
    });
  });
  request.on("error", e => res.status(500).json({ error: e.message }));
  request.write(body); request.end();
});

app.get("/api/status", (req, res) => {
  res.json({ status: "running", keyLoaded: !!API_KEY, supabaseUrl: !!SUPABASE_URL, supabaseKey: !!SUPABASE_KEY });
});

// Landing page at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "landing.html"));
});

// App at /app
app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// History page
app.get("/history", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "history.html"));
});

// Pricing page
app.get("/pricing", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pricing.html"));
});

app.get("/app/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FieldFix AI running on port ${PORT}`));

// ── TEAM ROUTES ──

// Create a team
app.post("/api/teams/create", requireAuth, async (req, res) => {
  const { name, plan } = req.body;
  const seats = plan === "small_team" ? 5 : plan === "team" ? 15 : plan === "plant" ? 50 : 5;
  try {
    // Update user plan
    await supabase("PATCH", "users", { plan }, `?id=eq.${req.userId}`);
    // Create team
    const teamResult = await supabase("POST", "teams", {
      name,
      admin_user_id: req.userId,
      plan,
      seats
    });
    if (!teamResult.data || !teamResult.data[0]) return res.status(500).json({ error: "Failed to create team" });
    const team = teamResult.data[0];
    // Add admin as first member
    await supabase("POST", "team_members", {
      team_id: team.id,
      user_id: req.userId,
      role: "admin",
      status: "active"
    });
    res.json({ team });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get my team
app.get("/api/teams/mine", requireAuth, async (req, res) => {
  try {
    const memberResult = await supabase("GET", "team_members", null, `?user_id=eq.${req.userId}`);
    if (!memberResult.data || !memberResult.data[0]) return res.json({ team: null });
    const teamId = memberResult.data[0].team_id;
    const teamResult = await supabase("GET", "teams", null, `?id=eq.${teamId}`);
    const membersResult = await supabase("GET", "team_members", null, `?team_id=eq.${teamId}`);
    res.json({ team: teamResult.data[0], members: membersResult.data, myRole: memberResult.data[0].role });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Invite a team member
app.post("/api/teams/invite", requireAuth, async (req, res) => {
  const { email } = req.body;
  try {
    // Get admin's team
    const memberResult = await supabase("GET", "team_members", null, `?user_id=eq.${req.userId}&role=eq.admin`);
    if (!memberResult.data || !memberResult.data[0]) return res.status(403).json({ error: "You are not a team admin" });
    const teamId = memberResult.data[0].team_id;
    // Check seat limit
    const teamResult = await supabase("GET", "teams", null, `?id=eq.${teamId}`);
    const team = teamResult.data[0];
    const allMembers = await supabase("GET", "team_members", null, `?team_id=eq.${teamId}`);
    if (allMembers.data.length >= team.seats) return res.status(400).json({ error: `Seat limit reached (${team.seats} seats). Upgrade your plan.` });
    // Check if user exists
    const userResult = await supabase("GET", "users", null, `?email=eq.${encodeURIComponent(email.toLowerCase())}`);
    if (userResult.data && userResult.data[0]) {
      // Add existing user to team
      const existingUser = userResult.data[0];
      await supabase("PATCH", "users", { plan: team.plan }, `?id=eq.${existingUser.id}`);
      await supabase("POST", "team_members", { team_id: teamId, user_id: existingUser.id, role: "member", invited_email: email, status: "active" });
    } else {
      // Add pending invite
      await supabase("POST", "team_members", { team_id: teamId, role: "member", invited_email: email.toLowerCase(), status: "pending" });
    }
    res.json({ success: true, message: `Invite sent to ${email}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove a team member
app.post("/api/teams/remove", requireAuth, async (req, res) => {
  const { userId } = req.body;
  try {
    const memberResult = await supabase("GET", "team_members", null, `?user_id=eq.${req.userId}&role=eq.admin`);
    if (!memberResult.data || !memberResult.data[0]) return res.status(403).json({ error: "Not authorized" });
    await supabase("DELETE", "team_members", null, `?user_id=eq.${userId}`);
    await supabase("PATCH", "users", { plan: "free" }, `?id=eq.${userId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all users (owner only - for admin dashboard)
app.get("/api/admin/users", requireAuth, async (req, res) => {
  // Only allow owner email
  if (req.user.email !== process.env.OWNER_EMAIL) return res.status(403).json({ error: "Not authorized" });
  try {
    const users = await supabase("GET", "users", null, `?order=created_at.desc&limit=100`);
    const teams = await supabase("GET", "teams", null, "");
    res.json({ users: users.data, teams: teams.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HISTORY ROUTES ──
app.post("/api/history/save", requireAuth, async (req, res) => {
  const { question, answer, category } = req.body;
  if (req.user.plan === "free") return res.json({ saved: false });
  try {
    await supabase("POST", "search_history", {
      user_id: req.userId,
      question: question.substring(0, 500),
      answer: answer.substring(0, 2000),
      category: category || "general",
      created_at: new Date().toISOString()
    });
    res.json({ saved: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/history", requireAuth, async (req, res) => {
  if (req.user.plan === "free") return res.json({ history: [] });
  try {
    const result = await supabase("GET", "search_history", null, `?user_id=eq.${req.userId}&order=created_at.desc&limit=20`);
    res.json({ history: result.data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/history/:id", requireAuth, async (req, res) => {
  try {
    await supabase("DELETE", "search_history", null, `?id=eq.${req.params.id}&user_id=eq.${req.userId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
