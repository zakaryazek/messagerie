const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

// routes protégées
router.use(authMiddleware);

// créer un groupe 
router.post('/', async (req, res) => {
  const { nom } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom du groupe est requis' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const groupeResult = await client.query(
      'INSERT INTO groupes (nom, created_by) VALUES ($1, $2) RETURNING id, nom, created_at',
      [nom, req.userId]
    );
    const groupe = groupeResult.rows[0];

    await client.query(
      'INSERT INTO groupe_users (groupe_id, user_id, role) VALUES ($1, $2, $3)',
      [groupe.id, req.userId, 'admin']
    );

    await client.query('COMMIT');
    res.status(201).json(groupe);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// lister les groupes (+nb membres)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        g.id,
        g.nom,
        g.created_at,
        u.pseudo AS created_by,
        COUNT(gu.user_id)::int AS membres
      FROM groupes g
      JOIN users u ON u.id = g.created_by
      LEFT JOIN groupe_users gu ON gu.groupe_id = g.id
      GROUP BY g.id, u.pseudo
      ORDER BY g.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// rejoindre un groupe
router.post('/:id/join', async (req, res) => {
  const groupeId = parseInt(req.params.id);

  try {
    // vérifie que le groupe existe
    const groupe = await pool.query('SELECT id FROM groupes WHERE id = $1', [groupeId]);
    if (groupe.rows.length === 0) return res.status(404).json({ error: 'Groupe introuvable' });

    // vérifie que l'utilisateur n'est pas déjà dans le groupe
    const existing = await pool.query(
      'SELECT 1 FROM groupe_users WHERE groupe_id = $1 AND user_id = $2',
      [groupeId, req.userId]
    );
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Déjà membre de ce groupe' });

    await pool.query(
      'INSERT INTO groupe_users (groupe_id, user_id, role) VALUES ($1, $2, $3)',
      [groupeId, req.userId, 'membre']
    );

    res.status(201).json({ message: 'Groupe rejoint avec succès' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
