import { NavLink, Outlet } from 'react-router-dom';
import { Fragment } from 'react';

import { useAuthStore } from '../features/auth/store';
import { useCartStore } from '../features/cart/store';
import { Button } from '../shared/components/base/Button';
import { cn } from '../shared/lib/cn';

const navLinks = [
  { to: '/', label: 'Início', end: true },
  { to: '/produtos', label: 'Produtos' },
  { to: '/conta', label: 'Minha Conta' },
  { to: '/carrinho', label: 'Carrinho' }
];

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const cartCount = useCartStore((state) => state.items.reduce((acc, item) => acc + item.quantity, 0));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-white shadow-sm">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <NavLink to="/" className="flex items-center" aria-label="Página inicial">
            <img src="/public/image/logo.svg" alt="Logotipo E o Bicho" className="h-20 w-auto" />
          </NavLink>
          <nav className="hidden items-center gap-6 md:flex">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    'text-sm font-semibold transition hover:text-primary',
                    isActive ? 'text-primary' : 'text-gray-700'
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <Fragment>
                <span className="hidden text-sm font-medium text-gray-600 md:inline">Olá, {user.firstName}</span>
                <Button variant="secondary" size="sm" onClick={logout}>
                  Sair
                </Button>
              </Fragment>
            ) : (
              <NavLink to="/conta" className="btn-primary hidden text-sm md:inline-flex">
                Entrar
              </NavLink>
            )}
            <NavLink
              to="/carrinho"
              className="relative inline-flex items-center rounded-full bg-secondary px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-secondary/90"
            >
              <i className="fa-solid fa-cart-shopping mr-2" aria-hidden />
              Carrinho
              <span className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">
                {cartCount}
              </span>
            </NavLink>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-secondary py-10 text-white">
        <div className="container mx-auto grid gap-8 px-4 md:grid-cols-4">
          <div>
            <h3 className="mb-3 text-lg font-semibold">E o Bicho</h3>
            <p className="text-sm text-gray-100">
              Tudo para o bem-estar do seu pet com entrega rápida e preços justos.
            </p>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide">Institucional</h4>
            <ul className="space-y-2 text-sm text-gray-100">
              <li><a href="#" className="hover:text-primary">Quem somos</a></li>
              <li><a href="#" className="hover:text-primary">Nossas lojas</a></li>
              <li><a href="#" className="hover:text-primary">Política de privacidade</a></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide">Ajuda</h4>
            <ul className="space-y-2 text-sm text-gray-100">
              <li><a href="#" className="hover:text-primary">Trocas e devoluções</a></li>
              <li><a href="#" className="hover:text-primary">Entregas</a></li>
              <li><a href="#" className="hover:text-primary">Fale conosco</a></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide">Contato</h4>
            <p className="text-sm text-gray-100">0800 123 4567</p>
            <p className="text-sm text-gray-100">contato@eobicho.com.br</p>
            <div className="mt-4 flex gap-3 text-lg">
              <a href="#" className="hover:text-primary" aria-label="Instagram">
                <i className="fa-brands fa-instagram" aria-hidden />
              </a>
              <a href="#" className="hover:text-primary" aria-label="Facebook">
                <i className="fa-brands fa-facebook" aria-hidden />
              </a>
              <a href="#" className="hover:text-primary" aria-label="YouTube">
                <i className="fa-brands fa-youtube" aria-hidden />
              </a>
            </div>
          </div>
        </div>
        <div className="mt-8 border-t border-white/10 pt-6 text-center text-xs text-gray-200">
          © {new Date().getFullYear()} E o Bicho. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}
