const express = require("express");
const cors = require("cors");
const path = require("path");
const https = require("https");

const app = express();

// Force HTTPS
app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] === "http") {
    return res.redirect(301, "https://" + req.headers.host + req.url);
  }
  next();
});

// Security headers
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "upgrade-insecure-requests");
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.ANTHROPIC_API_KEY;

app.get("/api/status", (req, res) => {
  res.json({
    status: "running",
    keyLoaded: !!API_KEY,
    keyPrefix: API_KEY ? API_KEY.substring(0, 14) + "..." : "NOT SET"
  });
});

app.post("/api/chat", (req, res) => {
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
      try {
        res.json(JSON.parse(data));
      } catch (e) {
        res.status(500).json({ error: "Parse error: " + e.message });
      }
    });
  });

  request.on("error", (e) => {
    res.status(500).json({ error: e.message });
  });

  request.write(body);
  request.end();
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FieldFix AI running on port ${PORT}`));
