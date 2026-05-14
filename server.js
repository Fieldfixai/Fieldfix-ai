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
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FREE_LIMIT = 3;

function supabase(method, table, body, query = "") {
  return new Promise((resolve, reject) => {
    const urlStr = `${SUPABASE_URL}/rest/v1/${table}${query}`;
    const url = new URL(urlStr);
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
        console.log(`Supabase ${method} ${table}: status=${res.statusCode} body=${data.substring(0, 200)}`);
        try { resolve({ status: res.statusCode, data: JSON.parse(data || "[]") }); }
        catch (e) { resolve({ status: res.statusCode, data: [], raw: data }); }
      });
    });
    req.on("error", (e) => {
      console.log(`Supabase error: ${e.message}`);
      reject(e);
    });
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
  const result = await supabase("GET", "sessions", null, `?token=eq.${token}&select=*,users(*)`);
  if (!result.data || !result.data[0]) return res.status(401).json({ error: "Session expired" });
  const session = result.data[0];
  if (new Date(session.expires_at) < new Date()) return res.status(401).json({ error: "Session expired" });
  req.user = session.users;
  req.userId = session.user_id;
  next();
}

app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    console.log("Signup attempt for:", email);
    console.log("SUPABASE_URL:", SUPABASE_URL);
    console.log("SUPABASE_KEY loaded:", !!SUPABASE_KEY);

    const existing = await supabase("GET", "users", null, `?email=eq.${encodeURIComponent(email)}`);
    console.log("Existing check result:", JSON.stringify(existing.data));

    if (existing.data && existing.data.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const userResult = await supabase("POST", "users", {
      email: email.toLowerCase(),
      password_hash: hashPassword(password),
      plan: "free",
      queries_used: 0,
      queries_reset_date: new Date().toISOString().split("T")[0]
    });

    console.log("User creation status:", userResult.status);
    console.log("User creation data:", JSON.stringify(userResult.data));

    if (!userResult.data || !userResult.data[0]) {
      return res.status(500).json({ error: "Failed to create account - DB error: " + JSON.stringify(userResult.data) });
    }

    const user = userResult.data[0];
    const token = generateToken();
    await supabase("POST", "sessions", { user_id: user.id, token });
    res.json({ token, email: user.email, plan: user.plan, queriesUsed: user.queries_used });
  } catch (e) {
    console.log("Signup error:", e.message);
    res.status(500).json({ error: "Server error: " + e.message });
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
    const token = generateToken();
    await supabase("POST", "sessions", { user_id: user.id, token });
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
  res.json({
    email: req.user.email,
    plan: req.user.plan,
    queriesUsed,
    queriesLeft: req.user.plan === "free" ? Math.max(0, FREE_LIMIT - queriesUsed) : 999
  });
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const user = req.user;
  const today = new Date().toISOString().split("T")[0];
  let queriesUsed = user.queries_used;
  if (user.queries_reset_date !== today) queriesUsed = 0;
  if (user.plan === "free" && queriesUsed >= FREE_LIMIT) {
    return res.status(403).json({ error: "upgrade_required" });
  }
  if (user.plan === "free") {
    await supabase("PATCH", "users", { queries_used: queriesUsed + 1, queries_reset_date: today }, `?id=eq.${req.userId}`);
  }
  const body = JSON.stringify(req.body);
  const options = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    }
  };
  const request = https.request(options, (response) => {
    let data = "";
    response.on("data", (chunk) => { data += chunk; });
    response.on("end", () => {
      try { res.json(JSON.parse(data)); }
      catch (e) { res.status(500).json({ error: "Parse error" }); }
    });
  });
  request.on("error", (e) => res.status(500).json({ error: e.message }));
  request.write(body);
  request.end();
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "running",
    keyLoaded: !!API_KEY,
    supabaseUrl: !!SUPABASE_URL,
    supabaseKey: !!SUPABASE_KEY
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FieldFix AI running on port ${PORT}`));
