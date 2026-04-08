import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Amis() {
  const { token, pseudo, logout } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [resultats, setResultats] = useState([]);
  const [amis, setAmis] = useState([]);
  const [demandes, setDemandes] = useState([]);
  const [message, setMessage] = useState('');

  async function fetchAmis() {
    const res = await fetch(`${API}/friendships`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setAmis(data.amis || []);
    setDemandes(data.demandes || []);
  }

  useEffect(() => { fetchAmis(); }, []);

  async function rechercherUsers(e) {
    e.preventDefault();
    if (!search.trim()) return;
    const res = await fetch(`${API}/users?search=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setResultats(data);
  }

  async function envoyerDemande(userId) {
    const res = await fetch(`${API}/friendships/${userId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) return setMessage(data.error);
    setMessage('Demande envoyée !');
    setResultats([]);
    setSearch('');
  }

  async function accepterDemande(friendshipId) {
    await fetch(`${API}/friendships/${friendshipId}/accepter`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchAmis();
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/groupes')} className="text-gray-400 hover:text-white transition">← Groupes</button>
          <h1 className="text-lg font-bold">Amis</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">@{pseudo}</span>
          <button onClick={logout} className="text-sm text-red-400 hover:text-red-300">Déconnexion</button>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8 flex flex-col gap-8">

        {/* Rechercher un utilisateur */}
        <section>
          <h2 className="text-gray-400 text-sm font-semibold uppercase mb-3">Ajouter un ami</h2>
          <form onSubmit={rechercherUsers} className="flex gap-2 mb-3">
            <input
              className="flex-1 bg-gray-800 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Rechercher un pseudo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 rounded-lg font-semibold transition">
              Chercher
            </button>
          </form>
          {message && <p className="text-green-400 text-sm mb-2">{message}</p>}
          <div className="flex flex-col gap-2">
            {resultats.map(u => (
              <div key={u.id} className="flex items-center justify-between bg-gray-900 rounded-xl px-5 py-3">
                <span>@{u.pseudo}</span>
                <button
                  onClick={() => envoyerDemande(u.id)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-700 hover:border-indigo-500 px-3 py-1 rounded-lg transition"
                >
                  Ajouter
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Demandes reçues */}
        {demandes.length > 0 && (
          <section>
            <h2 className="text-gray-400 text-sm font-semibold uppercase mb-3">
              Demandes reçues ({demandes.length})
            </h2>
            <div className="flex flex-col gap-2">
              {demandes.map(d => (
                <div key={d.id} className="flex items-center justify-between bg-gray-900 rounded-xl px-5 py-3">
                  <span>@{d.pseudo}</span>
                  <button
                    onClick={() => accepterDemande(d.id)}
                    className="text-xs text-green-400 hover:text-green-300 border border-green-700 hover:border-green-500 px-3 py-1 rounded-lg transition"
                  >
                    Accepter
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Liste des amis */}
        <section>
          <h2 className="text-gray-400 text-sm font-semibold uppercase mb-3">Mes amis</h2>
          <div className="flex flex-col gap-2">
            {amis.map(a => (
              <div
                key={a.user_id}
                className="flex items-center justify-between bg-gray-900 rounded-xl px-5 py-3 hover:bg-gray-800 transition cursor-pointer"
                onClick={() => navigate(`/dm/${a.user_id}`)}
              >
                <span>@{a.pseudo}</span>
                <span className="text-xs text-indigo-400">Message →</span>
              </div>
            ))}
            {amis.length === 0 && (
              <p className="text-gray-600 text-sm text-center py-8">Aucun ami pour l'instant.</p>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
