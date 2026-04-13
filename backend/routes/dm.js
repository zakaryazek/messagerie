const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
function fullUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return API_BASE + url;
}

async function checkFriendship(req, res, next) {
  const otherId = parseInt(req.params.userId);
  if (isNaN(otherId)) return res.status(400).json({ error: 'ID invalide' });
  try {
    const result = await pool.query(
      `SELECT 1 FROM friendships WHERE statut = 'accepted'
       AND ((demandeur_id = $1 AND receveur_id = $2) OR (demandeur_id = $2 AND receveur_id = $1))`,
      [req.userId, otherId]
    );
    if (result.rows.length === 0) return res.status(403).json({ error: 'Pas amis' });
    next();
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
}

// GET / — Historique DM avec réactions
router.get('/', checkFriendship, async (req, res) => {
  const otherId = parseInt(req.params.userId);
  try {
    const result = await pool.query(
      `SELECT mp.*, COALESCE(u.pseudo, '[Utilisateur supprimé]') AS sender,
        COALESCE(
          json_agg(
            json_build_object('emoji', r.emoji, 'count', r.cnt, 'reacted_by_me', r.reacted_by_me)
          ) FILTER (WHERE r.emoji IS NOT NULL),
          '[]'
        ) AS reactions
       FROM messages_prives mp
       LEFT JOIN users u ON u.id = mp.sender_id
       LEFT JOIN (
         SELECT message_id, emoji, COUNT(*) as cnt,
                BOOL_OR(user_id = $3) as reacted_by_me
         FROM reactions WHERE message_type = 'prive'
         GROUP BY message_id, emoji
       ) r ON r.message_id = mp.id
       WHERE ((mp.sender_id = $1 AND mp.receveur_id = $2)
          OR  (mp.sender_id = $2 AND mp.receveur_id = $1))
         AND mp.deleted_at IS NULL
       GROUP BY mp.id, u.pseudo
       ORDER BY mp.created_at ASC`,
      [req.userId, otherId, req.userId]
    );
    const rows = result.rows.map(m => ({ ...m, attachment_url: fullUrl(m.attachment_url) }));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /attachments
router.get('/attachments', async (req, res) => {
  const otherId = parseInt(req.params.userId);
  try {
    const result = await pool.query(
      `SELECT id, attachment_url FROM messages_prives
       WHERE ((sender_id = $1 AND receveur_id = $2) OR (sender_id = $2 AND receveur_id = $1))
         AND attachment_url IS NOT NULL AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.userId, otherId]
    );
    const rows = result.rows.map(m => ({ ...m, attachment_url: fullUrl(m.attachment_url) }));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PATCH /:msgId
router.patch('/:msgId', async (req, res) => {
  const { contenu } = req.body;
  try {
    const result = await pool.query(
      `UPDATE messages_prives SET contenu = $1, edited_at = NOW()
       WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL RETURNING *`,
      [contenu, req.params.msgId, req.userId]
    );
    if (result.rows.length === 0) return res.status(403).json({ error: 'Non autorisé' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erreur edit' }); }
});

// DELETE /:msgId
router.delete('/:msgId', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE messages_prives SET deleted_at = NOW()
       WHERE id = $1 AND sender_id = $2 RETURNING id`,
      [req.params.msgId, req.userId]
    );
    if (result.rows.length === 0) return res.status(403).json({ error: 'Non autorisé' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur delete' }); }
});

module.exports = router;