const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
router.use(authMiddleware);

let _io = null;

function getRoom(conversationKey) {
  // conversationKey est déjà canonique : 'groupe_X' ou 'dm_MIN_MAX'
  return conversationKey;
}

// Vérifie que l'utilisateur fait bien partie de la conversation désignée par la clé
// ('groupe_X' ou 'dm_MIN_MAX'). La clé est lue dans ?key= ou dans le body (conversationKey).
async function requireConversation(req, res, next) {
  const key = req.query.key || req.body?.conversationKey;
  if (typeof key !== 'string') return res.status(400).json({ error: 'key manquant' });
  try {
    let ok = false;
    let m;
    if ((m = /^groupe_(\d{1,9})$/.exec(key))) {
      const r = await pool.query(
        'SELECT 1 FROM groupe_users WHERE groupe_id = $1 AND user_id = $2', [Number(m[1]), req.userId]
      );
      ok = r.rows.length > 0;
    } else if ((m = /^dm_(\d{1,9})_(\d{1,9})$/.exec(key))) {
      const a = Number(m[1]), b = Number(m[2]);
      ok = a < b && (a === req.userId || b === req.userId);
    }
    if (!ok) return res.status(403).json({ error: 'Accès refusé' });
    next();
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
}

router.get('/bubble', requireConversation, async (req, res) => {
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

router.get('/bubble/other', requireConversation, async (req, res) => {
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

router.post('/bubble', requireConversation, async (req, res) => {
  const { conversationKey, color } = req.body;
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: 'Couleur invalide' });
  try {
    await pool.query(
      `INSERT INTO bubble_colors (user_id, conversation_key, color)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, conversation_key) DO UPDATE SET color = $3`,
      [req.userId, conversationKey, color]
    );
    if (_io) {
      const room = getRoom(conversationKey);
      _io.to(room).emit('bubbleColorChanged', { userId: req.userId, color, conversationKey });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/background', requireConversation, async (req, res) => {
  const { conversationKey, background } = req.body;
  if (typeof background !== 'string' || background.length === 0 || background.length > 100) return res.status(400).json({ error: 'Fond invalide' });
  try {
    await pool.query(
      `INSERT INTO chat_backgrounds (user_id, conversation_key, background)
       VALUES (0, $1, $2)
       ON CONFLICT (user_id, conversation_key) DO UPDATE SET background = $2`,
      [conversationKey, background]
    );
    if (_io) {
      const room = getRoom(conversationKey);
      _io.to(room).emit('backgroundChanged', { background, conversationKey });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.get('/pinned', requireConversation, async (req, res) => {
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