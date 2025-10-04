export interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  promotionalPrice?: number;
  clubPrice?: number;
  conditionalPromotionLabel?: string;
  discountPercentage?: number;
  images: string[];
  imageUrl?: string;
  category?: string;
  brand?: string;
  rating?: number;
  stock?: number;
  highlights?: string[];
  isFeatured?: boolean;
  raw?: unknown;
}

export interface ProductFilters {
  category?: string;
  brand?: string;
  search?: string;
}
