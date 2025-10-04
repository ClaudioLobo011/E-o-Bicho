import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from './AppLayout';
import { HomePage } from '../pages/home/HomePage';
import { AccountLayout } from '../pages/account/AccountLayout';
import { CartPage } from '../pages/cart/CartPage';
import { ProductsPage } from '../pages/products/ProductsPage';
import { ProductDetailPage } from '../pages/products/ProductDetailPage';
import { CheckoutPage } from '../pages/checkout/CheckoutPage';
import { AdminLayout } from '../admin/layout/AdminLayout';
import { AdminProductsPage } from '../admin/products/AdminProductsPage';
import { RequireAuth } from '../features/auth/components/RequireAuth';
import { AccountProfilePage } from '../pages/account/AccountProfilePage';
import { AccountOrdersPage } from '../pages/account/AccountOrdersPage';
import { LegacyRedirect } from '../shared/components/base/LegacyRedirect';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'conta',
        element: <AccountLayout />,
        children: [
          {
            path: 'meus-dados',
            element: (
              <RequireAuth>
                <AccountProfilePage />
              </RequireAuth>
            )
          },
          {
            path: 'pedidos',
            element: (
              <RequireAuth>
                <AccountOrdersPage />
              </RequireAuth>
            )
          },
          { index: true, element: <Navigate to="meus-dados" replace /> }
        ]
      },
      { path: 'carrinho', element: <CartPage /> },
      { path: 'produtos', element: <ProductsPage /> },
      { path: 'produtos/:id', element: <ProductDetailPage /> },
      { path: 'checkout', element: <CheckoutPage /> }
    ]
  },
  {
    path: '/admin',
    element: (
      <RequireAuth roles={["admin", "manager", "staff"]}>
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="produtos" replace /> },
      { path: 'produtos', element: <AdminProductsPage /> }
    ]
  },
  { path: '/pages/index.html', element: <LegacyRedirect to="/" /> },
  { path: '/pages/meus-dados.html', element: <LegacyRedirect to="/conta/meus-dados" /> },
  { path: '/pages/carrinho.html', element: <LegacyRedirect to="/carrinho" /> },
  { path: '/pages/produtos.html', element: <LegacyRedirect to="/produtos" /> },
  { path: '/pages/login.html', element: <LegacyRedirect to="/conta" /> },
  { path: '*', element: <LegacyRedirect to="/" /> }
]);
