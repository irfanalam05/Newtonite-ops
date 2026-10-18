import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui.jsx';

export default () => (
  <EmptyState title="Page not found">
    <Link to="/" className="text-teal hover:underline">Go to the dashboard</Link>
  </EmptyState>
);
