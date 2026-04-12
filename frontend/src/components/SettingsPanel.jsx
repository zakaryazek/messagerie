import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function SettingsPanel({ onClose }) {
  const { token, pseudo, email, updateProfile } = useAuth();
  const [newPseudo, setNewPseudo] = useState(pseudo || '');
  const [newEmail, setNewEmail] = useState(email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setMessage(''); setError(''); setLoading(true);

    const body = {};
    if (newPseudo !== pseudo) body.pseudo = newPseudo;
    if (newEmail !== email) body.email = newEmail;
    if (newPassword) { body.currentPassword = currentPassword; body.newPassword = newPassword; }

    if (Object.keys(body).length === 0) {
      setError('Aucune modification détectée');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API}/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error);
      updateProfile(data.pseudo, data.email);
      setMessage('Profil mis à jour avec succès');
      setCurrentPassword(''); setNewPassword('');
    } catch {
      setError('Erreur serveur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800">
        <button onClick={onClose} className="text-gray-400 hover:text-white transition">←</button>
        <h2 className="text-white font-bold">Paramètres du compte</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <form onSubmit={handleSave} className="flex flex-col gap-5 max-w-md">

          <div>
            <label className="text-gray-400 text-xs uppercase tracking-wider block mb-1.5">Pseudo</label>
            <input
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
              value={newPseudo}
              onChange={e => setNewPseudo(e.target.value)}
            />
          </div>

          <div>
            <label className="text-gray-400 text-xs uppercase tracking-wider block mb-1.5">Email</label>
            <input
              type="email"
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
            />
          </div>

          <div className="border-t border-gray-800 pt-4">
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Changer le mot de passe</p>
            <div className="flex flex-col gap-3">
              <input
                type="password"
                placeholder="Mot de passe actuel"
                className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
              />
              <input
                type="password"
                placeholder="Nouveau mot de passe"
                className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {message && <p className="text-green-400 text-sm">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 transition"
          >
            {loading ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </form>
      </div>
    </div>
  );
}
