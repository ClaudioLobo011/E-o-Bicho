import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/store';
import { cn } from '../../shared/lib/cn';

const navigation = [
  { label: 'Dashboard', to: '/admin' },
  { label: 'Produtos', to: '/admin/produtos' },
  { label: 'PDV', to: '/admin/pdv' },
  { label: 'Financeiro', to: '/admin/finance' },
  { label: 'Fiscal', to: '/admin/fiscal' },
  { label: 'Entregas', to: '/admin/delivery' },
  { label: 'Configurações', to: '/admin/settings' },
  { label: 'Usuários', to: '/admin/users' }
];

export function AdminLayout() {
  const { user, logout } = useAuthStore();

  return (
    <div className="flex min-h-screen bg-gray-100">
      <aside className="hidden w-64 flex-col bg-secondary text-white md:flex">
        <div className="px-6 py-6 text-lg font-bold">Painel E o Bicho</div>
        <nav className="flex-1 space-y-1 px-4">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              className={({ isActive }) =>
                cn(
                  'block rounded-xl px-4 py-3 text-sm font-semibold transition',
                  isActive ? 'bg-white text-secondary shadow' : 'text-white/80 hover:bg-white/10'
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-6 text-sm text-white/70">
          <p>{user?.firstName} {user?.lastName}</p>
          <button className="mt-3 text-xs font-semibold uppercase tracking-wide text-primary" onClick={logout}>
            Sair
          </button>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between bg-white px-6 py-4 shadow-sm">
          <div>
            <h1 className="text-xl font-semibold text-secondary">Administração</h1>
            <p className="text-xs text-gray-500">Gerencie produtos, estoque e configurações fiscais.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {user?.role?.toUpperCase()}
            </span>
            <button className="text-sm font-semibold text-secondary hover:text-primary" onClick={logout}>
              Encerrar sessão
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
