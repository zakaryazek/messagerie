const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const pool = require('./db');
const onlineUsers = new Map();
require('dotenv').config();

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const groupesRoutes = require('./routes/groupes');
const messagesRoutes = require('./routes/messages');
const friendshipsRoutes = require('./routes/friendships');
const usersRoutes = require('./routes/users');
const dmRoutes = require('./routes/dm');
const conversationsRoutes = require('./routes/conversations');
const uploadRoutes = require('./routes/upload');
const settingsRoutes = require('./routes/settings');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/auth', authRoutes);
app.use('/me', meRoutes);
app.use('/groupes', groupesRoutes(io));
app.use('/groupes/:id/messages', messagesRoutes);
app.use('/friendships', friendshipsRoutes(io));
app.use('/users', usersRoutes);
app.use('/dm/:userId/messages', dmRoutes);
app.use('/conversations', conversationsRoutes(io));
app.use('/upload', uploadRoutes);
app.use('/settings', settingsRoutes(io));

app.get('/', (req, res) => res.json({ message: 'API OK' }));

// Helper : préfixe l'URL d'attachment si relative
function fullUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return (process.env.API_BASE_URL || 'http://localhost:3001') + url;
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Token manquant'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) { next(new Error('Token invalide ou expiré')); }
});

io.on('connection', (socket) => {
  onlineUsers.set(socket.userId, socket.id);
  io.emit('userOnline', socket.userId);
  socket.emit('onlineUsers', Array.from(onlineUsers.keys()));
  socket.join('user_' + socket.userId); // room personnelle toujours active

  // --- GROUPES ---

  socket.on('joinRoom', async (groupeId) => {
    const id = Number(groupeId);
    try {
      const result = await pool.query(
        'SELECT 1 FROM groupe_users WHERE groupe_id = $1 AND user_id = $2', [id, socket.userId]
      );
      if (result.rows.length === 0) return socket.emit('error', 'Non membre du groupe');
      socket.join('groupe_' + id);
    } catch (err) { console.error('Erreur joinRoom:', err.message); }
  });

  socket.on('leaveRoom', (groupeId) => socket.leave('groupe_' + Number(groupeId)));

  socket.on('sendMessage', async ({ groupeId, contenu, attachmentUrl, replyToId }) => {
    const id = Number(groupeId);
    try {
      if (!contenu && !attachmentUrl) return socket.emit('error', 'Message vide');
      const result = await pool.query(
        `INSERT INTO messages (contenu, sender_id, groupe_id, attachment_url, reply_to_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, contenu, attachment_url, created_at, reply_to_id`,
        [contenu || null, socket.userId, id, attachmentUrl || null, replyToId || null]
      );
      const user = await pool.query('SELECT pseudo FROM users WHERE id = $1', [socket.userId]);
      const msg = result.rows[0];
      let replyToObj = null;
      if (replyToId) {
        const rp = await pool.query(
          `SELECT m.id, m.contenu, COALESCE(u.pseudo,'[Utilisateur supprimé]') AS sender
           FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = $1`, [replyToId]
        );
        replyToObj = rp.rows[0] || null;
      }
      io.to('groupe_' + id).emit('newMessage', {
        ...msg,
        attachment_url: fullUrl(msg.attachment_url),
        sender: user.rows[0].pseudo,
        sender_id: socket.userId,
        groupe_id: id,
        reactions: [],
        reply_to: replyToObj
      });
      // Notifier tous les membres du groupe (même si le chat n'est pas ouvert)
      const members = await pool.query('SELECT user_id FROM groupe_users WHERE groupe_id = $1', [id]);
      members.rows.forEach(({ user_id }) => {
        if (user_id !== socket.userId) io.to('user_' + user_id).emit('conversationListUpdated');
      });
      io.to('user_' + socket.userId).emit('conversationListUpdated');
    } catch (err) { console.error('Erreur sendMessage:', err.message); }
  });

  socket.on('editMessage', async ({ messageId, contenu, groupeId }) => {
    try {
      const result = await pool.query(
        `UPDATE messages SET contenu = $1, edited_at = NOW()
         WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL
         RETURNING id, contenu, edited_at`,
        [contenu, messageId, socket.userId]
      );
      if (result.rows.length === 0) return;
      io.to('groupe_' + groupeId).emit('messageEdited', result.rows[0]);
    } catch (err) { console.error(err.message); }
  });

  socket.on('deleteMessage', async ({ messageId, groupeId }) => {
    try {
      const result = await pool.query(
        `UPDATE messages SET deleted_at = NOW() WHERE id = $1 AND sender_id = $2 RETURNING id`,
        [messageId, socket.userId]
      );
      if (result.rows.length === 0) return;
      io.to('groupe_' + groupeId).emit('messageDeleted', { messageId });
    } catch (err) { console.error(err.message); }
  });

  socket.on('markReadGroupe', async ({ messageId, groupeId }) => {
    try {
      await pool.query(
        `INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [messageId, socket.userId]
      );
      const readers = await pool.query(
        `SELECT u.pseudo FROM message_reads mr
         JOIN users u ON u.id = mr.user_id WHERE mr.message_id = $1`,
        [messageId]
      );
      io.to('groupe_' + groupeId).emit('groupeRead', { messageId, readers: readers.rows.map(r => r.pseudo) });
    } catch (err) { console.error(err.message); }
  });

  // --- DM ---

  socket.on('joinDM', async (otherId) => {
    const targetId = Number(otherId);
    try {
      const result = await pool.query(
        `SELECT 1 FROM friendships WHERE statut = 'accepted'
         AND ((demandeur_id = $1 AND receveur_id = $2) OR (demandeur_id = $2 AND receveur_id = $1))`,
        [socket.userId, targetId]
      );
      if (result.rows.length === 0) return socket.emit('error', 'Pas amis');
      socket.join('dm_' + Math.min(socket.userId, targetId) + '_' + Math.max(socket.userId, targetId));
    } catch (err) { console.error('Erreur joinDM:', err.message); }
  });

  socket.on('leaveDM', (otherId) => {
    const t = Number(otherId);
    socket.leave('dm_' + Math.min(socket.userId, t) + '_' + Math.max(socket.userId, t));
  });

  socket.on('sendPrivateMessage', async ({ receveurId, contenu, attachmentUrl, replyToId }) => {
    const targetId = Number(receveurId);
    try {
      if (!contenu && !attachmentUrl) return socket.emit('error', 'Message vide');
      const result = await pool.query(
        `INSERT INTO messages_prives (contenu, sender_id, receveur_id, attachment_url, reply_to_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, contenu, attachment_url, created_at, reply_to_id`,
        [contenu || null, socket.userId, targetId, attachmentUrl || null, replyToId || null]
      );
      const user = await pool.query('SELECT pseudo FROM users WHERE id = $1', [socket.userId]);
      const msg = result.rows[0];
      const roomId = 'dm_' + Math.min(socket.userId, targetId) + '_' + Math.max(socket.userId, targetId);
      let replyToObj = null;
      if (replyToId) {
        const rp = await pool.query(
          `SELECT mp.id, mp.contenu, COALESCE(u.pseudo,'[Utilisateur supprimé]') AS sender
           FROM messages_prives mp LEFT JOIN users u ON u.id = mp.sender_id WHERE mp.id = $1`, [replyToId]
        );
        replyToObj = rp.rows[0] || null;
      }
      io.to(roomId).emit('newPrivateMessage', {
        ...msg,
        attachment_url: fullUrl(msg.attachment_url),
        sender: user.rows[0].pseudo,
        sender_id: socket.userId,
        receveur_id: targetId,
        reactions: [],
        reply_to: replyToObj
      });
      // Notifier le destinataire même si le chat n'est pas ouvert
      io.to('user_' + targetId).emit('conversationListUpdated');
      io.to('user_' + socket.userId).emit('conversationListUpdated');
    } catch (err) { console.error('Erreur sendPrivateMessage:', err.message); }
  });

  socket.on('editDM', async ({ messageId, contenu, otherId }) => {
    try {
      const result = await pool.query(
        `UPDATE messages_prives SET contenu = $1, edited_at = NOW()
         WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL
         RETURNING id, contenu, edited_at`,
        [contenu, messageId, socket.userId]
      );
      if (result.rows.length === 0) return;
      const roomId = 'dm_' + Math.min(socket.userId, Number(otherId)) + '_' + Math.max(socket.userId, Number(otherId));
      io.to(roomId).emit('dmEdited', result.rows[0]);
    } catch (err) { console.error(err.message); }
  });

  socket.on('deleteDM', async ({ messageId, otherId }) => {
    try {
      const result = await pool.query(
        `UPDATE messages_prives SET deleted_at = NOW() WHERE id = $1 AND sender_id = $2 RETURNING id`,
        [messageId, socket.userId]
      );
      if (result.rows.length === 0) return;
      const roomId = 'dm_' + Math.min(socket.userId, Number(otherId)) + '_' + Math.max(socket.userId, Number(otherId));
      io.to(roomId).emit('dmDeleted', { messageId });
    } catch (err) { console.error(err.message); }
  });

  socket.on('markReadDM', async ({ messageId, otherId }) => {
    try {
      await pool.query(
        `INSERT INTO message_prives_reads (message_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [messageId]
      );
      const roomId = 'dm_' + Math.min(socket.userId, Number(otherId)) + '_' + Math.max(socket.userId, Number(otherId));
      io.to(roomId).emit('dmRead', { messageId, readBy: socket.userId });
    } catch (err) { console.error(err.message); }
  });

  // Marquer tous les messages d'une conv comme lus
  socket.on('openedDM', async (otherId) => {
    const targetId = Number(otherId);
    try {
      await pool.query(
        `UPDATE messages_prives SET is_read = true
         WHERE receveur_id = $1 AND sender_id = $2 AND is_read = false`,
        [socket.userId, targetId]
      );
      // Toujours émettre, même si rien n'a changé (markConvRead HTTP a pu passer en premier)
      const roomId = 'dm_' + Math.min(socket.userId, targetId) + '_' + Math.max(socket.userId, targetId);
      io.to(roomId).emit('allDMRead', { readBy: socket.userId });
      io.to('user_' + targetId).emit('allDMRead', { readBy: socket.userId });
    } catch (err) { console.error(err.message); }
  });

  socket.on('openedGroupe', async (groupeId) => {
    const id = Number(groupeId);
    try {
      const msgs = await pool.query(
        `SELECT id FROM messages WHERE groupe_id = $1 AND sender_id != $2 AND deleted_at IS NULL`,
        [id, socket.userId]
      );
      for (const m of msgs.rows) {
        await pool.query(
          `INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [m.id, socket.userId]
        );
      }
      io.to('groupe_' + id).emit('allGroupeRead', { groupeId: id, userId: socket.userId });
    } catch (err) { console.error(err.message); }
  });

  // --- RÉACTIONS ---

  socket.on('react', async ({ messageId, emoji, type, groupeId, otherId }) => {
    try {
      // Toggle : si même emoji déjà posé par ce user, on supprime
      const existing = await pool.query(
        `SELECT id FROM reactions WHERE message_id = $1 AND message_type = $2 AND user_id = $3 AND emoji = $4`,
        [messageId, type, socket.userId, emoji]
      );
      if (existing.rows.length > 0) {
        await pool.query(`DELETE FROM reactions WHERE id = $1`, [existing.rows[0].id]);
      } else {
        await pool.query(
          `INSERT INTO reactions (message_id, message_type, user_id, emoji)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (message_id, message_type, user_id) DO UPDATE SET emoji = $4, created_at = NOW()`,
          [messageId, type, socket.userId, emoji]
        );
      }
      const result = await pool.query(
        `SELECT emoji, COUNT(*) as count, BOOL_OR(user_id = $2) as reacted_by_me
         FROM reactions WHERE message_id = $1 AND message_type = $3
         GROUP BY emoji`,
        [messageId, socket.userId, type]
      );
      const payload = { messageId, reactions: result.rows };
      if (type === 'groupe') {
        io.to('groupe_' + groupeId).emit('reactionUpdated', payload);
      } else {
        const roomId = 'dm_' + Math.min(socket.userId, Number(otherId)) + '_' + Math.max(socket.userId, Number(otherId));
        io.to(roomId).emit('reactionUpdated', payload);
      }
    } catch (err) { console.error(err.message); }
  });

  // --- ÉPINGLÉS ---

  socket.on('pinMessage', async ({ messageId, type, conversationKey, groupeId, otherId }) => {
    try {
      // Un seul message épinglé par conversation : on remplace
      await pool.query(
        `DELETE FROM pinned_messages WHERE conversation_key = $1`, [conversationKey]
      );
      await pool.query(
        `INSERT INTO pinned_messages (message_id, message_type, conversation_key, pinned_by)
         VALUES ($1, $2, $3, $4)`,
        [messageId, type, conversationKey, socket.userId]
      );
      // Charger le message complet pour l'émettre
      let msg;
      if (type === 'groupe') {
        const r = await pool.query(
          `SELECT m.*, COALESCE(u.pseudo, '[Utilisateur supprimé]') AS sender FROM messages m
           LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
          [messageId]
        );
        msg = r.rows[0];
      } else {
        const r = await pool.query(
          `SELECT mp.*, COALESCE(u.pseudo, '[Utilisateur supprimé]') AS sender FROM messages_prives mp
           LEFT JOIN users u ON u.id = mp.sender_id WHERE mp.id = $1`,
          [messageId]
        );
        msg = r.rows[0];
      }
      const payload = { conversationKey, pinnedMsg: msg };
      if (type === 'groupe') {
        io.to('groupe_' + groupeId).emit('messagePinned', payload);
      } else {
        const roomId = 'dm_' + Math.min(socket.userId, Number(otherId)) + '_' + Math.max(socket.userId, Number(otherId));
        io.to(roomId).emit('messagePinned', payload);
      }
    } catch (err) { console.error('Erreur pinMessage:', err.message); }
  });

  socket.on('unpinMessage', async ({ conversationKey, groupeId, otherId, type }) => {
    try {
      await pool.query(
        `DELETE FROM pinned_messages WHERE conversation_key = $1`, [conversationKey]
      );
      const payload = { conversationKey };
      if (type === 'groupe') {
        io.to('groupe_' + groupeId).emit('messageUnpinned', payload);
      } else {
        const roomId = 'dm_' + Math.min(socket.userId, Number(otherId)) + '_' + Math.max(socket.userId, Number(otherId));
        io.to(roomId).emit('messageUnpinned', payload);
      }
    } catch (err) { console.error('Erreur unpinMessage:', err.message); }
  });

  // --- TYPING ---

  socket.on('typing', ({ groupeId }) => {
    socket.to('groupe_' + groupeId).emit('userTyping', { userId: socket.userId });
    pool.query('SELECT user_id FROM groupe_users WHERE groupe_id = $1', [groupeId])
      .then(({ rows }) => rows.forEach(({ user_id }) => {
        if (user_id !== socket.userId)
          io.to('user_' + user_id).emit('sidebarTyping', { type: 'group', id: Number(groupeId) });
      }));
  });
  socket.on('stopTyping', ({ groupeId }) => {
    socket.to('groupe_' + groupeId).emit('userStopTyping', { userId: socket.userId });
    pool.query('SELECT user_id FROM groupe_users WHERE groupe_id = $1', [groupeId])
      .then(({ rows }) => rows.forEach(({ user_id }) => {
        if (user_id !== socket.userId)
          io.to('user_' + user_id).emit('sidebarStopTyping', { type: 'group', id: Number(groupeId) });
      }));
  });
  socket.on('typingDM', ({ otherId }) => {
    const roomId = 'dm_' + Math.min(socket.userId, Number(otherId)) + '_' + Math.max(socket.userId, Number(otherId));
    socket.to(roomId).emit('userTypingDM', { userId: socket.userId });
    io.to('user_' + Number(otherId)).emit('sidebarTyping', { type: 'dm', id: socket.userId });
  });
  socket.on('stopTypingDM', ({ otherId }) => {
    const roomId = 'dm_' + Math.min(socket.userId, Number(otherId)) + '_' + Math.max(socket.userId, Number(otherId));
    socket.to(roomId).emit('userStopTypingDM', { userId: socket.userId });
    io.to('user_' + Number(otherId)).emit('sidebarStopTyping', { type: 'dm', id: socket.userId });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.userId);
    io.emit('userOffline', socket.userId);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Serveur lancé sur http://localhost:' + PORT));