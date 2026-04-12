import { useState } from 'react';
import Sidebar from '../components/Sidebar';
import ChatPanel from '../components/ChatPanel';

export default function Home() {
  const [activeConversation, setActiveConversation] = useState(null);

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      <Sidebar
        activeConversation={activeConversation}
        onSelectConversation={setActiveConversation}
      />
      <ChatPanel
        conversation={activeConversation}
        onGroupDeleted={() => setActiveConversation(null)}
      />
    </div>
  );
}
