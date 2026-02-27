import Database from 'better-sqlite3';
import { hashSync } from 'bcryptjs';

const db = new Database('windfund.db');
db.pragma('journal_mode = WAL');

export function initDb() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    inviter_id INTEGER,
    balance REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    remark TEXT DEFAULT '',
    role TEXT DEFAULT 'user',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(inviter_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    image TEXT,
    price REAL NOT NULL,
    daily_income REAL NOT NULL,
    total_income REAL NOT NULL,
    income_ratio REAL DEFAULT 1,
    visible INTEGER DEFAULT 1,
    content_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    purchase_price REAL NOT NULL,
    daily_income REAL NOT NULL,
    total_income REAL NOT NULL,
    earned_income REAL DEFAULT 0,
    status TEXT DEFAULT 'running',
    frozen INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );
  CREATE TABLE IF NOT EXISTS income_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id INTEGER,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS recharges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    content_snapshot TEXT DEFAULT '{}',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending_review',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    paid_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS invitation_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id INTEGER NOT NULL,
    invitee_id INTEGER NOT NULL,
    level INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS admin_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    permissions TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_user_roles (
    user_id INTEGER,
    role_id INTEGER,
    PRIMARY KEY(user_id, role_id)
  );
  `);

  const productCount = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  if (productCount === 0) {
    const seed = db.prepare(`INSERT INTO products(name,description,image,price,daily_income,total_income,income_ratio,visible) VALUES(?,?,?,?,?,?,?,1)`);
    seed.run('体验型风机', '0成本体验机', '/wind1.png', 0, 100, 100, 1);
    seed.run('基础型风机', '稳定收益设备', '/wind2.png', 2000, 50, 20000, 1);
    seed.run('增强型风机', '中高收益设备', '/wind3.png', 6000, 160, 60000, 1);
    seed.run('旗舰型风机', '高端旗舰设备', '/wind4.png', 20000, 700, 200000, 1);
  }

  const admin = db.prepare('SELECT id FROM users WHERE username=?').get('admin');
  if (!admin) {
    const pwd = hashSync('admin123', 10);
    const res = db.prepare(`INSERT INTO users(username,password_hash,invite_code,balance,role) VALUES(?,?,?,?,?)`).run('admin', pwd, 'ADMIN888', 1000000, 'admin');
    const rid = db.prepare('INSERT INTO admin_roles(name,permissions) VALUES(?,?)').run('super-admin', JSON.stringify(['*'])).lastInsertRowid;
    db.prepare('INSERT INTO admin_user_roles(user_id, role_id) VALUES(?,?)').run(res.lastInsertRowid, rid);
  }

  if (!db.prepare('SELECT key FROM system_configs WHERE key=?').get('invite_rates')) {
    db.prepare('INSERT INTO system_configs(key,value) VALUES(?,?)').run('invite_rates', JSON.stringify([0.08, 0.03, 0.01]));
  }
  if (!db.prepare('SELECT key FROM system_configs WHERE key=?').get('risk_notice')) {
    db.prepare('INSERT INTO system_configs(key,value) VALUES(?,?)').run('risk_notice', '投资有风险，入市需谨慎。');
  }
}

export default db;
