import { Link } from 'react-router-dom';
import { useProductsQuery } from '../../features/products/useProductsQuery';
import { Button } from '../../shared/components/base/Button';

export function ProductsPage() {
  const { data, isLoading } = useProductsQuery();
  const products = data?.data ?? [];

  return (
    <div className="container mx-auto px-4 py-10">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold text-secondary">Produtos</h1>
          <p className="text-sm text-gray-500">Seleção exclusiva pensada pelo time clínico da E o Bicho.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          {data?.meta.categories.map((category) => (
            <span key={category} className="rounded-full bg-gray-100 px-3 py-1">
              {category}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading &&
          Array.from({ length: 6 }).map((_, index) => (
            <article key={`product-skeleton-${index}`} className="card overflow-hidden" aria-hidden>
              <div className="h-48 animate-pulse bg-gray-200" />
              <div className="space-y-3 p-5">
                <div className="h-5 w-24 animate-pulse rounded bg-gray-200" />
                <div className="h-6 w-full animate-pulse rounded bg-gray-200" />
                <div className="h-14 w-full animate-pulse rounded bg-gray-100" />
                <div className="h-6 w-32 animate-pulse rounded bg-gray-200" />
              </div>
            </article>
          ))}
        {!isLoading &&
          products.map((product) => (
            <article key={product.id} className="card flex flex-col overflow-hidden">
              <div className="relative h-48 bg-gray-100">
                <img
                  src={product.images[0] ?? 'https://placehold.co/600x400?text=Produto'}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
                <span className="absolute left-3 top-3 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-secondary">
                  {product.brand}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-5">
                <h2 className="text-lg font-semibold text-secondary">{product.name}</h2>
                <p className="text-sm text-gray-500 line-clamp-2">{product.description}</p>
                <div className="mt-auto flex items-baseline gap-2">
                  <span className="text-xl font-bold text-primary">
                    R$ {(product.promotionalPrice ?? product.price).toFixed(2)}
                  </span>
                  {product.promotionalPrice && (
                    <span className="text-xs text-gray-400 line-through">R$ {product.price.toFixed(2)}</span>
                  )}
                </div>
                <Button asChild className="w-full">
                  <Link to={`/produtos/${product.id}`}>Ver detalhes</Link>
                </Button>
              </div>
            </article>
          ))}
      </div>
    </div>
  );
}
