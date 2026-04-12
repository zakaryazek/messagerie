import { useState } from 'react';
import socket from '../socket';

const EMOJIS = ['👍','❤️','😂','😮','😢','🔥'];

export default function MessageItem({ msg, conversation, currentUserId, onReply, onEdit, onPin, bubbleColor }) {
  const [hovered, setHovered] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const isOwn = Number(msg.sender_id) === Number(currentUserId);
  const isDeleted = !!msg.deleted_at;

  function handleDelete() {
    if (conversation.type === 'group') {
      socket.emit('deleteMessage', { messageId: msg.id, groupeId: conversation.id });
    } else {
      socket.emit('deleteDM', { messageId: msg.id, otherId: conversation.id });
    }
  }

  function handleReact(emoji) {
    socket.emit('react', {
      messageId: msg.id,
      emoji,
      type: conversation.type === 'group' ? 'groupe' : 'prive',
      groupeId: conversation.type === 'group' ? conversation.id : undefined,
      otherId: conversation.type !== 'group' ? conversation.id : undefined,
    });
    setShowEmojis(false);
  }

  return (
    <div
      className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} mb-2`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowEmojis(false); }}
    >
      {/* Message auquel on répond */}
      {msg.reply_to && (
        <div className="text-xs text-gray-400 bg-gray-800 rounded px-2 py-1 mb-1 max-w-xs truncate cursor-pointer"
          onClick={() => document.getElementById('msg-' + msg.reply_to.id)?.scrollIntoView({ behavior: 'smooth' })}>
          ↩ {msg.reply_to.sender} : {msg.reply_to.contenu}
        </div>
      )}

      {/* Wrapper bulle + menu côte à côte */}
      <div className={`flex items-center gap-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>

        {/* Bulle */}
        <div
          id={'msg-' + msg.id}
          className={`relative max-w-xs lg:max-w-md px-3 py-2 rounded-2xl text-sm text-white ${isDeleted ? 'opacity-40 italic' : ''}`}
          style={{ backgroundColor: bubbleColor }}
        >
          {!isOwn && !isDeleted && (
            <p className="text-xs text-blue-300 font-semibold mb-0.5">{msg.sender}</p>
          )}
          {isDeleted
            ? <span>Message supprimé</span>
            : <span style={{ whiteSpace: 'pre-wrap' }}>{msg.contenu}</span>
          }
          {msg.edited_at && !isDeleted && (
            <span className="text-xs text-gray-300 ml-1">(modifié)</span>
          )}
          {msg.attachment_url && !isDeleted && (
            <img src={msg.attachment_url} alt="pj" className="mt-1 max-w-full rounded-lg" />
          )}
        </div>

        {/* Menu hover — aligné à côté de la bulle */}
        {hovered && !isDeleted && (
          <div className="flex items-center gap-1 bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 shadow-lg z-10 flex-shrink-0">
            {/* Réagir */}
            <div className="relative">
              <button onClick={() => setShowEmojis(p => !p)} className="text-base hover:scale-125 transition-transform">😊</button>
              {showEmojis && (
                <div className={`absolute bottom-8 flex gap-1 bg-gray-900 border border-gray-600 rounded-lg p-1 z-20 ${isOwn ? 'right-0' : 'left-0'}`}>
                  {EMOJIS.map(e => (
                    <button key={e} onClick={() => handleReact(e)} className="text-lg hover:scale-125 transition-transform">{e}</button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => onReply(msg)} className="text-gray-300 hover:text-white text-xs px-1">↩</button>
            <button onClick={() => onPin(msg)} className="text-gray-300 hover:text-white text-xs px-1">📌</button>
            {isOwn && (
              <button onClick={() => onEdit(msg)} className="text-gray-300 hover:text-white text-xs px-1">✏️</button>
            )}
            {isOwn && (
              <button onClick={handleDelete} className="text-red-400 hover:text-red-300 text-xs px-1">🗑</button>
            )}
          </div>
        )}
      </div>

      {/* Réactions */}
      {msg.reactions?.length > 0 && (
        <div className="flex gap-1 mt-0.5 flex-wrap">
          {msg.reactions.map(r => (
            <button key={r.emoji} onClick={() => handleReact(r.emoji)}
              className={`text-xs px-1.5 py-0.5 rounded-full border
                ${r.reacted_by_me ? 'border-blue-400 bg-blue-900' : 'border-gray-600 bg-gray-800'}`}>
              {r.emoji} {r.count}
            </button>
          ))}
        </div>
      )}

      {/* Vu */}
      {isOwn && !isDeleted && (
        <span className="text-xs text-gray-400 mt-0.5">
          {conversation.type !== 'group'
            ? (msg.is_read ? '✓✓ Vu' : '✓')
            : msg.readers?.length > 0 ? `Vu par ${msg.readers.join(', ')}` : null
          }
        </span>
      )}
    </div>
  );
}