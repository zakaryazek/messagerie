const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const helmet = require('helmet');
const pool = require('./db');
const { apiLimiter, uploadLimiter } = require('./middleware/rateLimit');
const onlineUsers = new Map();
require('dotenv').config();

// --- Configuration obligatoire ---
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET manquant dans le fichier .env : arrêt du serveur.');
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.warn('Attention : JWT_SECRET fait moins de 32 caractères, génère-en un plus long (voir .env.example).');
}
// Origines autorisées à appeler l'API depuis un navigateur
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map((o) => o.trim()).filter(Boolean);

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
const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS } });

// Derrière un reverse proxy, il faut le déclarer pour que le rate limiting voie la vraie IP
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
}

// 'cross-origin' : le frontend (autre port) doit pouvoir afficher les images de /uploads
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(apiLimiter); // après /uploads : afficher beaucoup d'images ne consomme pas le quota

app.use('/auth', authRoutes);
app.use('/me', meRoutes);
app.use('/groupes', groupesRoutes(io));
app.use('/groupes/:id/messages', messagesRoutes);
app.use('/friendships', friendshipsRoutes(io));
app.use('/users', usersRoutes);
app.use('/dm/:userId/messages', dmRoutes);
app.use('/conversations', conversationsRoutes(io));
app.use('/upload', uploadLimiter, uploadRoutes);
app.use('/settings', settingsRoutes(io));

app.get('/', (req, res) => res.json({ message: 'API OK' }));

// Gestionnaire d'erreurs final : toujours du JSON { error }, jamais de stack trace
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Fichier trop volumineux (10 Mo maximum)' });
  if (err.message === 'Type de fichier non autorisé') return res.status(415).json({ error: err.message });
  if (err.name === 'MulterError') return res.status(400).json({ error: 'Envoi de fichier invalide' });
  console.error('Erreur non gérée:', err);
  res.status(500).json({ error: 'Erreur serveur' });
});

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
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    socket.userId = decoded.userId;
    next();
  } catch (err) { next(new Error('Token invalide ou expiré')); }
});

// ================= HELPERS D'AUTORISATION =================
const MAX_MESSAGE_LENGTH = 4000;

// Renvoie un entier > 0, ou null (jamais de NaN, négatif, texte...)
const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Nom de room = clé de conversation d'un DM (même format que le frontend)
const dmRoom = (a, b) => 'dm_' + Math.min(a, b) + '_' + Math.max(a, b);

async function isMember(userId, groupeId) {
  const r = await pool.query(
    'SELECT 1 FROM groupe_users WHERE groupe_id = $1 AND user_id = $2', [groupeId, userId]
  );
  return r.rows.length > 0;
}

async function areFriends(a, b) {
  const r = await pool.query(
    `SELECT 1 FROM friendships WHERE statut = 'accepted'
     AND ((demandeur_id = $1 AND receveur_id = $2) OR (demandeur_id = $2 AND receveur_id = $1))`,
    [a, b]
  );
  return r.rows.length > 0;
}

