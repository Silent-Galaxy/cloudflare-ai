/**
 * Telegram Bot — Cloudflare Worker (v5.12 — Admin Salary + Tax Share + Live Stats)
 * ربات تبلیغات و کسب درآمد تلگرام
 * Pagination استاندارد در همه لیست‌ها + بهینه‌سازی کوئری‌ها
 */

const API = "https://api.telegram.org/bot";
const SUPER_ADMIN = "90267861";
const BOT_FALLBACK = "SilentGalaxy_bot";
const DB = (env) => env.telegram_bot_db;
const PAGE_SIZE = 10;

// ==================== Levels ====================
const LEVELS = [
  { lvl: 1, name: "تازه‌کار", icon: "🥉", xp: 0 },
  { lvl: 2, name: "فعال", icon: "🥈", xp: 50 },
  { lvl: 3, name: "کسب‌کار", icon: "🥇", xp: 150 },
  { lvl: 4, name: "حرفه‌ای", icon: "💎", xp: 350 },
  { lvl: 5, name: "استاد", icon: "👑", xp: 700 },
  { lvl: 6, name: "افسانه‌ای", icon: "🔥", xp: 1500 },
];

function getLevel(xp) {
  xp = xp || 0;
  let cur = LEVELS[0], next = null;
  for (const l of LEVELS) if (xp >= l.xp) { cur = l; next = LEVELS[l.lvl] || null; }
  const progress = next ? Math.min(100, Math.round(((xp - cur.xp) / (next.xp - cur.xp)) * 100)) : 100;
  return { ...cur, next, progress, xpToNext: next ? next.xp - xp : 0 };
}

// ==================== Permissions ====================
const ALL_PERMS = [
  { key: "stats", label: "📊 آمار" }, { key: "users", label: "👥 کاربران" },
  { key: "block", label: "🚫 مسدود" }, { key: "setbal", label: "💰 موجودی" },
  { key: "tx_all", label: "🧾 تراکنش‌ها" }, { key: "user_tx", label: "🧾 تراکنش کاربر" },
  { key: "user_refs", label: "👥 زیرمجموعه" }, { key: "broadcast", label: "📢 همگانی" },
  { key: "ads_pending", label: "📋 تایید تبلیغ" }, { key: "financial", label: "💰 مالی" },
  { key: "set_role", label: "🎭 دسترسی‌ها" }, { key: "search", label: "🔍 سرچ" },
  { key: "content", label: "📝 محتوا" },
];

function getPerms(u, uid) {
  if (uid === SUPER_ADMIN) return ALL_PERMS.map(p => p.key);
  if (u?.is_admin === 1 && (!u?.admin_role || u.admin_role === "null")) return ALL_PERMS.map(p => p.key);
  if (u?.admin_role && u.admin_role !== "null") return u.admin_role.split(",").filter(Boolean);
  return [];
}

const isAdmin = (u, uid) => getPerms(u, uid).length > 0;
const canAccess = (u, uid, p) => getPerms(u, uid).includes(p);

function permLabels(u, uid) {
  const perms = getPerms(u, uid);
  if (!perms.length) return "—";
  if (perms.length === ALL_PERMS.length) return "👑 همه";
  return perms.map(p => (ALL_PERMS.find(a => a.key === p) || {}).label || p).join(" + ");
}

// ==================== Telegram API ====================
async function tg(token, method, params = {}) {
  try {
    const r = await fetch(`${API}${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    });
    return await r.json();
  } catch (e) { console.error(`API ${method}:`, e); return null; }
}

const kb = (btns) => ({ inline_keyboard: btns.filter(r => r.length > 0) });
const edit = (env, cid, mid, text, btns) => tg(env.TELEGRAM_TOKEN, "editMessageText", { chat_id: cid, message_id: mid, text, reply_markup: kb(btns) });
const send = (env, cid, text, btns) => tg(env.TELEGRAM_TOKEN, "sendMessage", { chat_id: cid, text, reply_markup: btns ? kb(btns) : undefined });
const alert = (env, cbId, text, alert = true) => tg(env.TELEGRAM_TOKEN, "answerCallbackQuery", { callback_query_id: cbId, text, show_alert: alert });

// ==================== DB Helpers ====================
async function getSetting(env, key, def) {
  const s = await DB(env).prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  if (!s) return def;
  const n = Number(s.value);
  return isNaN(n) ? s.value : n;
}

async function setSetting(env, key, val) {
  await DB(env).prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").bind(key, val.toString()).run();
}

async function getUser(env, uid) {
  return DB(env).prepare("SELECT * FROM users WHERE telegram_id = ?").bind(uid).first();
}

async function registerUser(env, from) {
  const uid = from?.id?.toString() || "";
  const code = Math.random().toString(36).substring(2, 10).toUpperCase();
  await DB(env).prepare(
    "INSERT OR IGNORE INTO users (telegram_id, first_name, username, referral_code, privacy_leaderboard, privacy_show_name) VALUES (?, ?, ?, ?, 1, 1)"
  ).bind(uid, from?.first_name || "", from?.username || "", code).run();
  const u = await getUser(env, uid);
  if (u && !u.referral_code) {
    await DB(env).prepare("UPDATE users SET referral_code = ? WHERE telegram_id = ? AND referral_code IS NULL").bind(code, uid).run();
    u.referral_code = code;
  }
  return u;
}

async function setState(env, uid, state, data) {
  await DB(env).prepare("UPDATE users SET user_state = ?, state_data = ? WHERE telegram_id = ?").bind(state, data ? JSON.stringify(data) : null, uid).run();
}

async function clearState(env, uid) {
  await DB(env).prepare("UPDATE users SET user_state = NULL, state_data = NULL WHERE telegram_id = ?").bind(uid).run();
}

async function addTx(env, uid, type, amount, desc, ref) {
  try { await DB(env).prepare("INSERT INTO transactions (user_id, type, amount, description, reference_id) VALUES (?, ?, ?, ?, ?)").bind(uid, type, amount, desc, ref || null).run(); }
  catch (e) { console.error("tx:", e); }
}

async function logTax(env, campaignId, userId, amount, taxType) {
  try { await DB(env).prepare("INSERT INTO tax_log (campaign_id, user_id, amount, tax_type) VALUES (?, ?, ?, ?)").bind(campaignId || null, userId, amount, taxType).run(); }
  catch (e) { console.error("tax:", e); }
}

async function addXP(env, uid, xp) {
  try {
    const u = await getUser(env, uid);
    if (!u) return null;
    const oldXP = u.xp || 0, newXP = oldXP + xp;
    const oldLvl = getLevel(oldXP), newLvl = getLevel(newXP);
    await DB(env).prepare("UPDATE users SET xp = ? WHERE telegram_id = ?").bind(newXP, uid).run();
    if (newLvl.lvl > oldLvl.lvl) {
      await tg(env.TELEGRAM_TOKEN, "sendMessage", {
        chat_id: parseInt(uid),
        text: `${newLvl.icon} تبریک! به سطح ${newLvl.lvl} (${newLvl.name}) ارتقا یافتید!\n📊 XP: ${newXP}`,
      });
    }
    return { oldLvl, newLvl, newXP };
  } catch (e) { console.error("addXP:", e); return null; }
}

async function isMember(env, uid, channel) {
  try {
    const r = await tg(env.TELEGRAM_TOKEN, "getChatMember", { chat_id: channel, user_id: parseInt(uid) });
    return ["member", "administrator", "creator"].includes(r?.result?.status);
  } catch { return false; }
}

async function checkBotAdmin(env, channel) {
  try {
    const bi = await tg(env.TELEGRAM_TOKEN, "getMe");
    const bid = bi?.result?.id;
    if (!bid) return false;
    const m = await tg(env.TELEGRAM_TOKEN, "getChatMember", { chat_id: channel, user_id: bid });
    const s = m?.result?.status;
    return s === "administrator" || s === "creator";
  } catch { return false; }
}

// ==================== Formatting ====================
const TX_LABELS = {
  ad_creation: "ایجاد تبلیغ", ad_reward: "پاداش تبلیغ", ad_refund: "بازگشت وجه",
  referral: "پاداش دعوت", admin_adjust: "تنظیم مدیر", ad_penalty: "جریمه لفت", ad_renew: "تمدید ساعتی", like_reward: "پاداش لایک", activity_reward: "پاداش فعالیت", admin_salary: "حقوق ادمین", admin_tax_share: "سهم مالیات ادمین",
};

function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d.replace(" ", "T") + "Z").toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }); }
  catch { return d.split(".")[0].replace("T", " "); }
}

function fmtTx(t, withDate = true) {
  const icon = t.amount > 0 ? "🟢" : "🔴";
  const label = TX_LABELS[t.type] || t.type;
  let line = `${icon} ${t.amount > 0 ? "+" : ""}${t.amount} — ${label}`;
  if (t.description && t.description !== label) line += `\n   💬 ${t.description}`;
  if (withDate && t.created_at) line += `\n   🕐 ${fmtDate(t.created_at)}`;
  if (t.reference_id) line += `\n   🔖 ${t.reference_id}`;
  return line;
}

// ==================== Pagination (Standardized) ====================
function pageNav(prefix, offset, limit, hasMore) {
  const nav = [];
  if (offset > 0) nav.push({ text: "⬅️ قبلی", callback_data: `${prefix}_${Math.max(0, offset - limit)}` });
  if (hasMore) nav.push({ text: "➡️ بعدی", callback_data: `${prefix}_${offset + limit}` });
  return nav.length ? [nav] : [];
}

function pageIndicator(offset, limit, total) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit) || 1;
  return `📄 صفحه ${page} از ${pages} (${total} مورد)`;
}

async function paginatedList(opts) {
  const { env, cid, mid, title, query, countQuery, bindParams, prefix, backBtns, formatter, limit = PAGE_SIZE } = opts;
  const offset = parseInt(prefix.match(/_(\d+)$/)?.[1] || "0") || 0;
  const [rows, count] = await Promise.all([
    DB(env).prepare(`${query} LIMIT ? OFFSET ?`).bind(...bindParams, limit, offset).all(),
    DB(env).prepare(countQuery).bind(...bindParams).first(),
  ]);
  const total = count?.c || 0;
  let text = `${title}\n━━━━━━━━━━━━━━━━\n\n`;
  const btns = [];
  if (rows.results.length === 0) { text += "موردی وجود ندارد."; }
  else {
    text += pageIndicator(offset, limit, total) + "\n\n";
    text += rows.results.map((r, i) => formatter(r, offset + i)).join("\n\n");
  }
  const navPrefix = prefix.replace(/_\d+$/, "");
  const nav = pageNav(navPrefix, offset, limit, rows.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push(...backBtns);
  await edit(env, cid, mid, text, btns);
}

// ==================== Bot Username ====================
let _botUser = null;
async function getBotUsername(env) {
  if (_botUser) return _botUser;
  const cached = await getSetting(env, "bot_username", null);
  if (cached) { _botUser = cached; return _botUser; }
  const r = await tg(env.TELEGRAM_TOKEN, "getMe");
  if (r?.ok && r.result?.username) {
    _botUser = r.result.username;
    await setSetting(env, "bot_username", _botUser);
    return _botUser;
  }
  return BOT_FALLBACK;
}

// ==================== Budget Calculator ====================
function budgetButtons(prefix, budget, ok) {
  const btns = [];
  if (ok || budget === 0) {
    btns.push([{ text: "➕100", callback_data: `${prefix}_add_100` }, { text: "➕500", callback_data: `${prefix}_add_500` }, { text: "➕1000", callback_data: `${prefix}_add_1000` }]);
    if (budget >= 100) btns.push([{ text: "➖100", callback_data: `${prefix}_sub_100` }, { text: "➖500", callback_data: `${prefix}_sub_500` }]);
  } else {
    btns.push([{ text: "➖100", callback_data: `${prefix}_sub_100` }, { text: "➖500", callback_data: `${prefix}_sub_500` }]);
  }
  return btns;
}

function budgetText(title, channel, budget, cost, taxP, balance) {
  const tax = Math.ceil(budget * (taxP / 100));
  const total = budget + tax;
  const ok = balance >= total;
  let text = `📊 بودجه\n\n📌 ${title}\n🔗 ${channel}\n\n💵 بودجه: ${budget}\n👥 ~${Math.floor(budget / cost)} عضو\n\n`;
  text += `• پایه: ${budget}\n• مالیات (${taxP}%): ${tax}\n`;
  text += ok || budget === 0 ? `• کل: ${total} ✅` : `• کل: ${total} ❌ (کمبود: ${total - balance})`;
  return { text, ok, total, tax };
}

// ==================== Cron: Left Detection ====================
async function checkLeftMembers(env) {
  const botInfo = await tg(env.TELEGRAM_TOKEN, "getMe");
  const botId = botInfo?.result?.id;
  const now = Date.now();
  const campaigns = await DB(env).prepare("SELECT id, channel_username, title, reward_per_join, owner_id, total_budget, spent, tax_percent, hourly_cost, hourly_paid, last_hour_check FROM campaigns WHERE status = 'active'").all();
  let checked = 0, left = 0, stopped = 0, hourlyCharged = 0;
  for (const ad of campaigns.results) {
    let botAdmin = false;
    if (botId) {
      try {
        const m = await tg(env.TELEGRAM_TOKEN, "getChatMember", { chat_id: ad.channel_username, user_id: botId });
        const st = m?.result?.status;
        botAdmin = st === "administrator" || st === "creator";
      } catch { botAdmin = false; }
    }
    if (!botAdmin) {
      stopped++;
      const sp = ad.spent || 0;
      const remaining = (ad.total_budget || 0) - sp;
      const taxP = ad.tax_percent || 5;
      const refundTax = Math.ceil(remaining * (taxP / 100));
      const totalRefund = remaining + refundTax;
      await DB(env).prepare("UPDATE campaigns SET status = 'stopped', total_budget = ? WHERE id = ?").bind(sp, ad.id).run();
      const ownerId = ad.owner_id?.toString();
      if (ownerId) {
        if (totalRefund > 0) {
          await DB(env).prepare("UPDATE users SET balance = balance + ? WHERE telegram_id = ?").bind(totalRefund, ownerId).run();
          const refId = "stop_" + ad.id + "_" + Date.now();
          await addTx(env, ownerId, "ad_refund", totalRefund, "بازگشت - توقف خودکار (ربات ادمین نیست): " + (ad.title || ad.channel_username), refId);
          await logTax(env, ad.id, ownerId, -refundTax, "stop_refund");
        }
        await tg(env.TELEGRAM_TOKEN, "sendMessage", {
          chat_id: parseInt(ownerId),
          text: "🛑 تبلیغ شما متوقف شد!\n\n📌 " + (ad.title || ad.channel_username) + "\n🔗 " + ad.channel_username + "\n\n❌ دلیل: ربات ادمین کانال نیست (حذف/بن/کیک شده یا کانال در دسترس نیست)\n\n💸 خرج: " + sp + " | 💵 باقی: " + remaining + " | 💰 بازگشت: " + totalRefund + "\n\n💡 ربات را دوباره ادمین کنید و تبلیغ را تمدید کنید."
        });
      }
      continue;
    }
    const hourlyCost = ad.hourly_cost || 0;
    if (hourlyCost > 0) {
      const lastCheck = ad.last_hour_check ? new Date(ad.last_hour_check.replace(" ", "T") + "Z").getTime() : 0;
      const hoursElapsed = Math.floor((now - lastCheck) / 3600000);
      if (hoursElapsed >= 1) {
        const charge = hoursElapsed * hourlyCost;
        const currentRemaining = (ad.total_budget || 0) - (ad.spent || 0) - (ad.hourly_paid || 0);
        if (charge >= currentRemaining) {
          const finalCharge = currentRemaining;
          await DB(env).prepare("UPDATE campaigns SET hourly_paid = hourly_paid + ?, spent = spent + ?, last_hour_check = CURRENT_TIMESTAMP, status = 'completed' WHERE id = ?").bind(finalCharge, finalCharge, ad.id).run();
          const ownerId = ad.owner_id?.toString();
          if (ownerId) {
            await tg(env.TELEGRAM_TOKEN, "sendMessage", {
              chat_id: parseInt(ownerId),
              text: "⏰ بودجه ساعتی تمام شد!\n\n📌 " + (ad.title || ad.channel_username) + "\n💰 هزینه ساعتی: " + hourlyCost + "/ساعت\n💸 کل کسر ساعتی: " + ((ad.hourly_paid || 0) + finalCharge) + "\n\n💡 برای ادامه، تبلیغ را تمدید کنید."
            });
          }
          hourlyCharged++;
          continue;
        } else {
          await DB(env).prepare("UPDATE campaigns SET hourly_paid = hourly_paid + ?, spent = spent + ?, last_hour_check = CURRENT_TIMESTAMP WHERE id = ?").bind(charge, charge, ad.id).run();
          hourlyCharged++;
          const ownerId = ad.owner_id?.toString();
          if (ownerId) {
            await tg(env.TELEGRAM_TOKEN, "sendMessage", {
              chat_id: parseInt(ownerId),
              text: "⏰ کسر ساعتی\n\n📌 " + (ad.title || ad.channel_username) + "\n💰 " + hoursElapsed + " ساعت × " + hourlyCost + " = " + charge + " امتیاز\n💵 باقی‌مانده: " + (currentRemaining - charge)
            });
          }
        }
      }
    }
    const participants = await DB(env).prepare("SELECT user_id FROM campaign_participants WHERE campaign_id = ? AND status = 'rewarded'").bind(ad.id).all();
    for (const p of participants.results) {
      checked++;
      if (!(await isMember(env, p.user_id, ad.channel_username))) {
        left++;
        const reward = ad.reward_per_join || 0;
        await DB(env).prepare("UPDATE campaign_participants SET status = 'left' WHERE campaign_id = ? AND user_id = ?").bind(ad.id, p.user_id).run();
        await DB(env).prepare("UPDATE users SET balance = MAX(0, balance - ?), total_earnings = MAX(0, total_earnings - ?) WHERE telegram_id = ?").bind(reward, reward, p.user_id).run();
        await addTx(env, p.user_id, "ad_penalty", -reward, "جریمه لفت (خودکار): " + (ad.title || ad.channel_username), "cron_left_" + ad.id + "_" + p.user_id + "_" + Date.now());
        await DB(env).prepare("UPDATE campaigns SET spent = MAX(0, spent - ?) WHERE id = ?").bind(reward, ad.id).run();
        await tg(env.TELEGRAM_TOKEN, "sendMessage", { chat_id: parseInt(p.user_id), text: "⚠️ از کانال لفت دادید!\n📌 " + (ad.title || ad.channel_username) + "\n❌ " + reward + " امتیاز کسر شد." });
        const ownerId = ad.owner_id?.toString();
        if (ownerId && ownerId !== p.user_id) {
          const leaver = await getUser(env, p.user_id);
          await tg(env.TELEGRAM_TOKEN, "sendMessage", { chat_id: parseInt(ownerId), text: "⚠️ کاربر لفت داد!\n📌 " + (ad.title || ad.channel_username) + "\n👤 " + (leaver?.first_name || leaver?.username || p.user_id) + "\n💰 " + reward + " به بودجه برگشت" });
        }
      }
    }
  }
  await DB(env).prepare("UPDATE campaigns SET status = 'completed' WHERE status = 'active' AND total_budget <= spent").run();
  // ===== Hourly activity reward + admin salary =====
  const activityReward = await getSetting(env, "activity_reward", 6);
  const adminSalary = await getSetting(env, "admin_salary", 100);
  const adminTaxShare = await getSetting(env, "admin_tax_share", 30);
  let rewarded = 0, adminPaidCount = 0;
  if (activityReward > 0 || adminSalary > 0) {
    const activeUsers = await DB(env).prepare("SELECT telegram_id, last_active, last_hourly_reward, is_admin FROM users WHERE last_active >= datetime('now', '-1 hour') AND is_blocked = 0").all();
    for (const au of activeUsers.results) {
      const already = au.last_hourly_reward && (now - new Date(au.last_hourly_reward.replace(" ", "T") + "Z").getTime()) < 3600000;
      if (already) continue;
      const amount = au.is_admin === 1 ? (activityReward + adminSalary) : activityReward;
      if (amount > 0) {
        await DB(env).prepare("UPDATE users SET balance = balance + ?, last_hourly_reward = CURRENT_TIMESTAMP WHERE telegram_id = ?").bind(amount, au.telegram_id).run();
        const label = au.is_admin === 1 ? "حقوق ادمین + پاداش فعالیت" : "پاداش فعالیت ساعتی";
        await addTx(env, au.telegram_id, au.is_admin === 1 ? "admin_salary" : "activity_reward", amount, label, "act_" + au.telegram_id + "_" + Date.now());
        if (au.is_admin === 1) adminPaidCount++; else rewarded++;
      }
    }
  }
  console.log("Cron: checked " + checked + ", left " + left + ", stopped " + stopped + ", hourlyCharged " + hourlyCharged + ", rewarded " + rewarded + ", adminPaid " + adminPaidCount);
  return { checked, left, stopped, hourlyCharged, rewarded, adminPaidCount };
}
// ==================== Menus ====================
async function settingsPage(env, cid, mid, u) {
  const lbOn = u?.privacy_leaderboard === 1;
  const nameOn = u?.privacy_show_name === 1;
  const ownerOn = u?.privacy_show_owner !== 0;
  const langFa = u?.lang !== "en";
  await edit(env, cid, mid, t(u, "settings_title") + "\n━━━━━━━━━━━━━━━━\n\n" + t(u, "privacy_title") + ":\n" + t(u, "privacy_lb") + ": " + (lbOn ? t(u,"on") : t(u,"off")) + "\n" + t(u, "privacy_name") + ": " + (nameOn ? t(u,"on") : t(u,"off")) + "\n" + t(u, "privacy_owner") + ": " + (ownerOn ? t(u,"on") : t(u,"off")) + "\n\n" + t(u, "lang_title") + ": " + (langFa ? "🇮🇷 فارسی" : "🇬🇧 English"), [
    [{ text: t(u, "privacy_lb") + ": " + (lbOn ? t(u,"on") : t(u,"off")), callback_data: "set_priv_lb" }, { text: t(u, "privacy_name") + ": " + (nameOn ? t(u,"on") : t(u,"off")), callback_data: "set_priv_name" }],
    [{ text: t(u, "privacy_owner") + ": " + (ownerOn ? t(u,"on") : t(u,"off")), callback_data: "set_priv_owner" }],
    [{ text: "🇮🇷 فارسی", callback_data: "set_lang_fa" }, { text: "🇬🇧 English", callback_data: "set_lang_en" }],
    [{ text: t(u, "back"), callback_data: "main" }],
  ]);
}
const I18N = {
  fa: {
    panel: "👤 پنل کاربری", ads: "📢 تبلیغات", inbox: "📥 اینباکس", stats: "📊 آمار ربات",
    lb: "🏆 لیدربورد", rules: "📜 قوانین", about: "ℹ️ درباره ما", tutorial: "📚 آموزش",
    settings: "⚙️ تنظیمات", admin: "⚙️ مدیریت", back: "🏠 بازگشت",
    balance: "💰 موجودی", earnings: "📈 کل درآمد", activity: "⏱️ فعالیت",
    level: "سطح", xp: "📊 XP", joins: "🎯 تبلیغات انجام‌شده", my_ads: "📢 تبلیغات ایجادشده",
    refs: "👥 دعوت‌شده‌ها", ref_income: "💵 درآمد از دعوت", share: "📤 اشتراک لینک",
    my_subs: "👥 زیرمجموعه‌ها", txs: "🧾 تراکنش‌ها",
    privacy_title: "🔒 حریم خصوصی", privacy_lb: "نمایش در لیدربورد", privacy_name: "نمایش نام/آیدی", privacy_owner: "نمایش به‌عنوان صاحب تبلیغ",
    lang_title: "🌐 زبان", lang_fa: "🇮🇷 فارسی", lang_en: "🇬🇧 English",
    settings_title: "⚙️ تنظیمات", on: "✅ روشن", off: "❌ خاموش",
    welcome: "👋", coin: "سکه", hour: "ساعت", member: "عضو",
  },
  en: {
    panel: "👤 Profile", ads: "📢 Ads", inbox: "📥 Inbox", stats: "📊 Bot Stats",
    lb: "🏆 Leaderboard", rules: "📜 Rules", about: "ℹ️ About", tutorial: "📚 Tutorial",
    settings: "⚙️ Settings", admin: "⚙️ Admin", back: "🏠 Back",
    balance: "💰 Balance", earnings: "📈 Total Earnings", activity: "⏱️ Activity",
    level: "Level", xp: "📊 XP", joins: "🎯 Joins Done", my_ads: "📢 Ads Created",
    refs: "👥 Invited", ref_income: "💵 Referral Income", share: "📤 Share Link",
    my_subs: "👥 Referrals", txs: "🧾 Transactions",
    privacy_title: "🔒 Privacy", privacy_lb: "Show in Leaderboard", privacy_name: "Show Name/ID", privacy_owner: "Show as Ad Owner",
    lang_title: "🌐 Language", lang_fa: "🇮🇷 فارسی", lang_en: "🇬🇧 English",
    settings_title: "⚙️ Settings", on: "✅ On", off: "❌ Off",
    welcome: "👋", coin: "coins", hour: "hours", member: "members",
  },
};
function t(u, key) { const lang = u?.lang === 'en' ? 'en' : 'fa'; return I18N[lang]?.[key] ?? I18N.fa[key] ?? key; }
async function mainMenu(env, cid, mid, u, admin) {
  const lvl = getLevel(u?.xp || 0);
  const btns = [
    [{ text: t(u, "panel"), callback_data: "user_panel" }],
    [{ text: t(u, "ads"), callback_data: "ads_menu" }],
    [{ text: t(u, "inbox"), callback_data: "inbox_0" }, { text: t(u, "stats"), callback_data: "bot_stats" }],
    [{ text: t(u, "lb"), callback_data: "lb_earnings_0" }, { text: t(u, "rules"), callback_data: "rules" }],
    [{ text: t(u, "about"), callback_data: "about" }, { text: t(u, "tutorial"), callback_data: "tutorial" }],
    [{ text: t(u, "settings"), callback_data: "settings" }],
  ];
  if (admin) btns.push([{ text: "⚙️ مدیریت", callback_data: "admin" }]);
  const text = `👋 ${u?.first_name || "کاربر"}\n\n${lvl.icon} سطح ${lvl.lvl} (${lvl.name}) | 💰 ${u?.balance || 0} | 📈 ${u?.total_earnings || 0} | 📊 XP: ${u?.xp || 0}`;
  if (mid) await edit(env, cid, mid, text, btns);
  else await send(env, cid, text, btns);
}

async function userPanel(env, cid, mid, u) {
  const botU = await getBotUsername(env);
  const link = `https://t.me/${botU}?start=ref_${u?.referral_code || "------"}`;
  const lvl = getLevel(u?.xp || 0);
  const [refStats, txs, parts, adsCreated] = await Promise.all([
    DB(env).prepare("SELECT COUNT(*) as c, COALESCE(SUM(reward_amount), 0) as t FROM referrals WHERE referrer_id = ?").bind(u.telegram_id).first(),
    DB(env).prepare("SELECT type, amount, description, created_at, reference_id FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 5").bind(u.telegram_id).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaign_participants WHERE user_id = ? AND status = 'rewarded'").bind(u.telegram_id).first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE owner_id = ?").bind(u.telegram_id).first(),
  ]);
  let refByLine = "";
  if (u?.referred_by) {
    const refUser = await getUser(env, u.referred_by);
    if (refUser) refByLine = `\n📨 دعوت‌شده توسط: ${refUser.first_name || refUser.username || refUser.telegram_id}`;
  }
  const txSec = txs.results.length > 0 ? "\n\n🧾 آخرین تراکنش‌ها:\n" + txs.results.map(t => fmtTx(t, false)).join("\n") : "\n\n🧾 هنوز تراکنشی ندارید";
  const text = `👤 پنل — ${u?.first_name || "کاربر"}\n\n${lvl.icon} سطح ${lvl.lvl} — ${lvl.name}\n📊 XP: ${u?.xp || 0}${lvl.next ? ` → ${lvl.xpToNext} تا سطح بعد` : " (حداکثر)"}\n💰 موجودی: ${u?.balance || 0}\n📈 کل درآمد: ${u?.total_earnings || 0}
⏱️ فعالیت: ${Math.round((u?.total_active_seconds || 0) / 3600)} ساعت\n🎯 تبلیغات انجام‌شده: ${parts?.c || 0}\n📢 تبلیغات ایجادشده: ${adsCreated?.c || 0}${refByLine}\n\n━━━━━━━━━━━━━\n🔗 سیستم دعوت\n👥 دعوت‌شده‌ها: ${refStats?.c || 0} نفر\n💵 درآمد از دعوت: ${refStats?.t || 0}${txSec}\n\n👇 لینک دعوت آماده‌ست`;
  const customShare = await getSetting(env, "referral_share_text", "");
  const shareText = customShare ? customShare.replace(/{name}/g, u?.first_name || "رفیق").replace(/{link}/g, link) : `🚀 ${u?.first_name || "رفیق"} دعوتت می‌کنه!\n\n🎁 عضو شو، تبلیغ ببین، امتیاز بگیر!\n${link}`;
  const btns = [
    [{ text: "📤 اشتراک لینک", switch_inline_query: shareText }],
    [{ text: "👥 زیرمجموعه‌ها", callback_data: "my_refs_0" }, { text: "🧾 تراکنش‌ها", callback_data: "all_tx_0" }],
    [{ text: t(u, "stats"), callback_data: "bot_stats" }, { text: t(u, "settings"), callback_data: "settings" }],
    [{ text: t(u, "back"), callback_data: "main" }],
  ];
  await edit(env, cid, mid, text, btns);
}

// ==================== Paginated User Lists ====================
async function myReferrals(env, cid, mid, u, offset) {
  await paginatedList({
    env, cid, mid, title: `👥 زیرمجموعه‌های ${u?.first_name || "شما"}`,
    query: `SELECT r.referred_id, r.reward_amount, r.created_at, u.first_name, u.username, u.balance, u.privacy_show_name FROM referrals r LEFT JOIN users u ON r.referred_id = u.telegram_id WHERE r.referrer_id = ? ORDER BY r.id DESC`,
    countQuery: "SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ?",
    bindParams: [u.telegram_id], prefix: `my_refs_${offset}`,
    backBtns: [[{ text: "👤 بازگشت", callback_data: "user_panel" }]],
    formatter: (r, i) => `${i + 1}. 👤 ${r.privacy_show_name === 0 ? "کاربر مخفی" : (r.first_name || r.username || r.referred_id)}\n   💰 +${r.reward_amount} | 💼 ${r.balance || 0} | 🕐 ${fmtDate(r.created_at)}`,
  });
}

async function allTransactions(env, cid, mid, u, offset) {
  const limit = PAGE_SIZE;
  const [txs, count] = await Promise.all([
    DB(env).prepare("SELECT type, amount, description, created_at, reference_id FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?").bind(u.telegram_id, limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM transactions WHERE user_id = ?").bind(u.telegram_id).first(),
  ]);
  let text = "🧾 تراکنش‌ها\n━━━━━━━━━━━━━━━━\n\n";
  const btns = [];
  if (txs.results.length === 0) { text += "تراکنشی ثبت نشده."; }
  else {
    text += pageIndicator(offset, limit, count?.c || 0) + "\n\n";
    let tin = 0, tout = 0;
    for (const t of txs.results) { t.amount > 0 ? tin += t.amount : tout += Math.abs(t.amount); }
    text += txs.results.map(t => fmtTx(t, true)).join("\n\n");
    text += `\n\n━━━━━━━━━━━━━━━━\n🟢 ${tin} | 🔴 ${tout} | 💰 ${tin - tout}`;
  }
  const nav = pageNav("all_tx", offset, limit, txs.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "👤 بازگشت", callback_data: "user_panel" }]);
  await edit(env, cid, mid, text, btns);
}

