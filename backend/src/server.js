import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import jwt from 'jsonwebtoken';
import { compareSync, hashSync } from 'bcryptjs';
import db, { initDb } from './db.js';

const app = express();
const PORT = 4000;
const JWT_SECRET = 'wind-fund-secret';

initDb();
app.use(cors());
app.use(express.json());

function tokenFor(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'unauthorized' });
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'forbidden' });
  next();
}

function addFlow(userId, amount, type, description, deviceId = null) {
  db.prepare('INSERT INTO income_records(user_id,device_id,amount,type,description) VALUES(?,?,?,?,?)')
    .run(userId, deviceId, amount, type, description);
}

function applyInviteReward(baseUserId, incomeAmount, sourceDeviceId) {
  const rates = JSON.parse(db.prepare('SELECT value FROM system_configs WHERE key=?').get('invite_rates').value);
  let current = db.prepare('SELECT inviter_id FROM users WHERE id=?').get(baseUserId)?.inviter_id;
  rates.forEach((rate, idx) => {
    if (!current) return;
    const bonus = +(incomeAmount * rate).toFixed(2);
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(bonus, current);
    addFlow(current, bonus, 'invite_bonus', `第${idx + 1}级邀请收益`, sourceDeviceId);
    current = db.prepare('SELECT inviter_id FROM users WHERE id=?').get(current)?.inviter_id;
  });
}