// Contenu d'un nouveau message : absent, ou texte de taille raisonnable
const validContent = (c) => c == null || (typeof c === 'string' && c.length <= MAX_MESSAGE_LENGTH);
// Contenu d'une édition : texte non vide
const validEdit = (c) => typeof c === 'string' && c.trim().length > 0 && c.length <= MAX_MESSAGE_LENGTH;
// Pièce jointe : uniquement un fichier uploadé chez nous (pas d'URL externe)
const validAttachment = (u) =>
  u == null || (typeof u === 'string' && /^\/uploads\/[^/\\?#]+$/.test(u) && !u.includes('..'));

// Room d'un message si l'utilisateur y a accès, sinon null
async function messageRoom(userId, messageId, type) {
  if (!messageId) return null;
  if (type === 'groupe') {
    const r = await pool.query(
      `SELECT m.groupe_id FROM messages m
       JOIN groupe_users gu ON gu.groupe_id = m.groupe_id AND gu.user_id = $2
       WHERE m.id = $1`,
      [messageId, userId]
    );
    return r.rows[0] ? 'groupe_' + r.rows[0].groupe_id : null;
  }
  if (type === 'prive') {
    const r = await pool.query(
      `SELECT sender_id, receveur_id FROM messages_prives
       WHERE id = $1 AND (sender_id = $2 OR receveur_id = $2)`,
      [messageId, userId]
    );
    const row = r.rows[0];
    return row && row.sender_id && row.receveur_id ? dmRoom(row.sender_id, row.receveur_id) : null;
  }
  return null;
}

// Room d'une conversation si l'utilisateur en fait partie, sinon null
async function resolveRoom(userId, { type, groupeId, otherId }) {
  if (type === 'groupe') {
    const id = toId(groupeId);
    return id && (await isMember(userId, id)) ? 'groupe_' + id : null;
  }
  if (type === 'prive') {
    const other = toId(otherId);
    return other && (await areFriends(userId, other)) ? dmRoom(userId, other) : null;
  }
  return null;
}

io.on('connection', (socket) => {

  // Filet de sécurité : un payload malformé ou une erreur non gérée ne doit jamais faire planter le serveur
  const rawOn = socket.on.bind(socket);
  socket.on = (event, handler) => rawOn(event, async (...args) => {
    try { await handler(...args); }
    catch (err) { console.error(`Erreur socket "${event}":`, err.message); }
  });

  // Prévient les membres d'un groupe (sidebar) qu'on tape / arrête de taper
  function notifyGroupSidebar(id, event) {
    pool.query('SELECT user_id FROM groupe_users WHERE groupe_id = $1', [id])
      .then(({ rows }) => rows.forEach(({ user_id }) => {
        if (user_id !== socket.userId) io.to('user_' + user_id).emit(event, { type: 'group', id });
      }))
      .catch((err) => console.error(err.message));
  }
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
    const id = toId(groupeId);
    try {
      if (!id || !(await isMember(socket.userId, id))) return socket.emit('error', 'Non membre du groupe');
      if (!validContent(contenu) || !validAttachment(attachmentUrl)) return socket.emit('error', 'Message invalide');
      if (!contenu && !attachmentUrl) return socket.emit('error', 'Message vide');
      if (replyToId) {
        // Le message cité doit appartenir à CE groupe (sinon fuite de contenu d'un autre groupe)
        const ok = toId(replyToId) && await pool.query(
          'SELECT 1 FROM messages WHERE id = $1 AND groupe_id = $2', [replyToId, id]
        );
        if (!ok || ok.rows.length === 0) return socket.emit('error', 'Message cité invalide');
      }
      const result = await pool.query(
        `INSERT INTO messages (contenu, sender_id, groupe_id, attachment_url, reply_to_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, contenu, attachment_url, created_at, reply_to_id`,
        [contenu || null, socket.userId, id, attachmentUrl || null, replyToId || null]
      );
      const user = await pool.query('SELECT pseudo, avatar_url FROM users WHERE id = $1', [socket.userId]);
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
        sender_avatar_url: fullUrl(user.rows[0].avatar_url),
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

  socket.on('editMessage', async ({ messageId, contenu }) => {
    try {
      if (!validEdit(contenu)) return;
      const result = await pool.query(
        `UPDATE messages SET contenu = $1, edited_at = NOW()
         WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL
         RETURNING id, contenu, edited_at, groupe_id`,
        [contenu, messageId, socket.userId]
      );
      if (result.rows.length === 0) return;
      // La room vient de la base, pas du client
      const { groupe_id, ...edited } = result.rows[0];
      io.to('groupe_' + groupe_id).emit('messageEdited', edited);
    } catch (err) { console.error(err.message); }
  });

  socket.on('deleteMessage', async ({ messageId }) => {
    try {
      const result = await pool.query(
        `UPDATE messages SET deleted_at = NOW() WHERE id = $1 AND sender_id = $2 RETURNING id, groupe_id`,
        [messageId, socket.userId]
      );
      if (result.rows.length === 0) return;
      io.to('groupe_' + result.rows[0].groupe_id).emit('messageDeleted', { messageId });
    } catch (err) { console.error(err.message); }
  });

  socket.on('markReadGroupe', async ({ messageId }) => {
    try {
      // Le message doit appartenir à un groupe dont on est membre
      const m = await pool.query(
        `SELECT m.groupe_id FROM messages m
         JOIN groupe_users gu ON gu.groupe_id = m.groupe_id AND gu.user_id = $2
         WHERE m.id = $1`,
        [messageId, socket.userId]
      );
      if (m.rows.length === 0) return;
      const groupeId = m.rows[0].groupe_id;
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
    const targetId = toId(receveurId);
    try {
      if (!targetId || targetId === socket.userId || !(await areFriends(socket.userId, targetId))) {
        return socket.emit('error', 'Pas amis');
      }
      if (!validContent(contenu) || !validAttachment(attachmentUrl)) return socket.emit('error', 'Message invalide');
      if (!contenu && !attachmentUrl) return socket.emit('error', 'Message vide');
      if (replyToId) {
        // Le message cité doit appartenir à CETTE conversation
        const ok = toId(replyToId) && await pool.query(
          `SELECT 1 FROM messages_prives WHERE id = $1
           AND ((sender_id = $2 AND receveur_id = $3) OR (sender_id = $3 AND receveur_id = $2))`,
          [replyToId, socket.userId, targetId]
        );
        if (!ok || ok.rows.length === 0) return socket.emit('error', 'Message cité invalide');
      }
      const result = await pool.query(
        `INSERT INTO messages_prives (contenu, sender_id, receveur_id, attachment_url, reply_to_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, contenu, attachment_url, created_at, reply_to_id`,
        [contenu || null, socket.userId, targetId, attachmentUrl || null, replyToId || null]
      );
      const user = await pool.query('SELECT pseudo FROM users WHERE id = $1', [socket.userId]);
      const msg = result.rows[0];
      const roomId = dmRoom(socket.userId, targetId);
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

  socket.on('editDM', async ({ messageId, contenu }) => {
    try {
      if (!validEdit(contenu)) return;
      const result = await pool.query(
        `UPDATE messages_prives SET contenu = $1, edited_at = NOW()
         WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL
         RETURNING id, contenu, edited_at, receveur_id`,
        [contenu, messageId, socket.userId]
      );
      if (result.rows.length === 0) return;
      const { receveur_id, ...edited } = result.rows[0];
      if (!receveur_id) return;
      io.to(dmRoom(socket.userId, receveur_id)).emit('dmEdited', edited);
    } catch (err) { console.error(err.message); }
  });

  socket.on('deleteDM', async ({ messageId }) => {
    try {
      const result = await pool.query(
        `UPDATE messages_prives SET deleted_at = NOW() WHERE id = $1 AND sender_id = $2 RETURNING id, receveur_id`,
        [messageId, socket.userId]
      );
      if (result.rows.length === 0 || !result.rows[0].receveur_id) return;
      io.to(dmRoom(socket.userId, result.rows[0].receveur_id)).emit('dmDeleted', { messageId });
    } catch (err) { console.error(err.message); }
  });

  socket.on('markReadDM', async ({ messageId }) => {
    try {
      // Seul le destinataire du message peut le marquer comme lu
      const m = await pool.query(
        'SELECT sender_id FROM messages_prives WHERE id = $1 AND receveur_id = $2',
        [messageId, socket.userId]
      );
      if (m.rows.length === 0 || !m.rows[0].sender_id) return;
      await pool.query(
        `INSERT INTO message_prives_reads (message_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [messageId]
      );
      io.to(dmRoom(socket.userId, m.rows[0].sender_id)).emit('dmRead', { messageId, readBy: socket.userId });
    } catch (err) { console.error(err.message); }
  });

  // Marquer tous les messages d'une conv comme lus
  socket.on('openedDM', async (otherId) => {
    const targetId = toId(otherId);
    try {
      if (!targetId || !(await areFriends(socket.userId, targetId))) return;
      await pool.query(
        `UPDATE messages_prives SET is_read = true
         WHERE receveur_id = $1 AND sender_id = $2 AND is_read = false`,
        [socket.userId, targetId]
      );
      // Toujours émettre, même si rien n'a changé (markConvRead HTTP a pu passer en premier)
      io.to(dmRoom(socket.userId, targetId)).emit('allDMRead', { readBy: socket.userId });
      io.to('user_' + targetId).emit('allDMRead', { readBy: socket.userId });
    } catch (err) { console.error(err.message); }
  });

  socket.on('openedGroupe', async (groupeId) => {
    const id = toId(groupeId);
    try {
      if (!id || !(await isMember(socket.userId, id))) return;
      await pool.query(
        `INSERT INTO message_reads (message_id, user_id)
         SELECT id, $2::int FROM messages
         WHERE groupe_id = $1 AND sender_id != $2::int AND deleted_at IS NULL
         ON CONFLICT DO NOTHING`,
        [id, socket.userId]
      );
      io.to('groupe_' + id).emit('allGroupeRead', { groupeId: id, userId: socket.userId });
    } catch (err) { console.error(err.message); }
  });

  // --- RÉACTIONS ---

  socket.on('react', async ({ messageId, emoji, type }) => {
    try {
      const mid = toId(messageId);
      if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > 32) return;
      // Le message doit appartenir à une conversation dont on fait partie
      const room = await messageRoom(socket.userId, mid, type);
      if (!room) return;
      // Toggle : si même emoji déjà posé par ce user, on supprime
      const existing = await pool.query(
        `SELECT id FROM reactions WHERE message_id = $1 AND message_type = $2 AND user_id = $3 AND emoji = $4`,
        [mid, type, socket.userId, emoji]
      );
      if (existing.rows.length > 0) {
        await pool.query(`DELETE FROM reactions WHERE id = $1`, [existing.rows[0].id]);
      } else {
        await pool.query(
          `INSERT INTO reactions (message_id, message_type, user_id, emoji)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (message_id, message_type, user_id) DO UPDATE SET emoji = $4, created_at = NOW()`,
          [mid, type, socket.userId, emoji]
        );
      }
      const result = await pool.query(
        `SELECT emoji, COUNT(*) as count, BOOL_OR(user_id = $2) as reacted_by_me
         FROM reactions WHERE message_id = $1 AND message_type = $3
         GROUP BY emoji`,
        [mid, socket.userId, type]
      );
      io.to(room).emit('reactionUpdated', { messageId: mid, reactions: result.rows });
    } catch (err) { console.error(err.message); }
  });

  // --- ÉPINGLÉS ---

  socket.on('pinMessage', async ({ messageId, type, groupeId, otherId }) => {
    try {
      const mid = toId(messageId);
      // La conversation vient du serveur (clé = nom de room), plus du client
      const conversationKey = await resolveRoom(socket.userId, { type, groupeId, otherId });
      if (!mid || !conversationKey) return;
      // Le message doit appartenir à cette conversation
      if ((await messageRoom(socket.userId, mid, type)) !== conversationKey) return;
      // Un seul message épinglé par conversation : on remplace
      await pool.query(
        `DELETE FROM pinned_messages WHERE conversation_key = $1`, [conversationKey]
      );
      await pool.query(
        `INSERT INTO pinned_messages (message_id, message_type, conversation_key, pinned_by)
         VALUES ($1, $2, $3, $4)`,
        [mid, type, conversationKey, socket.userId]
      );
      // Charger le message complet pour l'émettre
      let msg;
      if (type === 'groupe') {
        const r = await pool.query(
          `SELECT m.*, COALESCE(u.pseudo, '[Utilisateur supprimé]') AS sender FROM messages m
           LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
          [mid]
        );
        msg = r.rows[0];
      } else {
        const r = await pool.query(
          `SELECT mp.*, COALESCE(u.pseudo, '[Utilisateur supprimé]') AS sender FROM messages_prives mp
           LEFT JOIN users u ON u.id = mp.sender_id WHERE mp.id = $1`,
          [mid]
        );
        msg = r.rows[0];
      }
      io.to(conversationKey).emit('messagePinned', { conversationKey, pinnedMsg: msg });
    } catch (err) { console.error('Erreur pinMessage:', err.message); }
  });

  socket.on('unpinMessage', async ({ type, groupeId, otherId }) => {
    try {
      const conversationKey = await resolveRoom(socket.userId, { type, groupeId, otherId });
      if (!conversationKey) return;
      await pool.query(
        `DELETE FROM pinned_messages WHERE conversation_key = $1`, [conversationKey]
      );
      io.to(conversationKey).emit('messageUnpinned', { conversationKey });
    } catch (err) { console.error('Erreur unpinMessage:', err.message); }
  });

  // --- TYPING ---
  // On n'émet que si le socket a déjà rejoint la room (joinRoom / joinDM ont vérifié les droits)

  socket.on('typing', ({ groupeId }) => {
    const id = toId(groupeId);
    if (!id || !socket.rooms.has('groupe_' + id)) return;
    socket.to('groupe_' + id).emit('userTyping', { userId: socket.userId });
    notifyGroupSidebar(id, 'sidebarTyping');
  });
  socket.on('stopTyping', ({ groupeId }) => {
    const id = toId(groupeId);
    if (!id || !socket.rooms.has('groupe_' + id)) return;
    socket.to('groupe_' + id).emit('userStopTyping', { userId: socket.userId });
    notifyGroupSidebar(id, 'sidebarStopTyping');
  });
  socket.on('typingDM', ({ otherId }) => {
    const other = toId(otherId);
    if (!other || !socket.rooms.has(dmRoom(socket.userId, other))) return;
    socket.to(dmRoom(socket.userId, other)).emit('userTypingDM', { userId: socket.userId });
    io.to('user_' + other).emit('sidebarTyping', { type: 'dm', id: socket.userId });
  });
  socket.on('stopTypingDM', ({ otherId }) => {
    const other = toId(otherId);
    if (!other || !socket.rooms.has(dmRoom(socket.userId, other))) return;
    socket.to(dmRoom(socket.userId, other)).emit('userStopTypingDM', { userId: socket.userId });
    io.to('user_' + other).emit('sidebarStopTyping', { type: 'dm', id: socket.userId });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.userId);
    io.emit('userOffline', socket.userId);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Serveur lancé sur http://localhost:' + PORT));