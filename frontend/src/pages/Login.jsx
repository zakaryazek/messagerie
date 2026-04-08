import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Login() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [pseudo, setPseudo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pseudo, password })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Une erreur est survenue');
        return;
      }

      if (mode === 'register') {
        // Après inscription, on connecte directement
        setMode('login');
        const loginRes = await fetch(`${API}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pseudo, password })
        });
        const loginData = await loginRes.json();
        login(loginData.token, loginData.pseudo);
      } else {
        login(data.token, data.pseudo);
      }

      navigate('/groupes');
    } catch (err) {
      setError('Impossible de contacter le serveur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-white mb-1">Messagerie</h1>
        <p className="text-gray-400 text-sm mb-6">
          {mode === 'login' ? 'Connexion à votre compte' : 'Créer un compte'}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Pseudo"
            value={pseudo}
            onChange={e => setPseudo(e.target.value)}
            required
          />
          <input
            className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 transition"
          >
            {loading ? '...' : mode === 'login' ? 'Se connecter' : "S'inscrire"}
          </button>
        </form>

        <p className="text-gray-500 text-sm mt-4 text-center">
          {mode === 'login' ? 'Pas encore de compte ?' : 'Déjà un compte ?'}{' '}
          <button
            className="text-indigo-400 hover:underline"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
          >
            {mode === 'login' ? "S'inscrire" : 'Se connecter'}
          </button>
        </p>
      </div>
    </div>
  );
}
