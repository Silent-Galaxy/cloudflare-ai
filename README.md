---

# 🤖 Cloudflare AI - Telegram Bot Platform

<div align="center">

[![Platform](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange)](https://workers.cloudflare.com/)
[![Database](https://img.shields.io/badge/Database-D1-blue)](https://developers.cloudflare.com/d1/)
[![Bot](https://img.shields.io/badge/Bot-Telegram-26A5E4)](https://t.me/SilentGalaxy_bot)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

**A production-ready Telegram bot for advertising campaigns and user earnings**

[English](#english) | [فارسی](#persian) | [Live Demo](https://t.me/SilentGalaxy_bot?start=ref_A7E3TR1K)

</div>

---

<a name="english"></a>
##  Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [📦 Setup Guide](#-setup-guide)
- [🛠️ Development Methods](#️-development-methods)
- [ AI Assistance with Qwen](#-ai-assistance-with-qwen)
- [ Project Structure](#-project-structure)
- [🤖 Live Demo](#-live-demo)
- [📸 Screenshots](#-screenshots)
- [📝 License](#-license)

---

## ✨ Features

### 💰 **Earning System**
- **Referral Program**: Earn 20% commission from each invite
- **XP-Based Levels**: 6 levels from Beginner (🥉) to Legendary (🔥)
- **Task Completion**: View ads and earn rewards automatically
- **Real-time Balance**: Track earnings and transactions

### 📢 **Campaign Management**
- **Create Ads**: Set budget, reward per join, and target channels
- **Auto-Verification**: Automatic user join/leave detection
- **Budget Tracking**: Monitor spent and remaining budget
- **Analytics**: View campaign statistics and user engagement

### 👥 **User Management**
- **Level System**: Progress through levels with XP points
- **Leaderboard**: Compete with other users
- **Transaction History**: Complete log of all financial activities
- **Privacy Settings**: Control visibility of your information

### ️ **Admin Panel**
- **Role-Based Permissions**: Granular access control
- **User Management**: View, search, and manage users
- **Broadcast Messages**: Send announcements to all users
- **Financial Controls**: Manage rewards, taxes, and budgets
- **Live Statistics**: Real-time bot analytics

###  **Technical Features**
- **Serverless**: Runs on Cloudflare's global edge network
- **D1 Database**: Optimized SQLite with pagination
- **Multi-Language**: Persian (Farsi) and English support
- **Fast Performance**: Minimal latency worldwide
- **Auto-Scaling**: Handles unlimited users automatically

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- Cloudflare account (free tier works)
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)

### Installation

```bash
# 1. Install Wrangler CLI globally
npm install -g wrangler

# 2. Clone the repository
git clone https://github.com/Silent-Galaxy/cloudflare-ai.git
cd cloudflare-ai

# 3. Login to Cloudflare
wrangler login

# 4. Create D1 database
wrangler d1 create cloudflare-ai-db

# 5. Initialize database schema
wrangler d1 execute cloudflare-ai-db --file=schema.sql

# 6. Add Telegram bot token
wrangler secret put TELEGRAM_TOKEN

# 7. Deploy to Cloudflare
wrangler deploy
```

### Configuration

Update `wrangler.toml` with your settings:

```toml
name = "cloudflare-ai"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "cloudflare-ai-db"
database_id = "your-database-id"

[vars]
ADMIN_IDS = ["your_telegram_id"]
```

---

## 📦 Setup Guide

### Method 1: VS Code + Cloudflare Extension (Recommended) 

**Why use this method?**
- ✅ One-click deployment
- ✅ Real-time logs and debugging
- ✅ Visual binding management
- ✅ Integrated development environment

**Steps:**
1. Install [VS Code](https://code.visualstudio.com/)
2. Install [Cloudflare Workers extension](https://marketplace.visualstudio.com/items?itemName=cloudflare.cloudflare-workers-bindings-extension)
3. Open project in VS Code
4. Click "Deploy" button in the extension panel

### Method 2: Cloudflare Dashboard

**Why use this method?**
- ✅ No local setup required
- ✅ Quick edits from anywhere
- ✅ Visual monitoring and analytics

**Steps:**
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages**
3. Create or select your worker
4. Edit code directly in the browser
5. Configure bindings and secrets from the dashboard

---

## 🛠️ Development Methods

### Local Development

```bash
# Start local development server
wrangler dev

# View logs in real-time
wrangler tail

# Run database migrations
wrangler d1 execute cloudflare-ai-db --file=migrations/001_add_column.sql
```

### Testing

```bash
# Test locally with Telegram webhook simulator
npm run test

# Check code quality
npm run lint
```

---

## 🧠 AI Assistance with Qwen

**Need help? Ask Qwen!** 🤖

This project is designed to be **AI-friendly**. You can get instant help for:

### What Qwen Can Do:
- 📖 **Explain Code**: Paste `src/index.js` and ask for explanations
- 🐛 **Debug Issues**: Get help fixing errors or bugs
- ✨ **Add Features**: Request new features (payment gateways, analytics, etc.)
- 🎨 **Customize UI**: Modify messages and button layouts
- 📊 **Optimize Queries**: Improve D1 database performance
- 🔐 **Security Review**: Audit code for vulnerabilities
-  **Add Languages**: Translate to new languages

### How to Use Qwen:

1. **Copy your code**:
   ```bash
   # Copy the entire source file
   cat src/index.js | pbcopy  # macOS
   cat src/index.js | clip    # Windows
   ```

2. **Paste in Qwen** and ask:
   - "Explain how the referral system works"
   - "Add a withdrawal feature"
   - "Optimize this database query"
   - "Fix the bug in the campaign creation"

3. **Get instant solutions** with code examples!

### Example Questions:
```
"چطور سیستم پرداخت به این ربات اضافه کنم؟"
"How do I add multi-language support?"
"Optimize the XP calculation function"
"Add export feature for admin statistics"
```

**Qwen understands both English and Persian!** 

---

## 📊 Project Structure

```
cloudflare-ai/
├── src/
│   └── index.js           # Main bot code (Telegram API + Business Logic)
├── schema.sql             # D1 database schema
├── wrangler.toml          # Cloudflare configuration
── package.json           # Node.js dependencies
└── README.md             # This file
```

### Key Components:

- **`src/index.js`**: Core bot logic including:
  - Telegram webhook handler
  - User registration and authentication
  - Campaign management system
  - Referral tracking
  - XP and leveling system
  - Admin panel functions

- **D1 Database Tables**:
  - `users`: User profiles, balances, XP, levels
  - `campaigns`: Ad campaigns with budgets and settings
  - `referrals`: Referral tracking and commissions
  - `transactions`: Financial transaction log
  - `campaign_participants`: User participation tracking

---

##  Live Demo

### Try it now! 

**Bot Username**: [@SilentGalaxy_bot](https://t.me/SilentGalaxy_bot)

**Start with referral link**:  
👉 [https://t.me/SilentGalaxy_bot?start=ref_A7E3TR1K](https://t.me/SilentGalaxy_bot?start=ref_A7E3TR1K)

### What you can test:
- ✅ User registration and leveling
- ✅ Viewing ads and earning rewards
- ✅ Referral system (invite friends)
- ✅ Campaign creation (if you have admin access)
- ✅ Statistics and transaction history
- ✅ Admin panel features

---

## 📸 Screenshots

### Bot Interface

*Add your screenshots here:*

```markdown
<!-- Example format -->
![Main Menu](screenshots/main-menu.png)
*Main menu with level, balance, and navigation*

![User Panel](screenshots/user-panel.png)
*User panel showing stats and referral link*

![Active Campaigns](screenshots/campaigns.png)
*List of active advertising campaigns*

![Admin Dashboard](screenshots/admin-panel.png)
*Admin panel with statistics and controls*
```

### How to add screenshots:

1. Take screenshots from the bot
2. Create a `screenshots/` folder in your repository
3. Upload images (PNG or JPG format)
4. Update the paths in the markdown above

---

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

##  Support & Contact

- **Telegram Bot**: [@SilentGalaxy_bot](https://t.me/SilentGalaxy_bot)
- **GitHub Issues**: [Report bugs or request features](https://github.com/Silent-Galaxy/cloudflare-ai/issues)
- **Email**: amiralisalehpoor@gmail.com

---

## 🙏 Acknowledgments

- **Cloudflare** for providing the serverless platform
- **Telegram** for the Bot API
- **Qwen AI** for development assistance
- **All contributors** who help improve this project

---

<div align="center">

**Made with ❤️ using Cloudflare Workers & Qwen AI**

[⬆ Back to Top](#-cloudflare-ai---telegram-bot-platform)

</div>

---

<a name="persian"></a>
---

## 🇮 راهنمای فارسی

###  ویژگی‌های اصلی

#### 💰 **سیستم کسب درآمد**
- **زیرمجموعه‌گیری**: ۰٪ پاداش از هر دعوت
- **سطح‌بندی**: ۶ سطح از تازه‌کار (🥉) تا افسانه‌ای (🔥)
- **مشاهده تبلیغات**: کسب درآمد خودکار با دیدن تبلیغات
- **موجودی لحظه‌ای**: پیگیری درآمد و تراکنش‌ها

####  **مدیریت کمپین‌ها**
- **ایجاد تبلیغ**: تعیین بودجه، پاداش و کانال هدف
- **تأیید خودکار**: تشخیص عضویت/ترک کاربران
- **پیگیری بودجه**: نظارت بر هزینه و باقی‌مانده
- **آمار و تحلیل**: مشاهده آمار کمپین و مشارکت کاربران

#### 👥 **مدیریت کاربران**
- **سیستم سطح**: پیشرفت با امتیاز XP
- **جدول رده‌بندی**: رقابت با سایر کاربران
- **تاریخچه تراکنش‌ها**: ثبت کامل فعالیت‌های مالی
- **تنظیمات حریم خصوصی**: کنترل نمایش اطلاعات

#### 🛡️ **پنل مدیریت**
- **دسترسی‌های نقش‌محور**: کنترل دسترسی دقیق
- **مدیریت کاربران**: مشاهده، جستجو و مدیریت
- **پیام همگانی**: ارسال اعلان به همه کاربران
- **کنترل‌های مالی**: مدیریت پاداش‌ها، مالیات و بودجه
- **آمار زنده**: تحلیل لحظه‌ای ربات

####  **ویژگی‌های فنی**
- **بدون سرور**: اجرا روی شبکه جهانی کلادفلر
- **دیتابیس D1**: SQLite بهینه‌شده با صفحه‌بندی
- **دو زبانه**: پشتیبانی از فارسی و انگلیسی
- **عملکرد سریع**: کمترین تأخیر در سراسر جهان
- **مقیاس‌پذیری خودکار**: پشتیبانی از کاربران نامحدود

---

### 🚀 شروع سریع (فارسی)

#### پیش‌نیازها
- نصب Node.js 18+
- حساب کلادفلر (نسخه رایگان کافی است)
- توکن ربات تلگرام از [@BotFather](https://t.me/BotFather)

#### نصب و راه‌اندازی

```bash
# ۱. نصب Wrangler CLI
npm install -g wrangler

# ۲. کلون کردن پروژه
git clone https://github.com/Silent-Galaxy/cloudflare-ai.git
cd cloudflare-ai

# ۳. ورود به کلادفلر
wrangler login

# ۴. ساخت دیتابیس D1
wrangler d1 create cloudflare-ai-db

# ۵. اجرای اسکیمای دیتابیس
wrangler d1 execute cloudflare-ai-db --file=schema.sql

# ۶. اضافه کردن توکن تلگرام
wrangler secret put TELEGRAM_TOKEN

# ۷. انتشار روی کلادفلر
wrangler deploy
```

---

### 🧠 کمک از هوش مصنوعی Qwen (فارسی)

**نیاز به کمک دارید؟ از Qwen بپرسید!** 🤖

این پروژه برای کمک هوش مصنوعی طراحی شده. می‌توانید برای موارد زیر کمک بگیرید:

#### Qwen چه کارهایی می‌تواند انجام دهد:
- 📖 **توضیح کد**: فایل `src/index.js` را بدهید و توضیح بخواهید
- 🐛 **رفع اشکال**: کمک در رفع خطاها و باگ‌ها
- ✨ **اضافه کردن قابلیت**: درخواست ویژگی‌های جدید (درگاه پرداخت، تحلیل و غیره)
-  **شخصی‌سازی**: تغییر پیام‌ها و چیدمان دکمه‌ها
- 📊 **بهینه‌سازی**: بهبود عملکرد دیتابیس D1
-  **بررسی امنیت**: audit کد برای آسیب‌پذیری‌ها
- 🌐 **افزودن زبان**: ترجمه به زبان‌های جدید

#### چطور از Qwen استفاده کنید:

1. **کد خود را کپی کنید**:
   ```bash
   # کپی کردن کل فایل سورس
   cat src/index.js | pbcopy  # مک
   cat src/index.js | clip    # ویندوز
   ```

2. **در Qwen پیست کنید** و بپرسید:
   - "این کد چطور کار می‌کنه؟"
   - "سیستم پرداخت اضافه کن"
   - "این کوئری دیتابیس رو بهینه کن"
   - "باگ بخش ساخت کمپین رو رفع کن"

3. **راه‌حل فوری با مثال کد بگیرید!**

#### نمونه سؤالات:
```
"چطور سیستم پرداخت به این ربات اضافه کنم؟"
"چطور زبان جدید اضافه کنم؟"
"تابع محاسبه XP رو بهینه کن"
"قابلیت خروجی گرفتن از آمار ادمین اضافه کن"
```

**Qwen هم انگلیسی و هم فارسی می‌فهمد!** 🌍

---

###  نسخه دمو (فارسی)

**همین الان تست کنید!** 🚀

**نام کاربری ربات**: [@SilentGalaxy_bot](https://t.me/SilentGalaxy_bot)

**شروع با لینک دعوت**:  
👉 [https://t.me/SilentGalaxy_bot?start=ref_A7E3TR1K](https://t.me/SilentGalaxy_bot?start=ref_A7E3TR1K)

**چی می‌تونید تست کنید**:
- ✅ ثبت‌نام کاربر و سیستم سطح‌بندی
- ✅ مشاهده تبلیغات و کسب درآمد
- ✅ سیستم زیرمجموعه‌گیری (دعوت دوستان)
- ✅ ساخت کمپین (اگر دسترسی ادمین دارید)
- ✅ آمار و تاریخچه تراکنش‌ها
- ✅ ویژگی‌های پنل مدیریت

---

### 📞 پشتیبانی و تماس (فارسی)

- **ربات تلگرام**: [@SilentGalaxy_bot](https://t.me/SilentGalaxy_bot)
- **گیت‌هاب**: [گزارش باگ یا درخواست ویژگی](https://github.com/Silent-Galaxy/cloudflare-ai/issues)
- **ایمیل**: amiralisalehpoor@gmail.com

---

<div align="center">

**ساخته شده با ❤️ توسط Cloudflare Workers و Qwen AI**

[بازگشت به بالا](#-cloudflare-ai---telegram-bot-platform)




<img width="1280" height="1392" alt="image" src="https://github.com/user-attachments/assets/196d6e1c-27a3-4d14-b811-9e8c72e4f0d7" />







<img width="477" height="743" alt="image" src="https://github.com/user-attachments/assets/f5577d7a-1360-4883-a466-ae66b878e7f0" />


<img width="477" height="849" alt="image" src="https://github.com/user-attachments/assets/36d29e51-90d0-4c1c-bf40-2db5e50e7b7b" />

<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/2e6410fd-c5fd-40e4-bf28-980cb79e6f79" />


<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/d59d5211-3203-4665-af42-8363f515198a" />




<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/975c914e-16d2-421e-8bdb-fb350d3c41dc" />

<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/1e866986-9751-4de0-8a9a-90d2b1440761" />
<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/bef4ff34-ce54-4b4c-ab2a-ab0df11a1d31" />

<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/b0932582-9b23-46fe-a1e1-f9e9027ab869" />


<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/0414fe19-1f25-4fd5-8e38-f1cda3056e1b" />
<img width="477" height="694" alt="image" src="https://github.com/user-attachments/assets/98500074-29fe-4569-b83b-f9de3d4e4617" />
<img width="477" height="694" alt="image" src="https://github.com/user-attachments/assets/d0584344-30a9-422a-abfa-1af969609035" />

<img width="477" height="694" alt="image" src="https://github.com/user-attachments/assets/19d08412-586b-4f24-aa45-3f10e0422d5c" />

<img width="477" height="694" alt="image" src="https://github.com/user-attachments/assets/1087f605-c92b-4f8f-8e3b-4f634cf460e3" />





<img width="477" height="1112" alt="image" src="https://github.com/user-attachments/assets/99e8507d-5076-4a37-8547-e73f94be025b" />

<img width="477" height="1338" alt="image" src="https://github.com/user-attachments/assets/b8f334bc-bfa6-4311-a6ec-ce5449e9d3f1" />

<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/25bfce00-3c25-4a9d-88c5-9de60109cbee" />


<img width="477" height="827" alt="image" src="https://github.com/user-attachments/assets/f3cd8f2c-bcd9-4778-adae-593acb6dfa2a" />

<img width="477" height="986" alt="image" src="https://github.com/user-attachments/assets/14a99012-73b8-47ed-9f09-b069a124a6c7" />


<img width="477" height="986" alt="image" src="https://github.com/user-attachments/assets/263fda71-2896-487c-b215-8b328f967db4" />


<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/b4b152ca-b3f5-414d-b6ee-bde9674dacea" />



<img width="477" height="745" alt="image" src="https://github.com/user-attachments/assets/0b495f7b-2203-413f-b8b7-106fe38d3159" />

<img width="477" height="745" alt="image" src="https://github.com/user-attachments/assets/b95088ac-0450-4890-a6c2-9a29e2aabdcf" />

<img width="477" height="745" alt="image" src="https://github.com/user-attachments/assets/47ce3bc8-c42f-4d0d-997a-7e67a414e8b8" />

<img width="477" height="745" alt="image" src="https://github.com/user-attachments/assets/b88db063-9834-491a-98fd-89371664adb3" />


<img width="477" height="952" alt="image" src="https://github.com/user-attachments/assets/692820bf-1120-4455-99bb-d553b706dc3d" />


<img width="477" height="1113" alt="image" src="https://github.com/user-attachments/assets/0e52a2c7-fe8b-48d8-aafc-321fb6e414dd" />


<img width="477" height="1113" alt="image" src="https://github.com/user-attachments/assets/45836b34-e1c3-43a5-a4ea-9c36df03c1f8" />



<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/944b9b18-bd54-4fe9-819b-c4c9f252b457" />


<img width="477" height="632" alt="image" src="https://github.com/user-attachments/assets/9df57701-b53f-4a3d-a0ff-e13eb804f26f" />





</div>

---
