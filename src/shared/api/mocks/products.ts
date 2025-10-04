import { AxiosRequestConfig } from 'axios';
import { products } from './data';

export const productsMock = [
  {
    method: 'GET' as const,
    test: (url: string) => url === '/products',
    handler: async () => ({
      data: products,
      meta: {
        total: products.length,
        categories: Array.from(new Set(products.map((product) => product.category))),
        brands: Array.from(new Set(products.map((product) => product.brand)))
      }
    })
  },
  {
    method: 'GET' as const,
    test: (url: string) => url === '/products/destaques',
    handler: async () => ({
      data: products.filter((product) => product.isFeatured !== false)
    })
  },
  {
    method: 'GET' as const,
    test: (url: string) => url?.startsWith('/products/'),
    handler: async (config: AxiosRequestConfig) => {
      const productId = config.url?.split('/').pop();
      const product = products.find((item) => item.id === productId);
      if (!product) throw new Error('Produto não encontrado');
      return product;
    }
  }
];