// ==================== Paginated Ads Menu ====================
async function adsMenu(env, cid, mid, uid, offset = 0) {
  const limit = PAGE_SIZE;
  const [ads, count] = await Promise.all([
    DB(env).prepare("SELECT * FROM campaigns WHERE status = 'active' ORDER BY id DESC LIMIT ? OFFSET ?").bind(limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'active'").first(),
  ]);
  let text = "📢 تبلیغات فعال\n━━━━━━━━━━━━━━━━\n\n";
  const btns = [];
  if (ads.results.length === 0) { text += "تبلیغی وجود ندارد.\n\nمی‌توانید خودتان بسازید!"; }
  else {
    text += pageIndicator(offset, limit, count?.c || 0) + "\n\n";
    const adIds = ads.results.map(a => a.id);
    const placeholders = adIds.map(() => "?").join(",");
    const [myParts, joinedCounts] = await Promise.all([
      DB(env).prepare(`SELECT campaign_id, status FROM campaign_participants WHERE user_id = ? AND campaign_id IN (${placeholders})`).bind(uid, ...adIds).all(),
      DB(env).prepare(`SELECT campaign_id, COUNT(*) as c FROM campaign_participants WHERE campaign_id IN (${placeholders}) AND status = 'rewarded' GROUP BY campaign_id`).bind(...adIds).all(),
    ]);
    const myPartMap = new Map(myParts.results.map(p => [p.campaign_id, p.status]));
    const joinedMap = new Map(joinedCounts.results.map(j => [j.campaign_id, j.c]));
    for (const ad of ads.results) {
      const pStatus = myPartMap.get(ad.id);
      const joined = joinedMap.get(ad.id) || 0;
      const st = pStatus ? (pStatus === "rewarded" ? "✅" : pStatus === "left" ? "⚠️" : "⏳") : "📝";
      text += `${st} ${ad.title || ad.channel_username}\n   🔗 ${ad.channel_username} | 💰 ${ad.reward_per_join || 0} | 👥 ${joined}\n\n`;
      btns.push([{ text: `${st} ${ad.title || ad.channel_username} — 💰${ad.reward_per_join || 0}`, callback_data: `ad_view_${ad.id}` }]);
    }
  }
  const nav = pageNav("ads_page", offset, limit, ads.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "➕ ایجاد تبلیغ", callback_data: "ad_create" }]);
  btns.push([{ text: "📋 تبلیغات من", callback_data: "my_ads_0" }]);
  btns.push([{ text: "🏠 بازگشت", callback_data: "main" }]);
  await edit(env, cid, mid, text, btns);
}

// ==================== Paginated My Ads ====================
async function myAds(env, cid, mid, uid, offset = 0) {
  const limit = PAGE_SIZE;
  const [ads, count] = await Promise.all([
    DB(env).prepare("SELECT * FROM campaigns WHERE CAST(owner_id AS TEXT) = ? ORDER BY id DESC LIMIT ? OFFSET ?").bind(uid, limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE CAST(owner_id AS TEXT) = ?").bind(uid).first(),
  ]);
  let text = "📋 تبلیغات من\n━━━━━━━━━━━━━━━━\n\n";
  const btns = [];
  if (ads.results.length === 0) { text += "هنوز تبلیغی نساخته‌اید."; }
  else {
    text += pageIndicator(offset, limit, count?.c || 0) + "\n\n";
    const adIds = ads.results.map(a => a.id);
    const placeholders = adIds.map(() => "?").join(",");
    const [joinedRows, leftRows] = await Promise.all([
      DB(env).prepare(`SELECT campaign_id, COUNT(*) as c FROM campaign_participants WHERE campaign_id IN (${placeholders}) AND status = 'rewarded' GROUP BY campaign_id`).bind(...adIds).all(),
      DB(env).prepare(`SELECT campaign_id, COUNT(*) as c FROM campaign_participants WHERE campaign_id IN (${placeholders}) AND status = 'left' GROUP BY campaign_id`).bind(...adIds).all(),
    ]);
    const joinedMap = new Map(joinedRows.results.map(j => [j.campaign_id, j.c]));
    const leftMap = new Map(leftRows.results.map(l => [l.campaign_id, l.c]));
    for (const ad of ads.results) {
      const spent = ad.spent || 0, remaining = (ad.total_budget || 0) - spent;
  const reacts = await DB(env).prepare("SELECT reaction, COUNT(*) as c FROM ad_reactions WHERE campaign_id = ? GROUP BY reaction").bind(adId).all();
  const goodC = reacts.results.find(x => x.reaction === "good")?.c || 0;
  const badC = reacts.results.find(x => x.reaction === "bad")?.c || 0;
      const si = ad.status === "active" ? "🟢" : ad.status === "pending" ? "⏳" : ad.status === "rejected" ? "❌" : ad.status === "stopped" ? "🛑" : "🔴";
      const joined = joinedMap.get(ad.id) || 0;
      const left = leftMap.get(ad.id) || 0;
      text += `${si} ${ad.title || ad.channel_username}\n   🔗 ${ad.channel_username} | 💰 ${ad.total_budget || 0}→${spent}→${remaining} | 👥${joined}/⚠️${left}\n\n`;
      btns.push([{ text: `📊 ${ad.title || ad.channel_username}`, callback_data: `ad_stats_${ad.id}` }]);
    }
  }
  const nav = pageNav("my_ads", offset, limit, ads.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "➕ ایجاد تبلیغ", callback_data: "ad_create" }]);
  btns.push([{ text: "🏠 بازگشت", callback_data: "main" }]);
  await edit(env, cid, mid, text, btns);
}

