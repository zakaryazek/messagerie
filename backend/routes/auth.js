const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');
const { registerSchema, loginSchema, validate } = require('../validation');

const BCRYPT_ROUNDS = 12;
// Hash factice : quand le pseudo n'existe pas, on compare quand même, pour que le temps de
// réponse ne révèle pas si un compte existe
const DUMMY_HASH = bcrypt.hashSync('mot-de-passe-factice', BCRYPT_ROUNDS);

// REGISTER
router.post('/register', registerLimiter, async (req, res) => {
  const v = validate(registerSchema, req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const { pseudo, email, password } = v.data;

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      'INSERT INTO users (pseudo, email, password_hash) VALUES ($1, $2, $3) RETURNING id, pseudo, email',
      [pseudo, email.toLowerCase(), hash]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      if (err.detail?.includes('pseudo')) return res.status(409).json({ error: 'Pseudo déjà utilisé' });
      if (err.detail?.includes('email')) return res.status(409).json({ error: 'Email déjà utilisé' });
    }
    console.error('Erreur register:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// LOGIN
router.post('/login', loginLimiter, async (req, res) => {
  const v = validate(loginSchema, req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const { pseudo, password } = v.data;

  try {
    const result = await pool.query('SELECT * FROM users WHERE pseudo = $1', [pseudo]);
    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    // Message unique : on ne dit pas si c'est le pseudo ou le mot de passe qui est faux
    if (!user || !valid) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, pseudo: user.pseudo, email: user.email, id: user.id });
  } catch (err) {
    console.error('Erreur login:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;