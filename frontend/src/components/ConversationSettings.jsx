import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import socket from '../socket';

const BUBBLE_COLORS = [
  '#3B82F6','#EF4444','#10B981','#F59E0B',
  '#8B5CF6','#EC4899','#06B6D4','#84CC16',
  '#F97316','#6366F1','#14B8A6','#E11D48'
];

const BACKGROUNDS = [
  { label: 'Défaut', value: 'default', group: 'default' },

  // Clair · Couleurs
  { label: 'Bleu clair',    value: '#BFDBFE', group: 'clair-fixe' },
  { label: 'Vert clair',    value: '#BBF7D0', group: 'clair-fixe' },
  { label: 'Rose',          value: '#FBCFE8', group: 'clair-fixe' },
  { label: 'Jaune',         value: '#FDE68A', group: 'clair-fixe' },
  { label: 'Violet clair',  value: '#DDD6FE', group: 'clair-fixe' },
  { label: 'Pêche',         value: '#FED7AA', group: 'clair-fixe' },
  { label: 'Turquoise',     value: '#99F6E4', group: 'clair-fixe' },
  { label: 'Rouge pâle',    value: '#FECACA', group: 'clair-fixe' },

  // Clair · Dégradés
  { label: 'Aurore',         value: 'linear-gradient(135deg,#fce4ec,#e3f2fd)',          group: 'clair-deg' },
  { label: 'Printemps',      value: 'linear-gradient(135deg,#d1fae5,#e0f2fe)',           group: 'clair-deg' },
  { label: 'Coucher soleil', value: 'linear-gradient(135deg,#fff3e0,#fce4ec)',           group: 'clair-deg' },
  { label: 'Coton candy',    value: 'linear-gradient(135deg,#fce4ec,#f3e5f5)',           group: 'clair-deg' },
  { label: 'Miel',           value: 'linear-gradient(135deg,#fffde7,#fff3e0)',           group: 'clair-deg' },
  { label: 'Ciel matin',     value: 'linear-gradient(180deg,#e0f2fe,#f0fdf4)',           group: 'clair-deg' },
  { label: 'Brume lilas',    value: 'linear-gradient(135deg,#ede9fe,#fce7f3)',           group: 'clair-deg' },
  { label: 'Aquarelle',      value: 'linear-gradient(135deg,#e0f2fe,#ede9fe,#fce7f3)',  group: 'clair-deg' },

  // Sombre · Couleurs
  { label: 'Gris foncé',   value: '#1F2937', group: 'sombre-fixe' },
  { label: 'Bleu nuit',    value: '#0F172A', group: 'sombre-fixe' },
  { label: 'Violet',       value: '#2E1065', group: 'sombre-fixe' },
  { label: 'Vert forêt',   value: '#052E16', group: 'sombre-fixe' },
  { label: 'Bordeaux',     value: '#3B0A0A', group: 'sombre-fixe' },
  { label: 'Ardoise',      value: '#0F1923', group: 'sombre-fixe' },
  { label: 'Anthracite',   value: '#18181B', group: 'sombre-fixe' },
  { label: 'Chocolat',     value: '#1C1008', group: 'sombre-fixe' },

  // Sombre · Dégradés
  { label: 'Océan nuit',    value: 'linear-gradient(135deg,#1e3a5f,#0f172a)',             group: 'sombre-deg' },
  { label: 'Cosmos',        value: 'linear-gradient(135deg,#2e1065,#1e1b4b)',             group: 'sombre-deg' },
  { label: 'Jungle',        value: 'linear-gradient(135deg,#052e16,#0f172a)',             group: 'sombre-deg' },
  { label: 'Aurore boréale',value: 'linear-gradient(135deg,#042f2e,#0e7490,#1e1b4b)',    group: 'sombre-deg' },
  { label: 'Feu & braise',  value: 'linear-gradient(135deg,#1c0a0a,#7c2d12,#1c0a0a)',   group: 'sombre-deg' },
  { label: 'Galaxie',       value: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)',    group: 'sombre-deg' },
  { label: 'Crépuscule',    value: 'linear-gradient(160deg,#1a1a2e,#16213e,#0f3460)',    group: 'sombre-deg' },
  { label: 'Forêt noire',   value: 'linear-gradient(135deg,#0a0a0a,#1a2a1a)',            group: 'sombre-deg' },

  // Animés
  { label: 'Galaxie ✨', value: 'animated:galaxy',  group: 'anim', icon: '🌌', preview: 'radial-gradient(ellipse,#1a2a4a,#000005)' },
  { label: 'Aurore 🌟',  value: 'animated:aurora',  group: 'anim', icon: '🌟', preview: 'linear-gradient(135deg,#042f2e,#0d1117)' },
  { label: 'Bulles 🫧',  value: 'animated:bubbles', group: 'anim', icon: '🫧', preview: 'linear-gradient(135deg,#0f172a,#1e3a5f)' },
  { label: 'Vagues 🌊',  value: 'animated:waves',   group: 'anim', icon: '🌊', preview: 'linear-gradient(135deg,#1e3a5f,#7c3aed,#0e7490)' },
  { label: 'Coucher 🌅', value: 'animated:sunset',  group: 'anim', icon: '🌅', preview: 'linear-gradient(135deg,#ff6b6b,#feca57,#ff9ff3)' },
];

