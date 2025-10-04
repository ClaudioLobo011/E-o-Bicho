import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

interface LegacyRedirectProps {
  to: string;
}

export function LegacyRedirect({ to }: LegacyRedirectProps) {
  const location = useLocation();

  useEffect(() => {
    console.info('[legacy-route]', location.pathname, '→', to);
  }, [location.pathname, to]);

  return <Navigate to={to} replace />;
}
