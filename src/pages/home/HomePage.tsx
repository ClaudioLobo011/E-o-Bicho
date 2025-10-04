import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { Product } from '../../entities/product';
import { Button } from '../../shared/components/base/Button';
import { useProductsQuery } from '../../features/products/useProductsQuery';
import { cn } from '../../shared/lib/cn';

const heroSlides = [
  {
    id: 'carousel-1',
    title: 'Tudo para o bem-estar do seu pet em um só lugar',
    description:
      'Produtos selecionados por veterinários, com preços especiais e entrega rápida para garantir o conforto do seu melhor amigo.',
    image: 'https://images.unsplash.com/photo-1543852786-1cf6624b9987?auto=format&fit=crop&w=900&q=80',
    highlight: 'Assinatura Premium',
    highlightDescription: '15% OFF na segunda compra e entrega programada.'
  },
  {
    id: 'carousel-2',
    title: 'Kit bem-estar com frete grátis para todo o Brasil',
    description: 'Planos especiais com entrega programada e suporte veterinário a cada renovação da assinatura.',
    image: 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80',
    highlight: 'Entrega Express',
    highlightDescription: 'Receba em 24 horas nas capitais selecionadas.'
  },
  {
    id: 'carousel-3',
    title: 'Coleção outono: conforto térmico para cães e gatos',
    description: 'Casacos, camas e acessórios com os tecidos mais aconchegantes para o seu pet curtir os dias frios.',
    image: 'https://images.unsplash.com/photo-1619983081593-ec60bb0feb84?auto=format&fit=crop&w=900&q=80',
    highlight: 'Coleção Exclusiva',
    highlightDescription: 'Estampas limitadas criadas com estilistas parceiros.'
  }
];

const categories = ['Ração', 'Brinquedos', 'Higiene', 'Acessórios', 'Camas'];

const benefits = [
  {
    title: 'Entrega Rápida',
    description: 'Entregamos em até 24 horas para todo o Brasil',
    icon: 'fa-truck'
  },
  {
    title: 'Compra Segura',
    description: 'Ambiente seguro com criptografia SSL',
    icon: 'fa-shield-alt'
  },
  {
    title: 'Devolução Grátis',
    description: 'Devoluções gratuitas em até 30 dias',
    icon: 'fa-sync-alt'
  }
];

const brandPlaceholders = Array.from({ length: 6 });

function getSlideState(current: number, index: number, total: number) {
  if (index === current) {
    return 'is-active';
  }

  const prev = (current - 1 + total) % total;
  const next = (current + 1) % total;

  if (index === prev) {
    return 'is-prev';
  }

  if (index === next) {
    return 'is-next';
  }

  return index < current ? 'is-hidden-left' : 'is-hidden-right';
}

