import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// L'instance est créée sans connexion automatique
// On la connecte manuellement une fois le token disponible
const socket = io(URL, {
  autoConnect: false,
  auth: {
    token: localStorage.getItem('token') || ''
  }
});

export default socket;
