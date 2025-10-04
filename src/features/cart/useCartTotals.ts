import { useMemo } from 'react';
import { useCartStore } from './store';
import { useProductsQuery } from '../products/useProductsQuery';

export function useCartTotals() {
  const items = useCartStore((state) => state.items);
  const { data } = useProductsQuery();

  return useMemo(() => {
    const productMap = new Map((data?.data ?? []).map((product) => [product.id, product]));
    let subtotal = 0;
    const detailed = items.map((item) => {
      const product = productMap.get(item.productId);
      const price = product?.promotionalPrice ?? product?.price ?? 0;
      const total = price * item.quantity;
      subtotal += total;
      return { ...item, product, total };
    });

    return {
      items: detailed,
      subtotal,
      total: subtotal,
      hasSubscription: detailed.some((item) => item.subscription)
    };
  }, [items, data]);
}