// ==================== Ad Stats Detail (with paginated participants) ====================
async function adStatsDetail(env, cid, mid, uid, adId, partOffset = 0) {
  const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ? AND CAST(owner_id AS TEXT) = ?").bind(adId, uid).first();
  if (!ad) return edit(env, cid, mid, "دسترسی ندارید.", [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
  const partLimit = PAGE_SIZE;
  const [joined, left, recent, totalCount] = await Promise.all([
    DB(env).prepare("SELECT COUNT(*) as c FROM campaign_participants WHERE campaign_id = ? AND status = 'rewarded'").bind(adId).first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaign_participants WHERE campaign_id = ? AND status = 'left'").bind(adId).first(),
    DB(env).prepare("SELECT cp.user_id, cp.status, u.first_name, u.username FROM campaign_participants cp LEFT JOIN users u ON cp.user_id = u.telegram_id WHERE cp.campaign_id = ? ORDER BY cp.joined_at DESC LIMIT ? OFFSET ?").bind(adId, partLimit, partOffset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaign_participants WHERE campaign_id = ?").bind(adId).first(),
  ]);
  const spent = ad.spent || 0, remaining = (ad.total_budget || 0) - spent;
  let text = `📊 آمار: ${ad.title || ad.channel_username}\n━━━━━━━━━━━━━━━━\n\n`;
  text += `🔗 ${ad.channel_username}\n📊 ${ad.status === "active" ? "🟢 فعال" : ad.status === "stopped" ? "🛑 متوقف‌شده (ربات ادمین نیست)" : ad.status}\n💰 بودجه: ${ad.total_budget || 0} | 💸 ${spent} | 💵 ${remaining}\n⏰ ساعتی: ${ad.hourly_cost || 0}/ساعت | پرداخت‌شده: ${ad.hourly_paid || 0}\n👥 ${joined?.c || 0} | ⚠️ ${left?.c || 0}\n👍 ${goodC} | 👎 ${badC}\n`;
  if (recent.results.length > 0) {
    text += `\n📋 شرکت‌کنندگان ${pageIndicator(partOffset, partLimit, totalCount?.c || 0)}:\n`;
    recent.results.forEach((r, i) => {
      const st = r.status === "rewarded" ? "✅" : r.status === "left" ? "⚠️" : "⏳";
      text += `${partOffset + i + 1}. ${st} ${r.first_name || r.username || r.user_id}\n`;
    });
  } else if (totalCount?.c > 0) {
    text += `\n📋 شرکت‌کنندگان (${pageIndicator(partOffset, partLimit, totalCount?.c || 0)}):\nاین صفحه خالی است.\n`;
  }
  const btns = [];
  const partNav = pageNav(`ad_part_${adId}`, partOffset, partLimit, recent.results.length === partLimit);
  if (partNav.length) btns.push(...partNav);
  if (ad.status === "active") btns.push([{ text: "🛑 پایان", callback_data: `ad_stop_${ad.id}` }, { text: "🔄 تمدید", callback_data: `ad_renew_${ad.id}` }, { text: "✏️ اصلاح", callback_data: `ad_edit_${ad.id}` }]);
  else if (ad.status === "cancelled" || ad.status === "completed" || ad.status === "stopped") btns.push([{ text: "🔄 تمدید", callback_data: `ad_renew_${ad.id}` }]);
  btns.push([{ text: "📋 بازگشت", callback_data: "my_ads_0" }]);
  await edit(env, cid, mid, text, btns);
}

// ==================== Leaderboard (Multi-Category) ====================
const LB_CATEGORIES = [
  { key: "earnings", label: "💰 بیشترین درآمد", icon: "💰", desc: "کل درآمد" },
  { key: "referrals", label: "👥 بیشترین رفرال", icon: "👥", desc: "تعداد دعوت" },
  { key: "joins", label: "🎯 بیشترین عضویت", icon: "🎯", desc: "تبلیغ انجام‌شده" },
  { key: "ads", label: "📢 بیشترین تبلیغ‌گذار", icon: "📢", desc: "تبلیغ ایجادشده" },
  { key: "active", label: "🔥 فعال‌ترین", icon: "🔥", desc: "ساعت فعالیت" },
  { key: "inactive", label: "💤 کم‌فعال‌ترین", icon: "💤", desc: "کمترین فعالیت" },
];

async function leaderboard(env, cid, mid, param) {
  if (!param || param === "0") param = "earnings_0";
  const parts = param.split("_");
  const category = parts[0] || "earnings";
  const offset = parseInt(parts[1] || "0") || 0;
  const limit = PAGE_SIZE;

  let query, countQuery, valueIcon;
  
  if (category === "earnings") {
    query = "SELECT first_name, username, total_earnings as val, xp, privacy_show_name FROM users WHERE privacy_leaderboard = 1 AND total_earnings > 0 ORDER BY total_earnings DESC LIMIT ? OFFSET ?";
    countQuery = "SELECT COUNT(*) as c FROM users WHERE privacy_leaderboard = 1 AND total_earnings > 0";
    valueIcon = "💰";
  } else if (category === "referrals") {
    query = "SELECT u.first_name, u.username, COUNT(r.id) as val, u.xp, u.privacy_show_name FROM users u LEFT JOIN referrals r ON r.referrer_id = u.telegram_id WHERE u.privacy_leaderboard = 1 GROUP BY u.telegram_id HAVING val > 0 ORDER BY val DESC LIMIT ? OFFSET ?";
    countQuery = "SELECT COUNT(*) as c FROM (SELECT referrer_id FROM referrals GROUP BY referrer_id) sub";
    valueIcon = "👥";
  } else if (category === "joins") {
    query = "SELECT u.first_name, u.username, COUNT(cp.id) as val, u.xp, u.privacy_show_name FROM users u LEFT JOIN campaign_participants cp ON cp.user_id = u.telegram_id AND cp.status = 'rewarded' WHERE u.privacy_leaderboard = 1 GROUP BY u.telegram_id HAVING val > 0 ORDER BY val DESC LIMIT ? OFFSET ?";
    countQuery = "SELECT COUNT(*) as c FROM (SELECT user_id FROM campaign_participants WHERE status = 'rewarded' GROUP BY user_id) sub";
    valueIcon = "🎯";
  } else if (category === "ads") {
    query = "SELECT u.first_name, u.username, COUNT(c.id) as val, u.xp, u.privacy_show_name FROM users u LEFT JOIN campaigns c ON CAST(c.owner_id AS TEXT) = u.telegram_id WHERE u.privacy_leaderboard = 1 GROUP BY u.telegram_id HAVING val > 0 ORDER BY val DESC LIMIT ? OFFSET ?";
    countQuery = "SELECT COUNT(*) as c FROM (SELECT owner_id FROM campaigns GROUP BY owner_id) sub";
    valueIcon = "📢";
  } else if (category === "active") {
    query = "SELECT first_name, username, total_active_seconds as val, xp, privacy_show_name FROM users WHERE privacy_leaderboard = 1 AND total_active_seconds > 0 ORDER BY total_active_seconds DESC LIMIT ? OFFSET ?";
    countQuery = "SELECT COUNT(*) as c FROM users WHERE privacy_leaderboard = 1 AND total_active_seconds > 0";
    valueIcon = "⏱️";
  } else if (category === "inactive") {
    query = "SELECT first_name, username, total_active_seconds as val, xp, privacy_show_name FROM users WHERE privacy_leaderboard = 1 ORDER BY total_active_seconds ASC LIMIT ? OFFSET ?";
    countQuery = "SELECT COUNT(*) as c FROM users WHERE privacy_leaderboard = 1";
    valueIcon = "💤";
  } else {
    return leaderboard(env, cid, mid, "earnings_0");
  }

  const [lb, total] = await Promise.all([
    DB(env).prepare(query).bind(limit, offset).all(),
    DB(env).prepare(countQuery).first(),
  ]);

  const cat = LB_CATEGORIES.find(c => c.key === category) || LB_CATEGORIES[0];
  let text = "🏆 لیدربورد — " + cat.label + "\n━━━━━━━━━━━━━━━━\n\n";
  const btns = [];

  const catBtns = LB_CATEGORIES.map(function(c) {
    return { text: category === c.key ? "✅ " + c.icon : c.icon, callback_data: "lb_" + c.key + "_0" };
  });
  for (let i = 0; i < catBtns.length; i += 2) btns.push([catBtns[i], catBtns[i + 1]]);

  if (lb.results.length === 0) {
    text += "هنوز کسی در این دسته‌بندی نیست.";
  } else {
    text += pageIndicator(offset, limit, total?.c || 0) + "\n\n";
    lb.results.forEach(function(u, i) {
      const rank = offset + i;
      const name = u.privacy_show_name ? (u.first_name || u.username || "کاربر " + (rank + 1)) : "کاربر " + (rank + 1);
      const lvl = getLevel(u.xp || 0);
      const medal = rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : (rank + 1) + ".";
      const displayVal = (category === "active" || category === "inactive") ? Math.round(u.val / 3600) + " ساعت" : u.val;
      text += medal + " " + lvl.icon + " " + name + " — " + valueIcon + " " + displayVal + "\n";
    });
  }

  const nav = pageNav("lb_" + category, offset, limit, lb.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "🏠 بازگشت", callback_data: "main" }]);
  await edit(env, cid, mid, text, btns);
}

// ==================== About / Tutorial / Likes ====================
async function aboutPage(env, cid, mid) {
  const content = await getSetting(env, "about_text", "");
  const likes = await DB(env).prepare("SELECT COUNT(*) as c FROM page_likes WHERE page_key = 'about'").first();
  const defaultText = "ℹ️ درباره ما\n\n🤖 ربات تبلیغات و کسب درآمد تلگرام\n\n🎯 هدف: تبلیغ کانال‌ها + کسب درآمد برای کاربران\n\n📢 صاحب کانال: تبلیغ بساز، عضو بگیر\n💰 کاربر: عضو شو، پاداش بگیر\n👥 دعوت دوستان = درآمد بیشتر\n\n🔒 ما حریم خصوصی شما را محترم می‌شماریم.";
  const text = (content || defaultText) + "\n\n👍 " + (likes?.c || 0) + " نفر این صفحه را مفید دانستند";
  await edit(env, cid, mid, text, [
    [{ text: "👍 مفید بود", callback_data: "like_about" }],
    [{ text: "🏠 بازگشت", callback_data: "main" }],
  ]);
}

async function tutorialPage(env, cid, mid) {
  const content = await getSetting(env, "tutorial_text", "");
  const likes = await DB(env).prepare("SELECT COUNT(*) as c FROM page_likes WHERE page_key = 'tutorial'").first();
  const cost = await getSetting(env, "ad_cost_per_join", 10);
  const taxP = await getSetting(env, "ad_tax_percent", 5);
  const refP = await getSetting(env, "referral_percent", 20);
  const defaultText = "📚 آموزش ربات\n\n1️⃣ تبلیغ زدن:\n• 📢 منو → ایجاد تبلیغ\n• آیدی کانال + عنوان + بودجه\n• ربات باید ادمین کانال باشد\n• هزینه/عضو: " + cost + " | مالیات: " + taxP + "%\n\n2️⃣ عضویت و درآمد:\n• 📢 تبلیغات → انتخاب کانال\n• عضو شو → ✅ بررسی → پاداش بگیر\n• ⚠️ لفت = کسر خودکار\n\n3️⃣ دعوت دوستان:\n• 👤 پنل → لینک دعوت\n• سهم شما: " + refP + "% از درآمد هر دعوتی\n\n4️⃣ سطح (XP):\n• هر عضویت = 10 XP\n• سطوح بالاتر = مزایا";
  const text = (content || defaultText) + "\n\n👍 " + (likes?.c || 0) + " نفر این آموزش را مفید دانستند";
  await edit(env, cid, mid, text, [
    [{ text: "👍 مفید بود", callback_data: "like_tutorial" }],
    [{ text: "🏠 بازگشت", callback_data: "main" }],
  ]);
}

async function handleLike(env, cb, uid, pageKey) {
  try {
    await DB(env).prepare("INSERT OR IGNORE INTO page_likes (page_key, user_id) VALUES (?, ?)").bind(pageKey, uid).run();
    const likes = await DB(env).prepare("SELECT COUNT(*) as c FROM page_likes WHERE page_key = ?").bind(pageKey).first();
    const likeReward = await getSetting(env, "like_reward", 10);
    if (likeReward > 0) {
      await DB(env).prepare("UPDATE users SET balance = balance + ? WHERE telegram_id = ?").bind(likeReward, uid).run();
      await addTx(env, uid, "like_reward", likeReward, "پاداش لایک: " + pageKey, "like_" + pageKey + "_" + uid + "_" + Date.now());
    }
    return alert(env, cb.id, "👍 ممنون! " + (likes?.c || 0) + " نفر این صفحه را مفید دانستند." + (likeReward > 0 ? "\n💰 " + likeReward + " سکه هدیه!" : ""), true);
  } catch {
    const likes = await DB(env).prepare("SELECT COUNT(*) as c FROM page_likes WHERE page_key = ?").bind(pageKey).first();
    return alert(env, cb.id, "شما قبلا لایک کرده‌اید!\n👍 مجموع: " + (likes?.c || 0) + " نفر این صفحه را مفید دانستند.", true);
  }
}
async function adminTutorialPage(env, cid, mid) {
  const content = await getSetting(env, "admin_tutorial_text", "");
  const likes = await DB(env).prepare("SELECT COUNT(*) as c FROM page_likes WHERE page_key = 'admin_tutorial'").first();
  const defaultText = "📖 آموزش ادمین\n━━━━━━━━━━━━━━━━\n\n📊 آمار: دیدن کاربران، تبلیغات، مالیات\n👥 کاربران: جستجو، مسدود/رفع، تنظیم موجودی\n📢 همگانی: پیام به اینباکس همه کاربران\n📋 تایید: تایید/رد تبلیغ (رد = بازگشت وجه)\n💰 مالی: قیمت، مالیات، رفرال، هزینه ساعتی\n📝 محتوا: ویرایش درباره ما/آموزش/قوانین\n🎭 دسترسی: نقش‌ها و سطوح ادمین\n🚫 مسدود تبلیغ: جلوگیری از تبلیغ‌گذاری\n\n💡 نکته: همیشه قبل از تایید تبلیغ، محتوای کانال را بررسی کنید تا خلاف قوانین تلگرام نباشد.";
  const text = (content || defaultText) + "\n\n👍 " + (likes?.c || 0) + " نفر این آموزش را مفید دانستند";
  await edit(env, cid, mid, text, [
    [{ text: "👍 مفید بود", callback_data: "like_admin_tutorial" }],
    [{ text: "✏️ ویرایش", callback_data: "admin_edit_admin_tutorial" }],
    [{ text: "📝 بازگشت", callback_data: "admin_content" }],
  ]);
}
async function adminContent(env, cid, mid) {
  const [about, tutorial, likeReward] = await Promise.all([
    getSetting(env, "about_text", ""),
    getSetting(env, "tutorial_text", ""),
    getSetting(env, "like_reward", 10),
  ]);
  const aboutPreview = about ? (about.substring(0, 80) + (about.length > 80 ? "..." : "")) : "(پیش‌فرض)";
  const tutorialPreview = tutorial ? (tutorial.substring(0, 80) + (tutorial.length > 80 ? "..." : "")) : "(پیش‌فرض)";
  await edit(env, cid, mid, "📝 مدیریت محتوا\n\nℹ️ درباره ما:\n" + aboutPreview + "\n\n📚 آموزش:\n" + tutorialPreview + "\n\n💰 پاداش لایک: " + likeReward + " امتیاز", [
    [{ text: "✏️ ویرایش درباره ما", callback_data: "admin_edit_about" }, { text: "✏️ ویرایش آموزش", callback_data: "admin_edit_tutorial" }],
    [{ text: "📖 آموزش ادمین", callback_data: "admin_tutorial" }, { text: "💰 پاداش لایک", callback_data: "admin_set_likereward" }],
    [{ text: "👁️ درباره ما", callback_data: "about" }, { text: "👁️ آموزش", callback_data: "tutorial" }],
    [{ text: "⚙️ بازگشت", callback_data: "admin" }],
  ]);
}
// ==================== Inbox / Stats ====================
async function inboxMenu(env, cid, mid, u, offset) {
  const limit = PAGE_SIZE;
  const [msgs, count] = await Promise.all([
    DB(env).prepare("SELECT * FROM inbox_messages ORDER BY id DESC LIMIT ? OFFSET ?").bind(limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM inbox_messages").first(),
  ]);
  let text = "📥 اینباکس\n━━━━━━━━━━━━━━━━\n\n" + (u?.inbox_muted ? "🔇 بی‌صدا" : "🔔 صدادار") + "\n\n";
  const btns = [];
  if (msgs.results.length === 0) { text += "پیامی نیست."; }
  else {
    text += pageIndicator(offset, limit, count?.c || 0) + "\n\n";
    for (const m of msgs.results) {
      const likes = await DB(env).prepare("SELECT COUNT(*) as c FROM inbox_likes WHERE message_id = ?").bind(m.id).first();
      const liked = await DB(env).prepare("SELECT 1 as x FROM inbox_likes WHERE message_id = ? AND user_id = ?").bind(m.id, u.telegram_id).first();
      text += "📢 " + m.text + "\n👤 " + (m.admin_name || "ادمین") + " | 🕐 " + fmtDate(m.created_at) + " | 👍 " + (likes?.c || 0) + (liked ? " ✅" : "") + "\n\n";
      btns.push([{ text: (liked ? "✅ لایک شد" : "👍 مفید بود") + " (" + (likes?.c || 0) + ")", callback_data: "inbox_like_" + m.id }]);
    }
  }
  const nav = pageNav("inbox", offset, limit, msgs.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: u?.inbox_muted ? "🔔 صدا دار" : "🔇 بی‌صدا", callback_data: "inbox_mute" }]);
  btns.push([{ text: "🏠 بازگشت", callback_data: "main" }]);
  await edit(env, cid, mid, text, btns);
}

async function inboxLike(env, cb, uid, msgId) {
  await DB(env).prepare("INSERT OR IGNORE INTO inbox_likes (message_id, user_id) VALUES (?, ?)").bind(msgId, uid).run();
  const likes = await DB(env).prepare("SELECT COUNT(*) as c FROM inbox_likes WHERE message_id = ?").bind(msgId).first();
  const reward = await getSetting(env, "like_reward", 10);
  if (reward > 0) {
    await DB(env).prepare("UPDATE users SET balance = balance + ? WHERE telegram_id = ?").bind(reward, uid).run();
    await addTx(env, uid, "like_reward", reward, "پاداش لایک اینباکس", "inbox_like_" + msgId + "_" + uid + "_" + Date.now());
  }
  return alert(env, cb.id, "👍 ممنون! " + (likes?.c || 0) + " نفر مفید دانستند." + (reward > 0 ? "\n💰 " + reward + " سکه هدیه!" : ""), true);
}

async function inboxMuteToggle(env, cid, mid, u) {
  const newVal = u?.inbox_muted ? 0 : 1;
  await DB(env).prepare("UPDATE users SET inbox_muted = ? WHERE telegram_id = ?").bind(newVal, u.telegram_id).run();
  u.inbox_muted = newVal;
  return inboxMenu(env, cid, mid, u, 0);
}

