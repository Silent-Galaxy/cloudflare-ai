📖 Setup & Development Guide | راهنمای راه‌اندازی و توسعه
🇮🇷 نسخه فارسی
🚀 شروع سریع
این پروژه روی Cloudflare Workers اجرا می‌شود. دو راه برای مدیریت آن دارید:
روش ۱: VS Code + اکستنشن Cloudflare Workers (پیشنهادی)
اکستنشن رسمی Cloudflare Workers را در VS Code نصب کنید
با یک کلیک Deploy کنید
لاگ‌ها را زنده ببینید
Bindings (D1، KV، Secrets) را گرافیکی مدیریت کنید
روش ۲: داشبورد Cloudflare
به dash.cloudflare.com بروید
از بخش Workers & Pages پروژه را مدیریت کنید
کد را آنلاین ویرایش کنید
متغیرها و Secrets را تنظیم کنید
📦 مراحل راه‌اندازی
Wrangler CLI را نصب کنید: npm install -g wrangler
با دستور wrangler login وارد حساب شوید
دیتابیس D1 بسازید و به پروژه متصل کنید
توکن تلگرام را با wrangler secret put TELEGRAM_TOKEN اضافه کنید
با wrangler deploy ربات را منتشر کنید
🧠 کمک گرفتن از Qwen
هر زمان سؤال داشتید یا خواستید قابلیتی اضافه کنید:
کل فایل src/index.js را کپی کنید
در Qwen پیست کنید
بگویید چه می‌خواهید (مثلاً: "این کد رو توضیح بده" یا "سیستم پرداخت اضافه کن")
Qwen خط به خط راهنمایی‌تان می‌کند
🤖 تست آنلاین
ربات هم‌اکنون فعال است: @SilentGalaxy_bot
می‌توانید قبل از راه‌اندازی، نسخه دمو را تست کنید و ببینید چطور کار می‌کند.
🇬🇧 English Version
🚀 Quick Start
This project runs on Cloudflare Workers. You have two ways to manage it:
Method 1: VS Code + Cloudflare Workers Extension (Recommended)
Install official Cloudflare Workers extension in VS Code
Deploy with one click
View logs in real-time
Manage Bindings (D1, KV, Secrets) visually
Method 2: Cloudflare Dashboard
Go to dash.cloudflare.com
Manage your project from Workers & Pages section
Edit code online
Configure variables and Secrets
📦 Setup Steps
Install Wrangler CLI: npm install -g wrangler
Login with wrangler login
Create D1 database and connect to project
Add Telegram token: wrangler secret put TELEGRAM_TOKEN
Deploy with wrangler deploy
🧠 Getting Help from Qwen
Whenever you have questions or want to add features:
Copy the entire src/index.js file
Paste it in Qwen
Tell me what you need (e.g., "Explain this code" or "Add payment system")
Qwen will guide you step by step
Live Demo
The bot is currently active: @SilentGalaxy_bot
You can test the demo version before deployment to see how it works.
