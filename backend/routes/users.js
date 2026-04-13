const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// GET /users?search=pseudo — rechercher un utilisateur
router.get('/', async (req, res) => {
  const { search } = req.query;
  if (!search) return res.status(400).json({ error: 'Paramètre search requis' });

  try {
    const result = await pool.query(
      `SELECT id, pseudo, created_at
       FROM users
       WHERE pseudo ILIKE $1
         AND id != $2
         AND password_hash != ''
         AND id NOT IN (
           SELECT CASE WHEN demandeur_id = $2 THEN receveur_id ELSE demandeur_id END
           FROM friendships
           WHERE (demandeur_id = $2 OR receveur_id = $2)
         )
       LIMIT 10`,
      [`%${search}%`, req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;