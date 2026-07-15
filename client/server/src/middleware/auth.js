const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'word-royale-dev-secret-change-me';

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      is_admin: !!user.is_admin,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    const { get } = require('../db/database').getDb();
    const row = get('SELECT id, is_admin FROM users WHERE id = ?', [req.user.id]);
    if (!row || !row.is_admin) {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    req.user.is_admin = true;
    next();
  });
}

module.exports = { signToken, authRequired, adminRequired, JWT_SECRET };
