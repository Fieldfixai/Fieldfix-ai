# FieldFix AI ⚙️

**Industrial Troubleshooting Assistant powered by AI**

FieldFix AI is a web-based troubleshooting tool built for maintenance technicians working with industrial equipment. Get step-by-step fault diagnosis, alarm code explanations, and test procedures — instantly.

---

## What It Does

- **Fanuc CNC** — Servo alarms, spindle faults, PMC alarms, overtravel, screen navigation
- **Fanuc Robots** — SRVO, SYST, INTP, MOTN alarms, mastering, teach pendant navigation
- **Siemens CNC** — Sinumerik 808D, 828D, 840D alarms, Sinamics drive faults, Safety Integrated
- **Siemens PLC** — S7-300/400/1200/1500, TIA Portal diagnostics, Profibus/Profinet faults
- **Allen-Bradley** — ControlLogix, CompactLogix, Kinetix drives, PowerFlex VFDs
- **Discrete Inputs** — Proximity sensors, photoelectrics, limit switches, NPN/PNP wiring
- **Discrete Outputs** — Solenoids, contactors, relay outputs, transistor output diagnosis
- **Analog I/O** — 4-20mA loops, thermocouples, RTD (PT100/PT1000), ground loops
- **Electrical** — 24VDC/120VAC control circuits, safety circuits, encoders
- **Drives** — Servo drives, spindle drives, VFDs

---

## Pricing

| Plan | Price | Features |
|---|---|---|
| Free | $0 | 3 queries per day |
| Pro | $9.99/month | Unlimited queries + session history |
| Expert | $19.99/month | Everything in Pro + wiring guides + parts lookup |

---

## Tech Stack

- **Frontend** — Vanilla HTML, CSS, JavaScript
- **Backend** — Node.js + Express
- **AI** — Anthropic Claude API (claude-sonnet-4-20250514)
- **Hosting** — Railway

---

## Deployment

### Prerequisites
- Node.js 18+
- Anthropic API key

### Local Development
```bash
npm install
ANTHROPIC_API_KEY=your_key_here node server.js
```
Open browser at `http://localhost:3001`

### Deploy to Railway
1. Fork this repository
2. Create new project on Railway
3. Connect your GitHub repo
4. Add environment variable: `ANTHROPIC_API_KEY=your_key`
5. Deploy — Railway handles the rest

---

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key from console.anthropic.com |
| `PORT` | Port number (Railway sets this automatically) |

---

## About

Built by a maintenance technician with years of hands-on experience in industrial automation. FieldFix AI combines real field knowledge with AI to give technicians the answers they need — fast.

**Website:** [fieldfix.io](https://fieldfix.io)

**Contact:** hello@fieldfix.io

---

*FieldFix AI is an independent troubleshooting aid. Always follow your plant's safety procedures and OEM documentation.*

© 2026 FieldFix AI LLC — All rights reserved
