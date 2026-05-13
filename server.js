const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.ANTHROPIC_API_KEY;

app.get("/api/status", (req, res) => {
  res.json({
    status: "running",
    keyLoaded: !!API_KEY,
    keyPrefix: API_KEY ? API_KEY.substring(0, 10) + "..." : "NOT SET"
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { default: fetch } = await import("node-fetch");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    console.log("Response status:", response.status);
    if (data.error) console.log("API error:", JSON.stringify(data.error));
    res.json(data);
  } catch (err) {
    console.log("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FieldFix AI running on port ${PORT}`));
