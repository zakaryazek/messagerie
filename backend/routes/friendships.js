const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// POST /friendships/:id — envoyer une demande d'ami
router.post('/:id', async (req, res) => {
  const receveurId = parseInt(req.params.id);
  if (receveurId === req.userId) return res.status(400).json({ error: 'Vous ne pouvez pas vous ajouter vous-même' });

  try {
    const result = await pool.query(
      `INSERT INTO friendships (demandeur_id, receveur_id)
       VALUES ($1, $2)
       RETURNING id, statut, created_at`,
      [req.userId, receveurId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Demande déjà envoyée' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /friendships — lister amis acceptés + demandes reçues en attente
router.get('/', async (req, res) => {
  try {
    const amis = await pool.query(
      `SELECT
         f.id,
         f.statut,
         f.created_at,
         u.id AS user_id,
         u.pseudo
       FROM friendships f
       JOIN users u ON u.id = CASE
         WHEN f.demandeur_id = $1 THEN f.receveur_id
         ELSE f.demandeur_id
       END
       WHERE (f.demandeur_id = $1 OR f.receveur_id = $1)
         AND f.statut = 'accepted'`,
      [req.userId]
    );

    const demandes = await pool.query(
      `SELECT
         f.id,
         f.created_at,
         u.id AS user_id,
         u.pseudo
       FROM friendships f
       JOIN users u ON u.id = f.demandeur_id
       WHERE f.receveur_id = $1 AND f.statut = 'pending'`,
      [req.userId]
    );

    res.json({ amis: amis.rows, demandes: demandes.rows });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /friendships/:id/accepter — accepter une demande
router.patch('/:id/accepter', async (req, res) => {
  const friendshipId = parseInt(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE friendships
       SET statut = 'accepted'
       WHERE id = $1 AND receveur_id = $2 AND statut = 'pending'
       RETURNING id, statut`,
      [friendshipId, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Demande introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
