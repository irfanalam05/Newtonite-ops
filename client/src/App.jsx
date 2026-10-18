import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import { useAuth } from './features/auth/AuthContext.jsx';
import { Spinner } from './components/ui.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ItemsPage from './pages/ItemsPage.jsx';
import ItemCreatePage from './pages/ItemCreatePage.jsx';
import ItemDetailPage from './pages/ItemDetailPage.jsx';
import TeamsPage from './pages/TeamsPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

function Protected({ children }) {
  const { user, booting } = useAuth();
  const location = useLocation();
  if (booting) return <Spinner label="Restoring session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="items/new" element={<ItemCreatePage />} />
        <Route path="items/:id" element={<ItemDetailPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
