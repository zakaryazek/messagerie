const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// GET /conversations — liste unifiée DMs + groupes triée par dernier message
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
          g.admin_id
        FROM groupes g
        JOIN groupe_users gu ON gu.groupe_id = g.id AND gu.user_id = $1
        LEFT JOIN LATERAL (
          SELECT contenu, created_at, sender_id, attachment_url
          FROM messages WHERE groupe_id = g.id
          ORDER BY created_at DESC LIMIT 1
        ) m ON true
        LEFT JOIN users u ON u.id = m.sender_id

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
          NULL::integer AS admin_id
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

module.exports = router;