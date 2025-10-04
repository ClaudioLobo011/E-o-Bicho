import { Button } from '../../shared/components/base/Button';
import { useProductsQuery } from '../../features/products/useProductsQuery';
import { Link } from 'react-router-dom';

const categories = [
  { label: 'Ração', icon: 'fa-bowl-food' },
  { label: 'Brinquedos', icon: 'fa-paw' },
  { label: 'Higiene', icon: 'fa-soap' },
  { label: 'Acessórios', icon: 'fa-tags' },
  { label: 'Camas', icon: 'fa-bed' }
];

const benefits = [
  {
    title: 'Entrega Rápida',
    description: 'Chegue antes do almoço do seu pet com entregas em 24h nas principais capitais.',
    icon: 'fa-truck-fast'
  },
  {
    title: 'Compra Segura',
    description: 'Ambiente com criptografia e monitoramento antifraude 24/7.',
    icon: 'fa-shield-heart'
  },
  {
    title: 'Assinatura Flexível',
    description: 'Agende entregas recorrentes com até 15% de desconto e pause quando quiser.',
    icon: 'fa-arrows-rotate'
  }
];

export function HomePage() {
  const { data, isLoading } = useProductsQuery();

  return (
    <div className="space-y-16 pb-16">
      <section className="bg-gray-100 pb-12 pt-10">
        <div className="container mx-auto grid items-center gap-10 px-4 md:grid-cols-2">
          <div className="space-y-6">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-4 py-1 text-sm font-semibold text-primary">
              Cuidar é um ato diário
            </span>
            <h1 className="text-4xl font-extrabold text-secondary md:text-5xl">
              Tudo para o bem-estar do seu pet em um só lugar
            </h1>
            <p className="text-lg text-gray-600">
              Produtos selecionados por veterinários, com preços especiais e entrega rápida para garantir o
              conforto do seu melhor amigo.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button asChild>
                <Link to="/produtos">Comprar agora</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/conta">Área do cliente</Link>
              </Button>
            </div>
          </div>
          <div className="relative">
            <div className="card p-6">
              <img
                src="https://images.unsplash.com/photo-1560114928-40f1f1eb26a0?auto=format&fit=crop&w=700&q=80"
                alt="Tutor abraçando um cachorro feliz"
                className="h-72 w-full rounded-xl object-cover"
              />
              <div className="absolute -bottom-6 left-1/2 w-full max-w-xs -translate-x-1/2 rounded-2xl bg-white p-4 shadow-lg">
                <p className="text-sm font-semibold text-secondary">Assinatura Premium</p>
                <p className="text-xs text-gray-500">15% OFF na segunda compra e entrega programada.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4">
        <h2 className="section-title text-center">Categorias</h2>
        <p className="mt-2 text-center text-gray-500">
          Explore as linhas completas para cada fase e necessidade do seu pet.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {categories.map((category) => (
            <div
              key={category.label}
              className="group card flex cursor-pointer flex-col items-center gap-3 p-6 text-center transition hover:-translate-y-1 hover:shadow-md"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-100 text-2xl text-secondary transition group-hover:border-primary group-hover:text-primary">
                <i className={`fa-solid ${category.icon}`} aria-hidden />
              </span>
              <span className="text-sm font-semibold text-gray-700">{category.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="container mx-auto px-4">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <h2 className="section-title">Produtos em Destaque</h2>
          <Link to="/produtos" className="text-sm font-semibold text-primary hover:text-primary/80">
            Ver todos
          </Link>
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {isLoading &&
            Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className="card flex flex-col overflow-hidden"
                aria-hidden
              >
                <div className="h-56 animate-pulse bg-gray-200" />
                <div className="flex flex-1 flex-col gap-3 p-6">
                  <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
                  <div className="h-6 w-full animate-pulse rounded bg-gray-200" />
                  <div className="h-16 w-full animate-pulse rounded bg-gray-100" />
                  <div className="mt-auto h-8 w-32 animate-pulse rounded bg-gray-200" />
                </div>
              </div>
            ))}
          {!isLoading &&
            (data?.data ?? []).map((product) => (
              <div key={product.id} className="card flex flex-col overflow-hidden">
                <div className="relative h-56 bg-gray-100">
                  <img
                    src={product.images[0] ?? 'https://placehold.co/600x400?text=Produto'}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                  {product.promotionalPrice && (
                    <span className="absolute left-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">
                      Oferta
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-3 p-6">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-gray-400">
                    <span>{product.category}</span>
                    <span className="flex items-center gap-1 text-yellow-500">
                      <i className="fa-solid fa-star" aria-hidden />
                      {product.rating.toFixed(1)}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-secondary">{product.name}</h3>
                  <p className="text-sm text-gray-500 line-clamp-3">{product.description}</p>
                  <div className="mt-auto flex items-baseline gap-3">
                    <span className="text-2xl font-bold text-primary">
                      R$ {(product.promotionalPrice ?? product.price).toFixed(2)}
                    </span>
                    {product.promotionalPrice && (
                      <span className="text-sm text-gray-400 line-through">R$ {product.price.toFixed(2)}</span>
                    )}
                  </div>
                  <Button asChild className="w-full">
                    <Link to={`/produtos/${product.id}`}>Ver detalhes</Link>
                  </Button>
                </div>
              </div>
            ))}
        </div>
      </section>

      <section className="bg-gray-100 py-16">
        <div className="container mx-auto px-4">
          <h2 className="section-title text-center">Por que comprar conosco?</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {benefits.map((benefit) => (
              <div key={benefit.title} className="card border-none bg-white/80 p-6 text-center shadow-none">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl text-primary">
                  <i className={`fa-solid ${benefit.icon}`} aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-secondary">{benefit.title}</h3>
                <p className="mt-2 text-sm text-gray-500">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
