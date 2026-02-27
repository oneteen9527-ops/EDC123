import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const api = axios.create({ baseURL: 'http://localhost:4000/api' });
api.interceptors.request.use(c => {
  const t = localStorage.getItem('token');
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

function AuthPage({ type = 'login' }) {
  const nav = useNavigate();
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '', inviteCode: '' });
  const submit = async () => {
    if (type === 'register') await api.post('/auth/register', form);
    else {
      const { data } = await api.post('/auth/login', form);
      localStorage.setItem('token', data.token); localStorage.setItem('role', data.role);
      nav(data.role === 'admin' ? '/admin' : '/');
      return;
    }
    nav('/login');
  };
  return <div className='auth bg'>
    <h1>🌬️ Wind Fund</h1><p>新能源 + 金融科技</p>
    <input placeholder='用户名' onChange={e => setForm({ ...form, username: e.target.value })} />
    <input placeholder='密码' type='password' onChange={e => setForm({ ...form, password: e.target.value })} />
    {type === 'register' && <>
      <input placeholder='确认密码' type='password' onChange={e => setForm({ ...form, confirmPassword: e.target.value })} />
      <input placeholder='邀请码(必填)' onChange={e => setForm({ ...form, inviteCode: e.target.value })} />
    </>}
    <button onClick={submit}>{type === 'register' ? '注册' : '登录'}</button>
    <Link to={type === 'register' ? '/login' : '/register'}>{type === 'register' ? '返回登录' : '注册入口'}</Link>
  </div>;
}

