const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

// routes protégées
router.use(authMiddleware);

// vérifie que l'utilisateur est membre du groupe
async function checkMembership(req, res, next) {
  const groupeId = parseInt(req.params.id);
  try {
    const result = await pool.query(
      'SELECT 1 FROM groupe_users WHERE groupe_id = $1 AND user_id = $2',
      [groupeId, req.userId]
    );
    if (result.rows.length === 0) return res.status(403).json({ error: 'Vous n\'êtes pas membre de ce groupe' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// POST /groupes/:id/messages
// envoyer un message
router.post('/', checkMembership, async (req, res) => {
  const groupeId = parseInt(req.params.id);
  const { contenu } = req.body;
  if (!contenu || contenu.trim() === '') return res.status(400).json({ error: 'Le contenu du message est requis' });

  try {
    const result = await pool.query(
      `INSERT INTO messages (contenu, sender_id, groupe_id)
       VALUES ($1, $2, $3)
       RETURNING id, contenu, created_at`,
      [contenu.trim(), req.userId, groupeId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /groupes/:id/messages
// historique des messages
router.get('/', checkMembership, async (req, res) => {
  const groupeId = parseInt(req.params.id);
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const result = await pool.query(
      `SELECT
         m.id,
         m.contenu,
         m.created_at,
         m.is_read,
         u.pseudo AS sender
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.groupe_id = $1
       ORDER BY m.created_at ASC
       LIMIT $2 OFFSET $3`,
      [groupeId, limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;