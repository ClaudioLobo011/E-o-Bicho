import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { Product } from '../../entities/product';
import { LegacyProductsResponse, mapLegacyProductsResponse } from '../../shared/api/transformers/product';

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
    queryFn: async () => {
      const response = await apiGet<ProductsResponse | LegacyProductsResponse>('/products');

      if ('data' in (response as ProductsResponse) && Array.isArray((response as ProductsResponse).data)) {
        return response as ProductsResponse;
      }

      const products = mapLegacyProductsResponse(response as LegacyProductsResponse);
      const categories = Array.from(
        new Set(products.map((product) => product.category).filter(Boolean) as string[])
      );
      const brands = Array.from(new Set(products.map((product) => product.brand).filter(Boolean) as string[]));

      return {
        data: products,
        meta: {
          total: (response as LegacyProductsResponse)?.total ?? products.length,
          categories,
          brands
        }
      } satisfies ProductsResponse;
    }
  });
}
