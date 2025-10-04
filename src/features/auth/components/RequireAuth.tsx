import { ReactNode, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { UserRole } from '../../../entities/user';

interface RequireAuthProps {
  children: ReactNode;
  roles?: UserRole[];
}

export function RequireAuth({ children, roles }: RequireAuthProps) {
  const { user, hasRole } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user) {
      navigate('/conta', { replace: true, state: { from: location.pathname } });
    } else if (!hasRole(roles)) {
      navigate('/', { replace: true });
    }
  }, [user, hasRole, roles, navigate, location.pathname]);

  if (!user || (roles && !hasRole(roles))) {
    return null;
  }

  return <>{children}</>;
}
