const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
router.use(authMiddleware);

let _io = null;

function dmRoom(userId, otherKey) {
  // otherKey = 'dm_5' → extract otherId → compute 'dm_1_5'
  const otherId = Number(otherKey.replace('dm_', ''));
  return 'dm_' + Math.min(userId, otherId) + '_' + Math.max(userId, otherId);
}

function getRoom(conversationKey, userId) {
  if (conversationKey.startsWith('groupe_')) return conversationKey;
  return dmRoom(userId, conversationKey);
}

router.get('/bubble', async (req, res) => {
  const { key } = req.query;
  try {
    const color = await pool.query(
      'SELECT color FROM bubble_colors WHERE user_id = $1 AND conversation_key = $2',
      [req.userId, key]
    );
    const bg = await pool.query(
      'SELECT background FROM chat_backgrounds WHERE user_id = 0 AND conversation_key = $1',
      [key]
    );
    res.json({
      color: color.rows[0]?.color || null,
      background: bg.rows[0]?.background || null
    });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.get('/bubble/other', async (req, res) => {
  const { key, otherUserId } = req.query;
  if (!key || !otherUserId) return res.status(400).json({ error: 'Paramètres manquants' });
  try {
    const color = await pool.query(
      'SELECT color FROM bubble_colors WHERE user_id = $1 AND conversation_key = $2',
      [otherUserId, key]
    );
    res.json({ color: color.rows[0]?.color || null });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/bubble', async (req, res) => {
  const { conversationKey, color } = req.body;
  try {
    await pool.query(
      `INSERT INTO bubble_colors (user_id, conversation_key, color)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, conversation_key) DO UPDATE SET color = $3`,
      [req.userId, conversationKey, color]
    );
    if (_io) {
      const room = getRoom(conversationKey, req.userId);
      _io.to(room).emit('bubbleColorChanged', { userId: req.userId, color, conversationKey });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/background', async (req, res) => {
  const { conversationKey, background } = req.body;
  try {
    await pool.query(
      `INSERT INTO chat_backgrounds (user_id, conversation_key, background)
       VALUES (0, $1, $2)
       ON CONFLICT (user_id, conversation_key) DO UPDATE SET background = $2`,
      [conversationKey, background]
    );
    if (_io) {
      const room = getRoom(conversationKey, req.userId);
      _io.to(room).emit('backgroundChanged', { background, conversationKey });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.get('/pinned', async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'key manquant' });
  try {
    const pin = await pool.query(
      `SELECT pm.*,
        CASE pm.message_type
          WHEN 'groupe' THEN (
            SELECT row_to_json(t) FROM (
              SELECT m.*, u.pseudo AS sender FROM messages m
              JOIN users u ON u.id = m.sender_id WHERE m.id = pm.message_id
            ) t
          )
          ELSE (
            SELECT row_to_json(t) FROM (
              SELECT mp.*, u.pseudo AS sender FROM messages_prives mp
              JOIN users u ON u.id = mp.sender_id WHERE mp.id = pm.message_id
            ) t
          )
        END AS "pinnedMsg"
       FROM pinned_messages pm
       WHERE pm.conversation_key = $1
       ORDER BY pm.pinned_at DESC LIMIT 1`,
      [key]
    );
    if (pin.rows.length === 0) return res.json({ pinnedMsg: null });
    res.json({ pinnedMsg: pin.rows[0].pinnedMsg });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = (io) => {
  _io = io;
  return router;
};