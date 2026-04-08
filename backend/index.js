const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./db');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const groupesRoutes = require('./routes/groupes');
const messagesRoutes = require('./routes/messages');
const friendshipsRoutes = require('./routes/friendships');
const usersRoutes = require('./routes/users');
const dmRoutes = require('./routes/dm');
const authMiddleware = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// Routes HTTP
app.use('/auth', authRoutes);
app.use('/groupes', groupesRoutes);
app.use('/groupes/:id/messages', messagesRoutes);
app.use('/friendships', friendshipsRoutes);
app.use('/users', usersRoutes);
app.use('/dm/:userId/messages', dmRoutes);

app.get('/', (req, res) => res.json({ message: 'API OK' }));

app.get('/me', authMiddleware, async (req, res) => {
  const result = await pool.query(
    'SELECT id, pseudo, created_at FROM users WHERE id = $1',
    [req.userId]
  );
  res.json(result.rows[0]);
});

// ─── Socket.io ────────────────────────────────────────────────────────────────

// Middleware Socket.io — vérifie le JWT à la connexion
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Token manquant'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Token invalide ou expiré'));
  }
});

io.on('connection', (socket) => {
  console.log(`Socket connecté : userId=${socket.userId}`);

  // Rejoindre la room d'un groupe
  socket.on('joinRoom', async (groupeId) => {
    // Vérifier que l'utilisateur est bien membre
    const result = await pool.query(
      'SELECT 1 FROM groupe_users WHERE groupe_id = $1 AND user_id = $2',
      [groupeId, socket.userId]
    );
    if (result.rows.length === 0) {
      return socket.emit('error', 'Vous n\'êtes pas membre de ce groupe');
    }
    socket.join(`groupe_${groupeId}`);
    console.log(`userId=${socket.userId} a rejoint la room groupe_${groupeId}`);
  });

  // Quitter la room d'un groupe
  socket.on('leaveRoom', (groupeId) => {
    socket.leave(`groupe_${groupeId}`);
    console.log(`userId=${socket.userId} a quitté la room groupe_${groupeId}`);
  });

  // Envoyer un message en temps réel
  socket.on('sendMessage', async ({ groupeId, contenu }) => {
    if (!contenu || contenu.trim() === '') {
      return socket.emit('error', 'Le contenu du message est requis');
    }

    // Vérifier membership
    const membership = await pool.query(
      'SELECT 1 FROM groupe_users WHERE groupe_id = $1 AND user_id = $2',
      [groupeId, socket.userId]
    );
    if (membership.rows.length === 0) {
      return socket.emit('error', 'Vous n\'êtes pas membre de ce groupe');
    }

    // Persister en base
    const result = await pool.query(
      `INSERT INTO messages (contenu, sender_id, groupe_id)
       VALUES ($1, $2, $3)
       RETURNING id, contenu, created_at`,
      [contenu.trim(), socket.userId, groupeId]
    );
    const message = result.rows[0];

    // Récupérer le pseudo de l'expéditeur
    const user = await pool.query(
      'SELECT pseudo FROM users WHERE id = $1',
      [socket.userId]
    );

    const payload = {
      ...message,
      sender: user.rows[0].pseudo,
      groupe_id: groupeId
    };

    // Émettre à tous les membres de la room (expéditeur inclus)
    io.to(`groupe_${groupeId}`).emit('newMessage', payload);
  });

  socket.on('disconnect', () => {
    console.log(`Socket déconnecté : userId=${socket.userId}`);
  });

  // ─── DM ───────────────────────────────────────────────────────────────────

  // Rejoindre la room DM avec un ami
  socket.on('joinDM', async (otherId) => {
    const result = await pool.query(
      `SELECT 1 FROM friendships
       WHERE statut = 'accepted'
         AND (
           (demandeur_id = $1 AND receveur_id = $2)
           OR (demandeur_id = $2 AND receveur_id = $1)
         )`,
      [socket.userId, otherId]
    );
    if (result.rows.length === 0) {
      return socket.emit('error', 'Vous n\'êtes pas amis');
    }
    const roomId = `dm_${Math.min(socket.userId, otherId)}_${Math.max(socket.userId, otherId)}`;
    socket.join(roomId);
    console.log(`userId=${socket.userId} a rejoint la room ${roomId}`);
  });

  // Quitter la room DM
  socket.on('leaveDM', (otherId) => {
    const roomId = `dm_${Math.min(socket.userId, otherId)}_${Math.max(socket.userId, otherId)}`;
    socket.leave(roomId);
  });

  // Envoyer un message privé
  socket.on('sendPrivateMessage', async ({ receveurId, contenu }) => {
    if (!contenu || contenu.trim() === '') {
      return socket.emit('error', 'Le contenu du message est requis');
    }

    const friendship = await pool.query(
      `SELECT 1 FROM friendships
       WHERE statut = 'accepted'
         AND (
           (demandeur_id = $1 AND receveur_id = $2)
           OR (demandeur_id = $2 AND receveur_id = $1)
         )`,
      [socket.userId, receveurId]
    );
    if (friendship.rows.length === 0) {
      return socket.emit('error', 'Vous n\'êtes pas amis');
    }

    const result = await pool.query(
      `INSERT INTO messages_prives (contenu, sender_id, receveur_id)
       VALUES ($1, $2, $3)
       RETURNING id, contenu, created_at`,
      [contenu.trim(), socket.userId, receveurId]
    );
    const message = result.rows[0];

    const user = await pool.query('SELECT pseudo FROM users WHERE id = $1', [socket.userId]);

    const payload = {
      ...message,
      sender: user.rows[0].pseudo,
      receveur_id: receveurId
    };

    const roomId = `dm_${Math.min(socket.userId, receveurId)}_${Math.max(socket.userId, receveurId)}`;
    io.to(roomId).emit('newPrivateMessage', payload);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));
