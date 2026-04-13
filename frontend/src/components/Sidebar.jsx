import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import AccountModal from './AccountModal';
import SettingsPanel from './SettingsPanel';
import socket from '../socket';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function TypingDots() {
  return (
    <span className="flex items-center gap-0.5 h-4">
      <style>{`
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        .typing-dot { width: 5px; height: 5px; border-radius: 50%; background: #6B7280;
          animation: typingBounce 1.2s infinite; display: inline-block; }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}


function convKeyFor(conv, userId) {
  if (conv.type === 'group') return 'groupe_' + conv.id;
  return 'dm_' + Math.min(Number(userId), Number(conv.id)) + '_' + Math.max(Number(userId), Number(conv.id));
}

export default function Sidebar({ activeConversation, onSelectConversation, refreshTrigger = 0 }) {
  const { token, pseudo, userId, avatarUrl, onlineUsers } = useAuth();

  // États Modification A
  const [me, setMe] = useState(null);
  const [showAccount, setShowAccount] = useState(false);

  // États Modification B
  const [conversations, setConversations] = useState([]);
  const [activeTab, setActiveTab] = useState('discussions'); // 'discussions' | 'amis'
  const [search, setSearch] = useState('');

  // États Modification C (Plus Menu & Groupes)
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showCreateGroupe, setShowCreateGroupe] = useState(false);
  const [showNewDM, setShowNewDM] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState([]);

  // États Amis
  const [amis, setAmis] = useState([]);
  const [demandes, setDemandes] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [friendsTab, setFriendsTab] = useState('amis'); // 'amis' | 'attente'
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchMsg, setSearchMsg] = useState('');

  const [showSettings, setShowSettings] = useState(false);
  const [typingConvs, setTypingConvs] = useState({}); // { 'group-12': timeoutId, 'dm-5': timeoutId }
  const [unreadMap, setUnreadMap] = useState({}); // { convKey: count }

  // --- Initialisation & Fetch ---

  useEffect(() => {
    // Fetch profil perso
    fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setMe);

    fetchDiscussions();
    fetchAmis();
  }, [token]);

  async function fetchDiscussions() {
    const res = await fetch(`${API}/conversations`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (Array.isArray(data)) {
      setConversations(data);
      // Sync unread counts from server (skip active conversation)
      const map = {};
      data.forEach(c => {
        const key = convKeyFor(c, userId);
        map[key] = c.unread_count || 0;
      });
      setUnreadMap(prev => {
        // Preserve 0 for active conversation (already marked read)
        const next = { ...map };
        return next;
      });
    }
  }

  async function markRead(conv) {
    const key = convKeyFor(conv, userId);
    setUnreadMap(prev => ({ ...prev, [key]: 0 }));
    try {
      await fetch(`${API}/conversations/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ convKey: key })
      });
    } catch (e) { console.error('markRead', e); }
  }

  async function fetchAmis() {
    const res = await fetch(`${API}/friendships`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setAmis(data.amis || []);
    setDemandes(data.demandes || []);
  }

  async function fetchPending() {
    const res = await fetch(`${API}/friendships/pending`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (Array.isArray(data)) setPendingRequests(data);
  }

  useEffect(() => {
    if (activeTab === 'amis' && friendsTab === 'attente') fetchPending();
  }, [activeTab, friendsTab]);

  useEffect(() => {
    if (refreshTrigger > 0) fetchDiscussions();
  }, [refreshTrigger]);

  // Auto-mark active conversation as read when it changes
  useEffect(() => {
    if (activeConversation) {
      markRead(activeConversation);
    }
  }, [activeConversation?.id, activeConversation?.type]);

  useEffect(() => {
    const delayedFetch = () => setTimeout(fetchDiscussions, 100);
    socket.on('newMessage', delayedFetch);
    socket.on('newPrivateMessage', delayedFetch);

    socket.on('friendRemoved', fetchAmis);
    socket.on('friendRemoved', fetchDiscussions);
    socket.on('friendRequestUpdated', () => { fetchAmis(); fetchPending(); fetchDiscussions(); });

    socket.on('addedToGroupe', ({ groupeId, userId: uid }) => {
      fetchDiscussions();
    });
    socket.on('removedFromGroupe', ({ groupeId, userId: uid }) => {
      if (Number(uid) === Number(userId)) fetchDiscussions();
    });
    socket.on('conversationListUpdated', fetchDiscussions);
    socket.on('groupeDeleted', fetchDiscussions);
    socket.on('groupeLeft', fetchDiscussions);

    socket.on('sidebarTyping', ({ type, id }) => {
      const key = `${type}-${id}`;
      setTypingConvs(prev => {
        if (prev[key]) clearTimeout(prev[key]);
        const timeout = setTimeout(() => {
          setTypingConvs(p => { const n = { ...p }; delete n[key]; return n; });
        }, 4000);
        return { ...prev, [key]: timeout };
      });
    });
    socket.on('sidebarStopTyping', ({ type, id }) => {
      const key = `${type}-${id}`;
      setTypingConvs(prev => {
        if (prev[key]) clearTimeout(prev[key]);
        const n = { ...prev }; delete n[key]; return n;
      });
    });

    return () => {
      socket.off('newMessage', delayedFetch);
      socket.off('newPrivateMessage', delayedFetch);
      socket.off('friendRemoved');
      socket.off('friendRequestUpdated');
      socket.off('addedToGroupe');
      socket.off('removedFromGroupe');
      socket.off('conversationListUpdated');
      socket.off('groupeDeleted');
      socket.off('groupeLeft');
      socket.off('sidebarTyping');
      socket.off('sidebarStopTyping');
    };
  }, []);

  // --- Actions Modification C ---

  async function createGroupe() {
    if (!newGroupName.trim()) return;
    await fetch(`${API}/groupes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nom: newGroupName, members: selectedFriends })
    });
    setShowCreateGroupe(false);
    setNewGroupName('');
    setSelectedFriends([]);
    fetchDiscussions();
  }

  // --- Autres Actions (Amis) ---

  async function acceptDemande(id) {
    await fetch(`${API}/friendships/${id}/accepter`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}` }
    });
    fetchAmis(); fetchDiscussions();
  }

  async function searchUsers(e) {
    e.preventDefault();
    if (!userSearch.trim()) return;
    const res = await fetch(`${API}/users?search=${encodeURIComponent(userSearch)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    setSearchResults(await res.json());
  }

  async function addFriend(userId) {
    const res = await fetch(`${API}/friendships/${userId}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setSearchMsg(res.ok ? 'Demande envoyée !' : (data.error || 'Erreur'));
    setSearchResults([]); setUserSearch('');
    fetchPending();
    if (res.ok) setFriendsTab('attente');
    setTimeout(() => setSearchMsg(''), 3000);
  }

  // --- Rendu ---

  const filteredConversations = conversations.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase())
  );

  if (showSettings) return <SettingsPanel onClose={() => setShowSettings(false)} />;

  return (
    <div className="w-80 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col h-full relative">

      {/* Modification A: Header avec Avatar */}
      <div className="px-4 py-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-white font-bold text-lg">ChatApp</h1>
          <button onClick={() => setShowAccount(true)} className="relative group">
            <img
              src={avatarUrl || '/default-avatar.png'}
              className="w-9 h-9 rounded-full object-cover border-2 border-gray-600 hover:border-blue-500 transition-colors"
              alt="Profil"
            />
            {onlineUsers.has(userId) && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-gray-900" />
            )}
          </button>
        </div>
        <input
          className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Rechercher..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Modification B: Onglets Simplifiés */}
      <div className="flex border-b border-gray-700">
        {[['discussions', 'Discussions'], ['amis', 'Amis']].map(([v, l]) => (
          <button key={v} onClick={() => setActiveTab(v)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${activeTab === v ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-200'}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'discussions' && (
          <div>
            {/* Modification C: Bouton Plus */}
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-gray-400 text-xs uppercase font-bold tracking-wider">Messages</span>
              <div className="relative">
                <button onClick={() => setShowPlusMenu(p => !p)}
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600 text-white text-lg transition-colors">
                  +
                </button>
                {showPlusMenu && (
                  <div className="absolute right-0 top-8 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 w-44 overflow-hidden">
                    <button onClick={() => { setShowPlusMenu(false); setShowCreateGroupe(true); }}
                      className="w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-700">
                      Créer un groupe
                    </button>
                    <button onClick={() => { setShowPlusMenu(false); setShowNewDM(true); }}
                      className="w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-700">
                      Nouvelle discussion
                    </button>
                  </div>
                )}
              </div>
            </div>

            {filteredConversations.map(conv => (
              <button
                key={`${conv.type}-${conv.id}`}
                onClick={() => { markRead(conv); onSelectConversation(conv); }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition-colors text-left ${activeConversation?.id === conv.id ? 'bg-gray-800' : ''
                  }`}
              >
                <div className="relative flex-shrink-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${conv.type === 'group' ? 'bg-purple-600' : 'bg-blue-600'}`}>
                    {conv.type === 'group' ? '#' : (conv.name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  {conv.type === 'dm' && onlineUsers.has(Number(conv.id)) && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-900" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <span className={`text-sm truncate ${unreadMap[convKeyFor(conv, userId)] > 0 ? 'text-white font-bold' : 'text-white font-semibold'}`}>{conv.name}</span>
                    <span className="text-gray-500 text-xs flex-shrink-0 ml-1">
                      {conv.last_message_at && new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mt-0.5">
                    {typingConvs[`${conv.type}-${conv.id}`]
                      ? <TypingDots />
                      : <p className={`text-xs truncate ${unreadMap[convKeyFor(conv, userId)] > 0 ? 'text-gray-300' : 'text-gray-500'}`}>
                          {conv.last_attachment && !conv.last_message
                            ? '🖼 Image'
                            : (conv.last_message || 'Aucun message')
                          }
                        </p>
                    }
                    {unreadMap[convKeyFor(conv, userId)] > 0 && (
                      <span className="flex-shrink-0 ml-2 min-w-[20px] h-5 px-1.5 rounded-full bg-green-500 text-white text-[11px] font-bold flex items-center justify-center leading-none">
                        {unreadMap[convKeyFor(conv, userId)] > 99 ? '99+' : unreadMap[convKeyFor(conv, userId)]}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Section Amis (Logique existante adaptée) */}
        {activeTab === 'amis' && (
          <div className="p-4 space-y-4">
            <form onSubmit={searchUsers} className="flex gap-2">
              <input className="flex-1 bg-gray-800 text-white rounded-lg px-3 py-2 text-sm outline-none"
                placeholder="Chercher un utilisateur..." value={userSearch}
                onChange={e => { setUserSearch(e.target.value); setSearchResults([]); setSearchMsg(''); }} />
              <button className="bg-blue-600 p-2 rounded-lg">🔍</button>
            </form>

            {searchMsg && <p className="text-xs text-center text-green-400">{searchMsg}</p>}
            {searchResults.length > 0 && (
              <div className="space-y-1">
                {searchResults.map(u => (
                  <div key={u.id} className="flex items-center justify-between p-2 bg-gray-800 rounded-lg">
                    <span className="text-white text-sm">{u.pseudo}</span>
                    <button onClick={() => addFriend(u.id)}
                      className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded transition">
                      Ajouter
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex border-b border-gray-800">
              <button onClick={() => setFriendsTab('amis')} className={`flex-1 py-1 text-xs ${friendsTab === 'amis' ? 'text-blue-400 border-b border-blue-400' : 'text-gray-500'}`}>Amis</button>
              <button onClick={() => setFriendsTab('attente')} className={`flex-1 py-1 text-xs ${friendsTab === 'attente' ? 'text-blue-400 border-b border-blue-400' : 'text-gray-500'}`}>Attente</button>
            </div>

            {friendsTab === 'amis' && amis.map(a => (
              <button key={a.user_id} onClick={() => onSelectConversation({ type: 'dm', id: a.user_id, name: a.pseudo })}
                className="w-full flex items-center gap-3 p-2 hover:bg-gray-800 rounded-lg transition-colors">
                <img src={a.avatar_url || '/default-avatar.png'} className="w-8 h-8 rounded-full" />
                <span className="text-white text-sm">{a.pseudo}</span>
              </button>
            ))}

            {friendsTab === 'attente' && (
              <div className="space-y-3">
                {/* Invitations reçues */}
                {demandes.length > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs uppercase font-bold mb-1">Reçues</p>
                    {demandes.map(r => (
                      <div key={r.id} className="flex items-center justify-between p-2 bg-gray-800 rounded-lg mb-1">
                        <span className="text-white text-sm">{r.pseudo}</span>
                        <div className="flex gap-1">
                          <button onClick={async () => {
                            await fetch(`${API}/friendships/${r.id}/accepter`, {
                              method: 'PATCH', headers: { Authorization: `Bearer ${token}` }
                            });
                            fetchAmis(); fetchDiscussions(); fetchPending();
                          }} className="text-xs bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded transition">
                            ✓
                          </button>
                          <button onClick={async () => {
                            await fetch(`${API}/friendships/${r.id}/decline`, {
                              method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
                            });
                            fetchAmis(); fetchPending();
                          }} className="text-xs bg-red-800 hover:bg-red-700 text-white px-2 py-1 rounded transition">
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Invitations envoyées */}
                {pendingRequests.length > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs uppercase font-bold mb-1">Envoyées</p>
                    {pendingRequests.map(r => (
                      <div key={r.id} className="flex items-center justify-between p-2 bg-gray-800 rounded-lg mb-1">
                        <span className="text-white text-sm">{r.pseudo}</span>
                        <button onClick={async () => {
                          await fetch(`${API}/friendships/${r.id}/cancel`, {
                            method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
                          });
                          fetchPending();
                        }} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-800 hover:border-red-600 transition">
                          Annuler
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {demandes.length === 0 && pendingRequests.length === 0 && (
                  <p className="text-gray-500 text-xs text-center">Aucune demande en attente</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAUX MODIFICATION C */}
      {showCreateGroupe && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl p-5 w-full max-w-sm space-y-3 border border-gray-700">
            <h3 className="text-white font-semibold">Créer un groupe</h3>
            <input placeholder="Nom du groupe" value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm outline-none border border-gray-700 focus:border-blue-500" />
            <p className="text-gray-400 text-xs font-bold uppercase">Ajouter des amis :</p>
            <div className="max-h-40 overflow-y-auto space-y-2">
              {amis.map(f => (
                <label key={f.user_id} className="flex items-center justify-between p-2 hover:bg-gray-800 rounded cursor-pointer">
                  <span className="text-white text-sm">{f.pseudo}</span>
                  <input type="checkbox" checked={selectedFriends.includes(f.user_id)}
                    onChange={e => setSelectedFriends(prev =>
                      e.target.checked ? [...prev, f.user_id] : prev.filter(id => id !== f.user_id)
                    )} className="w-4 h-4 accent-blue-500" />
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowCreateGroupe(false)}
                className="flex-1 py-2 text-sm text-gray-400 bg-gray-800 rounded-lg hover:bg-gray-700">Annuler</button>
              <button onClick={createGroupe}
                className="flex-1 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-500">Créer</button>
            </div>
          </div>
        </div>
      )}

      {showNewDM && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl p-5 w-full max-w-sm space-y-3 border border-gray-700">
            <h3 className="text-white font-semibold">Nouvelle discussion</h3>
            <p className="text-gray-400 text-xs font-bold uppercase">Choisir un ami :</p>
            <div className="max-h-60 overflow-y-auto">
              {amis.map(f => (
                <button key={f.user_id}
                  onClick={() => { onSelectConversation({ type: 'dm', id: f.user_id, name: f.pseudo }); setShowNewDM(false); }}
                  className="w-full text-left flex items-center gap-3 p-3 rounded-lg hover:bg-gray-800 transition-colors">
                  <div className="relative">
                    <img src={f.avatar_url || '/default-avatar.png'} className="w-10 h-10 rounded-full object-cover" />
                    {onlineUsers.has(f.user_id) && (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-gray-900" />
                    )}
                  </div>
                  <span className="text-white text-sm font-medium">{f.pseudo}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setShowNewDM(false)}
              className="w-full py-2 text-sm text-gray-400 bg-gray-800 rounded-lg hover:bg-gray-700">Fermer</button>
          </div>
        </div>
      )}

      {showAccount && <AccountModal onClose={() => setShowAccount(false)} onOpenSettings={() => { setShowAccount(false); setShowSettings(true); }} />}
    </div>
  );
}