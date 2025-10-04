import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { Product } from '../../entities/product';

export function useProductQuery(id: string) {
  return useQuery<Product>({
    queryKey: ['products', id],
    queryFn: () => apiGet(`/products/${id}`),
    enabled: Boolean(id)
  });
}
