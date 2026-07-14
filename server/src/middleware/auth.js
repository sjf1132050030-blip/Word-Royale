const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'word-royale-dev-secret-change-me';

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, nickname: user.nickname },
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

module.exports = { signToken, authRequired, JWT_SECRET };
