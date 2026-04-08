import { createContext, useContext, useState } from 'react';
import socket from '../socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [pseudo, setPseudo] = useState(localStorage.getItem('pseudo') || null);

  function login(newToken, newPseudo) {
    localStorage.setItem('token', newToken);
    localStorage.setItem('pseudo', newPseudo);
    setToken(newToken);
    setPseudo(newPseudo);

    // Connecter le socket avec le nouveau token
    socket.auth = { token: newToken };
    socket.connect();
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('pseudo');
    setToken(null);
    setPseudo(null);
    socket.disconnect();
  }

  return (
    <AuthContext.Provider value={{ token, pseudo, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
