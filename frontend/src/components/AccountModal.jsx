import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function AccountModal({ onClose, onOpenSettings }) {
  const { token, pseudo, email, avatarUrl, updateProfile, logout } = useAuth();
  const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  const [tab, setTab] = useState('profil');
  const [form, setForm] = useState({ pseudo: '', email: '', currentPassword: '', newPassword: '' });
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system');
  const [sound, setSound] = useState(localStorage.getItem('sound') !== 'false');
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('success'); // 'success' | 'error'
  const [localAvatar, setLocalAvatar] = useState(null); // preview locale

  function showMsg(text, type = 'success') {
    setMsg(text); setMsgType(type);
    setTimeout(() => setMsg(''), 3000);
  }

  async function applyTheme(t) {
    setTheme(t);
    localStorage.setItem('theme', t);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = t === 'dark' || (t === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
    // Sauvegarder en BDD
    await fetch(`${API}/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ theme: t })
    });
    updateProfile({ theme: t });
  }

  function toggleSound(v) {
    setSound(v);
    localStorage.setItem('sound', String(v));
  }

  async function handleAvatarChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!data.url) return showMsg('Erreur upload', 'error');

    // Sauvegarder l'URL relative en BDD, le backend la retournera préfixée
    const patchRes = await fetch(`${API}/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ avatar_url: data.url })
    });
    const patchData = await patchRes.json();
    if (patchRes.ok && patchData.avatar_url) {
      setLocalAvatar(patchData.avatar_url);
      updateProfile({ avatarUrl: patchData.avatar_url });
      showMsg('Photo mise à jour');
    } else {
      showMsg(patchData.error || 'Erreur', 'error');
    }
  }

  async function handleSave() {
    const body = {};
    if (form.pseudo.trim()) body.pseudo = form.pseudo.trim();
    if (form.email.trim()) body.email = form.email.trim();
    if (form.newPassword) {
      body.currentPassword = form.currentPassword;
      body.newPassword = form.newPassword;
    }
    if (!Object.keys(body).length) return showMsg('Aucune modification', 'error');

    const res = await fetch(`${API}/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      updateProfile({ pseudo: data.pseudo, email: data.email });
      setForm({ pseudo: '', email: '', currentPassword: '', newPassword: '' });
      showMsg('Profil mis à jour');
    } else {
      showMsg(data.error || 'Erreur', 'error');
    }
  }

  async function handleDeleteAccount() {
    if (!window.confirm('Supprimer définitivement votre compte ? Cette action est irréversible.')) return;
    await fetch(`${API}/me`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    localStorage.clear();
    window.location.href = '/login';
  }

  const displayAvatar = localAvatar || avatarUrl;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-gray-900 w-96 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>

        <div className="flex justify-between items-center px-5 py-4 border-b border-gray-700">
          <h2 className="text-white font-semibold">Mon compte</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="flex border-b border-gray-700">
          {['profil', 'apparence', 'sécurité'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm capitalize ${tab === t ? 'text-white border-b-2 border-blue-500' : 'text-gray-400'}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">

          {/* PROFIL */}
          {tab === 'profil' && (
            <>
              <div className="flex flex-col items-center gap-2">
                <label className="cursor-pointer relative group">
                  <img
                    src={displayAvatar || '/default-avatar.png'}
                    className="w-20 h-20 rounded-full object-cover border-2 border-gray-600 group-hover:opacity-70 transition-opacity"
                    alt="avatar"
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 bg-black/40 rounded-full">
                    Changer
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                </label>
                <span className="text-gray-400 text-sm">{pseudo}</span>
              </div>

              <input placeholder={`Pseudo actuel : ${pseudo}`} value={form.pseudo}
                onChange={e => setForm(p => ({ ...p, pseudo: e.target.value }))}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              <input placeholder={`Email actuel : ${email || '—'}`} value={form.email} type="email"
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />

              <button onClick={handleSave}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2 text-sm transition">
                Sauvegarder
              </button>

              {msg && <p className={`text-center text-sm ${msgType === 'error' ? 'text-red-400' : 'text-green-400'}`}>{msg}</p>}

              <div className="border-t border-gray-700 pt-3">
                <button onClick={handleDeleteAccount}
                  className="w-full text-sm text-red-500 hover:text-red-400 py-1">
                  Supprimer mon compte
                </button>
              </div>
            </>
          )}

          {/* APPARENCE */}
          {tab === 'apparence' && (
            <div className="space-y-4">
              <div>
                <p className="text-gray-400 text-sm mb-2">Thème</p>
                <div className="flex gap-2">
                  {[['system', '🖥 Système'], ['light', '☀️ Clair'], ['dark', '🌙 Sombre']].map(([v, l]) => (
                    <button key={v} onClick={() => applyTheme(v)}
                      className={`flex-1 py-2 rounded-lg text-sm border transition ${theme === v ? 'border-blue-500 text-white bg-blue-900/30' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-2">Notifications sonores</p>
                <div className="flex gap-2">
                  {[[true, '🔔 Activées'], [false, '🔕 Désactivées']].map(([v, l]) => (
                    <button key={String(v)} onClick={() => toggleSound(v)}
                      className={`flex-1 py-2 rounded-lg text-sm border transition ${sound === v ? 'border-blue-500 text-white bg-blue-900/30' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {msg && <p className={`text-center text-sm ${msgType === 'error' ? 'text-red-400' : 'text-green-400'}`}>{msg}</p>}
            </div>
          )}

          {/* SÉCURITÉ */}
          {tab === 'sécurité' && (
            <>
              <input placeholder="Mot de passe actuel" type="password" value={form.currentPassword}
                onChange={e => setForm(p => ({ ...p, currentPassword: e.target.value }))}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              <input placeholder="Nouveau mot de passe" type="password" value={form.newPassword}
                onChange={e => setForm(p => ({ ...p, newPassword: e.target.value }))}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={handleSave}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2 text-sm transition">
                Changer le mot de passe
              </button>
              {msg && <p className={`text-center text-sm ${msgType === 'error' ? 'text-red-400' : 'text-green-400'}`}>{msg}</p>}
            </>
          )}

          <button onClick={logout}
            className="w-full text-sm text-gray-400 hover:text-white py-1 border-t border-gray-700 pt-3 transition">
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}