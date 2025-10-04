import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { Product } from '../../entities/product';
import { LegacyProduct, mapProductFromApi } from '../../shared/api/transformers/product';

export function useProductQuery(id: string) {
  return useQuery<Product>({
    queryKey: ['products', id],
    queryFn: async () => {
      const response = await apiGet<Product | LegacyProduct>(`/products/${id}`);
      if ('id' in response && response.id) {
        return response as Product;
      }

      return mapProductFromApi(response as LegacyProduct);
    },
    enabled: Boolean(id)
  });
}
