import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useFeaturedProductsQuery } from '../../features/products/useFeaturedProductsQuery';
import { useCartStore } from '../../features/cart/store';
import { useBannersQuery } from '../../features/home/useBannersQuery';
import type { Product } from '../../entities/product';

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
const FALLBACK_IMAGE = 'https://placehold.co/600x400?text=Produto';

function getSlideClasses(index: number, current: number, total: number) {
  if (total === 0) return 'slide flex-shrink-0';

  if (index === current) {
    return 'slide flex-shrink-0 slide-ativo';
  }

  if (index === (current - 1 + total) % total) {
    return 'slide flex-shrink-0 slide-anterior';
  }

  if (index === (current + 1) % total) {
    return 'slide flex-shrink-0 slide-proximo';
  }

  if (index === (current - 2 + total) % total) {
    return 'slide flex-shrink-0 slide-escondido-esquerda';
  }

  return 'slide flex-shrink-0 slide-escondido-direita';
}

function resolvePrice(product: Product) {
  return {
    price: product.price,
    promotionalPrice: product.promotionalPrice,
    clubPrice: product.clubPrice,
    discountPercentage: product.discountPercentage,
    conditionalPromotionLabel: product.conditionalPromotionLabel
  };
}

function formatPrice(value: number) {
  return value.toFixed(2).replace('.', ',');
}

