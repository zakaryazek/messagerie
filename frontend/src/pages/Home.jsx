import { useState, useEffect } from 'react';
import socket from '../socket';
import Sidebar from '../components/Sidebar';
import ChatPanel from '../components/ChatPanel';

export default function Home() {
  const [activeConversation, setActiveConversation] = useState(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  // Quelqu'un change la photo du groupe ouvert : l'en-tête se met à jour sans recharger
  useEffect(() => {
    const onPhoto = ({ groupeId, avatar_url }) =>
      setActiveConversation(c =>
        c && c.type === 'group' && Number(c.id) === Number(groupeId) ? { ...c, avatar_url } : c
      );
    socket.on('groupePhotoChanged', onPhoto);
    return () => socket.off('groupePhotoChanged', onPhoto);
  }, []);

  function handleGroupDeleted() {
    setActiveConversation(null);
    setSidebarRefresh(n => n + 1);
  }

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      <Sidebar
        activeConversation={activeConversation}
        onSelectConversation={setActiveConversation}
        refreshTrigger={sidebarRefresh}
      />
      <ChatPanel
        conversation={activeConversation}
        onGroupDeleted={handleGroupDeleted}
      />
    </div>
  );
}