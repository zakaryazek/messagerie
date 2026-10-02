const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    // Algorithme imposé : on refuse tout token signé autrement que HS256
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
};