export function HomePage() {
  const { data, isLoading } = useProductsQuery();
  const products = data?.data ?? [];
  const [activeSlide, setActiveSlide] = useState(0);
  const [featuredPage, setFeaturedPage] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % heroSlides.length);
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  const featuredSlides = useMemo(() => {
    const perPage = 3;
    const slides: Product[][] = [];
    for (let start = 0; start < products.length; start += perPage) {
      slides.push(products.slice(start, start + perPage));
    }
    return slides;
  }, [products]);

  useEffect(() => {
    if (featuredSlides.length > 0 && featuredPage > featuredSlides.length - 1) {
      setFeaturedPage(0);
    }
  }, [featuredSlides, featuredPage]);

  const canPrev = featuredPage > 0;
  const canNext = featuredPage < Math.max(featuredSlides.length - 1, 0);

  return (
    <div className="space-y-16 pb-16">
      <section className="bg-gray-100 py-8">
        <div className="container mx-auto px-4">
          <div id="carousel" className="relative w-full overflow-hidden">
            <div className="carousel-container flex h-full items-center">
              {heroSlides.map((slide, index) => (
                <article
                  key={slide.id}
                  className={cn(
                    'slide flex flex-col justify-center rounded-3xl bg-white/90 p-8 shadow-lg md:flex-row md:items-center md:gap-10',
                    getSlideState(activeSlide, index, heroSlides.length)
                  )}
                >
                  <div className="flex-1 space-y-6">
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-4 py-1 text-sm font-semibold text-primary">
                      Cuidar é um ato diário
                    </span>
                    <h1 className="text-3xl font-extrabold text-secondary md:text-4xl">{slide.title}</h1>
                    <p className="text-base text-gray-600 md:text-lg">{slide.description}</p>
                    <div className="flex flex-wrap gap-3">
                      <Button asChild>
                        <Link to="/produtos">Comprar agora</Link>
                      </Button>
                      <Button asChild variant="ghost">
                        <Link to="/conta">Área do cliente</Link>
                      </Button>
                    </div>
                  </div>
                  <div className="relative mt-8 w-full max-w-lg md:mt-0">
                    <img
                      src={slide.image}
                      alt="Tutor interagindo com o pet"
                      className="h-72 w-full rounded-2xl object-cover"
                    />
                    <div className="absolute -bottom-6 left-1/2 w-full max-w-xs -translate-x-1/2 rounded-2xl bg-white p-4 shadow-lg">
                      <p className="text-sm font-semibold text-secondary">{slide.highlight}</p>
                      <p className="text-xs text-gray-500">{slide.highlightDescription}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <button
              type="button"
              id="prev"
              aria-label="Slide anterior"
              onClick={() => setActiveSlide((prev) => (prev - 1 + heroSlides.length) % heroSlides.length)}
              className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/70 text-secondary transition hover:bg-white"
            >
              <i className="fas fa-chevron-left" aria-hidden />
            </button>
            <button
              type="button"
              id="next"
              aria-label="Próximo slide"
              onClick={() => setActiveSlide((prev) => (prev + 1) % heroSlides.length)}
              className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/70 text-secondary transition hover:bg-white"
            >
              <i className="fas fa-chevron-right" aria-hidden />
            </button>

            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2" id="carousel-indicators">
              {heroSlides.map((slide, index) => (
                <button
                  key={slide.id}
                  type="button"
                  aria-label={`Ir para o slide ${index + 1}`}
                  className={cn('indicator', index === activeSlide && 'active')}
                  onClick={() => setActiveSlide(index)}
                >
                  <span className="dot" />
                  <span className="pill">
                    <span className="fill" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-gray-100 py-10">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold text-center">Categorias</h2>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {categories.map((category) => (
              <div
                key={category}
                className="category-card rounded-lg border border-gray-200 bg-white p-6 text-center shadow transition duration-300"
              >
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-100" />
                <h3 className="font-medium text-gray-700">{category}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-10">
        <div className="container mx-auto px-4">
          <div className="mb-8 flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
            <h2 className="text-2xl font-bold text-gray-900">Produtos em Destaque</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                id="prev-featured-btn"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-gray-700 transition hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canPrev}
                onClick={() => setFeaturedPage((prev) => Math.max(prev - 1, 0))}
              >
                <i className="fas fa-chevron-left" aria-hidden />
              </button>
              <button
                type="button"
                id="next-featured-btn"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-gray-700 transition hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canNext}
                onClick={() => setFeaturedPage((prev) => Math.min(prev + 1, Math.max(featuredSlides.length - 1, 0)))}
              >
                <i className="fas fa-chevron-right" aria-hidden />
              </button>
              <Link to="/produtos" className="ml-4 text-sm font-medium text-primary hover:underline">
                Ver todos
              </Link>
            </div>
          </div>

          <div id="featured-slider-wrapper" className="relative overflow-hidden">
            <div
              id="featured-products-container"
              className="flex transition-transform duration-500 ease-in-out"
              style={{ transform: `translateX(-${featuredPage * 100}%)` }}
            >
              {featuredSlides.length === 0 && (
                <div className="grid min-w-full gap-6 md:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={`featured-skeleton-${index}`} className="rounded-2xl border border-gray-200 bg-white p-6">
                      <div className="h-48 w-full animate-pulse rounded-xl bg-gray-200" />
                      <div className="mt-4 space-y-3">
                        <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
                        <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                        <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {featuredSlides.map((group, slideIndex) => (
                <div key={`featured-group-${slideIndex}`} className="grid min-w-full gap-6 md:grid-cols-3">
                  {group.map((product) => (
                    <div key={product.id} className="product-card flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                      <div className="relative h-48 bg-gray-100">
                        <img
                          src={product.images[0] ?? 'https://placehold.co/600x400?text=Produto'}
                          alt={product.name}
                          className="h-full w-full object-cover"
                        />
                        {product.promotionalPrice && (
                          <span className="absolute left-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">Oferta</span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-3 p-6">
                        <h3 className="text-lg font-semibold text-secondary">{product.name}</h3>
                        <p className="product-details text-sm text-gray-500 line-clamp-3">{product.description}</p>
                        <div className="product-price flex items-baseline gap-3">
                          <span className="text-2xl font-bold text-primary">R$ {(product.promotionalPrice ?? product.price).toFixed(2)}</span>
                          {product.promotionalPrice && (
                            <span className="text-sm text-gray-400 line-through">R$ {product.price.toFixed(2)}</span>
                          )}
                        </div>
                        <Button asChild className="add-to-cart w-full">
                          <Link to={`/produtos/${product.id}`}>Ver detalhes</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-gray-100 py-10">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold text-center">Nossas Marcas</h2>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {brandPlaceholders.map((_, index) => (
              <div
                key={`brand-${index}`}
                className="rounded-lg border border-gray-200 bg-white p-6"
              >
                <div className="mx-auto h-12 w-24 rounded-xl border-2 border-dashed border-gray-300" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gray-100 py-10">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold text-center">Por que comprar conosco?</h2>
          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
            {benefits.map((benefit) => (
              <div key={benefit.title} className="benefit-card rounded-lg border border-gray-200 bg-white p-6 text-center shadow transition duration-300">
                <div className="mb-4 text-4xl text-primary">
                  <i className={cn('fas', benefit.icon)} aria-hidden />
                </div>
                <h3 className="text-lg font-bold text-secondary">{benefit.title}</h3>
                <p className="mt-2 text-sm text-gray-600">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
