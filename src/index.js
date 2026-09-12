# 1. ذخیره کد کپی‌شده در فایل src/index.js
Get-Clipboard | Out-File -FilePath "src\index.js" -Encoding utf8

# 2. اضافه کردن و ثبت در گیت
git add src/index.js
git commit -m "feat: add main telegram bot source code (v5.12)"

# 3. ارسال به گیت‌هاب
git push
