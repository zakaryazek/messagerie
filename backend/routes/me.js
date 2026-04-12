const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
router.use(authMiddleware);

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
function fullUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return API_BASE + url;
}

// GET /me
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, pseudo, email, status, avatar_url, theme, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ ...user, avatar_url: fullUrl(user.avatar_url) });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /me — pseudo, email, mot de passe, avatar_url, theme
router.patch('/', async (req, res) => {
  const { pseudo, email, currentPassword, newPassword, avatar_url, theme } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = userResult.rows[0];
    const updates = [];
    const values = [];
    let i = 1;

    if (pseudo && pseudo !== user.pseudo) {
      const existing = await pool.query('SELECT id FROM users WHERE pseudo = $1 AND id != $2', [pseudo, req.userId]);
      if (existing.rows.length > 0) return res.status(409).json({ error: 'Pseudo déjà utilisé' });
      updates.push(`pseudo = $${i++}`); values.push(pseudo);
    }
    if (email && email.toLowerCase() !== user.email) {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email.toLowerCase(), req.userId]);
      if (existing.rows.length > 0) return res.status(409).json({ error: 'Email déjà utilisé' });
      updates.push(`email = $${i++}`); values.push(email.toLowerCase());
    }
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Mot de passe actuel requis' });
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
      const hash = await bcrypt.hash(newPassword, 10);
      updates.push(`password_hash = $${i++}`); values.push(hash);
    }
    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${i++}`); values.push(avatar_url);
    }
    if (theme && ['system', 'light', 'dark'].includes(theme)) {
      updates.push(`theme = $${i++}`); values.push(theme);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Aucune modification détectée' });

    values.push(req.userId);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, pseudo, email, status, avatar_url, theme`,
      values
    );
    const updated = result.rows[0];
    res.json({ ...updated, avatar_url: fullUrl(updated.avatar_url) });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /me/status
router.patch('/status', async (req, res) => {
  const { status } = req.body;
  if (!['online', 'offline'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  try {
    await pool.query('UPDATE users SET status = $1 WHERE id = $2', [status, req.userId]);
    res.json({ status });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /me
router.delete('/', async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET pseudo = '[Utilisateur supprimé]', email = NULL,
       password_hash = '', avatar_url = NULL WHERE id = $1`,
      [req.userId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;