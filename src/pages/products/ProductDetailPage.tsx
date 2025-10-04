import { useParams, Link } from 'react-router-dom';
import { useProductQuery } from '../../features/products/useProductQuery';
import { Button } from '../../shared/components/base/Button';
import { useCartStore } from '../../features/cart/store';

export function ProductDetailPage() {
  const { id } = useParams();
  const { data, isLoading } = useProductQuery(id ?? '');
  const addItem = useCartStore((state) => state.addItem);

  if (isLoading || !data) {
    return (
      <div className="container mx-auto px-4 py-10">
        <p className="text-sm text-gray-500">Carregando produto...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10">
      <Link to="/produtos" className="text-sm text-primary hover:text-primary/80">
        <i className="fa-solid fa-chevron-left mr-2" aria-hidden />Voltar
      </Link>
      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div className="rounded-3xl bg-gray-100 p-4">
          <img
            src={data.images[0] ?? 'https://placehold.co/600x400?text=Produto'}
            alt={data.name}
            className="h-full w-full rounded-2xl object-cover"
          />
        </div>
        <div className="space-y-6">
          <div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase text-primary">
              {data.category}
            </span>
            <h1 className="mt-3 text-3xl font-bold text-secondary">{data.name}</h1>
            <p className="text-sm text-gray-500">{data.description}</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold text-primary">R$ {(data.promotionalPrice ?? data.price).toFixed(2)}</span>
              {data.promotionalPrice && (
                <span className="text-sm text-gray-400 line-through">R$ {data.price.toFixed(2)}</span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Em estoque: {data.stock} unidades — entrega rápida para sua região.
            </p>
          </div>
          <div className="space-y-3">
            {data.highlights?.map((highlight) => (
              <div key={highlight} className="flex items-center gap-2 text-sm text-secondary">
                <i className="fa-solid fa-circle-check text-primary" aria-hidden />
                <span>{highlight}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              className="w-full"
              onClick={() => {
                addItem({ productId: data.id, quantity: 1 });
              }}
            >
              Adicionar ao carrinho
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link to="/checkout">Comprar agora</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
