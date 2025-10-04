import { AxiosRequestConfig } from 'axios';
import { products } from './data';
import { CartItem } from '../../../entities/cart';

const carts = new Map<string, CartItem[]>([
  [
    'token-cliente-julia',
    [
      { productId: 'racao-premium-01', quantity: 1, subscription: true },
      { productId: 'brinquedo-interativo-01', quantity: 1 }
    ]
  ]
]);

export const cartMock = [
  {
    method: 'GET' as const,
    test: (url: string) => url?.startsWith('/cart'),
    handler: async (config: AxiosRequestConfig) => {
      const token = config.headers?.Authorization?.toString().replace('Bearer ', '') ?? '';
      const cart = carts.get(token) ?? [];
      return cart.map((item) => ({
        ...item,
        product: products.find((product) => product.id === item.productId)
      }));
    }
  },
  {
    method: 'PUT' as const,
    test: (url: string) => url?.startsWith('/cart'),
    handler: async (config: AxiosRequestConfig) => {
      const token = config.headers?.Authorization?.toString().replace('Bearer ', '') ?? '';
      const cart = carts.get(token) ?? [];
      const payload = JSON.parse(config.data as string) as CartItem;
      const index = cart.findIndex((item) => item.productId === payload.productId);
      if (index >= 0) {
        cart[index] = payload;
      } else {
        cart.push(payload);
      }
      carts.set(token, cart);
      return { success: true };
    }
  }
];
