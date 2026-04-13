const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

module.exports = function(io) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /conversations — liste unifiée DMs + groupes avec unread_count
  router.get('/', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT * FROM (
          -- Groupes
          SELECT
            'group' AS type,
            g.id,
            g.nom AS name,
            g.created_at,
            g.created_by,
            gu.role,
            m.contenu AS last_message,
            m.attachment_url AS last_attachment,
            m.created_at AS last_message_at,
            u.pseudo AS last_sender,
            NULL::integer AS other_user_id,
            NULL::text AS other_status,
            NULL::timestamp AS accepted_at,
            g.admin_id,
            COALESCE(unread.cnt, 0)::integer AS unread_count
          FROM groupes g
          JOIN groupe_users gu ON gu.groupe_id = g.id AND gu.user_id = $1
          LEFT JOIN LATERAL (
            SELECT contenu, created_at, sender_id, attachment_url
            FROM messages WHERE groupe_id = g.id
            ORDER BY created_at DESC LIMIT 1
          ) m ON true
          LEFT JOIN users u ON u.id = m.sender_id
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::integer AS cnt
            FROM messages msg
            LEFT JOIN conversation_last_read clr
              ON clr.user_id = $1
              AND clr.conv_key = 'groupe_' || g.id::text
            WHERE msg.groupe_id = g.id
              AND msg.sender_id != $1
              AND (clr.last_read_at IS NULL OR msg.created_at > clr.last_read_at)
          ) unread ON true

          UNION ALL

          -- DMs
          SELECT
            'dm' AS type,
            other_u.id,
            other_u.pseudo AS name,
            NULL::timestamp AS created_at,
            NULL::integer AS created_by,
            NULL::varchar AS role,
            mp.contenu AS last_message,
            mp.attachment_url AS last_attachment,
            mp.created_at AS last_message_at,
            sender_u.pseudo AS last_sender,
            other_u.id AS other_user_id,
            other_u.status AS other_status,
            f.accepted_at,
            NULL::integer AS admin_id,
            COALESCE(unread.cnt, 0)::integer AS unread_count
          FROM friendships f
          JOIN users other_u ON other_u.id = CASE
            WHEN f.demandeur_id = $1 THEN f.receveur_id ELSE f.demandeur_id END
          LEFT JOIN LATERAL (
            SELECT contenu, created_at, sender_id, attachment_url
            FROM messages_prives
            WHERE (sender_id = $1 AND receveur_id = other_u.id)
               OR (sender_id = other_u.id AND receveur_id = $1)
            ORDER BY created_at DESC LIMIT 1
          ) mp ON true
          LEFT JOIN users sender_u ON sender_u.id = mp.sender_id
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::integer AS cnt
            FROM messages_prives msg
            LEFT JOIN conversation_last_read clr
              ON clr.user_id = $1
              AND clr.conv_key = 'dm_'
                || LEAST($1::integer, other_u.id)
                || '_'
                || GREATEST($1::integer, other_u.id)
            WHERE ((msg.sender_id = other_u.id AND msg.receveur_id = $1)
                OR (msg.sender_id = $1 AND msg.receveur_id = other_u.id))
              AND msg.sender_id != $1
              AND (clr.last_read_at IS NULL OR msg.created_at > clr.last_read_at)
          ) unread ON true
          WHERE f.statut = 'accepted'
            AND (f.demandeur_id = $1 OR f.receveur_id = $1)
        ) conversations
        ORDER BY last_message_at DESC NULLS LAST`,
        [req.userId]
      );
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // POST /conversations/mark-read
  router.post('/mark-read', async (req, res) => {
    const { convKey } = req.body;
    if (!convKey) return res.status(400).json({ error: 'convKey requis' });
    try {
      // 1. Mettre à jour conversation_last_read (badges Sidebar)
      await pool.query(
        `INSERT INTO conversation_last_read (user_id, conv_key, last_read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, conv_key) DO UPDATE SET last_read_at = NOW()`,
        [req.userId, convKey]
      );

      // 2. Si DM : mettre is_read = true dans messages_prives + notifier l'expéditeur
      if (convKey.startsWith('dm_')) {
        const parts = convKey.replace('dm_', '').split('_');
        const idA = Number(parts[0]);
        const idB = Number(parts[1]);
        const senderId = idA === req.userId ? idB : idA;

        await pool.query(
          `UPDATE messages_prives SET is_read = true
           WHERE receveur_id = $1 AND sender_id = $2 AND is_read = false`,
          [req.userId, senderId]
        );

        io.to('user_' + senderId).emit('allDMRead', { readBy: req.userId });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  return router;
};