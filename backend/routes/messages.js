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

async function checkMembership(req, res, next) {
  const groupeId = parseInt(req.params.id);
  if (isNaN(groupeId)) return next();
  try {
    const result = await pool.query(
      'SELECT 1 FROM groupe_users WHERE groupe_id = $1 AND user_id = $2',
      [groupeId, req.userId]
    );
    if (result.rows.length === 0) return res.status(403).json({ error: 'Non membre' });
    next();
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
}

// GET / — Historique avec réactions
router.get('/', checkMembership, async (req, res) => {
  const groupeId = parseInt(req.params.id);
  try {
    const result = await pool.query(
      `SELECT m.*, COALESCE(u.pseudo, '[Utilisateur supprimé]') AS sender,
        COALESCE(
          json_agg(
            json_build_object('emoji', r.emoji, 'count', r.cnt, 'reacted_by_me', r.reacted_by_me)
          ) FILTER (WHERE r.emoji IS NOT NULL),
          '[]'
        ) AS reactions,
        CASE WHEN m.reply_to_id IS NOT NULL THEN
          json_build_object(
            'id', rp.id,
            'contenu', rp.contenu,
            'sender', COALESCE(ru.pseudo, '[Utilisateur supprimé]')
          )
        END AS reply_to
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN messages rp ON rp.id = m.reply_to_id
       LEFT JOIN users ru ON ru.id = rp.sender_id
       LEFT JOIN (
         SELECT message_id, emoji, COUNT(*) as cnt,
                BOOL_OR(user_id = $2) as reacted_by_me
         FROM reactions WHERE message_type = 'groupe'
         GROUP BY message_id, emoji
       ) r ON r.message_id = m.id
       WHERE m.groupe_id = $1 AND m.deleted_at IS NULL
       GROUP BY m.id, u.pseudo, rp.id, rp.contenu, ru.pseudo
       ORDER BY m.created_at ASC`,
      [groupeId, req.userId]
    );
    const rows = result.rows.map(m => ({ ...m, attachment_url: fullUrl(m.attachment_url) }));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /attachments
router.get('/attachments', async (req, res) => {
  const groupeId = parseInt(req.params.id);
  try {
    const result = await pool.query(
      `SELECT id, attachment_url FROM messages
       WHERE groupe_id = $1 AND attachment_url IS NOT NULL AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [groupeId]
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
      `UPDATE messages SET contenu = $1, edited_at = NOW()
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
      `UPDATE messages SET deleted_at = NOW() WHERE id = $1 AND sender_id = $2 RETURNING id`,
      [req.params.msgId, req.userId]
    );
    if (result.rows.length === 0) return res.status(403).json({ error: 'Non autorisé' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur delete' }); }
});

module.exports = router;