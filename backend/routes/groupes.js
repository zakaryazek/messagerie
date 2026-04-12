const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// POST /groupes — créer un groupe
router.post('/', async (req, res) => {
  const { nom, members } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom du groupe est requis' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const groupeResult = await client.query(
      'INSERT INTO groupes (nom, created_by, admin_id) VALUES ($1, $2, $2) RETURNING id, nom, created_at',
      [nom, req.userId]
    );
    const groupe = groupeResult.rows[0];
    await client.query(
      'INSERT INTO groupe_users (groupe_id, user_id, role) VALUES ($1, $2, $3)',
      [groupe.id, req.userId, 'admin']
    );
    // Add selected friends
    if (Array.isArray(members) && members.length > 0) {
      for (const memberId of members) {
        if (Number(memberId) !== Number(req.userId)) {
          await client.query(
            'INSERT INTO groupe_users (groupe_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [groupe.id, memberId, 'membre']
          );
        }
      }
    }
    await client.query('COMMIT');
    res.status(201).json(groupe);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /groupes — lister tous les groupes
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.nom, g.created_at, g.created_by,
              u.pseudo AS created_by_pseudo,
              COUNT(gu.user_id)::int AS membres,
              EXISTS(
                SELECT 1 FROM groupe_users
                WHERE groupe_id = g.id AND user_id = $1 AND role = 'admin'
              ) AS is_admin
       FROM groupes g
       JOIN users u ON u.id = g.created_by
       LEFT JOIN groupe_users gu ON gu.groupe_id = g.id
       GROUP BY g.id, u.pseudo
       ORDER BY g.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /groupes/:id/join — rejoindre un groupe
router.post('/:id/join', async (req, res) => {
  const groupeId = parseInt(req.params.id);
  try {
    const groupe = await pool.query('SELECT id FROM groupes WHERE id = $1', [groupeId]);
    if (groupe.rows.length === 0) return res.status(404).json({ error: 'Groupe introuvable' });

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

// DELETE /groupes/:id — supprimer un groupe (admin uniquement)
router.delete('/:id', async (req, res) => {
  const groupeId = parseInt(req.params.id);
  const client = await pool.connect();
  try {
    const isAdmin = await client.query(
      `SELECT 1 FROM groupe_users WHERE groupe_id = $1 AND user_id = $2 AND role = 'admin'`,
      [groupeId, req.userId]
    );
    if (isAdmin.rows.length === 0) return res.status(403).json({ error: "Seul l'admin peut supprimer ce groupe" });

    await client.query('BEGIN');
    await client.query('DELETE FROM messages WHERE groupe_id = $1', [groupeId]);
    await client.query('DELETE FROM groupe_users WHERE groupe_id = $1', [groupeId]);
    await client.query('DELETE FROM groupes WHERE id = $1', [groupeId]);
    await client.query('COMMIT');
    res.json({ message: 'Groupe supprimé' });
    if (_io) _io.emit('groupeDeleted', { groupeId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// Liste des membres avec leur couleur de bulle
router.get('/:id/members', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.pseudo, u.avatar_url,
       bc.color as bubble_color
       FROM groupe_users gu
       JOIN users u ON u.id = gu.user_id
       LEFT JOIN bubble_colors bc ON bc.user_id = u.id 
         AND bc.conversation_key = $2
       WHERE gu.groupe_id = $1`,
      [req.params.id, 'groupe_' + req.params.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// Ajouter un membre
router.post('/:id/members', authMiddleware, async (req, res) => {
  const { userId } = req.body;
  try {
    const count = await pool.query(
      'SELECT COUNT(*) FROM groupe_users WHERE groupe_id = $1', [req.params.id]
    );
    if (parseInt(count.rows[0].count) >= 20)
      return res.status(400).json({ error: 'Groupe plein' });
    await pool.query(
      'INSERT INTO groupe_users (groupe_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, userId]
    );
    res.json({ success: true });
    if (_io) _io.emit('addedToGroupe', { groupeId: Number(req.params.id), userId: Number(userId) });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// Retirer un membre (admin seulement)
router.delete('/:id/members/:userId', authMiddleware, async (req, res) => {
  try {
    const groupe = await pool.query('SELECT admin_id FROM groupes WHERE id = $1', [req.params.id]);
    if (groupe.rows[0].admin_id !== req.userId)
      return res.status(403).json({ error: 'Non autorisé' });
    await pool.query(
      'DELETE FROM groupe_users WHERE groupe_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId]
    );
    // Message système
    await pool.query(
      'INSERT INTO messages (contenu, groupe_id) VALUES ($1, $2)',
      ['Un membre a été retiré du groupe.', req.params.id]
    );
    res.json({ success: true });
    if (_io) _io.emit('removedFromGroupe', { groupeId: Number(req.params.id), userId: Number(req.params.userId) });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// Quitter un groupe
router.post('/:id/leave', authMiddleware, async (req, res) => {
  const { newAdminId } = req.body;
  try {
    const groupe = await pool.query('SELECT admin_id FROM groupes WHERE id = $1', [req.params.id]);
    if (groupe.rows[0].admin_id === req.userId) {
      if (!newAdminId) return res.status(400).json({ error: 'Nouvel admin requis' });
      await pool.query('UPDATE groupes SET admin_id = $1 WHERE id = $2', [newAdminId, req.params.id]);
      await pool.query(
        `UPDATE groupe_users SET role = 'admin' WHERE groupe_id = $1 AND user_id = $2`,
        [req.params.id, newAdminId]
      );
    }
    await pool.query(
      'DELETE FROM groupe_users WHERE groupe_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    res.json({ success: true });
    if (_io) _io.emit('groupeLeft', { groupeId: Number(req.params.id), userId: Number(req.userId) });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

let _io = null;
module.exports = (io) => { _io = io; return router; };