function UserApp() {
  const [tab, setTab] = useState('home');
  const [me, setMe] = useState();
  const [products, setProducts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [inv, setInv] = useState({ team: [] });
  const [stats, setStats] = useState({ points: [] });
  const { t, i18n } = useTranslation();

  const load = async () => {
    setMe((await api.get('/me')).data);
    setProducts((await api.get('/products')).data);
    setDevices((await api.get('/devices')).data);
    setInv((await api.get('/invitations')).data);
    setStats((await api.get('/stats')).data);
  };
  useEffect(() => { load(); }, []);

  const home = <div>
    <section className='hero card'><h2>{t('welcome')}</h2><p>⚡ 发电数据动态增长 · 高端可信平台</p>
      <ResponsiveContainer width='100%' height={220}><AreaChart data={stats.points}><defs><linearGradient id='g'><stop offset='5%' stopColor='#f0c66e'/><stop offset='95%' stopColor='#102d70'/></linearGradient></defs><CartesianGrid strokeDasharray='3 3' /><XAxis dataKey='day' /><YAxis /><Tooltip /><Area dataKey='power' stroke='#f0c66e' fill='url(#g)' /></AreaChart></ResponsiveContainer>
    </section>
    <div className='grid'>{products.map(p => <div className='card product' key={p.id}><div className='fan'>🌀</div><h3>{p.name}</h3><p>{p.description}</p><p>售价: {p.price}</p><p>每日收益: {p.daily_income}</p><p>总收益: {p.total_income}</p><button onClick={async () => { try { await api.post(`/products/${p.id}/buy`); await load(); alert('购买成功'); } catch (e) { alert(e.response?.data?.message || '失败'); } }}>购买</button></div>)}</div>
    <div className='card'><h3>公司介绍</h3><p>我们聚焦全球风电资产数字化，构建可信任的新能源投资平台。</p></div>
    <div className='card danger'>{me?.risk}</div>
  </div>;

  const deviceView = <div className='grid'>{devices.map(d => <div className='card' key={d.id}><h3>{d.name}</h3><p>日收益 {d.daily_income}</p><p>累计 {d.earned_income.toFixed(2)}</p><p>剩余 {d.remaining.toFixed(2)}</p><p>状态 {d.status === 'running' ? '运行中' : '已完成'}</p><progress max='100' value={d.progress}></progress></div>)}</div>;
  const inviteView = <div className='card'><h3>邀请码: {inv.inviteCode}</h3><p>总邀请人数: {inv.total}</p><p>邀请收益: {inv.inviteIncome}</p><ul>{inv.team.map(x => <li key={x.username}>{x.username} - {x.created_at}</li>)}</ul></div>;
  const meView = <div className='card'><h3>账号: {me?.user?.username}</h3><p>邀请码: {me?.user?.invite_code}</p><p>余额: {me?.user?.balance?.toFixed(2)}</p>
    <button onClick={async () => { const amount = prompt('充值金额'); if (amount) await api.post('/recharge', { amount: +amount }); alert('已提交'); }}>充值入口</button>
    <button onClick={async () => { const amount = prompt('提款金额'); if (amount) await api.post('/withdraw', { amount: +amount }); alert('已提交'); }}>提款入口</button>
    <button onClick={async () => { const p = prompt('新密码'); if (p) await api.post('/me/password', { password: p }); alert('已修改'); }}>修改密码</button>
    <button onClick={() => { localStorage.clear(); location.href = '/login'; }}>退出登录</button>
    <h4>余额明细</h4><ul>{me?.details?.map(d => <li key={d.id}>{d.type} {d.amount.toFixed(2)} {d.created_at}</li>)}</ul>
    <button onClick={() => i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh')}>中/EN</button>
  </div>;

  const map = { home, device: deviceView, invite: inviteView, me: meView };
  return <div className='bg app'><header><h2>风电投资中心</h2><div>💰 {me?.user?.balance?.toFixed(2)}</div></header><main>{map[tab]}</main><footer>{['home', 'device', 'invite', 'me'].map(k => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{k === 'home' ? '首页' : k === 'device' ? '设备' : k === 'invite' ? '邀请' : '我的'}</button>)}</footer></div>;
}

function AdminApp() {
  const [users, setUsers] = useState([]), [products, setProducts] = useState([]), [devices, setDevices] = useState([]), [recharges, setRecharges] = useState([]), [withdrawals, setWithdrawals] = useState([]);
  const [tab, setTab] = useState('users');
  const load = async () => {
    setUsers((await api.get('/admin/users')).data); setProducts((await api.get('/admin/products')).data); setDevices((await api.get('/admin/devices')).data); setRecharges((await api.get('/admin/recharges')).data); setWithdrawals((await api.get('/admin/withdrawals')).data);
  }; useEffect(() => { load(); }, []);
  const views = {
    users: <div className='card'><h3>会员管理</h3>{users.map(u => <div key={u.id} className='row'>{u.username} 余额{u.balance} 状态{u.status} <button onClick={async () => { const b = prompt('修改余额', u.balance); if (b) await api.patch('/admin/users/' + u.id, { balance: +b }); load(); }}>修改余额</button><button onClick={async () => { await api.patch('/admin/users/' + u.id, { status: u.status === 'active' ? 'banned' : 'active' }); load(); }}>封禁/解封</button></div>)}</div>,
    recharge: <div className='card'><h3>充值管理</h3>{recharges.map(r => <div className='row' key={r.id}>{r.username} {r.amount} {r.status}<button onClick={async () => { await api.patch('/admin/recharges/' + r.id, { status: 'approved' }); load(); }}>通过</button><button onClick={async () => { await api.patch('/admin/recharges/' + r.id, { status: 'rejected' }); load(); }}>拒绝</button></div>)}</div>,
    withdraw: <div className='card'><h3>提款管理</h3>{withdrawals.map(w => <div className='row' key={w.id}>{w.username} {w.amount} {w.status}<button onClick={async () => { await api.patch('/admin/withdrawals/' + w.id, { status: 'approved' }); load(); }}>审核通过</button><button onClick={async () => { await api.patch('/admin/withdrawals/' + w.id, { status: 'paid' }); load(); }}>打款通过</button><button onClick={async () => { await api.patch('/admin/withdrawals/' + w.id, { status: 'rejected' }); load(); }}>拒绝</button></div>)}</div>,
    device: <div className='card'><h3>设备租用管理</h3>{devices.map(d => <div className='row' key={d.id}>{d.username}-{d.name}-{d.status}<button onClick={async () => { await api.patch('/admin/device/' + d.id, { status: 'terminated' }); load(); }}>终止</button><button onClick={async () => { await api.patch('/admin/device/' + d.id, { frozen: d.frozen ? 0 : 1 }); load(); }}>冻结</button></div>)}</div>,
    product: <div className='card'><h3>产品配置管理</h3><button onClick={async () => { await api.post('/admin/products', { name: '新产品', description: '说明', image: '', price: 100, daily_income: 5, total_income: 1000, visible: 1 }); load(); }}>新增产品</button>{products.map(p => <div className='row' key={p.id}>{p.name} ￥{p.price} <button onClick={async () => { const price = prompt('新价格', p.price); if (price) await api.patch('/admin/products/' + p.id, { ...p, price: +price }); load(); }}>编辑</button><button onClick={async () => { await api.delete('/admin/products/' + p.id); load(); }}>删除</button></div>)}</div>
  };
  return <div className='bg app'><header><h2>管理后台</h2><button onClick={() => { localStorage.clear(); location.href = '/login'; }}>退出</button></header><main>{views[tab]}</main><footer>{Object.keys(views).map(k => <button key={k} onClick={() => setTab(k)}>{k}</button>)}</footer></div>;
}

function Protected({ children, admin = false }) {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  if (!token) return <Navigate to='/login' />;
  if (admin && role !== 'admin') return <Navigate to='/' />;
  return children;
}

export default function App() {
  return <Routes>
    <Route path='/login' element={<AuthPage type='login' />} />
    <Route path='/register' element={<AuthPage type='register' />} />
    <Route path='/admin' element={<Protected admin><AdminApp /></Protected>} />
    <Route path='/' element={<Protected><UserApp /></Protected>} />
  </Routes>;
}
