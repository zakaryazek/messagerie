import { useState } from 'react';
import Sidebar from '../components/Sidebar';
import ChatPanel from '../components/ChatPanel';

export default function Home() {
  const [activeConversation, setActiveConversation] = useState(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

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