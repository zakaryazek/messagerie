import { createContext, useContext, useState, useEffect } from 'react';
import socket from '../socket';

const AuthContext = createContext(null);

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [pseudo, setPseudo] = useState(localStorage.getItem('pseudo') || null);
  const [email, setEmail] = useState(localStorage.getItem('email') || null);
  const [userId, setUserId] = useState(
    localStorage.getItem('userId') ? Number(localStorage.getItem('userId')) : null
  );
  const [avatarUrl, setAvatarUrl] = useState(localStorage.getItem('avatarUrl') || null);
  const [onlineUsers, setOnlineUsers] = useState(new Set());

  // Resync profil depuis le serveur au démarrage (pour avoir avatar_url à jour)
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        if (data.pseudo) { localStorage.setItem('pseudo', data.pseudo); setPseudo(data.pseudo); }
        if (data.email) { localStorage.setItem('email', data.email); setEmail(data.email); }
        if (data.avatar_url) { localStorage.setItem('avatarUrl', data.avatar_url); setAvatarUrl(data.avatar_url); }
        if (data.id) { localStorage.setItem('userId', data.id); setUserId(Number(data.id)); }
        // Appliquer le thème sauvegardé en BDD
        if (data.theme) {
          localStorage.setItem('theme', data.theme);
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          const isDark = data.theme === 'dark' || (data.theme === 'system' && prefersDark);
          document.documentElement.classList.toggle('dark', isDark);
        }
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    socket.on('onlineUsers', (ids) => setOnlineUsers(new Set(ids)));
    socket.on('userOnline', (id) => setOnlineUsers(prev => new Set([...prev, id])));
    socket.on('userOffline', (id) => setOnlineUsers(prev => { const s = new Set(prev); s.delete(id); return s; }));
    return () => {
      socket.off('onlineUsers');
      socket.off('userOnline');
      socket.off('userOffline');
    };
  }, []);

  function login(newToken, newPseudo, newEmail, newUserId) {
    localStorage.setItem('token', newToken);
    localStorage.setItem('pseudo', newPseudo);
    localStorage.setItem('email', newEmail || '');
    if (newUserId) localStorage.setItem('userId', String(newUserId));
    setToken(newToken); setPseudo(newPseudo); setEmail(newEmail || '');
    if (newUserId) setUserId(Number(newUserId));
    socket.auth = { token: newToken };
    socket.connect();
  }

  function updateProfile({ pseudo: newPseudo, email: newEmail, avatarUrl: newAvatar, theme: newTheme } = {}) {
    if (newPseudo) { localStorage.setItem('pseudo', newPseudo); setPseudo(newPseudo); }
    if (newEmail) { localStorage.setItem('email', newEmail); setEmail(newEmail); }
    if (newAvatar) { localStorage.setItem('avatarUrl', newAvatar); setAvatarUrl(newAvatar); }
    if (newTheme) { localStorage.setItem('theme', newTheme); }
  }

  function logout() {
    ['token', 'pseudo', 'email', 'userId', 'avatarUrl', 'theme'].forEach(k => localStorage.removeItem(k));
    setToken(null); setPseudo(null); setEmail(null); setUserId(null); setAvatarUrl(null);
    socket.disconnect();
  }

  return (
    <AuthContext.Provider value={{ token, pseudo, email, userId, avatarUrl, onlineUsers, login, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }