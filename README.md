# 📖 Setup & Development Guide | راهنمای راه‌اندازی و توسعه

## Table of Contents
- [🚀 Quick Start](#-quick-start)
- [📦 Setup Steps](#-setup-steps)
- [🧠 Getting Help from Qwen](#-getting-help-from-qwen)
- [🤖 Live Demo](#-live-demo)
- [📸 Screenshots below | اسکرین‌شات‌ها در ادامه](#-screenshots-below--اسکرین‌شات‌ها-در-ادامه)

---

## 🚀 Quick Start

This project runs on Cloudflare Workers. You have two ways to manage it:

### Method 1: VS Code + Cloudflare Workers Extension (Recommended)
- Install the official Cloudflare Workers extension in VS Code
- Deploy with one click
- View logs in real-time
- Manage Bindings (D1, KV, Secrets) visually

### Method 2: Cloudflare Dashboard
- Go to [dash.cloudflare.com](https://dash.cloudflare.com)
- Manage your project from the Workers & Pages section
- Edit code online
- Configure variables and Secrets

---

## 📦 Setup Steps

1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```
   
2. Login with:
   ```bash
   wrangler login
   ```

3. Create a D1 database and connect it to your project.

4. Add your Telegram token:
   ```bash
   wrangler secret put TELEGRAM_TOKEN
   ```

5. Deploy your bot:
   ```bash
   wrangler deploy
   ```

---

## 🧠 Getting Help from Qwen

Whenever you have questions or want to add features:
1. Copy the entire `src/index.js` file.
2. Paste it in Qwen.
3. Tell me what you need (e.g., "Explain this code" or "Add payment system").

Qwen will guide you step by step.

---

## 🤖 Live Demo

The bot is currently active: [@SilentGalaxy_bot](https://t.me/SilentGalaxy_bot)

You can test the demo version before deployment to see how it works.

---

## 📸 Screenshots below | اسکرین‌شات‌ها در ادامه

*(Screenshots will be added here)*
