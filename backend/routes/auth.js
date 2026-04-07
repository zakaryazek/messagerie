const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

// REGISTER
router.post('/register', async (req, res) => {
  const { pseudo, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (pseudo, password_hash) VALUES ($1, $2) RETURNING id, pseudo',
      [pseudo, hash]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Pseudo déjà pris ou données invalides' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  const { pseudo, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE pseudo = $1', [pseudo]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, pseudo: user.pseudo });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;