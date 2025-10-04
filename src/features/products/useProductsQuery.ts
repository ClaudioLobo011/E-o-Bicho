import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { Product } from '../../entities/product';

interface ProductsResponse {
  data: Product[];
  meta: {
    total: number;
    categories: string[];
    brands: string[];
  };
}

export function useProductsQuery() {
  return useQuery<ProductsResponse>({
    queryKey: ['products'],
    queryFn: () => apiGet('/products')
  });
}
