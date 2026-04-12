import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const token = localStorage.getItem('token');

const socket = io(URL, {
  autoConnect: !!token,
  auth: { token: token || '' }
});

export default socket;