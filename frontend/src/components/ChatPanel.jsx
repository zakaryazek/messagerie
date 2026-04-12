import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import socket from '../socket';
import MessageItem from './MessageItem';
import ConversationSettings from './ConversationSettings';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function ChatPanel({ conversation, onGroupDeleted }) {
  const { token, pseudo, userId } = useAuth();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreview, setPendingPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [pinnedMsg, setPinnedMsg] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [myBubbleColor, setMyBubbleColor] = useState('#3B82F6');
  const [chatBackground, setChatBackground] = useState(null);
  const [membersColors, setMembersColors] = useState({});

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeout = useRef(null);

  const isGroup = conversation?.type === 'group';

  // Clé unique de la conversation (même format que le backend)
  const convKey = conversation
    ? (isGroup ? 'groupe_' + conversation.id : 'dm_' + conversation.id)
    : null;

  async function loadMessages() {
    if (!conversation) return;
    try {
      const url = isGroup
        ? `${API}/groupes/${conversation.id}/messages`
        : `${API}/dm/${conversation.id}/messages`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (Array.isArray(data)) setMessages(data);
    } catch (err) { console.error('Erreur chargement messages', err); }
  }

  async function loadSettings() {
    if (!convKey) return;
    try {
      // Load own color + background
      const res = await fetch(`${API}/settings/bubble?key=${encodeURIComponent(convKey)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await res.json();
      if (d.color) setMyBubbleColor(d.color);
      if (d.background && d.background !== 'default') setChatBackground(d.background);
      else setChatBackground(null);

      // Load members' colors (for groups, fetch from members endpoint; for DMs fetch other user's color)
      if (isGroup) {
        const membersRes = await fetch(`${API}/groupes/${conversation.id}/members`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const membersData = await membersRes.json();
        if (Array.isArray(membersData)) {
          const colors = {};
          membersData.forEach(m => {
            if (m.bubble_color) colors[m.id] = m.bubble_color;
          });
          setMembersColors(colors);
        }
      } else {
        // DM: load the other person's bubble color
        const otherRes = await fetch(
          `${API}/settings/bubble/other?key=${encodeURIComponent(convKey)}&otherUserId=${conversation.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const otherData = await otherRes.json();
        if (otherData.color) {
          setMembersColors({ [conversation.id]: otherData.color });
        }
      }
    } catch (err) { console.error('Erreur chargement settings', err); }
  }

  async function loadPinned() {
    if (!convKey) return;
    try {
      const res = await fetch(`${API}/settings/pinned?key=${encodeURIComponent(convKey)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setPinnedMsg(data.pinnedMsg || null);
    } catch (err) { console.error('Erreur chargement épinglé', err); }
  }

  function handlePin(msg) {
    if (!conversation) return;
    const type = isGroup ? 'groupe' : 'prive';
    socket.emit('pinMessage', {
      messageId: msg.id,
      type,
      conversationKey: convKey,
      groupeId: isGroup ? conversation.id : undefined,
      otherId: !isGroup ? conversation.id : undefined,
    });
  }

  function handleUnpin() {
    if (!conversation) return;
    const type = isGroup ? 'groupe' : 'prive';
    socket.emit('unpinMessage', {
      conversationKey: convKey,
      type,
      groupeId: isGroup ? conversation.id : undefined,
      otherId: !isGroup ? conversation.id : undefined,
    });
  }

  useEffect(() => {
    if (!conversation) return;
    setMessages([]);
    setPinnedMsg(null);
    setReplyTo(null);
    setEditingMsg(null);
    setInputValue('');
    setShowSettings(false);
    setMyBubbleColor('#3B82F6');
    setChatBackground(null);
    setMembersColors({});
    
    loadMessages();

    // Notifier qu'on a ouvert la conversation
    const convId = Number(conversation.id);
    if (isGroup) socket.emit('openedGroupe', convId);
    else socket.emit('openedDM', convId);

    loadPinned();
    loadSettings();

    if (isGroup) {
      socket.emit('joinRoom', convId);
      socket.on('newMessage', (msg) => {
        if (Number(msg.groupe_id) === convId) setMessages(prev => [...prev, msg]);
      });
    } else {
      socket.emit('joinDM', convId);
      socket.on('newPrivateMessage', (msg) => {
        if (Number(msg.sender_id) === convId || Number(msg.receveur_id) === convId) {
          setMessages(prev => [...prev, msg]);
        }
      });
    }

    socket.on('messageEdited', ({ id, contenu, edited_at }) => {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, contenu, edited_at } : m));
    });
    socket.on('dmEdited', ({ id, contenu, edited_at }) => {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, contenu, edited_at } : m));
    });
    socket.on('messageDeleted', ({ messageId }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, deleted_at: true } : m));
    });
    socket.on('dmDeleted', ({ messageId }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, deleted_at: true } : m));
    });
    socket.on('reactionUpdated', ({ messageId, reactions }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    });
    socket.on('dmRead', ({ messageId }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, is_read: true } : m));
    });
    socket.on('groupeRead', ({ messageId, readers }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, readers } : m));
    });
    
    // --- Nouveaux listeners pour lecture globale ---
    socket.on('allDMRead', ({ readBy }) => {
      if (Number(readBy) !== Number(userId)) {
        setMessages(prev => prev.map(m => ({ ...m, is_read: true })));
      }
    });
    socket.on('allGroupeRead', ({ userId: uid }) => {
      // optionnel: mettre à jour les readers
    });
    // ------------------------------------------------

    socket.on('messagePinned', ({ conversationKey, pinnedMsg: msg }) => {
      if (conversationKey === convKey) setPinnedMsg(msg);
    });
    socket.on('messageUnpinned', ({ conversationKey }) => {
      if (conversationKey === convKey) setPinnedMsg(null);
    });
    socket.on('bubbleColorChanged', ({ userId: uid, color, conversationKey: ck }) => {
      if (ck !== convKey) return;
      if (Number(uid) === Number(userId)) {
        setMyBubbleColor(color);
      } else {
        setMembersColors(prev => ({ ...prev, [uid]: color }));
      }
    });
    socket.on('backgroundChanged', ({ background: bg, conversationKey: ck }) => {
      if (ck !== convKey) return;
      setChatBackground(bg === 'default' ? null : bg);
    });
    socket.on('userTyping', ({ userId: uid }) => {
      if (Number(uid) !== Number(userId)) setTypingUsers(prev => prev.includes(uid) ? prev : [...prev, uid]);
    });
    socket.on('userStopTyping', ({ userId: uid }) => {
      setTypingUsers(prev => prev.filter(id => id !== uid));
    });
    socket.on('userTypingDM', ({ userId: uid }) => {
      if (Number(uid) !== Number(userId)) setTypingUsers(prev => prev.includes(uid) ? prev : [...prev, uid]);
    });
    socket.on('userStopTypingDM', ({ userId: uid }) => {
      setTypingUsers(prev => prev.filter(id => id !== uid));
    });

    return () => {
      if (isGroup) socket.emit('leaveRoom', convId);
      else socket.emit('leaveDM', convId);
      socket.off('newMessage'); socket.off('newPrivateMessage');
      socket.off('messageEdited'); socket.off('dmEdited');
      socket.off('messageDeleted'); socket.off('dmDeleted');
      socket.off('reactionUpdated'); socket.off('dmRead'); socket.off('groupeRead');
      socket.off('messagePinned'); socket.off('messageUnpinned');
      socket.off('bubbleColorChanged'); socket.off('backgroundChanged');
      socket.off('userTyping'); socket.off('userStopTyping');
      socket.off('userTypingDM'); socket.off('userStopTypingDM');
      // Cleanup nouveaux listeners
      socket.off('allDMRead'); socket.off('allGroupeRead');
    };
  }, [conversation?.id, conversation?.type]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers]);

  const handleInputChange = (e) => {
    setInputValue(e.target.value);
    const convId = Number(conversation.id);
    if (isGroup) socket.emit('typing', { groupeId: convId });
    else socket.emit('typingDM', { otherId: convId });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      if (isGroup) socket.emit('stopTyping', { groupeId: convId });
      else socket.emit('stopTypingDM', { otherId: convId });
    }, 2000);
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() && !pendingFile) return;

    const convId = Number(conversation.id);

    if (editingMsg) {
      if (isGroup) socket.emit('editMessage', { messageId: editingMsg.id, contenu: inputValue, groupeId: convId });
      else socket.emit('editDM', { messageId: editingMsg.id, contenu: inputValue, otherId: convId });
      setEditingMsg(null);
      setInputValue('');
      return;
    }

    let attachmentUrl = null;
    if (pendingFile) {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', pendingFile);
        const res = await fetch(`${API}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        });
        const data = await res.json();
        attachmentUrl = data.url;
      } catch (err) {
        console.error('Erreur upload', err);
      } finally {
        setUploading(false);
      }
    }

    const payload = {
      contenu: inputValue.trim(),
      attachmentUrl,
      replyToId: replyTo?.id
    };

    if (isGroup) socket.emit('sendMessage', { ...payload, groupeId: convId });
    else socket.emit('sendPrivateMessage', { ...payload, receveurId: convId });

    setInputValue('');
    setReplyTo(null);
    setPendingFile(null);
    setPendingPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!conversation) return (
    <div className="flex-1 flex items-center justify-center bg-gray-950 text-gray-500">
      Sélectionne une conversation
    </div>
  );

  return (
    <div className="flex-1 flex flex-col bg-gray-950 min-w-0 relative">
      <div className="px-5 py-4 bg-gray-900 border-b border-gray-800 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold ${isGroup ? 'bg-purple-600' : 'bg-indigo-600'}`}>
            {isGroup ? '#' : conversation.name?.slice(0, 1).toUpperCase()}
          </div>
          <h2 className="text-white font-bold">{isGroup ? conversation.name : `@${conversation.name}`}</h2>
        </div>
        <button onClick={() => setShowSettings(true)}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {showSettings && (
        <ConversationSettings
          conversation={conversation}
          currentUserId={userId}
          onClose={() => setShowSettings(false)}
          onDeleted={() => { setShowSettings(false); onGroupDeleted(); }}
          onLeft={() => { setShowSettings(false); onGroupDeleted(); }}
        />
      )}

      {pinnedMsg && (
        <div className="bg-indigo-900/20 border-b border-indigo-500/30 px-4 py-2 flex justify-between items-center">
          <div className="flex items-center gap-3 cursor-pointer"
            onClick={() => document.getElementById('msg-' + pinnedMsg.id)?.scrollIntoView({ behavior: 'smooth' })}>
            <span className="text-lg">📌</span>
            <div className="text-sm truncate max-w-md">
              <p className="text-indigo-400 font-bold text-xs uppercase">Message épinglé</p>
              <p className="text-gray-300 truncate">{pinnedMsg.contenu || '📎 Pièce jointe'}</p>
            </div>
          </div>
          <button onClick={handleUnpin} className="text-gray-500 hover:text-white text-xl ml-3">✕</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col" style={chatBackground ? { background: chatBackground } : undefined}>
        {messages.map(msg => (
          <MessageItem
            key={msg.id}
            msg={msg}
            conversation={conversation}
            currentUserId={userId}
            onReply={setReplyTo}
            onEdit={(m) => { setEditingMsg(m); setInputValue(m.contenu); setReplyTo(null); }}
            onPin={handlePin}
            bubbleColor={
              Number(msg.sender_id) === Number(userId)
                ? myBubbleColor
                : (membersColors[msg.sender_id] || '#4B5563')
            }
          />
        ))}
        {typingUsers.length > 0 && (
          <div className="text-xs text-gray-500 italic mt-2 animate-pulse">
            {typingUsers.length === 1 ? 'Quelqu\'un écrit...' : 'Plusieurs personnes écrivent...'}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="bg-gray-900 border-t border-gray-800 p-4">
        {(replyTo || editingMsg) && (
          <div className="mb-3 bg-gray-800 rounded-lg p-3 flex justify-between items-center border-l-4 border-indigo-500">
            <div className="truncate">
              <p className="text-xs text-indigo-400 font-bold uppercase">
                {replyTo ? `Réponse à ${replyTo.sender}` : 'Modification du message'}
              </p>
              <p className="text-sm text-gray-400 truncate">
                {replyTo ? replyTo.contenu : editingMsg.contenu}
              </p>
            </div>
            <button onClick={() => { setReplyTo(null); setEditingMsg(null); setInputValue(''); }}
              className="text-gray-500 hover:text-white ml-4">✕</button>
          </div>
        )}

        {pendingPreview && (
          <div className="mb-3 relative inline-block">
            <img src={pendingPreview} className="h-20 w-20 object-cover rounded-lg border border-indigo-500" alt="preview" />
            <button onClick={() => { setPendingFile(null); setPendingPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
              className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">✕</button>
          </div>
        )}

        <form onSubmit={handleSend} className="flex items-end gap-2">
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*"
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) { setPendingFile(f); setPendingPreview(URL.createObjectURL(f)); }
            }} />
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-400 hover:text-white text-xl flex-shrink-0">📎</button>
          <textarea
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            rows={1}
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-sm"
            placeholder="Écrire un message..."
            style={{ maxHeight: '150px' }}
          />
          <button type="submit"
            disabled={uploading || (!inputValue.trim() && !pendingFile)}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white p-2.5 rounded-xl transition flex-shrink-0">
            {uploading ? '⏳' : editingMsg ? '✅' : '➤'}
          </button>
        </form>
      </div>
    </div>
  );
}