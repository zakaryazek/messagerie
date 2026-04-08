const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const groupesRoutes = require('./routes/groupes');
const messagesRoutes = require('./routes/messages');
const authMiddleware = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// routes
app.use('/auth', authRoutes);
app.use('/groupes', groupesRoutes);
app.use('/groupes/:id/messages', messagesRoutes);

app.get('/', (req, res) => res.json({ message: 'API OK' }));

// route de test
app.get('/me', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT id, pseudo, created_at FROM users WHERE id = $1', [req.userId]);
  res.json(result.rows[0]);
});

// socket.io
// middleware socket
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
  // rejoindre la room d'un groupe
  socket.on('joinRoom', async (groupeId) => {
    // vérifie que l'utilisateur est membre
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
 
  // quitter la room d'un groupe
  socket.on('leaveRoom', (groupeId) => {
    socket.leave(`groupe_${groupeId}`);
    console.log(`userId=${socket.userId} a quitté la room groupe_${groupeId}`);
  });
 
  // envoyer un message
  socket.on('sendMessage', async ({ groupeId, contenu }) => {
    if (!contenu || contenu.trim() === '') {
      return socket.emit('error', 'Le contenu du message est requis');
    }
 
    // vérifie que l'utilisateur est membre
    const membership = await pool.query(
      'SELECT 1 FROM groupe_users WHERE groupe_id = $1 AND user_id = $2',
      [groupeId, socket.userId]
    );
    if (membership.rows.length === 0) {
      return socket.emit('error', 'Vous n\'êtes pas membre de ce groupe');
    }
 
    // persister en base
    const result = await pool.query(
      `INSERT INTO messages (contenu, sender_id, groupe_id)
       VALUES ($1, $2, $3)
       RETURNING id, contenu, created_at`,
      [contenu.trim(), socket.userId, groupeId]
    );
    const message = result.rows[0];
 
    // récupérer le pseudo de l'expéditeur
    const user = await pool.query(
      'SELECT pseudo FROM users WHERE id = $1',
      [socket.userId]
    );
 
    const payload = {
      ...message,
      sender: user.rows[0].pseudo,
      groupe_id: groupeId
    };
 
    // émettre à tous les membres de la room (expéditeur inclus)
    io.to(`groupe_${groupeId}`).emit('newMessage', payload);
  });
 
  socket.on('disconnect', () => {
    console.log(`Socket déconnecté : userId=${socket.userId}`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));