import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { Product } from '../../entities/product';
import { LegacyProduct, mapProductFromApi } from '../../shared/api/transformers/product';

interface FeaturedProductsResponse {
  data: Product[];
}

export function useFeaturedProductsQuery() {
  return useQuery<FeaturedProductsResponse>({
    queryKey: ['products', 'featured'],
    queryFn: async () => {
      const response = await apiGet<LegacyProduct[] | FeaturedProductsResponse>('/products/destaques');

      if (Array.isArray(response)) {
        return { data: response.map(mapProductFromApi) } satisfies FeaturedProductsResponse;
      }

      if ('data' in response && Array.isArray(response.data)) {
        return response;
      }

      return { data: [] } satisfies FeaturedProductsResponse;
    }
  });
}
