import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Groupes from './pages/Groupes';
import Chat from './pages/Chat';

function PrivateRoute({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/groupes" element={<PrivateRoute><Groupes /></PrivateRoute>} />
          <Route path="/groupes/:id" element={<PrivateRoute><Chat /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/groupes" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