export default function ConversationSettings({ conversation, currentUserId, onClose, onDeleted, onLeft }) {
  const { token } = useAuth();
  const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
  const isGroupe = conversation.type === 'group';
  const convKey = isGroupe
  ? 'groupe_' + conversation.id
  : 'dm_' + Math.min(Number(currentUserId), Number(conversation.id)) 
  + '_' + Math.max(Number(currentUserId), Number(conversation.id));

  const [members, setMembers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [bubbleColor, setBubbleColor] = useState('#3B82F6');
  const [background, setBackground] = useState('default');
  const [attachments, setAttachments] = useState([]);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [tab, setTab] = useState(isGroupe ? 'membres' : 'couleur');
  const [newAdminId, setNewAdminId] = useState(null);
  const [showAdminPicker, setShowAdminPicker] = useState(false);

  const isAdmin = isGroupe && conversation.admin_id === currentUserId;

  useEffect(() => {
    fetchSettings();
    if (isGroupe) fetchMembers();
    fetchAttachments();
    fetchFriends();
  }, []);

  async function fetchSettings() {
    try {
      const r = await fetch(`${API}/settings/bubble?key=${convKey}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await r.json();
      if (d.color) setBubbleColor(d.color);
      if (d.background) setBackground(d.background);
    } catch (err) { console.error('fetchSettings', err); }
  }

  async function fetchMembers() {
    try {
      const r = await fetch(`${API}/groupes/${conversation.id}/members`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await r.json();
      setMembers(Array.isArray(data) ? data : []);
    } catch (err) { setMembers([]); }
  }

  async function fetchFriends() {
    try {
      const r = await fetch(`${API}/friendships`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await r.json();
      setFriends(data.amis || []);
    } catch (err) { setFriends([]); }
  }

  async function fetchAttachments() {
    try {
      const endpoint = isGroupe
        ? `${API}/groupes/${conversation.id}/messages/attachments`
        : `${API}/dm/${conversation.id}/messages/attachments`;
      const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      setAttachments(Array.isArray(data) ? data : []);
    } catch (err) { setAttachments([]); }
  }

  async function saveBubbleColor(color) {
    setBubbleColor(color);
    await fetch(`${API}/settings/bubble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationKey: convKey, color })
    });
  }

  async function saveBackground(bg) {
    setBackground(bg);
    await fetch(`${API}/settings/background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationKey: convKey, background: bg })
    });
  }

  async function removeMember(userId) {
    await fetch(`${API}/groupes/${conversation.id}/members/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    setMembers(prev => prev.filter(m => m.id !== userId));
    socket.emit('memberRemoved', { groupeId: conversation.id, userId });
  }

  async function addMember(userId) {
    await fetch(`${API}/groupes/${conversation.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId })
    });
    fetchMembers();
  }

  async function leaveGroupe() {
    if (isAdmin) { setShowAdminPicker(true); return; }
    await fetch(`${API}/groupes/${conversation.id}/leave`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }
    });
    onLeft();
  }

  async function confirmLeaveWithNewAdmin() {
    if (!newAdminId) return;
    await fetch(`${API}/groupes/${conversation.id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ newAdminId })
    });
    onLeft();
  }

  async function deleteGroupe() {
    if (!window.confirm('Supprimer le groupe définitivement ?')) return;
    await fetch(`${API}/groupes/${conversation.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
    });
    onDeleted();
  }

  async function removeFriend() {
    if (!window.confirm('Supprimer cet ami ?')) return;
    await fetch(`${API}/friendships/${conversation.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
    });
    onDeleted();
  }

  const usedColors = members
    .filter(m => m.id !== currentUserId && m.bubble_color)
    .map(m => m.bubble_color);

  const tabs = isGroupe
    ? ['membres', 'ajouter', 'couleur', 'fond', 'pj', 'stats']
    : ['couleur', 'fond', 'pj', 'stats'];

  const tabLabels = {
    membres: 'Membres', ajouter: 'Ajouter', couleur: 'Bulle',
    fond: 'Fond', pj: 'Médias', stats: 'Stats'
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex justify-end" onClick={onClose}>
      <div className="w-80 bg-gray-900 h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>

        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-700">
          <h2 className="text-white font-semibold">Paramètres</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex flex-wrap gap-1 p-2 border-b border-gray-700">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-2 py-1 rounded ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}>
              {tabLabels[t]}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-4">

          {/* MEMBRES */}
          {tab === 'membres' && isGroupe && (
            <div className="space-y-2">
              {members.map(m => (
                <div key={m.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <img src={m.avatar_url || '/default-avatar.png'} className="w-8 h-8 rounded-full" />
                    <span className="text-white text-sm">{m.pseudo}</span>
                    {m.id === conversation.admin_id && (
                      <span className="text-xs text-yellow-400 bg-yellow-900/30 px-1 rounded">admin</span>
                    )}
                  </div>
                  {isAdmin && m.id !== currentUserId && (
                    <button onClick={() => removeMember(m.id)} className="text-xs text-red-400 hover:text-red-300">Retirer</button>
                  )}
                </div>
              ))}
              <div className="pt-4 space-y-2 border-t border-gray-700">
                <button onClick={leaveGroupe} className="w-full text-sm text-orange-400 hover:text-orange-300 py-1">Quitter le groupe</button>
                {isAdmin && (
                  <button onClick={deleteGroupe} className="w-full text-sm text-red-500 hover:text-red-400 py-1">Supprimer le groupe</button>
                )}
              </div>
              {showAdminPicker && (
                <div className="bg-gray-800 rounded-lg p-3 space-y-2 border border-gray-600">
                  <p className="text-sm text-white">Choisir un nouvel admin :</p>
                  {members.filter(m => m.id !== currentUserId).map(m => (
                    <div key={m.id} className="flex items-center gap-2">
                      <input type="radio" name="newAdmin" value={m.id} onChange={() => setNewAdminId(m.id)} />
                      <span className="text-white text-sm">{m.pseudo}</span>
                    </div>
                  ))}
                  <button onClick={confirmLeaveWithNewAdmin} disabled={!newAdminId}
                    className="w-full bg-blue-600 text-white text-sm py-1 rounded disabled:opacity-50">
                    Confirmer et quitter
                  </button>
                </div>
              )}
            </div>
          )}

          {/* AJOUTER MEMBRES */}
          {tab === 'ajouter' && isGroupe && (
            <div className="space-y-2">
              {members.length >= 20 && <p className="text-yellow-400 text-sm">Groupe plein (20/20)</p>}
              {friends
                .filter(f => !members.find(m => m.id === f.user_id))
                .map(f => (
                  <div key={f.user_id} className="flex items-center justify-between">
                    <span className="text-white text-sm">{f.pseudo}</span>
                    <button onClick={() => addMember(f.user_id)}
                      disabled={members.length >= 20}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40">
                      Ajouter
                    </button>
                  </div>
                ))}
            </div>
          )}

          {/* COULEUR BULLE */}
          {tab === 'couleur' && (
            <div>
              <p className="text-gray-400 text-xs mb-3">Choisir la couleur de vos bulles</p>
              <div className="grid grid-cols-6 gap-2">
                {BUBBLE_COLORS.map(c => {
                  const taken = usedColors.includes(c);
                  return (
                    <button key={c} onClick={() => !taken && saveBubbleColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-8 h-8 rounded-full border-2 transition-transform
                        ${bubbleColor === c ? 'border-white scale-110' : 'border-transparent'}
                        ${taken ? 'opacity-30 cursor-not-allowed' : 'hover:scale-110'}`}
                      title={taken ? 'Utilisée par un autre membre' : c}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* FOND */}
          {tab === 'fond' && (
            <div className="space-y-5">

              {/* Helper to render a grid of bg swatches */}
              {[
                { key: 'default',     title: null },
                { key: 'clair-fixe',  title: 'Clair — couleurs' },
                { key: 'clair-deg',   title: 'Clair — dégradés' },
                { key: 'sombre-fixe', title: 'Sombre — couleurs' },
                { key: 'sombre-deg',  title: 'Sombre — dégradés' },
              ].map(({ key, title }) => {
                const items = BACKGROUNDS.filter(b => b.group === key);
                if (!items.length) return null;
                return (
                  <div key={key}>
                    {title && (
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-2">{title}</p>
                    )}
                    <div className="grid grid-cols-4 gap-x-2 gap-y-3">
                      {items.map(bg => (
                        <div key={bg.value} className="flex flex-col items-center gap-1">
                          <button
                            onClick={() => saveBackground(bg.value)}
                            title={bg.label}
                            className={`w-full h-10 rounded-lg border-2 transition-all hover:scale-105 relative overflow-hidden
                              ${background === bg.value ? 'border-blue-400 ring-1 ring-blue-400 scale-105' : 'border-gray-700 hover:border-gray-500'}`}
                            style={{ background: bg.value === 'default' ? '#111827' : bg.value }}
                          >
                            {background === bg.value && (
                              <span className="absolute inset-0 flex items-center justify-center font-bold text-white drop-shadow text-sm">✓</span>
                            )}
                          </button>
                          <span className="text-[9px] text-gray-500 text-center leading-tight w-full" style={{ wordBreak: 'break-word' }}>{bg.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Animés */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-2">✨ Animés</p>
                <div className="grid grid-cols-4 gap-x-2 gap-y-3">
                  {BACKGROUNDS.filter(b => b.group === 'anim').map(bg => (
                    <div key={bg.value} className="flex flex-col items-center gap-1">
                      <button
                        onClick={() => saveBackground(bg.value)}
                        title={bg.label}
                        className={`w-full h-10 rounded-lg border-2 transition-all hover:scale-105 relative overflow-hidden
                          ${background === bg.value ? 'border-blue-400 ring-1 ring-blue-400 scale-105' : 'border-gray-700 hover:border-gray-500'}`}
                        style={{ background: bg.preview }}
                      >
                        <span className="absolute inset-0 flex items-center justify-center text-lg">{bg.icon}</span>
                        {background === bg.value && (
                          <span className="absolute top-0.5 right-1 text-white text-[10px] font-bold drop-shadow">✓</span>
                        )}
                      </button>
                      <span className="text-[9px] text-gray-500 text-center leading-tight w-full" style={{ wordBreak: 'break-word' }}>{bg.label}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* PIÈCES JOINTES */}
          {tab === 'pj' && (
            <div>
              <p className="text-gray-400 text-xs mb-3">Médias partagés</p>
              {attachments.length === 0
                ? <p className="text-gray-500 text-sm">Aucun média partagé</p>
                : <div className="grid grid-cols-3 gap-1">
                    {attachments.map(a => (
                      <img key={a.id} src={a.attachment_url}
                        className="w-full aspect-square object-cover rounded cursor-pointer hover:opacity-80"
                        onClick={() => setLightboxUrl(a.attachment_url)}
                      />
                    ))}
                  </div>
              }
            </div>
          )}

          {/* STATS */}
          {tab === 'stats' && (
            <div className="space-y-2 text-sm">
              {isGroupe ? (
                <>
                  <p className="text-gray-300">Créé le : <span className="text-white">
                    {conversation.created_at
                      ? new Date(conversation.created_at).toLocaleDateString('fr-FR')
                      : 'N/A'}
                  </span></p>
                  <p className="text-gray-300">Membres : <span className="text-white">{members.length}/20</span></p>
                </>
              ) : (
                <p className="text-gray-300">Amis depuis : <span className="text-white">
                  {conversation.accepted_at
                    ? new Date(conversation.accepted_at).toLocaleDateString('fr-FR')
                    : 'N/A'}
                </span></p>
              )}
            </div>
          )}

          {/* Supprimer ami */}
          {!isGroupe && (
            <div className="pt-4 border-t border-gray-700">
              <button onClick={removeFriend} className="w-full text-sm text-red-400 hover:text-red-300 py-1">
                Supprimer cet ami
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center"
          onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl" />
          <button className="absolute top-4 right-4 text-white text-3xl hover:text-gray-300">✕</button>
        </div>
      )}
    </div>
  );
}