import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import socket from '../socket';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Chat() {
  const { id } = useParams();
  const groupeId = parseInt(id);
  const { token, pseudo } = useAuth();
  const navigate = useNavigate();

  const [messages, setMessages] = useState([]);
  const [contenu, setContenu] = useState('');
  const [nomGroupe, setNomGroupe] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const bottomRef = useRef(null);

  // Charger le nom du groupe + historique
  useEffect(() => {
    async function load() {
      const [groupesRes, messagesRes] = await Promise.all([
        fetch(`${API}/groupes`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/groupes/${groupeId}/messages`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      const groupes = await groupesRes.json();
      const msgs = await messagesRes.json();

      const groupe = groupes.find(g => g.id === groupeId);
      if (groupe) setNomGroupe(groupe.nom);

      if (Array.isArray(msgs)) setMessages(msgs);
    }
    load();
  }, [groupeId]);

  // Socket.io
  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.emit('joinRoom', groupeId);
    setConnected(true);

    socket.on('newMessage', (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    return () => {
      socket.emit('leaveRoom', groupeId);
      socket.off('newMessage');
      socket.off('connect');
      socket.off('disconnect');
    };
  }, [groupeId]);

  // Scroll automatique vers le bas
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function sendMessage(e) {
    e.preventDefault();
    if (!contenu.trim()) return;
    socket.emit('sendMessage', { groupeId, contenu });
    setContenu('');
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-gray-900 border-b border-gray-800">
        <button onClick={() => navigate('/groupes')} className="text-gray-400 hover:text-white transition text-lg">
          ←
        </button>
        <div className="flex-1">
          <h1 className="font-bold"># {nomGroupe}</h1>
          <p className={`text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
            {connected ? 'Connecté' : 'Déconnecté'}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
        {messages.map((msg, i) => {
          const isMe = msg.sender === pseudo;
          return (
            <div key={msg.id ?? i} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              {!isMe && <span className="text-xs text-gray-500 mb-1">@{msg.sender}</span>}
              <div className={`px-4 py-2 rounded-2xl max-w-xs lg:max-w-md text-sm ${
                isMe ? 'bg-indigo-600 rounded-br-sm' : 'bg-gray-800 rounded-bl-sm'
              }`}>
                {msg.contenu}
              </div>
              <span className="text-xs text-gray-600 mt-1">
                {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="flex gap-3 px-5 py-4 bg-gray-900 border-t border-gray-800">
        <input
          className="flex-1 bg-gray-800 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
          placeholder="Écrire un message..."
          value={contenu}
          onChange={e => setContenu(e.target.value)}
        />
        <button
          type="submit"
          className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 rounded-xl font-semibold transition text-sm"
        >
          Envoyer
        </button>
      </form>
    </div>
  );
}