async function botStats(env, cid, mid) {
  const [users, left, activeAds, pendingAds, rejectedAds, stoppedAds, completedAds, balances, adminPaid, activeAdminsNow, activeAdminsToday, activeAdminsWeek, activeToday, activeWeek, activeMonth, avgActive] = await Promise.all([
    DB(env).prepare("SELECT COUNT(*) as c FROM users").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaign_participants WHERE status = 'left'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'active'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'pending'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'rejected'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'stopped'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'completed'").first(),
    DB(env).prepare("SELECT COALESCE(SUM(balance), 0) as t FROM users").first(),
    DB(env).prepare("SELECT COALESCE(SUM(amount), 0) as t FROM transactions WHERE type = 'admin_adjust'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM users WHERE is_admin = 1 AND last_active >= datetime('now', '-1 minute')").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM users WHERE is_admin = 1 AND last_active >= datetime('now', '-1 day')").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM users WHERE is_admin = 1 AND last_active >= datetime('now', '-7 days')").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM users WHERE last_active >= datetime('now', '-1 day')").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM users WHERE last_active >= datetime('now', '-7 days')").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM users WHERE last_active >= datetime('now', '-30 days')").first(),
    DB(env).prepare("SELECT COALESCE(AVG(total_active_seconds), 0) as t FROM users").first(),
  ]);
  const total = users?.c || 0;
  const text = "📊 آمار ربات\n━━━━━━━━━━━━━━━━\n\n👥 کل کاربران: " + total + "\n⚠️ لفت‌داده‌ها: " + (left?.c || 0) + "\n📢 تبلیغات فعال: " + (activeAds?.c || 0) + "\n⏳ در انتظار: " + (pendingAds?.c || 0) + "\n🛑 متوقف: " + (stoppedAds?.c || 0) + "\n✅ تکمیل: " + (completedAds?.c || 0) + "\n❌ ردشده: " + (rejectedAds?.c || 0) + "\n💰 در چرخش: " + (balances?.t || 0) + "\n💵 پرداختی ادمین: " + (adminPaid?.t || 0) + "\n\n🛡️ ادمین‌ها:\nآنلاین (۱ دقیقه): " + (activeAdminsNow?.c || 0) + "\nامروز: " + (activeAdminsToday?.c || 0) + "\nاین هفته: " + (activeAdminsWeek?.c || 0) + "\n\n🎯 پاداش فعالیت/ساعت: " + (await getSetting(env, "activity_reward", 6)) + " سکه\n💼 حقوق ادمین/ساعت: " + (await getSetting(env, "admin_salary", 100)) + " سکه\n📊 سهم ادمین از مالیات: " + (await getSetting(env, "admin_tax_share", 30)) + "%\n\n🕐 فعالیت کاربران:\nامروز: " + (activeToday?.c || 0) + " فعال | " + (total - (activeToday?.c || 0)) + " غیرفعال\nاین هفته: " + (activeWeek?.c || 0) + " فعال | " + (total - (activeWeek?.c || 0)) + " غیرفعال\nاین ماه: " + (activeMonth?.c || 0) + " فعال | " + (total - (activeMonth?.c || 0)) + " غیرفعال\n⏱️ میانگین فعالیت هر کاربر: " + Math.round((avgActive?.t || 0) / 3600) + " ساعت";
  await edit(env, cid, mid, text, [[{ text: "🏠 بازگشت", callback_data: "main" }]]);
}
async function rules(env, cid, mid) {
  const r = await DB(env).prepare("SELECT content FROM rules WHERE is_active = 1 ORDER BY version DESC LIMIT 1").first();
  const rp = await getSetting(env, "referral_percent", 20);
  const taxP = await getSetting(env, "ad_tax_percent", 5);
  const likes = await DB(env).prepare("SELECT COUNT(*) as c FROM page_likes WHERE page_key = 'rules'").first();
  const defaultText = "📜 قوانین استفاده از ربات\n━━━━━━━━━━━━━━━━\n\n✅ تبلیغ‌گذاری:\n• ربات باید ادمین کانال شما باشد\n• محتوای تبلیغ باید مطابق قوانین تلگرام و اصول انسانی باشد\n• تبلیغ نامناسب: بار اول اخطار + رد، بار دوم مسدودیت از تبلیغ‌گذاری\n\n🔒 حریم خصوصی:\n• اطلاعات شما محفوظ است و فقط در موارد قانونی/دولتی یا شرایط اضطراری منتقل می‌شود\n• عضویت در گروه/کانال‌ها و محتوای آن‌ها به ما ربطی ندارد\n\n⚠️ رفتار کاربران:\n• لفت دادن = کسر خودکار پاداش\n• تبلیغ نامناسب؟ 👎 بزنید تا ادمین‌ها مطلع شوند یا ⏭️ رد شوید\n\n📌 استفاده از ربات = پذیرش تمام قوانین\nما زیر نظر قوانین تلگرام فعالیت می‌کنیم:\ntelegram.org/privacy-tpa\n\n💰 مالیات: " + taxP + "% | سهم معرف: " + rp + "%";
  const text = (r?.content || defaultText) + "\n\n👍 " + (likes?.c || 0) + " نفر این قوانین را مفید دانستند";
  await edit(env, cid, mid, text, [
    [{ text: "👍 مفید بود", callback_data: "like_rules" }],
    [{ text: "🏠 بازگشت", callback_data: "main" }],
  ]);
}
// ==================== Campaign Actions ====================
async function cancelCampaign(env, cid, mid, uid, adId) {
  const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ? AND CAST(owner_id AS TEXT) = ?").bind(adId, uid).first();
  if (!ad) return edit(env, cid, mid, "دسترسی ندارید.", [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
  if (ad.status !== "active") return edit(env, cid, mid, "این تبلیغ فعال نیست.", [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
  const spent = ad.spent || 0, remaining = (ad.total_budget || 0) - spent;
  const taxP = ad.tax_percent || 5, refundTax = Math.ceil(remaining * (taxP / 100));
  const totalRefund = remaining + refundTax;
  await DB(env).prepare("UPDATE campaigns SET status = 'cancelled', total_budget = ? WHERE id = ?").bind(spent, adId).run();
  let refId = "";
  if (totalRefund > 0) {
    await DB(env).prepare("UPDATE users SET balance = balance + ? WHERE telegram_id = ?").bind(totalRefund, uid).run();
    refId = `cancel_${adId}_${Date.now()}`;
    await addTx(env, uid, "ad_refund", totalRefund, `بازگشت - لغو: ${ad.title || ad.channel_username}`, refId);
    await logTax(env, adId, uid, -refundTax, "cancel_refund");
  }
  await edit(env, cid, mid, `🛑 لغو شد!\n\n📌 ${ad.title || ad.channel_username}\n💸 خرج: ${spent} | 💵 باقی: ${remaining} | 💰 بازگشت: ${totalRefund}${refId ? `\n🔖 ${refId}` : ""}`, [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
}

async function renewCampaign(env, cid, mid, uid, adId) {
  const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ? AND CAST(owner_id AS TEXT) = ?").bind(adId, uid).first();
  if (!ad) return edit(env, cid, mid, "دسترسی ندارید.", [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
  if (!["active", "cancelled", "completed", "stopped"].includes(ad.status)) return edit(env, cid, mid, "قابل تمدید نیست.", [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
  if (!(await checkBotAdmin(env, ad.channel_username))) return edit(env, cid, mid, "❌ ربات ادمین کانال نیست!\n\nابتدا ربات را دوباره ادمین کنید.", [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
  const cost = await getSetting(env, "ad_cost_per_join", 10);
  const taxP = await getSetting(env, "ad_tax_percent", 5);
  const currentBudget = (ad.total_budget || 0) - (ad.spent || 0);
  await setState(env, uid, "renew_ad_budget", { adId, addedBudget: 0 });
  await edit(env, cid, mid, `🔄 تمدید: ${ad.title || ad.channel_username}\n🔗 ${ad.channel_username}\n💰 باقی‌مانده: ${currentBudget}\n📊 هزینه/عضو: ${cost} | 💰 مالیات: ${taxP}%\n\nافزایش بودجه:`, [
    [{ text: "➕100", callback_data: "renew_add_100" }, { text: "➕500", callback_data: "renew_add_500" }, { text: "➕1000", callback_data: "renew_add_1000" }],
    [{ text: "❌ انصراف", callback_data: "my_ads_0" }],
  ]);
}

async function handleRenewBudget(env, cb, u, uid, cid, mid, data) {
  if (u?.user_state !== "renew_ad_budget") return alert(env, cb.id, "از /start شروع کنید");
  let d = {};
  try { d = JSON.parse(u.state_data || "{}"); } catch { return; }
  const add = data.startsWith("renew_add_");
  d.addedBudget = add ? (d.addedBudget || 0) + parseInt(data.split("_")[2]) : Math.max(0, (d.addedBudget || 0) - parseInt(data.split("_")[2]));
  await DB(env).prepare("UPDATE users SET state_data = ? WHERE telegram_id = ?").bind(JSON.stringify(d), uid).run();
  const taxP = await getSetting(env, "ad_tax_percent", 5);
  const tax = Math.ceil(d.addedBudget * (taxP / 100));
  const total = d.addedBudget + tax;
  const ok = u.balance >= total;
  let text = `🔄 تمدید\n\n💵 بودجه: ${d.addedBudget}\n• مالیات (${taxP}%): ${tax}\n${ok || d.addedBudget === 0 ? `• کل: ${total} ✅` : `• کل: ${total} ❌ (کمبود: ${total - u.balance})`}`;
  const btns = budgetButtons("renew", d.addedBudget, ok);
  if (ok || d.addedBudget === 0) btns.push([{ text: "✅ تایید", callback_data: "renew_confirm" }]);
  btns.push([{ text: "❌ انصراف", callback_data: "my_ads_0" }]);
  await edit(env, cid, mid, text, btns);
}

async function confirmRenew(env, cb, u, uid, cid, mid) {
  if (u?.user_state !== "renew_ad_budget") return;
  let d = {};
  try { d = JSON.parse(u.state_data || "{}"); } catch { return; }
  if (!d.adId || !d.addedBudget || d.addedBudget <= 0) return alert(env, cb.id, "بودجه باید > 0 باشد!");
  const taxP = await getSetting(env, "ad_tax_percent", 5);
  const tax = Math.ceil(d.addedBudget * (taxP / 100));
  const total = d.addedBudget + tax;
  if (u.balance < total) return alert(env, cb.id, "موجودی کافی نیست!");
  const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ? AND CAST(owner_id AS TEXT) = ?").bind(d.adId, uid).first();
  if (!ad) return;
  if (!(await checkBotAdmin(env, ad.channel_username))) return alert(env, cb.id, "❌ ربات هنوز ادمین کانال نیست! ابتدا ربات را ادمین کنید.");
  await DB(env).prepare("UPDATE users SET balance = balance - ?, user_state = NULL, state_data = NULL WHERE telegram_id = ?").bind(total, uid).run();
  const refId = `renew_${d.adId}_${Date.now()}`;
  await addTx(env, uid, "ad_creation", -total, `تمدید: ${ad.title || ad.channel_username}`, refId);
  await logTax(env, d.adId, uid, tax, "renewal");
  const newBudget = (ad.total_budget || 0) + d.addedBudget;
  await DB(env).prepare("UPDATE campaigns SET total_budget = ?, status = 'active', last_hour_check = CURRENT_TIMESTAMP WHERE id = ?").bind(newBudget, d.adId).run();
  await edit(env, cid, mid, `✅ تمدید شد!\n📌 ${ad.title || ad.channel_username}\n💰 بودجه جدید: ${newBudget}\n🔖 ${refId}`, [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
}

// ==================== Ad Creation ====================
async function handleAdMessage(env, chat, u, uid, text) {
  if (text === "❌ انصراف") { await clearState(env, uid); await send(env, chat.id, "❌ لغو شد."); return true; }
  if (u?.user_state === "create_ad_channel") {
    if (!text?.startsWith("@")) { await send(env, chat.id, "❌ باید با @ شروع شود.\n@example"); return true; }
    const botInfo = await tg(env.TELEGRAM_TOKEN, "getMe");
    const botId = botInfo?.result?.id;
    const botU = botInfo?.result?.username || BOT_FALLBACK;
    if (!botId) { await send(env, chat.id, "❌ خطا در بررسی ربات. دوباره تلاش کنید."); return true; }
    const member = await tg(env.TELEGRAM_TOKEN, "getChatMember", { chat_id: text, user_id: botId });
    const status = member?.result?.status;
    if (status !== "administrator" && status !== "creator") {
      await setState(env, uid, "create_ad_channel", { channel: text, pending: true });
      await send(env, chat.id, "⚠️ ربات هنوز ادمین کانال نیست!\n\n1️⃣ ربات را به کانال اضافه کنید:\nhttps://t.me/" + botU + "?startchannel=admin\n\n2️⃣ ربات را با دسترسی کامل ادمین کنید.\n\nسپس دکمه زیر را بزنید:", [
        [{ text: "✅ بررسی دوباره", callback_data: "ad_chcheck" }],
        [{ text: "❌ انصراف", callback_data: "ad_cancel" }],
      ]);
      return true;
    }
    await setState(env, uid, "create_ad_title", { channel: text, budget: 0 });
    await send(env, chat.id, "✅ کانال: " + text + "\n\n✅ ربات ادمین کانال است.\n\nعنوان تبلیغ:", [[{ text: "❌ انصراف", callback_data: "ad_cancel" }]]);
    return true;
  }
  if (u?.user_state === "create_ad_title") {
    let d = {};
    try { d = JSON.parse(u.state_data || "{}"); } catch { d = { channel: "" }; }
    d.title = text;
    await setState(env, uid, "create_ad_hourly", d);
    await send(env, chat.id, "✅ عنوان ثبت شد.\n\n⏰ هزینه ساعتی تبلیغ:\n\nمبلغی که هر ساعت از بودجه کسر می‌شود.\n0 = بدون هزینه ساعتی\n\nمثال: 60 یعنی 60 امتیاز در ساعت\n\nعدد وارد کنید:", [[{ text: "⏭️ بدون هزینه ساعتی (0)", callback_data: "ad_hourly_skip" }], [{ text: "❌ انصراف", callback_data: "ad_cancel" }]]);
    return true;
  }
  if (u?.user_state === "create_ad_hourly") {
    let d = {};
    try { d = JSON.parse(u.state_data || "{}"); } catch { d = {}; }
    const v = parseInt(text || "0");
    if (isNaN(v) || v < 0) { await send(env, chat.id, "❌ عدد نامعتبر. 0 یا بیشتر:"); return true; }
    d.hourlyCost = v;
    await setState(env, uid, "create_ad_budget", d);
    const cost = await getSetting(env, "ad_cost_per_join", 10);
    await send(env, chat.id, "✅ هزینه ساعتی: " + v + (v > 0 ? " امتیاز/ساعت" : " (بدون هزینه ساعتی)") + "\n💰 هزینه/عضو: " + cost + "\n\nبودجه را انتخاب کنید:", [
      [{ text: "➕100", callback_data: "bud_add_100" }, { text: "➕500", callback_data: "bud_add_500" }, { text: "➕1000", callback_data: "bud_add_1000" }],
      [{ text: "❌ انصراف", callback_data: "ad_cancel" }],
    ]);
    return true;
  }
  return false;
}

async function handleBudget(env, cb, u, uid, cid, mid, data) {
  if (u?.user_state !== "create_ad_budget") return alert(env, cb.id, "از /start شروع کنید");
  const add = data.startsWith("bud_add_");
  let d = {};
  try { d = JSON.parse(u.state_data || "{}"); } catch { return; }
  d.budget = add ? (d.budget || 0) + parseInt(data.split("_")[2]) : Math.max(0, (d.budget || 0) - parseInt(data.split("_")[2]));
  await DB(env).prepare("UPDATE users SET state_data = ? WHERE telegram_id = ?").bind(JSON.stringify(d), uid).run();
  const cost = await getSetting(env, "ad_cost_per_join", 10);
  const taxP = await getSetting(env, "ad_tax_percent", 5);
  const { text, ok } = budgetText(d.title, d.channel, d.budget, cost, taxP, u.balance);
  const btns = budgetButtons("bud", d.budget, ok);
  if (ok || d.budget === 0) btns.push([{ text: "✅ ثبت نهایی", callback_data: "bud_confirm" }]);
  btns.push([{ text: "❌ انصراف", callback_data: "ad_cancel" }]);
  await edit(env, cid, mid, text + "\n\nاز دکمه‌ها استفاده کنید:", btns);
}

async function confirmAd(env, cb, u, uid, cid, mid) {
  if (u?.user_state !== "create_ad_budget") return;
  let d = {};
  try { d = JSON.parse(u.state_data || "{}"); } catch { return; }
  if (!d.budget || d.budget <= 0) return alert(env, cb.id, "بودجه باید > 0 باشد!");
  const taxP = await getSetting(env, "ad_tax_percent", 5);
  const tax = Math.ceil(d.budget * (taxP / 100));
  const total = d.budget + tax;
  if (u.balance < total) return alert(env, cb.id, "موجودی کافی نیست!");
  await DB(env).prepare("UPDATE users SET balance = balance - ?, user_state = NULL, state_data = NULL WHERE telegram_id = ?").bind(total, uid).run();
  const refId = `ad_${Date.now()}`;
  await addTx(env, uid, "ad_creation", -total, `کمپین: ${d.title} (بودجه: ${d.budget}, مالیات: ${tax})`, refId);
  await logTax(env, null, uid, tax, "creation");
  await DB(env).prepare("INSERT INTO campaigns (owner_id, channel_username, title, description, reward_per_join, total_budget, tax_percent, hourly_cost, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')").bind(uid, d.channel, d.title, "عضو شوید و پاداش بگیرید", await getSetting(env, "ad_cost_per_join", 10), d.budget, taxP, d.hourlyCost || 0).run();
  await send(env, cid, "✅ کمپین ثبت شد!\n\n📌 " + d.title + "\n🔗 " + d.channel + "\n💰 بودجه: " + d.budget + " | مالیات: " + tax + " | کل: " + total + (d.hourlyCost ? "\n⏰ هزینه ساعتی: " + d.hourlyCost + "/ساعت" : "") + "\n🔖 " + refId + "\n\nوضعیت: در انتظار تایید", [[{ text: "👤 پنل", callback_data: "user_panel" }]]);
}

// ==================== Ad View/Join ====================
async function handleAdView(env, cid, mid, uid, adId) {
  const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ? AND status = 'active'").bind(adId).first();
  if (!ad) return edit(env, cid, mid, "این تبلیغ غیرفعال است.", [[{ text: "🏠 بازگشت", callback_data: "ads_menu" }]]);
  if (!(await checkBotAdmin(env, ad.channel_username))) {
    return edit(env, cid, mid, "🛑 این تبلیغ موقتاً متوقف شده است.\n\n❌ دلیل: ربات ادمین کانال نیست.\n\n💡 این مشکل به صاحب تبلیغ اطلاع داده خواهد شد.", [[{ text: "🏠 بازگشت", callback_data: "ads_menu" }]]);
  }
  const p = await DB(env).prepare("SELECT status FROM campaign_participants WHERE campaign_id = ? AND user_id = ?").bind(adId, uid).first();
  const reward = ad.reward_per_join || 0;
  const chUrl = `https://t.me/${ad.channel_username.replace("@", "")}`;
  if (p?.status === "rewarded") {
    if (!(await isMember(env, uid, ad.channel_username))) {
      await DB(env).prepare("UPDATE campaign_participants SET status = 'left' WHERE campaign_id = ? AND user_id = ?").bind(adId, uid).run();
      await DB(env).prepare("UPDATE users SET balance = MAX(0, balance - ?), total_earnings = MAX(0, total_earnings - ?) WHERE telegram_id = ?").bind(reward, reward, uid).run();
      const refId = `left_${adId}_${Date.now()}`;
      await addTx(env, uid, "ad_penalty", -reward, `جریمه لفت: ${ad.title || ad.channel_username}`, refId);
      await DB(env).prepare("UPDATE campaigns SET spent = MAX(0, spent - ?) WHERE id = ?").bind(reward, adId).run();
      const ownerId = ad.owner_id?.toString();
      if (ownerId && ownerId !== uid) {
        const leaver = await getUser(env, uid);
        await tg(env.TELEGRAM_TOKEN, "sendMessage", { chat_id: parseInt(ownerId), text: `⚠️ کاربر لفت داد!\n📌 ${ad.title || ad.channel_username}\n👤 ${leaver?.first_name || leaver?.username || uid}\n💰 ${reward} به بودجه برگشت` });
      }
      return edit(env, cid, mid, `⚠️ لفت دادید!\n❌ ${reward} کسر شد.\n📌 ${ad.title || ad.channel_username}\n🔖 ${refId}`, [[{ text: "📢 عضویت مجدد", url: chUrl }], [{ text: "🏠 بازگشت", callback_data: "ads_menu" }]]);
    }
    return edit(env, cid, mid, `✅ پاداش گرفته‌اید و عضو هستید.\n📌 ${ad.title || ad.channel_username}\n💰 ${reward}`, [[{ text: "👍 مناسب", callback_data: `ad_react_${adId}_good` }, { text: "👎 نامناسب", callback_data: `ad_react_${adId}_bad` }], [{ text: "⏭️ بعدی", callback_data: `ad_skip_${adId}` }], [{ text: "🏠 بازگشت", callback_data: "ads_menu" }]]);
  }
  if (p?.status === "left") {
    if (await isMember(env, uid, ad.channel_username)) {
      await DB(env).prepare("UPDATE campaign_participants SET status = 'rewarded' WHERE campaign_id = ? AND user_id = ?").bind(adId, uid).run();
      await DB(env).prepare("UPDATE users SET balance = balance + ?, total_earnings = total_earnings + ? WHERE telegram_id = ?").bind(reward, reward, uid).run();
      const refId = `rejoin_${adId}_${Date.now()}`;
      await addTx(env, uid, "ad_reward", reward, `عضویت مجدد: ${ad.title || ad.channel_username}`, refId);
      await DB(env).prepare("UPDATE campaigns SET spent = spent + ? WHERE id = ?").bind(reward, adId).run();
      await addXP(env, uid, 10);
      return edit(env, cid, mid, `🎉 دوباره عضو شدید! +${reward}!\n📌 ${ad.title || ad.channel_username}`, [[{ text: "🏠 بازگشت", callback_data: "ads_menu" }]]);
    }
    return edit(env, cid, mid, `⚠️ لفت داده بودید.\n📌 ${ad.title || ad.channel_username}\n\nدوباره عضو شوید:`, [[{ text: "📢 عضویت", url: chUrl }], [{ text: "✅ بررسی", callback_data: `ad_check_${adId}` }], [{ text: "🏠 بازگشت", callback_data: "ads_menu" }]]);
  }
  if (await isMember(env, uid, ad.channel_username)) {
    const joiner = await getUser(env, uid);
    await DB(env).prepare("INSERT OR REPLACE INTO campaign_participants (campaign_id, user_id, status, reward_given) VALUES (?, ?, 'rewarded', 1)").bind(adId, uid).run();
    await DB(env).prepare("UPDATE users SET balance = balance + ?, total_earnings = total_earnings + ? WHERE telegram_id = ?").bind(reward, reward, uid).run();
    const refId = `ar_${adId}_${Date.now()}`;
    await addTx(env, uid, "ad_reward", reward, `پاداش: ${ad.title || ad.channel_username}`, refId);
    await DB(env).prepare("UPDATE campaigns SET spent = spent + ? WHERE id = ?").bind(reward, adId).run();
    await addXP(env, uid, 10);
    const ownerId = ad.owner_id?.toString();
    if (ownerId && ownerId !== uid) {
      const joined = await DB(env).prepare("SELECT COUNT(*) as c FROM campaign_participants WHERE campaign_id = ? AND status = 'rewarded'").bind(adId).first();
      const remaining = (ad.total_budget || 0) - (ad.spent || 0) - reward;
      await tg(env.TELEGRAM_TOKEN, "sendMessage", { chat_id: parseInt(ownerId), text: `🎉 عضو جدید!\n📌 ${ad.title || ad.channel_username}\n👤 ${joiner?.first_name || joiner?.username || uid}\n💰 ${reward} | 👥 ${joined?.c || 0} | 💰 ${remaining}` });
    }
    return edit(env, cid, mid, `🎉 +${reward} امتیاز!\n📌 ${ad.title || ad.channel_username}\n🔗 ${ad.channel_username}\n🔖 ${refId}\n\n⚠️ لفت = کسر پاداش!`, [[{ text: "🏠 بازگشت", callback_data: "ads_menu" }]]);
  }
  const joined = await DB(env).prepare("SELECT COUNT(*) as c FROM campaign_participants WHERE campaign_id = ? AND status = 'rewarded'").bind(adId).first();
  return edit(env, cid, mid, `📌 ${ad.title || ad.channel_username}\n🔗 ${ad.channel_username}\n💰 ${reward} امتیاز\n👥 ${joined?.c || 0} نفر عضو\n\nابتدا عضو شوید:`, [[{ text: "📢 عضویت", url: chUrl }], [{ text: "✅ بررسی", callback_data: `ad_check_${adId}` }], [{ text: "⏭️ بعدی", callback_data: `ad_skip_${adId}` }], [{ text: "👍 مناسب", callback_data: `ad_react_${adId}_good` }, { text: "👎 نامناسب", callback_data: `ad_react_${adId}_bad` }], [{ text: "🏠 بازگشت", callback_data: "ads_menu" }]]);
}

async function editAd(env, cid, mid, uid, adId) {
  const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ? AND CAST(owner_id AS TEXT) = ?").bind(adId, uid).first();
  if (!ad) return edit(env, cid, mid, "دسترسی ندارید.", [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
  if (!["active", "stopped", "pending"].includes(ad.status)) return edit(env, cid, mid, "این تبلیغ قابل اصلاح نیست.", [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
  await edit(env, cid, mid, "✏️ اصلاح تبلیغ\n\n📌 " + (ad.title || ad.channel_username) + "\n🔗 " + ad.channel_username + "\n💰 بودجه: " + (ad.total_budget || 0) + "\n⏰ هزینه ساعتی: " + (ad.hourly_cost || 0) + "/ساعت\n\nچه چیزی را اصلاح کنید؟", [
    [{ text: "📝 عنوان", callback_data: "ad_edit_title_" + adId }, { text: "⏰ هزینه ساعتی", callback_data: "ad_edit_hourly_" + adId }],
    [{ text: "📋 بازگشت", callback_data: "ad_stats_" + adId }],
  ]);
}

async function editAdField(env, cid, mid, uid, adId, field) {
  const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ? AND CAST(owner_id AS TEXT) = ?").bind(adId, uid).first();
  if (!ad) return edit(env, cid, mid, "دسترسی ندارید.", [[{ text: "📋 بازگشت", callback_data: "my_ads_0" }]]);
  const labels = { title: "عنوان", hourly: "هزینه ساعتی" };
  const cur = field === "title" ? (ad.title || "") : (ad.hourly_cost || 0);
  await setState(env, uid, "edit_ad_" + field, { adId });
  await edit(env, cid, mid, "✏️ اصلاح " + labels[field] + "\n\nفعلی: " + cur + "\n\nمقدار جدید:", [[{ text: "❌ انصراف", callback_data: "ad_stats_" + adId }]]);
}
// ==================== Admin Panel ====================
async function adminPanel(env, cid, mid) {
  await edit(env, cid, mid, "⚙️ پنل مدیریت", [
    [{ text: "📊 آمار", callback_data: "admin_stats" }, { text: "👥 کاربران", callback_data: "admin_users_0" }],
    [{ text: "🧾 تراکنش‌ها", callback_data: "admin_tx_0" }, { text: "📢 همگانی", callback_data: "admin_broadcast" }],
    [{ text: "📋 تبلیغ‌ها", callback_data: "admin_ads_menu" }, { text: "💰 مالی", callback_data: "admin_financial" }],
    [{ text: "📝 محتوا", callback_data: "admin_content" }, { text: "🎭 دسترسی‌ها", callback_data: "admin_roles_0" }],
    [{ text: "🏠 بازگشت", callback_data: "main" }],
  ]);
}

async function adminStats(env, cid, mid) {
  const [uc, aa, pa, tb, tt, totalXP] = await Promise.all([
    DB(env).prepare("SELECT COUNT(*) as c FROM users").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'active'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'pending'").first(),
    DB(env).prepare("SELECT SUM(balance) as t FROM users").first(),
    DB(env).prepare("SELECT SUM(amount) as t FROM transactions WHERE type = 'ad_creation'").first(),
    DB(env).prepare("SELECT SUM(xp) as t FROM users").first(),
  ]);
  await edit(env, cid, mid, `📊 آمار ربات\n\n👥 کاربران: ${uc?.c || 0}\n📢 فعال: ${aa?.c || 0}\n⏳ در انتظار: ${pa?.c || 0}\n💰 موجودی: ${tb?.t || 0}\n💵 مالیات: ${Math.abs(tt?.t || 0)}\n📊 XP: ${totalXP?.t || 0}`, [[{ text: "⚙️ بازگشت", callback_data: "admin" }]]);
}

async function adminUsers(env, cid, mid, offset) {
  const limit = PAGE_SIZE;
  const [users, total] = await Promise.all([
    DB(env).prepare("SELECT telegram_id, first_name, username, balance, xp, is_blocked, is_admin, admin_role FROM users ORDER BY id DESC LIMIT ? OFFSET ?").bind(limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM users").first(),
  ]);
  let text = `👥 کاربران\n━━━━━━━━━━━━━━━━\n\n${pageIndicator(offset, limit, total?.c || 0)}\n\n`;
  const btns = [];
  for (const u of users.results) {
    const name = u.first_name || u.username || u.telegram_id;
    const perms = getPerms(u, u.telegram_id);
    const lvl = getLevel(u.xp || 0);
    const st = u.is_blocked ? "🚫" : perms.length > 0 ? "👑" : "👤";
    btns.push([{ text: `${st} ${lvl.icon} ${name} — 💰${u.balance}`, callback_data: `admin_user_${u.telegram_id}` }]);
  }
  const nav = pageNav("admin_users", offset, limit, users.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "🔍 سرچ", callback_data: "admin_search" }]);
  btns.push([{ text: "⚙️ بازگشت", callback_data: "admin" }]);
  await edit(env, cid, mid, text, btns);
}

async function adminSearch(env, cid, mid, uid) {
  await setState(env, uid, "admin_search", {});
  await edit(env, cid, mid, "🔍 سرچ کاربر\n\nنام، یوزرنیم یا آیدی:", [[{ text: "❌ انصراف", callback_data: "admin_users_0" }]]);
}

async function adminSearchResults(env, cid, query, offset = 0) {
  const limit = PAGE_SIZE;
  const like = `%${query}%`;
  const [users, total] = await Promise.all([
    DB(env).prepare("SELECT telegram_id, first_name, username, balance, xp, is_blocked, is_admin, admin_role FROM users WHERE first_name LIKE ? OR username LIKE ? OR telegram_id LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?").bind(like, like, like, limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM users WHERE first_name LIKE ? OR username LIKE ? OR telegram_id LIKE ?").bind(like, like, like).first(),
  ]);
  let text = `🔍 نتایج سرچ: "${query}"\n━━━━━━━━━━━━━━━━\n\n`;
  const btns = [];
  if (users.results.length === 0) { text += "کاربری یافت نشد."; }
  else {
    text += pageIndicator(offset, limit, total?.c || 0) + "\n\n";
    for (const u of users.results) {
      const name = u.first_name || u.username || u.telegram_id;
      const perms = getPerms(u, u.telegram_id);
      const lvl = getLevel(u.xp || 0);
      const st = u.is_blocked ? "🚫" : perms.length > 0 ? "👑" : "👤";
      btns.push([{ text: `${st} ${lvl.icon} ${name} — 💰${u.balance}`, callback_data: `admin_user_${u.telegram_id}` }]);
    }
  }
  const encodedQuery = encodeURIComponent(query).replace(/_/g, "%5F");
  const nav = pageNav(`admin_sr_${encodedQuery}`, offset, limit, users.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "⬅️ بازگشت", callback_data: "admin_users_0" }]);
  await edit(env, cid, mid, text, btns);
}

async function adminUserAction(env, cid, mid, tid) {
  const t = await getUser(env, tid);
  if (!t) return;
  const lvl = getLevel(t.xp || 0);
  const [adsCreated, adsActive, parts, refCount, refEarn, txCount] = await Promise.all([
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE owner_id = ?").bind(tid).first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE owner_id = ? AND status = 'active'").bind(tid).first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaign_participants WHERE user_id = ? AND status = 'rewarded'").bind(tid).first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ?").bind(tid).first(),
    DB(env).prepare("SELECT COALESCE(SUM(reward_amount), 0) as t FROM referrals WHERE referrer_id = ?").bind(tid).first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM transactions WHERE user_id = ?").bind(tid).first(),
  ]);
  let refByLine = "خودش ثبت‌نام کرده";
  if (t.referred_by) {
    const refUser = await getUser(env, t.referred_by);
    if (refUser) refByLine = `${refUser.first_name || refUser.username || refUser.telegram_id} (${refUser.telegram_id})`;
  }
  const text = `👤 ${t.first_name || t.username || tid}\n\n🆔 ${t.telegram_id}\n${lvl.icon} سطح ${lvl.lvl} (${lvl.name})\n📊 XP: ${t.xp || 0}\n💰 ${t.balance} | 📈 ${t.total_earnings}\n🚫 ${t.is_blocked ? "بله" : "خیر"} | 👑 ${t.is_admin ? "بله" : "خیر"}
📢 تبلیغ: ${t.ad_blocked ? "🚫 مسدود" : "✅ آزاد"}\n🎭 ${permLabels(t, tid)}\n\n━━━━━━━━━━━━━\n📊 فعالیت\n📢 کمپین: ${adsCreated?.c || 0} (فعال: ${adsActive?.c || 0})\n🎯 عضویت: ${parts?.c || 0}\n👥 دعوت: ${refCount?.c || 0} (${refEarn?.t || 0} امتیاز)\n📨 دعوت‌شده توسط: ${refByLine}\n🧾 تراکنش: ${txCount?.c || 0}`;
  const btns = [
    [{ text: t.is_blocked ? "✅ رفع مسدودیت" : "🚫 مسدود", callback_data: `${t.is_blocked ? "admin_unblock" : "admin_block"}_${tid}` }],
    [{ text: "🎭 نقش", callback_data: `admin_setrole_${tid}` }, { text: "💰 موجودی", callback_data: `admin_setbal_${tid}` }],
    [{ text: t.ad_blocked ? "✅ رفع مسدود تبلیغ" : "🚫 مسدود تبلیغ", callback_data: `${t.ad_blocked ? "admin_adunblock" : "admin_adblock"}_${tid}` }],
    [{ text: "🧾 تراکنش‌ها", callback_data: `admin_usertx_${tid}_0` }, { text: "👥 زیرمجموعه", callback_data: `admin_userrefs_${tid}_0` }],
    [{ text: "⬅️ بازگشت", callback_data: "admin_users_0" }],
  ];
  await edit(env, cid, mid, text, btns);
}

async function adminTransactions(env, cid, mid, offset) {
  const limit = PAGE_SIZE;
  const [txs, total] = await Promise.all([
    DB(env).prepare("SELECT t.id, t.user_id, t.type, t.amount, t.description, t.reference_id, t.created_at, u.first_name, u.username FROM transactions t LEFT JOIN users u ON t.user_id = u.telegram_id ORDER BY t.id DESC LIMIT ? OFFSET ?").bind(limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM transactions").first(),
  ]);
  let text = `🧾 تراکنش‌های سیستم\n━━━━━━━━━━━━━━━━\n\n`;
  const btns = [];
  if (txs.results.length === 0) { text += "تراکنشی وجود ندارد."; }
  else {
    text += pageIndicator(offset, limit, total?.c || 0) + "\n\n";
    for (const t of txs.results) {
      const name = t.first_name || t.username || t.user_id;
      const icon = t.amount > 0 ? "🟢" : "🔴";
      text += `${icon} ${t.amount > 0 ? "+" : ""}${t.amount} — ${TX_LABELS[t.type] || t.type}\n   👤 ${name} (${t.user_id})\n   💬 ${t.description || "—"}\n   🕐 ${fmtDate(t.created_at)}${t.reference_id ? `\n   🔖 ${t.reference_id}` : ""}\n\n`;
    }
  }
  const nav = pageNav("admin_tx", offset, limit, txs.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "⚙️ بازگشت", callback_data: "admin" }]);
  await edit(env, cid, mid, text, btns);
}

async function adminUserTx(env, cid, mid, tid, offset) {
  const limit = PAGE_SIZE;
  const [txs, total] = await Promise.all([
    DB(env).prepare("SELECT id, type, amount, description, reference_id, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?").bind(tid, limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM transactions WHERE user_id = ?").bind(tid).first(),
  ]);
  const u = await getUser(env, tid);
  const name = u?.first_name || u?.username || tid;
  let text = `🧾 تراکنش‌های ${name}\n🆔 ${tid}\n━━━━━━━━━━━━━━━━\n\n`;
  const btns = [];
  if (txs.results.length === 0) { text += "تراکنشی وجود ندارد."; }
  else {
    text += pageIndicator(offset, limit, total?.c || 0) + "\n\n";
    let tin = 0, tout = 0;
    for (const t of txs.results) { t.amount > 0 ? tin += t.amount : tout += Math.abs(t.amount); text += fmtTx(t, true) + "\n\n"; }
    text += `━━━━━━━━━━━━━━━━\n🟢 ${tin} | 🔴 ${tout}`;
  }
  const nav = pageNav(`admin_usertx_${tid}`, offset, limit, txs.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "⬅️ بازگشت", callback_data: `admin_user_${tid}` }]);
  await edit(env, cid, mid, text, btns);
}

async function adminUserRefs(env, cid, mid, tid, offset) {
  const limit = PAGE_SIZE;
  const [refs, total] = await Promise.all([
    DB(env).prepare("SELECT r.referred_id, r.reward_amount, r.created_at, u.first_name, u.username, u.balance FROM referrals r LEFT JOIN users u ON r.referred_id = u.telegram_id WHERE r.referrer_id = ? ORDER BY r.id DESC LIMIT ? OFFSET ?").bind(tid, limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ?").bind(tid).first(),
  ]);
  const u = await getUser(env, tid);
  const name = u?.first_name || u?.username || tid;
  let text = `👥 زیرمجموعه‌های ${name}\n━━━━━━━━━━━━━━━━\n\n`;
  const btns = [];
  if (refs.results.length === 0) { text += "زیرمجموعه‌ای وجود ندارد."; }
  else {
    text += pageIndicator(offset, limit, total?.c || 0) + "\n\n";
    refs.results.forEach((r, i) => {
      const rn = r.first_name || r.username || r.referred_id;
      text += `${offset + i + 1}. 👤 ${rn} (${r.referred_id})\n   💰 +${r.reward_amount} | 💼 ${r.balance || 0} | 🕐 ${fmtDate(r.created_at)}\n\n`;
    });
  }
  const nav = pageNav(`admin_userrefs_${tid}`, offset, limit, refs.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "⬅️ بازگشت", callback_data: `admin_user_${tid}` }]);
  await edit(env, cid, mid, text, btns);
}

// ==================== Paginated Admin Ads Pending ====================
async function adminAdsMenu(env, cid, mid) {
  const [pending, active, stopped, completed, rejected] = await Promise.all([
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'pending'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'active'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'stopped'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'completed'").first(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'rejected'").first(),
  ]);
  await edit(env, cid, mid, "📋 مدیریت تبلیغ‌ها\n━━━━━━━━━━━━━━━━\n\n⏳ در انتظار: " + (pending?.c || 0) + "\n🟢 فعال: " + (active?.c || 0) + "\n🛑 متوقف: " + (stopped?.c || 0) + "\n✅ تکمیل: " + (completed?.c || 0) + "\n❌ ردشده: " + (rejected?.c || 0), [
    [{ text: "⏳ در انتظار (" + (pending?.c || 0) + ")", callback_data: "admin_ap_0" }, { text: "🟢 فعال (" + (active?.c || 0) + ")", callback_data: "admin_ads_active_0" }],
    [{ text: "🛑 متوقف (" + (stopped?.c || 0) + ")", callback_data: "admin_ads_stopped_0" }, { text: "✅ تکمیل (" + (completed?.c || 0) + ")", callback_data: "admin_ads_completed_0" }],
    [{ text: "❌ ردشده (" + (rejected?.c || 0) + ")", callback_data: "admin_ads_rejected_0" }],
    [{ text: "⚙️ بازگشت", callback_data: "admin" }],
  ]);
}

async function adminAdsList(env, cid, mid, status, offset) {
  const limit = PAGE_SIZE;
  const [ads, total] = await Promise.all([
    DB(env).prepare("SELECT * FROM campaigns WHERE status = ? ORDER BY id DESC LIMIT ? OFFSET ?").bind(status, limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = ?").bind(status).first(),
  ]);
  const statusIcon = { pending: "⏳", active: "🟢", stopped: "🛑", completed: "✅", rejected: "❌" }[status] || "📋";
  const statusLabel = { pending: "در انتظار", active: "فعال", stopped: "متوقف", completed: "تکمیل", rejected: "ردشده" }[status] || status;
  let text = statusIcon + " تبلیغ‌های " + statusLabel + "\n━━━━━━━━━━━━━━━━\n\n";
  const btns = [];
  if (ads.results.length === 0) { text += "تبلیغی نیست."; }
  else {
    text += pageIndicator(offset, limit, total?.c || 0) + "\n\n";
    const ownerIds = [...new Set(ads.results.map(a => a.owner_id?.toString()).filter(Boolean))];
    const ownerPlaceholders = ownerIds.map(() => "?").join(",");
    const owners = await DB(env).prepare("SELECT telegram_id, first_name, username, privacy_show_name, privacy_show_owner FROM users WHERE telegram_id IN (" + ownerPlaceholders + ")").bind(...ownerIds).all();
    const ownerMap = new Map(owners.results.map(o => [o.telegram_id, o]));
    for (const ad of ads.results) {
      const owner = ownerMap.get(ad.owner_id?.toString());
      const ownerName = owner?.privacy_show_owner === 0 ? "مخفی" : (owner?.privacy_show_name === 0 ? "مخفی" : (owner?.first_name || owner?.username || ad.owner_id));
      const approver = ad.approved_by ? "\n✅ تایید: " + ad.approved_by : "";
      const rejecter = ad.rejected_by ? "\n❌ رد: " + ad.rejected_by + (ad.rejected_reason ? " (" + ad.rejected_reason + ")" : "") : "";
      text += "🔹 " + (ad.title || ad.channel_username) + "\n   🔗 " + ad.channel_username + " | 💰 " + (ad.total_budget || 0) + " | 👤 " + ownerName + approver + rejecter + "\n\n";
      if (status === 'pending') {
        btns.push([{ text: "✅ تایید", callback_data: "admin_approve_" + ad.id }, { text: "❌ رد", callback_data: "admin_reject_" + ad.id }]);
      } else if (status === 'active') {
        btns.push([{ text: "🛑 توقف", callback_data: "admin_adstop_" + ad.id }, { text: "👁️ جزئیات", callback_data: "admin_adetail_" + ad.id }]);
      } else if (status === 'stopped') {
        btns.push([{ text: "✅ فعال‌سازی", callback_data: "admin_adactivate_" + ad.id }, { text: "👁️ جزئیات", callback_data: "admin_adetail_" + ad.id }]);
      } else {
        btns.push([{ text: "👁️ جزئیات", callback_data: "admin_adetail_" + ad.id }]);
      }
    }
  }
  const nav = pageNav("admin_ads_" + status + "_", offset, limit, ads.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "📋 تبلیغ‌ها", callback_data: "admin_ads_menu" }]);
  await edit(env, cid, mid, text, btns);
}

async function adminAdDetail(env, cid, mid, adId) {
  const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ?").bind(adId).first();
  if (!ad) return edit(env, cid, mid, "تبلیغ یافت نشد.", [[{ text: "📋 بازگشت", callback_data: "admin_ads_menu" }]]);
  const owner = await getUser(env, ad.owner_id?.toString());
  const ownerName = owner?.privacy_show_owner === 0 ? "مخفی" : (owner?.privacy_show_name === 0 ? "مخفی" : (owner?.first_name || owner?.username || ad.owner_id));
  const joined = await DB(env).prepare("SELECT COUNT(*) as c FROM campaign_participants WHERE campaign_id = ? AND status = 'rewarded'").bind(adId).first();
  const left = await DB(env).prepare("SELECT COUNT(*) as c FROM campaign_participants WHERE campaign_id = ? AND status = 'left'").bind(adId).first();
  const reacts = await DB(env).prepare("SELECT reaction, COUNT(*) as c FROM ad_reactions WHERE campaign_id = ? GROUP BY reaction").bind(adId).all();
  const good = reacts.results.find(x => x.reaction === "good")?.c || 0;
  const bad = reacts.results.find(x => x.reaction === "bad")?.c || 0;
  const statusLabel = { active: "🟢 فعال", pending: "⏳ در انتظار", stopped: "🛑 متوقف", completed: "✅ تکمیل", rejected: "❌ ردشده" }[ad.status] || ad.status;
  let text = "👁️ جزئیات تبلیغ\n━━━━━━━━━━━━━━━━\n\n📌 " + (ad.title || ad.channel_username) + "\n🔗 " + ad.channel_username + "\n📊 " + statusLabel + "\n💰 بودجه: " + (ad.total_budget || 0) + " | 💸 " + (ad.spent || 0) + " | 💵 " + ((ad.total_budget || 0) - (ad.spent || 0)) + "\n⏰ ساعتی: " + (ad.hourly_cost || 0) + "/ساعت | پرداخت: " + (ad.hourly_paid || 0) + "\n👥 عضو: " + (joined?.c || 0) + " | ⚠️ لفت: " + (left?.c || 0) + "\n👍 " + good + " | 👎 " + bad + "\n👤 صاحب: " + ownerName;
  if (ad.approved_by) text += "\n✅ تایید توسط: " + ad.approved_by;
  if (ad.rejected_by) text += "\n❌ رد توسط: " + ad.rejected_by + (ad.rejected_reason ? " (" + ad.rejected_reason + ")" : "");
  const btns = [];
  if (ad.status === "active") btns.push([{ text: "🛑 توقف", callback_data: "admin_adstop_" + adId }]);
  if (ad.status === "stopped") btns.push([{ text: "✅ فعال‌سازی", callback_data: "admin_adactivate_" + adId }]);
  if (ad.status === "pending") btns.push([{ text: "✅ تایید", callback_data: "admin_approve_" + adId }, { text: "❌ رد", callback_data: "admin_reject_" + adId }]);
  btns.push([{ text: "📋 بازگشت", callback_data: "admin_ads_menu" }]);
  await edit(env, cid, mid, text, btns);
}
async function adminAdsPending(env, cid, mid, offset = 0) {
  const limit = PAGE_SIZE;
  const [pending, total] = await Promise.all([
    DB(env).prepare("SELECT * FROM campaigns WHERE status = 'pending' ORDER BY id DESC LIMIT ? OFFSET ?").bind(limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM campaigns WHERE status = 'pending'").first(),
  ]);
  let text = "📋 تایید تبلیغ\n━━━━━━━━━━━━━━━━\n\n";
  const btns = [];
  if (pending.results.length === 0) { text += "تبلیغ در انتظار تایید وجود ندارد."; }
  else {
    text += pageIndicator(offset, limit, total?.c || 0) + "\n\n";
    const ownerIds = [...new Set(pending.results.map(a => a.owner_id?.toString()).filter(Boolean))];
    const ownerPlaceholders = ownerIds.map(() => "?").join(",");
    const owners = await DB(env).prepare(`SELECT telegram_id, first_name, username, privacy_show_name, privacy_show_owner FROM users WHERE telegram_id IN (${ownerPlaceholders})`).bind(...ownerIds).all();
    const ownerMap = new Map(owners.results.map(o => [o.telegram_id, o]));
    for (const ad of pending.results) {
      const owner = ownerMap.get(ad.owner_id?.toString());
      const reacts = await DB(env).prepare("SELECT reaction, COUNT(*) as c FROM ad_reactions WHERE campaign_id = ? GROUP BY reaction").bind(ad.id).all();
    const good = reacts.results.find(x => x.reaction === "good")?.c || 0;
    const bad = reacts.results.find(x => x.reaction === "bad")?.c || 0;
    text += `🔹 ${ad.title || ad.channel_username}\n   🔗 ${ad.channel_username} | 💰 ${ad.total_budget}${ad.hourly_cost ? ` | ⏰ ${ad.hourly_cost}/ساعت` : ""} | 👤 ${owner?.privacy_show_owner === 0 ? "مخفی" : (owner?.privacy_show_name === 0 ? "مخفی" : (owner?.first_name || owner?.username || ad.owner_id))} | 👍${good} 👎${bad}\n\n`;
      btns.push([{ text: "✅ تایید", callback_data: `admin_approve_${ad.id}` }, { text: "❌ رد", callback_data: `admin_reject_${ad.id}` }]);
    }
  }
  const nav = pageNav("admin_ap", offset, limit, pending.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "⚙️ بازگشت", callback_data: "admin" }]);
  await edit(env, cid, mid, text, btns);
}

async function adminFinancial(env, cid, mid) {
  const [cost, tax, ref, tt] = await Promise.all([
    getSetting(env, "ad_cost_per_join", 10), getSetting(env, "ad_tax_percent", 5),
    getSetting(env, "referral_percent", 20), DB(env).prepare("SELECT SUM(amount) as t FROM transactions WHERE type = 'ad_creation'").first(),
  ]);
  await edit(env, cid, mid, `💰 تنظیمات مالی\n\n• هزینه/عضو: ${cost}\n• مالیات: ${tax}%\n• سهم رفرال: ${ref}%\n• هزینه ساعتی: ${await getSetting(env, "default_hourly_cost", 0)}\n• پاداش فعالیت/ساعت: ${await getSetting(env, "activity_reward", 6)} سکه\n• حقوق ادمین/ساعت: ${await getSetting(env, "admin_salary", 100)} سکه\n• سهم ادمین از مالیات: ${await getSetting(env, "admin_tax_share", 30)}%\n• کل مالیات: ${Math.abs(tt?.t || 0)}`, [
    [{ text: "💵 قیمت", callback_data: "admin_set_cost" }, { text: "📊 مالیات", callback_data: "admin_set_tax" }],
    [{ text: "👥 رفرال", callback_data: "admin_set_ref" }, { text: "📝 متن اشتراک", callback_data: "admin_set_share" }],
    [{ text: "⏰ هزینه ساعتی", callback_data: "admin_set_hourly" }, { text: "🎯 پاداش فعالیت", callback_data: "admin_set_activityreward" }],
    [{ text: "💼 حقوق ادمین/ساعت", callback_data: "admin_set_adminsalary" }, { text: "📊 سهم مالیات ادمین", callback_data: "admin_set_taxshare" }],
    [{ text: "🧾 گزارش مالیات", callback_data: "admin_tax_log_0" }],
    [{ text: "⚙️ بازگشت", callback_data: "admin" }],
  ]);
}

async function adminTaxLog(env, cid, mid, offset) {
  const limit = PAGE_SIZE;
  const [logs, total] = await Promise.all([
    DB(env).prepare("SELECT t.id, t.campaign_id, t.user_id, t.amount, t.tax_type, t.created_at, u.first_name, u.username FROM tax_log t LEFT JOIN users u ON t.user_id = u.telegram_id ORDER BY t.id DESC LIMIT ? OFFSET ?").bind(limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM tax_log").first(),
  ]);
  const taxNames = { creation: "ایجاد", renewal: "تمدید", cancel_refund: "بازگشت لغو" };
  let text = "🧾 گزارش مالیات\n━━━━━━━━━━━━━━━━\n\n";
  const btns = [];
  if (logs.results.length === 0) { text += "رکوردی وجود ندارد."; }
  else {
    text += pageIndicator(offset, limit, total?.c || 0) + "\n\n";
    for (const l of logs.results) {
      const name = l.first_name || l.username || l.user_id;
      text += `${l.amount > 0 ? "🟢" : "🔴"} ${l.amount > 0 ? "+" : ""}${l.amount} — ${taxNames[l.tax_type] || l.tax_type}\n   👤 ${name} (${l.user_id})${l.campaign_id ? `\n   📌 #${l.campaign_id}` : ""}\n   🕐 ${fmtDate(l.created_at)}\n\n`;
    }
  }
  const nav = pageNav("admin_tax_log", offset, limit, logs.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "💰 بازگشت", callback_data: "admin_financial" }]);
  await edit(env, cid, mid, text, btns);
}

// ==================== Admin Roles ====================
async function adminRoles(env, cid, mid, offset) {
  const limit = PAGE_SIZE;
  const [users, total] = await Promise.all([
    DB(env).prepare("SELECT telegram_id, first_name, username, is_admin, admin_role FROM users WHERE is_admin = 1 OR (admin_role IS NOT NULL AND admin_role != 'null') ORDER BY id DESC LIMIT ? OFFSET ?").bind(limit, offset).all(),
    DB(env).prepare("SELECT COUNT(*) as c FROM users WHERE is_admin = 1 OR (admin_role IS NOT NULL AND admin_role != 'null')").first(),
  ]);
  let text = "🎭 دسترسی‌ها\n━━━━━━━━━━━━━━━━\n\n";
  const btns = [];
  if (users.results.length === 0) { text += "ادمینی وجود ندارد."; }
  else {
    text += pageIndicator(offset, limit, total?.c || 0) + "\n\n";
    for (const u of users.results) {
      const name = u.first_name || u.username || u.telegram_id;
      const perms = getPerms(u, u.telegram_id);
      const label = perms.length === ALL_PERMS.length ? "👑 همه" : `${perms.length} دسترسی`;
      btns.push([{ text: `👤 ${name} — ${label}`, callback_data: `admin_setrole_${u.telegram_id}` }]);
    }
  }
  const nav = pageNav("admin_roles", offset, limit, users.results.length === limit);
  if (nav.length) btns.push(...nav);
  btns.push([{ text: "➕ افزودن", callback_data: "admin_addrole" }]);
  btns.push([{ text: "⚙️ بازگشت", callback_data: "admin" }]);
  await edit(env, cid, mid, text, btns);
}

async function adminSetRole(env, cid, mid, tid) {
  const t = await getUser(env, tid);
  if (!t) return;
  const userPerms = getPerms(t, tid);
  const hasAll = userPerms.length === ALL_PERMS.length;
  let text = `🎭 دسترسی‌های ${t.first_name || t.username || tid}\n🆔 ${tid}\n🏷️ ${hasAll ? "👑 همه" : userPerms.length > 0 ? `${userPerms.length} دسترسی` : "بدون دسترسی"}\n\nکلیک = فعال/غیرفعال:`;
  const btns = ALL_PERMS.map(p => [{ text: `${userPerms.includes(p.key) ? "✅" : "⬜"} ${p.label}`, callback_data: `perm_toggle_${p.key}_${tid}` }]);
  btns.push([{ text: "👑 همه", callback_data: `perm_all_${tid}` }]);
  btns.push([{ text: "❌ حذف همه", callback_data: `perm_clear_${tid}` }]);
  btns.push([{ text: "⬅️ بازگشت", callback_data: "admin_roles_0" }]);
  if (mid) await edit(env, cid, mid, text, btns);
  else await send(env, cid, text, btns);
}

// ==================== Message Handler ====================
async function handleMessage(env, upd) {
  const { chat, from, text } = upd.message;
  const uid = from?.id?.toString() || "";
  const u = await registerUser(env, from);
  if (!u) return;
  try {
    const nowMs = Date.now();
    const nowStr = new Date(nowMs).toISOString().slice(0, 19).replace("T", " ");
    if (u.last_active) {
      const lastMs = new Date(u.last_active.replace(" ", "T") + "Z").getTime();
      const gap = Math.min(Math.max(Math.floor((nowMs - lastMs) / 1000), 0), 600);
      if (gap > 0) await DB(env).prepare("UPDATE users SET total_active_seconds = total_active_seconds + ?, last_active = ? WHERE telegram_id = ?").bind(gap, nowStr, uid).run();
    } else {
      await DB(env).prepare("UPDATE users SET last_active = ? WHERE telegram_id = ?").bind(nowStr, uid).run();
    }
  } catch (e) { console.error("activity:", e); }
  if (u?.is_blocked === 1) return send(env, chat.id, "❌ حساب شما مسدود است.");
  const admin = isAdmin(u, uid);
  if (admin && u?.user_state) {
    if (u.user_state === "admin_broadcast") {
      if (text === "❌ انصراف") { await clearState(env, uid); return send(env, chat.id, "❌ لغو شد."); }
      await clearState(env, uid);
      const adminUser = await getUser(env, uid);
      await DB(env).prepare("INSERT INTO inbox_messages (admin_id, admin_name, text) VALUES (?, ?, ?)").bind(uid, (adminUser?.first_name || adminUser?.username || uid), text).run();
      const all = await DB(env).prepare("SELECT telegram_id FROM users WHERE is_blocked = 0 AND inbox_muted = 0").all();
      let sent = 0, fail = 0;
      for (const r of all.results) { (await tg(env.TELEGRAM_TOKEN, "sendMessage", { chat_id: r.telegram_id, text: "📥 پیام جدید در اینباکس!\n\n" + text, reply_markup: { inline_keyboard: [[{ text: "📥 باز کردن اینباکس", callback_data: "inbox_0" }]] } }))?.ok ? sent++ : fail++; }
      return send(env, chat.id, `✅ ارسال شد.\n📤 ${sent} | ❌ ${fail}`);
    }
    if (u.user_state === "admin_search") {
      if (text === "❌ انصراف") { await clearState(env, uid); return; }
      await clearState(env, uid);
      return adminSearchResults(env, chat.id, text.trim(), 0);
    }
    if (u.user_state === "admin_addrole") {
      const tid = text.trim();
      if (!/^\d+$/.test(tid)) return send(env, chat.id, "❌ آیدی باید عدد باشد.");
      const target = await getUser(env, tid);
      if (!target) { await clearState(env, uid); return send(env, chat.id, "❌ کاربر یافت نشد. ابتدا /start بزند."); }
      await clearState(env, uid);
      return adminSetRole(env, chat.id, null, tid);
    }
    const setMap = { admin_set_cost: "ad_cost_per_join", admin_set_tax: "ad_tax_percent", admin_set_ref: "referral_percent", admin_set_hourly: "default_hourly_cost", admin_set_activityreward: "activity_reward", admin_set_adminsalary: "admin_salary", admin_set_taxshare: "admin_tax_share" };
    for (const [state, key] of Object.entries(setMap)) {
      if (u.user_state === state) {
        const v = parseInt(text || "0");
        const isPct = key.includes("percent") || key === "referral_percent";
        if (isNaN(v) || v < 0 || (isPct && v > 100)) { await clearState(env, uid); return send(env, chat.id, `❌ ${isPct ? "0 تا 100" : "عدد نامعتبر"}.`); }
        await setSetting(env, key, v); await clearState(env, uid);
        return send(env, chat.id, `✅ ${key === "ad_cost_per_join" ? "قیمت" : key === "ad_tax_percent" ? "مالیات" : key === "default_hourly_cost" ? "هزینه ساعتی" : key === "activity_reward" ? "پاداش فعالیت" : key === "admin_salary" ? "حقوق ادمین" : key === "admin_tax_share" ? "سهم مالیات ادمین" : "سهم رفرال"}: ${v}${isPct ? "%" : ""}`, [[{ text: "💰 بازگشت", callback_data: "admin_financial" }]]);
      }
    }
    if (u.user_state === "admin_edit_admin_tutorial") {
      if (text === "❌ انصراف") { await clearState(env, uid); return send(env, chat.id, "❌ لغو شد."); }
      await setSetting(env, "admin_tutorial_text", text); await clearState(env, uid);
      return send(env, chat.id, "✅ متن «آموزش ادمین» ذخیره شد.", [[{ text: "📝 بازگشت", callback_data: "admin_content" }]]);
    }
    if (u.user_state === "admin_edit_about") {
      if (text === "❌ انصراف") { await clearState(env, uid); return send(env, chat.id, "❌ لغو شد."); }
      await setSetting(env, "about_text", text); await clearState(env, uid);
      return send(env, chat.id, "✅ متن «درباره ما» ذخیره شد.", [[{ text: "📝 بازگشت", callback_data: "admin_content" }]]);
    }
    if (u.user_state === "admin_edit_tutorial") {
      if (text === "❌ انصراف") { await clearState(env, uid); return send(env, chat.id, "❌ لغو شد."); }
      await setSetting(env, "tutorial_text", text); await clearState(env, uid);
      return send(env, chat.id, "✅ متن «آموزش» ذخیره شد.", [[{ text: "📝 بازگشت", callback_data: "admin_content" }]]);
    }
    if (u.user_state === "admin_set_likereward") {
      if (text === "❌ انصراف") { await clearState(env, uid); return send(env, chat.id, "❌ لغو شد."); }
      const v = parseInt(text || "0");
      if (isNaN(v) || v < 0) { await clearState(env, uid); return send(env, chat.id, "❌ عدد نامعتبر."); }
      await setSetting(env, "like_reward", v); await clearState(env, uid);
      return send(env, chat.id, "✅ پاداش لایک: " + v + " سکه", [[{ text: "📝 بازگشت", callback_data: "admin_content" }]]);
    }
    if (u.user_state === u.user_state === "admin_set_share") {
      await setSetting(env, "referral_share_text", text); await clearState(env, uid);
      return send(env, chat.id, "✅ متن اشتراک ذخیره شد.", [[{ text: "💰 بازگشت", callback_data: "admin_financial" }]]);
    }
    if (u.user_state?.startsWith("admin_setbal_")) {
      const tid = u.user_state.replace("admin_setbal_", "");
      const v = parseFloat(text || "0");
      if (isNaN(v)) { await clearState(env, uid); return send(env, chat.id, "❌ نامعتبر."); }
      const tu = await getUser(env, tid);
      const diff = v - (tu?.balance || 0);
      await DB(env).prepare("UPDATE users SET balance = ? WHERE telegram_id = ?").bind(v, tid).run();
      const refId = `adj_${tid}_${Date.now()}`;
      await addTx(env, tid, "admin_adjust", diff, `تنظیم مدیر (${uid}) از ${tu?.balance || 0} به ${v}`, refId);
      await clearState(env, uid);
      return send(env, chat.id, `✅ موجودی: ${v}\n🔖 ${refId}`, [[{ text: "👥 بازگشت", callback_data: `admin_user_${tid}` }]]);
    }
  }
    if (u?.user_state === "edit_ad_title") {
    let d = {};
    try { d = JSON.parse(u.state_data || "{}"); } catch { d = {}; }
    if (!d.adId) return;
    await DB(env).prepare("UPDATE campaigns SET title = ? WHERE id = ?").bind(text, d.adId).run();
    await clearState(env, uid);
    await send(env, chat.id, "✅ عنوان اصلاح شد.", [[{ text: "📊 مشاهده", callback_data: "ad_stats_" + d.adId }]]);
    return;
  }
  if (u?.user_state === "edit_ad_hourly") {
    let d = {};
    try { d = JSON.parse(u.state_data || "{}"); } catch { d = {}; }
    if (!d.adId) return;
    const v = parseInt(text || "0");
    if (isNaN(v) || v < 0) { await send(env, chat.id, "❌ عدد نامعتبر. 0 یا بیشتر:"); return; }
    await DB(env).prepare("UPDATE campaigns SET hourly_cost = ? WHERE id = ?").bind(v, d.adId).run();
    await clearState(env, uid);
    await send(env, chat.id, "✅ هزینه ساعتی اصلاح شد: " + v + "/ساعت", [[{ text: "📊 مشاهده", callback_data: "ad_stats_" + d.adId }]]);
    return;
  }
if (u?.user_state?.startsWith("create_ad")) {
    if (await handleAdMessage(env, chat, u, uid, text)) return;
  }
    if (text === "/help") {
    const cost = await getSetting(env, "ad_cost_per_join", 10);
    const taxP = await getSetting(env, "ad_tax_percent", 5);
    return send(env, chat.id, "📚 راهنمای ربات\n━━━━━━━━━━━━━━━━\n\n🤖 این ربات برای تبلیغ کانال و کسب درآمد است.\n\n📢 تبلیغ‌گذار:\n• /start → 📢 تبلیغات → ➕ ایجاد تبلیغ\n• ربات را ادمین کانال کنید\n• هزینه/عضو: " + cost + " | مالیات: " + taxP + "%\n\n💰 کاربر:\n• 📢 تبلیغات → عضو شوید → پاداش بگیرید\n• ⚠️ لفت = کسر پاداش\n\n👥 دعوت دوستان = درآمد بیشتر\n\nℹ️ درباره ما و 📚 آموزش در منوی اصلی\n📜 قوانین: /rules\n\n🔒 حریم خصوصی شما محترم است.", [[{ text: "🏠 بازگشت", callback_data: "main" }]]);
  }
if (text === "/start" || text?.startsWith("/start ")) {
    if (text?.includes("ref_") && !u?.referred_by) {
      const code = text.split("ref_")[1]?.split(" ")[0];
      if (code) {
        const ref = await DB(env).prepare("SELECT * FROM users WHERE referral_code = ?").bind(code).first();
        if (ref && ref.telegram_id !== uid) {
          const reward = 2;
          const refId = `ref_${ref.telegram_id}_${uid}`;
          await Promise.all([
            DB(env).prepare("INSERT OR IGNORE INTO referrals (referrer_id, referred_id, reward_amount) VALUES (?, ?, ?)").bind(ref.telegram_id, uid, reward).run(),
            DB(env).prepare("UPDATE users SET referred_by = ?, balance = balance + ?, total_earnings = total_earnings + ? WHERE telegram_id = ?").bind(ref.telegram_id, reward, reward, ref.telegram_id).run(),
            addTx(env, ref.telegram_id, "referral", reward, `دعوت ${u.first_name || uid}`, refId),
            addXP(env, ref.telegram_id, 5),
            tg(env.TELEGRAM_TOKEN, "sendMessage", { chat_id: parseInt(ref.telegram_id), text: `🎉 +${reward} از دعوت!\n👤 ${u.first_name || uid}` }),
          ]);
        }
      }
    }
    const ch = await DB(env).prepare("SELECT channel_username FROM channels WHERE is_required = 1 LIMIT 1").first();
    if (ch && !(await isMember(env, uid, ch.channel_username))) {
      return send(env, chat.id, `⚠️ ابتدا عضو شوید:\n${ch.channel_username}`, [[{ text: "📢 عضویت", url: `https://t.me/${ch.channel_username.replace("@", "")}` }], [{ text: "✅ بررسی", callback_data: "check_ch" }]]);
    }
    if (!u?.rules_accepted) {
      const r = await DB(env).prepare("SELECT content FROM rules WHERE is_active = 1 ORDER BY version DESC LIMIT 1").first();
      const rp = await getSetting(env, "referral_percent", 20);
      return send(env, chat.id, (r?.content || `📜 قوانین:\n1. رعایت ادب\n2. بدون محتوای غیراخلاقی\n3. لفت = کسر\n\n💰 مالیات: 5%\n• ${rp}% به معرف`) + "\n\n✅ قوانین را می‌پذیرم:", [[{ text: "✅ قبول", callback_data: "accept_rules" }]]);
    }
    return mainMenu(env, chat.id, null, u, admin);
  }
  if (text && !text.startsWith("/")) {
    return send(env, chat.id, "از /start استفاده کنید.", [[{ text: "🏠 منو", callback_data: "main" }]]);
  }
}

// ==================== Callback Handler ====================
async function handleCallback(env, upd) {
  const cb = upd.callback_query;
  const uid = cb.from.id.toString();
  const cid = cb.message.chat.id;
  const mid = cb.message.message_id;
  const d = cb.data;
  await tg(env.TELEGRAM_TOKEN, "answerCallbackQuery", { callback_query_id: cb.id, cache_time: 0 });
  const u = await getUser(env, uid);
  if (!u) return;
  if (u?.is_blocked === 1) return alert(env, cb.id, "❌ مسدود هستید.");
  const admin = isAdmin(u, uid);
  try {
    const nowMs = Date.now();
    const nowStr = new Date(nowMs).toISOString().slice(0, 19).replace("T", " ");
    if (u.last_active) {
      const lastMs = new Date(u.last_active.replace(" ", "T") + "Z").getTime();
      const gap = Math.min(Math.max(Math.floor((nowMs - lastMs) / 1000), 0), 600);
      if (gap > 0) await DB(env).prepare("UPDATE users SET total_active_seconds = total_active_seconds + ?, last_active = ? WHERE telegram_id = ?").bind(gap, nowStr, uid).run();
    } else {
      await DB(env).prepare("UPDATE users SET last_active = ? WHERE telegram_id = ?").bind(nowStr, uid).run();
    }
  } catch (e) { console.error("activity_cb:", e); }
  if (d === "main") return mainMenu(env, cid, mid, u, admin);
  if (d === "user_panel") return userPanel(env, cid, mid, u);
  if (d === "ads_menu") return adsMenu(env, cid, mid, uid, 0);
  if (d.startsWith("ads_page_")) return adsMenu(env, cid, mid, uid, parseInt(d.replace("ads_page_", "")) || 0);
  if (d.startsWith("my_ads_")) return myAds(env, cid, mid, uid, parseInt(d.replace("my_ads_", "")) || 0);
  if (d.startsWith("ad_stats_")) return adStatsDetail(env, cid, mid, uid, parseInt(d.replace("ad_stats_", "")), 0);
  if (d.startsWith("ad_part_")) {
    const parts = d.replace("ad_part_", "").split("_");
    return adStatsDetail(env, cid, mid, uid, parseInt(parts[0]), parseInt(parts[1]) || 0);
  }
  if (d.startsWith("ad_stop_")) return cancelCampaign(env, cid, mid, uid, parseInt(d.replace("ad_stop_", "")));
  if (d.startsWith("ad_renew_")) return renewCampaign(env, cid, mid, uid, parseInt(d.replace("ad_renew_", "")));
  if (d.startsWith("renew_add_") || d.startsWith("renew_sub_")) return handleRenewBudget(env, cb, u, uid, cid, mid, d);
  if (d === "renew_confirm") return confirmRenew(env, cb, u, uid, cid, mid);
  if (d.startsWith("lb_")) return leaderboard(env, cid, mid, d.replace("lb_", ""));
  if (d.startsWith("inbox_like_")) return inboxLike(env, cb, uid, parseInt(d.replace("inbox_like_", "")));
  if (d === "inbox_mute") return inboxMuteToggle(env, cid, mid, u);
  if (d.startsWith("inbox_")) return inboxMenu(env, cid, mid, u, parseInt(d.replace("inbox_", "") || "0"));
  if (d === "bot_stats") return botStats(env, cid, mid);
  if (d === "settings") return settingsPage(env, cid, mid, u);
  if (d === "set_priv_lb") {
    await DB(env).prepare("UPDATE users SET privacy_leaderboard = ? WHERE telegram_id = ?").bind(u?.privacy_leaderboard === 1 ? 0 : 1, uid).run();
    u.privacy_leaderboard = u?.privacy_leaderboard === 1 ? 0 : 1;
    return settingsPage(env, cid, mid, u);
  }
  if (d === "set_priv_name") {
    await DB(env).prepare("UPDATE users SET privacy_show_name = ? WHERE telegram_id = ?").bind(u?.privacy_show_name === 1 ? 0 : 1, uid).run();
    u.privacy_show_name = u?.privacy_show_name === 1 ? 0 : 1;
    return settingsPage(env, cid, mid, u);
  }
  if (d === "set_priv_owner") {
    await DB(env).prepare("UPDATE users SET privacy_show_owner = ? WHERE telegram_id = ?").bind(u?.privacy_show_owner === 0 ? 1 : 0, uid).run();
    u.privacy_show_owner = u?.privacy_show_owner === 0 ? 1 : 0;
    return settingsPage(env, cid, mid, u);
  }
  if (d === "set_lang_fa") {
    await DB(env).prepare("UPDATE users SET lang = ? WHERE telegram_id = ?").bind("fa", uid).run();
    u.lang = "fa";
    return settingsPage(env, cid, mid, u);
  }
  if (d === "set_lang_en") {
    await DB(env).prepare("UPDATE users SET lang = ? WHERE telegram_id = ?").bind("en", uid).run();
    u.lang = "en";
    return settingsPage(env, cid, mid, u);
  }
  if (d === "about") return aboutPage(env, cid, mid);
  if (d === "tutorial") return tutorialPage(env, cid, mid);
  if (d.startsWith("like_")) {
    const pageKey = d.replace("like_", "");
    return handleLike(env, cb, uid, pageKey);
  }
  if (d === "admin_tutorial") {
    if (!canAccess(u, uid, "content")) return;
    return adminTutorialPage(env, cid, mid);
  }
  if (d === "admin_edit_admin_tutorial") {
    if (!canAccess(u, uid, "content")) return;
    const cur = await getSetting(env, "admin_tutorial_text", "");
    await setState(env, uid, "admin_edit_admin_tutorial", {});
    return edit(env, cid, mid, "✏️ ویرایش «آموزش ادمین»\n\nمتن فعلی:\n" + (cur || "(پیش‌فرض)") + "\n\nمتن جدید را ارسال کنید:", [[{ text: "❌ انصراف", callback_data: "admin_content" }]]);
  }
  if (d === "admin_content") {
    if (!canAccess(u, uid, "content")) return;
    return adminContent(env, cid, mid);
  }
  if (d === "admin_edit_about") {
    if (!canAccess(u, uid, "content")) return;
    const cur = await getSetting(env, "about_text", "");
    await setState(env, uid, "admin_edit_about", {});
    return edit(env, cid, mid, "✏️ ویرایش «درباره ما»\n\nمتن فعلی:\n" + (cur || "(پیش‌فرض)") + "\n\nمتن جدید را ارسال کنید:", [[{ text: "❌ انصراف", callback_data: "admin_content" }]]);
  }
  if (d === "admin_edit_tutorial") {
    if (!canAccess(u, uid, "content")) return;
    const cur = await getSetting(env, "tutorial_text", "");
    await setState(env, uid, "admin_edit_tutorial", {});
    return edit(env, cid, mid, "✏️ ویرایش «آموزش»\n\nمتن فعلی:\n" + (cur || "(پیش‌فرض)") + "\n\nمتن جدید را ارسال کنید:", [[{ text: "❌ انصراف", callback_data: "admin_content" }]]);
  }
  if (d === "admin_set_likereward") {
    if (!canAccess(u, uid, "content")) return;
    await setState(env, uid, "admin_set_likereward", {});
    const cur = await getSetting(env, "like_reward", 10);
    return edit(env, cid, mid, "💰 پاداش لایک فعلی: " + cur + "\n\nمقدار جدید:", [[{ text: "❌ انصراف", callback_data: "admin_content" }]]);
  }
  if (d === "rules") return rules(env, cid, mid);
  if (d === "my_refs_0" || d.startsWith("my_refs_")) return myReferrals(env, cid, mid, u, parseInt(d.replace("my_refs_", "")) || 0);
  if (d === "all_tx_0" || d.startsWith("all_tx_")) return allTransactions(env, cid, mid, u, parseInt(d.replace("all_tx_", "")) || 0);
  if (d === "accept_rules") {
    await DB(env).prepare("UPDATE users SET rules_accepted = 1 WHERE telegram_id = ?").bind(uid).run();
    return mainMenu(env, cid, mid, await getUser(env, uid), admin);
  }
  if (d === "check_ch") {
    const ch = await DB(env).prepare("SELECT channel_username FROM channels WHERE is_required = 1 LIMIT 1").first();
    if (ch && (await isMember(env, uid, ch.channel_username))) return mainMenu(env, cid, mid, u, admin);
    return alert(env, cb.id, "❌ هنوز عضو نشده‌اید!");
  }
  if (d.startsWith("ad_edit_title_")) {
    const adId = parseInt(d.replace("ad_edit_title_", ""));
    return editAdField(env, cid, mid, uid, adId, "title");
  }
  if (d.startsWith("ad_edit_hourly_")) {
    const adId = parseInt(d.replace("ad_edit_hourly_", ""));
    return editAdField(env, cid, mid, uid, adId, "hourly");
  }
  if (d.startsWith("ad_edit_")) {
    const adId = parseInt(d.replace("ad_edit_", ""));
    return editAd(env, cid, mid, uid, adId);
  }
  if (d === "ad_create") {
    if (u?.ad_blocked) return edit(env, cid, mid, "🚫 شما از تبلیغ‌گذاری مسدود شده‌اید!\n\n❌ دلیل: نقض قوانین ربات\n\nبرای رفع مسدودیت با ادمین تماس بگیرید.", [[{ text: "🏠 بازگشت", callback_data: "main" }]]);
    await setState(env, uid, "create_ad_channel", {});
    return edit(env, cid, mid, "➕ ایجاد تبلیغ\n\n⚠️ ربات باید ادمین کانال باشد.\n\nآیدی کانال با @:\n@example", [[{ text: "❌ انصراف", callback_data: "ad_cancel" }]]);
  }
  if (d === "ad_cancel") {
    await clearState(env, uid);
    return edit(env, cid, mid, "❌ لغو شد.", [[{ text: "🏠 بازگشت", callback_data: "main" }]]);
  }
  if (d === "ad_chcheck") {
    let s = {};
    try { s = JSON.parse(u.state_data || "{}"); } catch { s = {}; }
    const ch = s.channel;
    if (!ch) return alert(env, cb.id, "خطا! دوباره از منو شروع کنید.");
    const botInfo = await tg(env.TELEGRAM_TOKEN, "getMe");
    const botId = botInfo?.result?.id;
    if (!botId) return alert(env, cb.id, "خطا در بررسی ربات!");
    const member = await tg(env.TELEGRAM_TOKEN, "getChatMember", { chat_id: ch, user_id: botId });
    const status = member?.result?.status;
    if (status === "administrator" || status === "creator") {
      await setState(env, uid, "create_ad_title", { channel: ch, budget: 0 });
      return edit(env, cid, mid, "✅ کانال: " + ch + "\n\n✅ ربات ادمین کانال است.\n\nعنوان تبلیغ:", [[{ text: "❌ انصراف", callback_data: "ad_cancel" }]]);
    }
    return alert(env, cb.id, "❌ ربات هنوز ادمین نیست! ابتدا ربات را ادمین کنید.");
  }
  if (d === "ad_hourly_skip") {
    if (u?.user_state !== "create_ad_hourly") return alert(env, cb.id, "خطا! دوباره شروع کنید.");
    let s = {};
    try { s = JSON.parse(u.state_data || "{}"); } catch { s = {}; }
    s.hourlyCost = 0;
    await setState(env, uid, "create_ad_budget", s);
    const cost = await getSetting(env, "ad_cost_per_join", 10);
    return edit(env, cid, mid, "✅ هزینه ساعتی: 0 (بدون هزینه ساعتی)\n💰 هزینه/عضو: " + cost + "\n\nبودجه را انتخاب کنید:", [
      [{ text: "➕100", callback_data: "bud_add_100" }, { text: "➕500", callback_data: "bud_add_500" }, { text: "➕1000", callback_data: "bud_add_1000" }],
      [{ text: "❌ انصراف", callback_data: "ad_cancel" }],
    ]);
  }
  if (d.startsWith("bud_add_") || d.startsWith("bud_sub_")) return handleBudget(env, cb, u, uid, cid, mid, d);
  if (d === "bud_confirm") return confirmAd(env, cb, u, uid, cid, mid);
  if (d.startsWith("ad_react_")) {
    const parts = d.replace("ad_react_", "").split("_");
    const adId = parseInt(parts[0]);
    const reaction = parts[1];
    await DB(env).prepare("INSERT OR REPLACE INTO ad_reactions (campaign_id, user_id, reaction) VALUES (?, ?, ?)").bind(adId, uid, reaction).run();
    if (reaction === "bad") {
      const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ?").bind(adId).first();
      const reporter = await getUser(env, uid);
      await tg(env.TELEGRAM_TOKEN, "sendMessage", { chat_id: SUPER_ADMIN, text: "⚠️ گزارش تبلیغ نامناسب!\n\n📌 " + (ad?.title || adId) + "\n🔗 " + (ad?.channel_username || "") + "\n👤 گزارش‌دهنده: " + (reporter?.first_name || reporter?.username || uid) });
      return alert(env, cb.id, "👎 گزارش شد! ادمین‌ها بررسی می‌کنند.\n💡 می‌توانید از تبلیغ بگذرید.", true);
    }
    return alert(env, cb.id, "👍 ممنون! نظر شما ثبت شد.", true);
  }
  if (d.startsWith("ad_skip_")) {
    const adId = parseInt(d.replace("ad_skip_", ""));
    const next = await DB(env).prepare("SELECT id FROM campaigns WHERE status = 'active' AND id > ? ORDER BY id ASC LIMIT 1").bind(adId).first();
    if (next) return handleAdView(env, cid, mid, uid, next.id);
    return adsMenu(env, cid, mid, uid, 0);
  }
  if (d.startsWith("ad_view_") || d.startsWith("ad_check_")) {
    return handleAdView(env, cid, mid, uid, parseInt(d.replace("ad_view_", "").replace("ad_check_", "")));
  }
  if (d === "admin") { if (!admin) return; await clearState(env, uid); return adminPanel(env, cid, mid); }
  if (d.startsWith("admin_sr_")) {
    if (!canAccess(u, uid, "search")) return;
    const rest = d.replace("admin_sr_", "");
    const lastUscore = rest.lastIndexOf("_");
    const encodedQuery = rest.substring(0, lastUscore);
    const offset = parseInt(rest.substring(lastUscore + 1)) || 0;
    const query = decodeURIComponent(encodedQuery);
    return adminSearchResults(env, cid, query, offset);
  }
  if (d.startsWith("admin_usertx_")) {
    if (!canAccess(u, uid, "user_tx")) return;
    const parts = d.replace("admin_usertx_", "").split("_");
    return adminUserTx(env, cid, mid, parts[0], parseInt(parts[1]) || 0);
  }
  if (d.startsWith("admin_userrefs_")) {
    if (!canAccess(u, uid, "user_refs")) return;
    const parts = d.replace("admin_userrefs_", "").split("_");
    return adminUserRefs(env, cid, mid, parts[0], parseInt(parts[1]) || 0);
  }
  if (d.startsWith("admin_users_")) {
    if (!canAccess(u, uid, "users")) return;
    return adminUsers(env, cid, mid, parseInt(d.replace("admin_users_", "")) || 0);
  }
  if (d.startsWith("admin_user_")) {
    if (!canAccess(u, uid, "users")) return;
    return adminUserAction(env, cid, mid, d.replace("admin_user_", ""));
  }
  if (d === "admin_ads_menu") {
    if (!canAccess(u, uid, "ads_pending")) return;
    return adminAdsMenu(env, cid, mid);
  }
  if (d.startsWith("admin_ads_active_")) {
    if (!canAccess(u, uid, "ads_pending")) return;
    return adminAdsList(env, cid, mid, "active", parseInt(d.replace("admin_ads_active_", "") || "0"));
  }
  if (d.startsWith("admin_ads_stopped_")) {
    if (!canAccess(u, uid, "ads_pending")) return;
    return adminAdsList(env, cid, mid, "stopped", parseInt(d.replace("admin_ads_stopped_", "") || "0"));
  }
  if (d.startsWith("admin_ads_completed_")) {
    if (!canAccess(u, uid, "ads_pending")) return;
    return adminAdsList(env, cid, mid, "completed", parseInt(d.replace("admin_ads_completed_", "") || "0"));
  }
  if (d.startsWith("admin_ads_rejected_")) {
    if (!canAccess(u, uid, "ads_pending")) return;
    return adminAdsList(env, cid, mid, "rejected", parseInt(d.replace("admin_ads_rejected_", "") || "0"));
  }
  if (d.startsWith("admin_adstop_")) {
    if (!canAccess(u, uid, "ads_pending")) return;
    const adId = parseInt(d.replace("admin_adstop_", ""));
    await DB(env).prepare("UPDATE campaigns SET status = 'stopped' WHERE id = ?").bind(adId).run();
    return adminAdsList(env, cid, mid, "active", 0);
  }
  if (d.startsWith("admin_adactivate_")) {
    if (!canAccess(u, uid, "ads_pending")) return;
    const adId = parseInt(d.replace("admin_adactivate_", ""));
    await DB(env).prepare("UPDATE campaigns SET status = 'active', last_hour_check = CURRENT_TIMESTAMP WHERE id = ?").bind(adId).run();
    return adminAdsList(env, cid, mid, "stopped", 0);
  }
  if (d.startsWith("admin_adetail_")) {
    if (!canAccess(u, uid, "ads_pending")) return;
    return adminAdDetail(env, cid, mid, parseInt(d.replace("admin_adetail_", "")));
  }
  if (d.startsWith("admin_adblock_")) {
    if (!canAccess(u, uid, "block")) return;
    const tid = d.replace("admin_adblock_", "");
    await DB(env).prepare("UPDATE users SET ad_blocked = 1 WHERE telegram_id = ?").bind(tid).run();
    await DB(env).prepare("UPDATE campaigns SET status = 'stopped' WHERE owner_id = ? AND status = 'active'").bind(tid).run();
    return adminUserAction(env, cid, mid, tid);
  }
  if (d.startsWith("admin_adunblock_")) {
    if (!canAccess(u, uid, "block")) return;
    const tid = d.replace("admin_adunblock_", "");
    await DB(env).prepare("UPDATE users SET ad_blocked = 0 WHERE telegram_id = ?").bind(tid).run();
    return adminUserAction(env, cid, mid, tid);
  }
  if (d.startsWith("admin_block_")) {
    if (!canAccess(u, uid, "block")) return;
    const tid = d.replace("admin_block_", "");
    await DB(env).prepare("UPDATE users SET is_blocked = 1 WHERE telegram_id = ?").bind(tid).run();
    return adminUserAction(env, cid, mid, tid);
  }
  if (d.startsWith("admin_unblock_")) {
    if (!canAccess(u, uid, "block")) return;
    const tid = d.replace("admin_unblock_", "");
    await DB(env).prepare("UPDATE users SET is_blocked = 0 WHERE telegram_id = ?").bind(tid).run();
    return adminUserAction(env, cid, mid, tid);
  }
  if (d.startsWith("admin_setbal_")) {
    if (!canAccess(u, uid, "setbal")) return;
    const tid = d.replace("admin_setbal_", "");
    await setState(env, uid, `admin_setbal_${tid}`, {});
    return edit(env, cid, mid, "💰 موجودی جدید:", [[{ text: "❌ انصراف", callback_data: `admin_user_${tid}` }]]);
  }
  if (d.startsWith("admin_setrole_")) {
    if (!canAccess(u, uid, "set_role")) return;
    return adminSetRole(env, cid, mid, d.replace("admin_setrole_", ""));
  }
  if (d.startsWith("perm_toggle_")) {
    if (!canAccess(u, uid, "set_role")) return;
    const parts = d.replace("perm_toggle_", "").split("_");
    const perm = parts[0], tid = parts.slice(1).join("_");
    const t = await getUser(env, tid);
    if (!t) return;
    let perms = getPerms(t, tid);
    perms = perms.includes(perm) ? perms.filter(p => p !== perm) : [...perms, perm];
    const permStr = perms.length > 0 ? perms.join(",") : null;
    await DB(env).prepare("UPDATE users SET admin_role = ?, is_admin = ? WHERE telegram_id = ?").bind(permStr, perms.length > 0 ? 1 : 0, tid).run();
    await alert(env, cb.id, perms.includes(perm) ? "✅ اضافه شد!" : "❌ حذف شد!", false);
    return adminSetRole(env, cid, mid, tid);
  }
  if (d.startsWith("perm_all_")) {
    if (!canAccess(u, uid, "set_role")) return;
    const tid = d.replace("perm_all_", "");
    await DB(env).prepare("UPDATE users SET admin_role = ?, is_admin = 1 WHERE telegram_id = ?").bind(ALL_PERMS.map(p => p.key).join(","), tid).run();
    await alert(env, cb.id, "✅ همه دسترسی‌ها!", false);
    return adminSetRole(env, cid, mid, tid);
  }
  if (d.startsWith("perm_clear_")) {
    if (!canAccess(u, uid, "set_role")) return;
    const tid = d.replace("perm_clear_", "");
    await DB(env).prepare("UPDATE users SET admin_role = NULL, is_admin = 0 WHERE telegram_id = ?").bind(tid).run();
    await alert(env, cb.id, "✅ حذف شد!", false);
    return adminSetRole(env, cid, mid, tid);
  }
  if (d.startsWith("admin_approve_")) {
    if (!canAccess(u, uid, "ads_pending")) return;
    const adId = parseInt(d.replace("admin_approve_", ""));
    const adminUser = await getUser(env, uid);
    const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ?").bind(adId).first();
    const adminTaxShare = await getSetting(env, "admin_tax_share", 30);
    if (ad && adminTaxShare > 0) {
      const taxAmount = Math.ceil((ad.total_budget || 0) * ((ad.tax_percent || 5) / 100));
      const adminCut = Math.ceil(taxAmount * (adminTaxShare / 100));
      if (adminCut > 0) {
        await DB(env).prepare("UPDATE users SET balance = balance + ? WHERE telegram_id = ?").bind(adminCut, uid).run();
        await addTx(env, uid, "admin_tax_share", adminCut, "سهم مالیات تایید تبلیغ: " + (ad.title || ad.channel_username), "taxshare_" + adId + "_" + uid + "_" + Date.now());
      }
    }
    await DB(env).prepare("UPDATE campaigns SET status = 'active', last_hour_check = CURRENT_TIMESTAMP, approved_by = ?, rejected_by = NULL WHERE id = ?").bind((adminUser?.first_name || adminUser?.username || uid), adId).run();
    await alert(env, cb.id, "✅ تایید شد!" + (adminCut > 0 ? " (+" + adminCut + " سکه سهم مالیات)" : ""), false);
    return adminAdsPending(env, cid, mid, 0);
  }
  if (d.startsWith("admin_reject_")) {
    if (!canAccess(u, uid, "ads_pending")) return;
    const adId = parseInt(d.replace("admin_reject_", ""));
    const ad = await DB(env).prepare("SELECT * FROM campaigns WHERE id = ?").bind(adId).first();
    const adminUser = await getUser(env, uid);
    if (ad) {
      await DB(env).prepare("UPDATE campaigns SET rejected_by = ?, rejected_reason = ? WHERE id = ?").bind((adminUser?.first_name || adminUser?.username || uid), "نقض قوانین", adId).run();
      const taxP = ad.tax_percent || 5, tax = Math.ceil(ad.total_budget * (taxP / 100));
      const total = ad.total_budget + tax, ownerId = ad.owner_id?.toString();
      await DB(env).prepare("UPDATE users SET balance = balance + ? WHERE telegram_id = ?").bind(total, ownerId).run();
      await addTx(env, ownerId, "ad_refund", total, `بازگشت - رد: ${ad.title || ad.channel_username}`, `refund_${adId}_${Date.now()}`);
      await DB(env).prepare("UPDATE campaigns SET status = 'rejected' WHERE id = ?").bind(adId).run();
    }
    await alert(env, cb.id, "❌ رد شد و وجه بازگشت!", false);
    return adminAdsPending(env, cid, mid, 0);
  }
  if (d.startsWith("admin_tx_")) {
    if (!canAccess(u, uid, "tx_all")) return;
    return adminTransactions(env, cid, mid, parseInt(d.replace("admin_tx_", "")) || 0);
  }
  if (d.startsWith("admin_tax_log_")) {
    if (!canAccess(u, uid, "financial")) return;
    return adminTaxLog(env, cid, mid, parseInt(d.replace("admin_tax_log_", "")) || 0);
  }
  if (d === "admin_ap_0" || d.startsWith("admin_ap_")) {
    if (!canAccess(u, uid, "ads_pending")) return;
    return adminAdsPending(env, cid, mid, parseInt(d.replace("admin_ap_", "")) || 0);
  }
  if (d === "admin_stats") { if (canAccess(u, uid, "stats")) return adminStats(env, cid, mid); return; }
  if (d === "admin_broadcast") {
    if (!canAccess(u, uid, "broadcast")) return;
    await setState(env, uid, "admin_broadcast", null);
    return edit(env, cid, mid, "📢 پیام خود را ارسال کنید:", [[{ text: "❌ انصراف", callback_data: "admin" }]]);
  }
  if (d === "admin_ads_pending") { if (canAccess(u, uid, "ads_pending")) return adminAdsPending(env, cid, mid, 0); return; }
  if (d === "admin_search") { if (canAccess(u, uid, "search")) return adminSearch(env, cid, mid, uid); return; }
  if (d === "admin_addrole") {
    if (!canAccess(u, uid, "set_role")) return;
    await setState(env, uid, "admin_addrole", {});
    return edit(env, cid, mid, "➕ افزودن نقش\n\nآیدی عددی کاربر:", [[{ text: "❌ انصراف", callback_data: "admin_roles_0" }]]);
  }
  if (d === "admin_roles_0" || d.startsWith("admin_roles_")) {
    if (!canAccess(u, uid, "set_role")) return;
    return adminRoles(env, cid, mid, parseInt(d.replace("admin_roles_", "")) || 0);
  }
  if (d === "admin_financial") { if (canAccess(u, uid, "financial")) return adminFinancial(env, cid, mid); return; }
  const finSettings = {
    admin_set_cost: { key: "ad_cost_per_join", label: "قیمت", isPct: false },
    admin_set_tax: { key: "ad_tax_percent", label: "مالیات", isPct: true },
    admin_set_ref: { key: "referral_percent", label: "سهم رفرال", isPct: true },
    admin_set_share: { key: "referral_share_text", label: "متن اشتراک", isPct: false, isText: true },
    admin_set_hourly: { key: "default_hourly_cost", label: "هزینه ساعتی", isPct: false },
    admin_set_activityreward: { key: "activity_reward", label: "پاداش فعالیت", isPct: false },
    admin_set_adminsalary: { key: "admin_salary", label: "حقوق ادمین", isPct: false },
    admin_set_taxshare: { key: "admin_tax_share", label: "سهم مالیات ادمین", isPct: true },
  };
  for (const [action, cfg] of Object.entries(finSettings)) {
    if (d === action) {
      if (!canAccess(u, uid, "financial")) return;
      await setState(env, uid, action, {});
      const cur = await getSetting(env, cfg.key, cfg.isPct ? (cfg.key === "referral_percent" ? 20 : 5) : 10);
      const prompt = cfg.isText ? `📝 متن اشتراک\n\nفعلی:\n${cur || "(پیش‌فرض)"}\n\nمتن جدید:\n({name}, {link})` : `${cfg.label} فعلی: ${cur}${cfg.isPct ? "%" : ""}\n\n${cfg.label} جدید:`;
      return edit(env, cid, mid, prompt, [[{ text: "❌ انصراف", callback_data: "admin_financial" }]]);
    }
  }
}

// ==================== DB Migration ====================
async function migrateDB(env) {
  try {
    const cols = await DB(env).prepare("PRAGMA table_info(users)").all();
    const colNames = cols.results.map(c => c.name);
    if (!colNames.includes("xp")) await DB(env).prepare("ALTER TABLE users ADD COLUMN xp REAL DEFAULT 0").run();
    const adCols = await DB(env).prepare("PRAGMA table_info(campaigns)").all();
    const adColNames = adCols.results.map(c => c.name);
    if (!adColNames.includes("hourly_cost")) await DB(env).prepare("ALTER TABLE campaigns ADD COLUMN hourly_cost REAL DEFAULT 0").run();
    if (!adColNames.includes("hourly_paid")) await DB(env).prepare("ALTER TABLE campaigns ADD COLUMN hourly_paid REAL DEFAULT 0").run();
    if (!adColNames.includes("last_hour_check")) await DB(env).prepare("ALTER TABLE campaigns ADD COLUMN last_hour_check TEXT").run();
    if (!adColNames.includes("approved_by")) await DB(env).prepare("ALTER TABLE campaigns ADD COLUMN approved_by TEXT").run();
    if (!adColNames.includes("rejected_by")) await DB(env).prepare("ALTER TABLE campaigns ADD COLUMN rejected_by TEXT").run();
    if (!adColNames.includes("rejected_reason")) await DB(env).prepare("ALTER TABLE campaigns ADD COLUMN rejected_reason TEXT").run();
    if (!colNames.includes("ad_blocked")) await DB(env).prepare("ALTER TABLE users ADD COLUMN ad_blocked INTEGER DEFAULT 0").run();
    if (!colNames.includes("last_active")) await DB(env).prepare("ALTER TABLE users ADD COLUMN last_active TEXT").run();
    if (!colNames.includes("total_active_seconds")) await DB(env).prepare("ALTER TABLE users ADD COLUMN total_active_seconds INTEGER DEFAULT 0").run();
    if (!colNames.includes("inbox_muted")) await DB(env).prepare("ALTER TABLE users ADD COLUMN inbox_muted INTEGER DEFAULT 0").run();
    if (!colNames.includes("lang")) await DB(env).prepare("ALTER TABLE users ADD COLUMN lang TEXT DEFAULT 'fa'").run();
    if (!colNames.includes("privacy_show_owner")) await DB(env).prepare("ALTER TABLE users ADD COLUMN privacy_show_owner INTEGER DEFAULT 1").run();
    if (!colNames.includes("last_hourly_reward")) await DB(env).prepare("ALTER TABLE users ADD COLUMN last_hourly_reward TEXT").run();
    await DB(env).prepare("CREATE TABLE IF NOT EXISTS inbox_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id TEXT, admin_name TEXT, text TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
    await DB(env).prepare("CREATE TABLE IF NOT EXISTS inbox_likes (message_id INTEGER, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (message_id, user_id))").run();
    await DB(env).prepare("CREATE TABLE IF NOT EXISTS page_likes (page_key TEXT, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (page_key, user_id))").run();
    await DB(env).prepare("CREATE TABLE IF NOT EXISTS ad_reactions (campaign_id INTEGER, user_id TEXT, reaction TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (campaign_id, user_id))").run();
    const newRules = "📜 قوانین استفاده از ربات\n━━━━━━━━━━━━━━━━\n\n✅ تبلیغ‌گذاری:\n• ربات باید ادمین کانال شما باشد\n• محتوای تبلیغ باید مطابق قوانین تلگرام و اصول انسانی باشد\n• تبلیغ نامناسب: بار اول اخطار + رد، بار دوم مسدودیت از تبلیغ‌گذاری\n\n🔒 حریم خصوصی:\n• اطلاعات شما محفوظ است و فقط در موارد قانونی/دولتی یا شرایط اضطراری منتقل می‌شود\n• عضویت در گروه/کانال‌ها و محتوای آن‌ها به ما ربطی ندارد\n\n⚠️ رفتار کاربران:\n• لفت دادن = کسر خودکار پاداش\n• تبلیغ نامناسب؟ 👎 بزنید تا ادمین‌ها مطلع شوند یا ⏭️ رد شوید\n\n📌 استفاده از ربات = پذیرش تمام قوانین\nما زیر نظر قوانین تلگرام فعالیت می‌کنیم:\ntelegram.org/privacy-tpa\n\n💰 مالیات: 5% | سهم معرف: 20%"
    const existingRules = await DB(env).prepare("SELECT id, content FROM rules WHERE is_active = 1 ORDER BY version DESC LIMIT 1").first();
    if (!existingRules || existingRules.content !== newRules) {
      await DB(env).prepare("UPDATE rules SET is_active = 0 WHERE is_active = 1").run();
      const maxVer = await DB(env).prepare("SELECT COALESCE(MAX(version), 0) as v FROM rules").first();
      await DB(env).prepare("INSERT INTO rules (content, version, is_active) VALUES (?, ?, 1)").bind(newRules, (maxVer?.v || 0) + 1).run();
    }
  } catch (e) { console.error("migrate:", e); }
}

// ==================== Main ====================
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/migrate") {
      await migrateDB(env);
      return new Response(JSON.stringify({ ok: true, message: "Migration complete" }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/") return new Response(JSON.stringify({ ok: true }));
    if (url.pathname === "/set-webhook") {
      const r = await tg(env.TELEGRAM_TOKEN, "setWebhook", { url: `https://${url.hostname}/webhook` });
      return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/webhook" && req.method === "POST") {
      try {
        await migrateDB(env);
        const upd = await req.json();
        if (upd.message) await handleMessage(env, upd);
        else if (upd.callback_query) await handleCallback(env, upd);
      } catch (e) { console.error("webhook:", e); }
      return new Response("OK");
    }
    if (url.pathname === "/check-left") {
      const result = await checkLeftMembers(env);
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("Not Found", { status: 404 });
  },
  async scheduled(event, env) {
    await migrateDB(env);
    await checkLeftMembers(env);
  },
};