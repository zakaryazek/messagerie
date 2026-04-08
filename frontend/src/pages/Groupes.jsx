import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Groupes() {
  const { token, pseudo, logout } = useAuth();
  const [groupes, setGroupes] = useState([]);
  const [nom, setNom] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function fetchGroupes() {
    const res = await fetch(`${API}/groupes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setGroupes(data);
  }

  useEffect(() => { fetchGroupes(); }, []);

  async function creerGroupe(e) {
    e.preventDefault();
    setError('');
    const res = await fetch(`${API}/groupes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nom })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setNom('');
    fetchGroupes();
  }

  async function rejoindre(id) {
    const res = await fetch(`${API}/groupes/${id}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) fetchGroupes();
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-800">
        <h1 className="text-lg font-bold">Messagerie</h1>
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/amis')} className="text-sm text-indigo-400 hover:text-indigo-300">
            Amis
          </button>
          <span className="text-gray-400 text-sm">@{pseudo}</span>
          <button onClick={logout} className="text-sm text-red-400 hover:text-red-300">
            Déconnexion
          </button>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8">
        {/* Créer un groupe */}
        <form onSubmit={creerGroupe} className="flex gap-2 mb-8">
          <input
            className="flex-1 bg-gray-800 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Nom du groupe..."
            value={nom}
            onChange={e => setNom(e.target.value)}
            required
          />
          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 rounded-lg font-semibold transition"
          >
            Créer
          </button>
        </form>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

        {/* Liste des groupes */}
        <h2 className="text-gray-400 text-sm font-semibold uppercase mb-3">Groupes disponibles</h2>
        <div className="flex flex-col gap-3">
          {groupes.map(g => (
            <div
              key={g.id}
              className="flex items-center justify-between bg-gray-900 rounded-xl px-5 py-4 hover:bg-gray-800 transition cursor-pointer"
              onClick={() => navigate(`/groupes/${g.id}`)}
            >
              <div>
                <p className="font-semibold">{g.nom}</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  Créé par @{g.created_by} · {g.membres} membre{g.membres > 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); rejoindre(g.id); }}
                className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-700 hover:border-indigo-500 px-3 py-1 rounded-lg transition"
              >
                Rejoindre
              </button>
            </div>
          ))}
          {groupes.length === 0 && (
            <p className="text-gray-600 text-sm text-center py-8">Aucun groupe pour l'instant.</p>
          )}
        </div>
      </div>
    </div>
  );
}