app.post('/api/auth/register', (req, res) => {
  const { username, password, confirmPassword, inviteCode } = req.body;
  if (!username || !password || !confirmPassword || !inviteCode) return res.status(400).json({ message: 'missing fields' });
  if (password !== confirmPassword) return res.status(400).json({ message: 'password mismatch' });
  const inviter = db.prepare('SELECT id FROM users WHERE invite_code=?').get(inviteCode);
  if (!inviter) return res.status(400).json({ message: 'invalid invite code' });
  const myCode = `W${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  try {
    const result = db.prepare('INSERT INTO users(username,password_hash,invite_code,inviter_id,balance) VALUES(?,?,?,?,?)')
      .run(username, hashSync(password, 10), myCode, inviter.id, 1000);
    db.prepare('INSERT INTO invitation_relations(inviter_id,invitee_id,level) VALUES(?,?,1)').run(inviter.id, result.lastInsertRowid);
    res.json({ message: 'ok' });
  } catch {
    res.status(400).json({ message: 'username exists' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !compareSync(password, user.password_hash)) return res.status(401).json({ message: 'invalid credentials' });
  if (user.status === 'banned') return res.status(403).json({ message: 'account banned' });
  res.json({ token: tokenFor(user), role: user.role });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT id,username,invite_code,balance,role,created_at FROM users WHERE id=?').get(req.user.id);
  const details = db.prepare('SELECT * FROM income_records WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.user.id);
  const risk = db.prepare('SELECT value FROM system_configs WHERE key=?').get('risk_notice')?.value || '';
  res.json({ user, details, risk });
});

app.post('/api/me/password', auth, (req, res) => {
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashSync(req.body.password, 10), req.user.id);
  res.json({ message: 'updated' });
});

app.get('/api/products', auth, (req, res) => {
  const list = db.prepare('SELECT * FROM products WHERE visible=1 ORDER BY id').all();
  res.json(list);
});

app.post('/api/products/:id/buy', auth, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!product || !user) return res.status(404).json({ message: 'not found' });
  if (user.balance < product.price) return res.status(400).json({ message: '余额不足' });
  const t = db.transaction(() => {
    db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(product.price, user.id);
    const d = db.prepare('INSERT INTO devices(user_id,product_id,purchase_price,daily_income,total_income) VALUES(?,?,?,?,?)')
      .run(user.id, product.id, product.price, product.daily_income * product.income_ratio, product.total_income * product.income_ratio);
    addFlow(user.id, -product.price, 'purchase', `购买${product.name}`, d.lastInsertRowid);
  });
  t();
  res.json({ message: '购买成功' });
});

app.get('/api/devices', auth, (req, res) => {
  const devices = db.prepare(`SELECT d.*,p.name,p.image FROM devices d JOIN products p ON d.product_id=p.id WHERE d.user_id=? ORDER BY d.id DESC`).all(req.user.id);
  res.json(devices.map(d => ({ ...d, remaining: +(d.total_income - d.earned_income).toFixed(2), progress: Math.min(100, +(d.earned_income / d.total_income * 100).toFixed(2)) })));
});

app.get('/api/invitations', auth, (req, res) => {
  const me = db.prepare('SELECT invite_code FROM users WHERE id=?').get(req.user.id);
  const team = db.prepare('SELECT username,created_at FROM users WHERE inviter_id=?').all(req.user.id);
  const inviteIncome = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM income_records WHERE user_id=? AND type='invite_bonus'").get(req.user.id).s;
  res.json({ inviteCode: me.invite_code, total: team.length, team, inviteIncome });
});

app.post('/api/recharge', auth, (req, res) => {
  db.prepare('INSERT INTO recharges(user_id,amount,content_snapshot) VALUES(?,?,?)').run(req.user.id, req.body.amount, JSON.stringify(req.body.content || {}));
  res.json({ message: 'submitted' });
});
app.post('/api/withdraw', auth, (req, res) => {
  const amount = +req.body.amount;
  const user = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);
  if (user.balance < amount) return res.status(400).json({ message: 'insufficient' });
  db.prepare('INSERT INTO withdrawals(user_id,amount) VALUES(?,?)').run(req.user.id, amount);
  res.json({ message: 'submitted' });
});

app.get('/api/stats', auth, (req, res) => {
  const points = Array.from({ length: 7 }).map((_, i) => ({
    day: `${i + 1}D`,
    power: 12000 + i * 1600 + Math.round(Math.random() * 800),
    profit: 2000 + i * 250 + Math.round(Math.random() * 200)
  }));
  res.json({ points });
});

// admin
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%';
  const users = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM recharges r WHERE r.user_id=u.id) recharge_count,
  (SELECT COUNT(*) FROM withdrawals w WHERE w.user_id=u.id) withdraw_count FROM users u WHERE username LIKE ? ORDER BY id DESC`).all(q);
  res.json(users);
});
app.patch('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const { balance, status, remark } = req.body;
  if (balance !== undefined) db.prepare('UPDATE users SET balance=? WHERE id=?').run(balance, req.params.id);
  if (status) db.prepare('UPDATE users SET status=? WHERE id=?').run(status, req.params.id);
  if (remark !== undefined) db.prepare('UPDATE users SET remark=? WHERE id=?').run(remark, req.params.id);
  res.json({ message: 'ok' });
});
app.get('/api/admin/invite-tree/:id', auth, adminOnly, (req, res) => {
  const direct = db.prepare('SELECT id,username,created_at FROM users WHERE inviter_id=?').all(req.params.id);
  res.json(direct);
});
app.patch('/api/admin/device/:id', auth, adminOnly, (req, res) => {
  const { status, income_ratio, frozen } = req.body;
  if (status) db.prepare('UPDATE devices SET status=? WHERE id=?').run(status, req.params.id);
  if (frozen !== undefined) db.prepare('UPDATE devices SET frozen=? WHERE id=?').run(frozen ? 1 : 0, req.params.id);
  if (income_ratio) db.prepare('UPDATE devices SET daily_income=daily_income*?, total_income=total_income*? WHERE id=?').run(income_ratio, income_ratio, req.params.id);
  res.json({ message: 'ok' });
});
app.get('/api/admin/recharges', auth, adminOnly, (req, res) => res.json(db.prepare('SELECT r.*,u.username FROM recharges r JOIN users u ON r.user_id=u.id ORDER BY r.id DESC').all()));
app.patch('/api/admin/recharges/:id', auth, adminOnly, (req, res) => {
  const item = db.prepare('SELECT * FROM recharges WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ message: 'missing' });
  db.prepare('UPDATE recharges SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status, req.params.id);
  if (req.body.status === 'approved') {
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(item.amount, item.user_id);
    addFlow(item.user_id, item.amount, 'recharge', '充值到账');
  }
  res.json({ message: 'ok' });
});
app.patch('/api/admin/recharge-content', auth, adminOnly, (req, res) => {
  db.prepare('INSERT OR REPLACE INTO system_configs(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)').run('recharge_content', JSON.stringify(req.body));
  res.json({ message: 'ok' });
});
app.get('/api/admin/withdrawals', auth, adminOnly, (req, res) => res.json(db.prepare('SELECT w.*,u.username FROM withdrawals w JOIN users u ON w.user_id=u.id ORDER BY w.id DESC').all()));
app.patch('/api/admin/withdrawals/:id', auth, adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id);
  db.prepare('UPDATE withdrawals SET status=?,reviewed_at=CURRENT_TIMESTAMP,paid_at=CASE WHEN ?="paid" THEN CURRENT_TIMESTAMP ELSE paid_at END WHERE id=?').run(req.body.status, req.body.status, req.params.id);
  if (req.body.status === 'approved' || req.body.status === 'paid') {
    db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(row.amount, row.user_id);
    addFlow(row.user_id, -row.amount, 'withdraw', '提款扣减');
  }
  res.json({ message: 'ok' });
});
app.get('/api/admin/products', auth, adminOnly, (req, res) => res.json(db.prepare('SELECT * FROM products ORDER BY id').all()));
app.post('/api/admin/products', auth, adminOnly, (req, res) => {
  const p = req.body;
  db.prepare('INSERT INTO products(name,description,image,price,daily_income,total_income,income_ratio,visible,content_json) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(p.name, p.description, p.image, p.price, p.daily_income, p.total_income, p.income_ratio || 1, p.visible ? 1 : 0, JSON.stringify(p.content || {}));
  res.json({ message: 'ok' });
});
app.patch('/api/admin/products/:id', auth, adminOnly, (req, res) => {
  const p = req.body;
  db.prepare('UPDATE products SET name=?,description=?,image=?,price=?,daily_income=?,total_income=?,income_ratio=?,visible=?,content_json=? WHERE id=?')
    .run(p.name, p.description, p.image, p.price, p.daily_income, p.total_income, p.income_ratio || 1, p.visible ? 1 : 0, JSON.stringify(p.content || {}), req.params.id);
  res.json({ message: 'ok' });
});
app.delete('/api/admin/products/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ message: 'ok' });
});
app.get('/api/admin/devices', auth, adminOnly, (req, res) => res.json(db.prepare('SELECT d.*,u.username,p.name FROM devices d JOIN users u ON d.user_id=u.id JOIN products p ON d.product_id=p.id ORDER BY d.id DESC').all()));
app.get('/api/admin/config', auth, adminOnly, (req, res) => {
  const all = db.prepare('SELECT * FROM system_configs').all();
  res.json(Object.fromEntries(all.map(i => [i.key, i.value])));
});

cron.schedule('* * * * *', () => {
  const devices = db.prepare('SELECT * FROM devices WHERE status="running" AND frozen=0').all();
  const tx = db.transaction(() => {
    for (const d of devices) {
      const remain = d.total_income - d.earned_income;
      if (remain <= 0) {
        db.prepare('UPDATE devices SET status="completed" WHERE id=?').run(d.id);
        continue;
      }
      const gain = Math.min(d.daily_income / 1440, remain); // 每分钟模拟每日收益
      db.prepare('UPDATE devices SET earned_income=earned_income+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(gain, d.id);
      db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(gain, d.user_id);
      addFlow(d.user_id, gain, 'device_income', '风机发电收益', d.id);
      applyInviteReward(d.user_id, gain, d.id);
      if (remain - gain <= 0) db.prepare('UPDATE devices SET status="completed" WHERE id=?').run(d.id);
    }
  });
  tx();
});

app.listen(PORT, () => console.log(`backend on ${PORT}`));
