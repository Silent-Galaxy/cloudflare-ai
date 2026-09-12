PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, rules_accepted INTEGER DEFAULT 0, balance REAL DEFAULT 0.0, referral_code TEXT, is_admin INTEGER DEFAULT 0, privacy_leaderboard INTEGER DEFAULT 1, privacy_show_name INTEGER DEFAULT 1, total_earnings REAL DEFAULT 0, user_state TEXT, state_data TEXT, is_blocked INTEGER DEFAULT 0, referred_by TEXT, admin_role TEXT, xp REAL DEFAULT 0, ad_blocked INTEGER DEFAULT 0, last_active TEXT, total_active_seconds INTEGER DEFAULT 0, inbox_muted INTEGER DEFAULT 0, lang TEXT DEFAULT 'fa', privacy_show_owner INTEGER DEFAULT 1, last_hourly_reward TEXT, warnings_count INTEGER DEFAULT 0, admin_last_action TEXT);
CREATE TABLE rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER UNIQUE NOT NULL,
    content TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    channel_username TEXT NOT NULL,
    total_budget REAL DEFAULT 0.0,
    spent REAL DEFAULT 0.0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, reward_per_join REAL, tax_percent REAL, title TEXT, description TEXT, hourly_cost REAL DEFAULT 0, hourly_paid REAL DEFAULT 0, last_hour_check TEXT, approved_by TEXT, rejected_by TEXT, rejected_reason TEXT, ad_text TEXT DEFAULT '', tier INTEGER DEFAULT 0);
CREATE TABLE referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referred_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, reward_amount REAL);
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
, description TEXT);
CREATE TABLE channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_username TEXT UNIQUE NOT NULL,
    channel_id TEXT,
    is_required INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, reference_id TEXT);
CREATE TABLE campaign_participants (campaign_id INTEGER, user_id TEXT, status TEXT DEFAULT 'pending', joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, reward_given INTEGER DEFAULT 0, PRIMARY KEY (campaign_id, user_id));
CREATE TABLE tax_log (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER, user_id TEXT, amount REAL, tax_type TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE _temp_script (id INTEGER PRIMARY KEY, chunk TEXT);
CREATE TABLE _deploy_chunks (id INTEGER PRIMARY KEY, data TEXT);
CREATE TABLE page_likes (page_key TEXT, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (page_key, user_id));
CREATE TABLE ad_reactions (campaign_id INTEGER, user_id TEXT, reaction TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (campaign_id, user_id));
CREATE TABLE inbox_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id TEXT, text TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, admin_name TEXT);
CREATE TABLE inbox_likes (message_id INTEGER, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (message_id, user_id));
CREATE TABLE tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      subject TEXT,
      message TEXT,
      priority INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      admin_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      admin_read INTEGER DEFAULT 0
    );
CREATE TABLE ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      sender_id TEXT NOT NULL,
      sender_type TEXT DEFAULT 'user',
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE user_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      admin_id TEXT,
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, chat_id INTEGER NOT NULL, text TEXT, created_at INTEGER NOT NULL);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX idx_referrals_referred ON referrals(referred_id);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_users_balance ON users(balance DESC);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaign_participants_user ON campaign_participants(user_id, status);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_chat ON messages(chat_id);
