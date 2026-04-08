const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// Vérifie que les deux users sont amis
async function checkFriendship(req, res, next) {
  const otherId = parseInt(req.params.userId);
  try {
    const result = await pool.query(
      `SELECT 1 FROM friendships
       WHERE statut = 'accepted'
         AND (
           (demandeur_id = $1 AND receveur_id = $2)
           OR
           (demandeur_id = $2 AND receveur_id = $1)
         )`,
      [req.userId, otherId]
    );
    if (result.rows.length === 0) return res.status(403).json({ error: 'Vous n\'êtes pas amis' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// GET /dm/:userId/messages — historique de la conversation
router.get('/', checkFriendship, async (req, res) => {
  const otherId = parseInt(req.params.userId);
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const result = await pool.query(
      `SELECT
         m.id,
         m.contenu,
         m.created_at,
         u.pseudo AS sender
       FROM messages_prives m
       JOIN users u ON u.id = m.sender_id
       WHERE (m.sender_id = $1 AND m.receveur_id = $2)
          OR (m.sender_id = $2 AND m.receveur_id = $1)
       ORDER BY m.created_at ASC
       LIMIT $3 OFFSET $4`,
      [req.userId, otherId, limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
