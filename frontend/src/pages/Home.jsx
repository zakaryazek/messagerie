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
    // L'admin change le réglage « validation des ajouts » du groupe ouvert
    const onSettings = ({ groupeId, add_requires_approval }) =>
      setActiveConversation(c =>
        c && c.type === 'group' && Number(c.id) === Number(groupeId) ? { ...c, add_requires_approval } : c
      );
    socket.on('groupePhotoChanged', onPhoto);
    socket.on('groupeSettingsChanged', onSettings);
    return () => {
      socket.off('groupePhotoChanged', onPhoto);
      socket.off('groupeSettingsChanged', onSettings);
    };
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