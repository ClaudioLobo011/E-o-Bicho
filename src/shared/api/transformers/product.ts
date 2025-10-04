import { Product } from '../../../entities/product';

interface LegacyPromotion {
  ativa?: boolean;
  porcentagem?: number;
}

interface LegacyConditionalPromotion {
  ativa?: boolean;
  tipo?: 'leve_pague' | 'acima_de' | null;
  leve?: number;
  pague?: number;
  quantidadeMinima?: number;
  descontoPorcentagem?: number;
}

interface LegacyCategory {
  nome?: string;
}

export interface LegacyProduct {
  _id?: string;
  id?: string;
  cod?: string;
  nome?: string;
  name?: string;
  descricao?: string;
  description?: string;
  venda?: number;
  price?: number;
  precoClube?: number | null;
  imagemPrincipal?: string;
  imagens?: string[];
  images?: string[];
  marca?: string;
  brand?: string;
  categorias?: LegacyCategory[];
  category?: string;
  stock?: number;
  rating?: number;
  highlights?: string[];
  promocao?: LegacyPromotion;
  promocaoCondicional?: LegacyConditionalPromotion;
}

function generateId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

function resolveAssetPath(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const sanitized = path.startsWith('/') ? path : `/${path}`;
  return sanitized;
}

function buildConditionalLabel(promotion?: LegacyConditionalPromotion): string | undefined {
  if (!promotion || !promotion.ativa) {
    return undefined;
  }

  if (promotion.tipo === 'leve_pague' && promotion.leve && promotion.pague) {
    return `Leve ${promotion.leve} Pague ${promotion.pague}`;
  }

  if (promotion.tipo === 'acima_de' && promotion.quantidadeMinima && promotion.descontoPorcentagem) {
    return `+${promotion.quantidadeMinima} un. com ${promotion.descontoPorcentagem}%`;
  }

  return 'Oferta Especial';
}

export function mapProductFromApi(product: LegacyProduct): Product {
  const price = Number(
    product.venda ?? product.price ?? (typeof product.precoClube === 'number' ? product.precoClube : 0)
  );
  const discountActive = Boolean(product.promocao?.ativa && product.promocao?.porcentagem);
  const discountPercentage = discountActive ? Number(product.promocao?.porcentagem ?? 0) : undefined;
  const promotionalPrice = discountActive && Number.isFinite(price)
    ? Number((price * (1 - (discountPercentage ?? 0) / 100)).toFixed(2))
    : undefined;

  const clubPrice =
    typeof product.precoClube === 'number' && product.precoClube > 0 ? Number(product.precoClube) : undefined;

  const conditionalPromotionLabel = buildConditionalLabel(product.promocaoCondicional);

  const mainImage = resolveAssetPath(product.imagemPrincipal ?? product.images?.[0]);
  const gallery = [
    ...(product.imagens?.map((img) => resolveAssetPath(img)).filter(Boolean) as string[]),
    ...(product.images?.map((img) => resolveAssetPath(img)).filter(Boolean) as string[])
  ];

  const images = Array.from(new Set([mainImage, ...gallery].filter(Boolean))) as string[];

  return {
    id: product._id ?? product.id ?? product.cod ?? generateId('product'),
    name: product.nome ?? product.name ?? 'Produto',
    description: product.descricao ?? product.description,
    price: Number.isFinite(price) ? price : 0,
    promotionalPrice,
    clubPrice,
    conditionalPromotionLabel,
    discountPercentage,
    images,
    imageUrl: mainImage,
    category: product.categorias?.[0]?.nome ?? product.category,
    brand: product.marca ?? product.brand,
    rating: product.rating,
    stock: product.stock,
    highlights: product.highlights,
    raw: product
  };
}

export interface LegacyProductsResponse {
  products?: LegacyProduct[];
  page?: number;
  pages?: number;
  total?: number;
}

export function mapLegacyProductsResponse(payload: LegacyProductsResponse | LegacyProduct[]): Product[] {
  const list = Array.isArray(payload) ? payload : payload.products ?? [];
  return list.map(mapProductFromApi);
}