export function HomePage() {
  const { data: featuredResponse } = useFeaturedProductsQuery();
  const { data: bannersResponse } = useBannersQuery();
  const addItem = useCartStore((state) => state.addItem);

  const banners = bannersResponse?.data ?? [];
  const featuredProducts = featuredResponse?.data ?? [];

  const [currentSlide, setCurrentSlide] = useState(0);
  const [currentProductIndex, setCurrentProductIndex] = useState(0);
  const [maxProductIndex, setMaxProductIndex] = useState(0);

  const sliderWrapperRef = useRef<HTMLDivElement | null>(null);
  const sliderContainerRef = useRef<HTMLDivElement | null>(null);

  const handleAddToCart = useCallback(
    (product: Product) => {
      addItem({ productId: product.id, quantity: 1 });
    },
    [addItem]
  );

  useEffect(() => {
    if (!banners.length) return;

    const interval = window.setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % banners.length);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [banners.length]);

  const updateSliderMetrics = useCallback(() => {
    const wrapper = sliderWrapperRef.current;
    const container = sliderContainerRef.current;
    if (!wrapper || !container) return;

    const firstCard = container.querySelector('.product-card') as HTMLElement | null;
    if (!firstCard) {
      setCurrentProductIndex(0);
      setMaxProductIndex(0);
      return;
    }

    const gap = 24;
    const itemsVisible = Math.max(1, Math.floor(wrapper.offsetWidth / (firstCard.offsetWidth + gap)));
    const maxIndex = Math.max(0, featuredProducts.length - itemsVisible);

    setMaxProductIndex(maxIndex);
    setCurrentProductIndex((prev) => Math.min(prev, maxIndex));
  }, [featuredProducts.length]);

  useEffect(() => {
    updateSliderMetrics();
  }, [featuredProducts.length, updateSliderMetrics]);

  useEffect(() => {
    const handleResize = () => {
      window.requestAnimationFrame(updateSliderMetrics);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateSliderMetrics]);

  useEffect(() => {
    const container = sliderContainerRef.current;
    const wrapper = sliderWrapperRef.current;
    if (!container || !wrapper) return;

    const firstCard = container.querySelector('.product-card') as HTMLElement | null;
    if (!firstCard) return;

    const gap = 24;
    const moveDistance = (firstCard.offsetWidth + gap) * currentProductIndex;
    container.style.transform = `translateX(-${moveDistance}px)`;
  }, [currentProductIndex, featuredProducts.length]);

  return (
    <div className="space-y-0">
      <div className="bg-gray-200 py-3 text-center text-sm text-black">
        <p>Frete grátis para compras acima de R$ 100,00</p>
      </div>

      <div className="bg-gray-100 py-8">
        <div className="w-full">
          <div id="carousel" className="relative w-full overflow-hidden">
            <div className="carousel-container flex h-full items-center">
              {banners.map((banner, index) => (
                <div key={banner.id} className={getSlideClasses(index, currentSlide, banners.length)}>
                  <Link to={banner.link} className="relative block h-full w-full overflow-hidden rounded-3xl">
                    <img
                      src={banner.imageUrl}
                      alt={banner.title}
                      className="h-full w-full object-cover"
                      loading={index === 0 ? 'eager' : 'lazy'}
                    />
                    <div className="absolute inset-0 flex flex-col justify-center gap-4 bg-gradient-to-r from-black/60 via-black/30 to-transparent p-8 text-white">
                      <div className="max-w-xl">
                        <p className="text-xs uppercase tracking-[0.35em] text-white/70">Campanha exclusiva</p>
                        <h2 className="mt-2 text-3xl font-bold leading-tight md:text-4xl">{banner.title}</h2>
                        {banner.subtitle ? (
                          <p className="mt-3 text-base text-white/85 md:text-lg">{banner.subtitle}</p>
                        ) : null}
                      </div>
                      {banner.buttonText ? (
                        <span className="mt-4 inline-flex w-fit items-center">
                          <span className="btn btn-primary btn-lg">{banner.buttonText}</span>
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </div>
              ))}
            </div>

            <button
              id="prev"
              type="button"
              aria-label="Slide anterior"
              className="absolute left-4 top-1/2 -translate-y-1/2 transform rounded-full bg-white/30 p-2 transition hover:bg-white/50"
              onClick={() =>
                setCurrentSlide((prev) => (prev - 1 + (banners.length || 1)) % (banners.length || 1))
              }
            >
              <i className="fas fa-chevron-left" aria-hidden />
            </button>

            <button
              id="next"
              type="button"
              aria-label="Próximo slide"
              className="absolute right-4 top-1/2 -translate-y-1/2 transform rounded-full bg-white/30 p-2 transition hover:bg-white/50"
              onClick={() => setCurrentSlide((prev) => (prev + 1) % (banners.length || 1))}
            >
              <i className="fas fa-chevron-right" aria-hidden />
            </button>

            <div
              id="carousel-indicators"
              className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center space-x-1"
            >
              {banners.map((banner, index) => (
                <div key={banner.id} className={`indicator${index === currentSlide ? ' active' : ''}`}>
                  <span className="dot" />
                  <span className="pill">
                    <span className="fill" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <section className="bg-light py-10">
        <div className="container mx-auto px-4">
          <h2 className="mb-8 text-center text-2xl font-bold">Categorias</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {categories.map((category) => (
              <div
                key={category}
                className="category-card border border-gray-200 bg-white p-4 text-center shadow transition duration-300"
              >
                <div className="mx-auto mb-3 h-16 w-16 rounded-xl border-2 border-dashed bg-gray-200" />
                <h3 className="font-medium">{category}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-10">
        <div className="container mx-auto px-4">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-2xl font-bold">Produtos em Destaque</h2>
            <div className="flex items-center space-x-2">
              <button
                id="prev-featured-btn"
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-gray-700 transition-colors hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setCurrentProductIndex((prev) => Math.max(prev - 1, 0))}
                disabled={currentProductIndex === 0}
              >
                <i className="fas fa-chevron-left" aria-hidden />
              </button>
              <button
                id="next-featured-btn"
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-gray-700 transition-colors hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setCurrentProductIndex((prev) => Math.min(prev + 1, maxProductIndex))}
                disabled={currentProductIndex >= maxProductIndex}
              >
                <i className="fas fa-chevron-right" aria-hidden />
              </button>
              <Link to="/produtos" className="btn btn-outline btn-sm ml-4 hidden sm:inline-flex">
                Ver todos
              </Link>
            </div>
          </div>

          <div id="featured-slider-wrapper" ref={sliderWrapperRef} className="relative overflow-hidden">
            <div
              id="featured-products-container"
              ref={sliderContainerRef}
              className="flex space-x-6 transition-transform duration-500 ease-in-out"
            >
              {featuredProducts.map((product) => {
                const price = resolvePrice(product);
                return (
                  <div
                    key={product.id}
                    className="product-card group relative flex w-60 flex-shrink-0 flex-col overflow-hidden rounded-lg bg-white shadow transition duration-300 sm:w-64"
                  >
                    {price.discountPercentage ? (
                      <div className="absolute left-0 top-3 z-10 rounded-r bg-primary px-2 py-1 text-xs font-bold text-white">
                        -{price.discountPercentage}% DE DESCONTO
                      </div>
                    ) : null}
                    <div className="product-info flex h-full flex-col p-4">
                      <div className="relative mb-4 h-48 w-full">
                        <Link to={`/produtos/${product.id}`} className="block h-full w-full">
                          <img
                            src={product.imageUrl ?? product.images?.[0] ?? FALLBACK_IMAGE}
                            alt={product.name}
                            className="h-full w-full rounded-md object-cover"
                          />
                        </Link>
                        <button
                          type="button"
                          className="add-to-cart absolute bottom-3 right-3 flex h-[55px] w-[55px] items-center justify-center rounded-full opacity-0 transition-all duration-300 group-hover:opacity-100"
                          aria-label="Adicionar ao carrinho"
                          onClick={() => handleAddToCart(product)}
                        >
                          <div
                            data-icon="sacola"
                            className="flex h-[55px] w-[55px] items-center justify-center rounded-full bg-secondary text-white"
                          >
                            <i className="fa-solid fa-bag-shopping text-xl" aria-hidden />
                          </div>
                        </button>
                      </div>
                      <div className="product-details flex flex-grow flex-col">
                        <h3 className="line-clamp-2 h-12 text-base font-normal">{product.name}</h3>
                        <div className="product-price mt-auto flex min-h-[2.5rem] items-center justify-between gap-3">
                          <div className="space-y-1">
                            {price.discountPercentage && price.promotionalPrice ? (
                              <div>
                                <span className="block text-sm text-gray-500 line-through">
                                  R$ {formatPrice(price.price)}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-lg font-bold text-primary">
                                    R$ {formatPrice(price.promotionalPrice)}
                                  </span>
                                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">
                                    -{price.discountPercentage}% OFF
                                  </span>
                                </div>
                              </div>
                            ) : price.clubPrice ? (
                              <div>
                                <span className="block text-sm text-gray-500 line-through">
                                  R$ {formatPrice(price.price)}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-lg font-bold text-primary">
                                    R$ {formatPrice(price.clubPrice)}
                                  </span>
                                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">Club</span>
                                </div>
                              </div>
                            ) : price.promotionalPrice ? (
                              <div>
                                <span className="block text-sm text-gray-500 line-through">
                                  R$ {formatPrice(price.price)}
                                </span>
                                <span className="text-lg font-bold text-primary">
                                  R$ {formatPrice(price.promotionalPrice)}
                                </span>
                              </div>
                            ) : (
                              <span className="block text-lg font-bold text-gray-950">
                                R$ {formatPrice(price.price)}
                              </span>
                            )}
                          </div>
                          {price.conditionalPromotionLabel ? (
                            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">
                              {price.conditionalPromotionLabel}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {featuredProducts.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500">Nenhum produto em destaque no momento.</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="py-10">
        <div className="container mx-auto px-4">
          <h2 className="mb-8 text-center text-2xl font-bold">Nossas Marcas</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {brandPlaceholders.map((_, index) => (
              <div
                key={index}
                className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-4 shadow"
              >
                <div className="h-12 w-24 rounded-xl border-2 border-dashed bg-gray-200" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-light py-10">
        <div className="container mx-auto px-4">
          <h2 className="mb-8 text-center text-2xl font-bold">Por que comprar conosco?</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {benefits.map((benefit) => (
              <div
                key={benefit.title}
                className="benefit-card rounded-lg bg-white p-6 text-center shadow transition duration-300"
              >
                <div className="mb-4 text-4xl text-primary">
                  <i className={`fas ${benefit.icon}`} aria-hidden />
                </div>
                <h3 className="mb-2 text-lg font-bold">{benefit.title}</h3>
                <p className="text-gray-600">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
