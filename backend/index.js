const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const groupesRoutes = require('./routes/groupes');
const messagesRoutes = require('./routes/messages');
const authMiddleware = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json());

// routes
app.use('/auth', authRoutes);
app.use('/groupes', groupesRoutes);
app.use('/groupes/:id/messages', messagesRoutes);

app.get('/', (req, res) => res.json({ message: 'API OK' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));


// route de test
app.get('/me', authMiddleware, async (req, res) => {
  const result = await pool.query('SELECT id, pseudo, created_at FROM users WHERE id = $1', [req.userId]);
  res.json(result.rows[0]);
});