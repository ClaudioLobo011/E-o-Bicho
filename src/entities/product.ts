export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  promotionalPrice?: number;
  images: string[];
  category: string;
  brand: string;
  rating: number;
  stock: number;
  highlights?: string[];
}

export interface ProductFilters {
  category?: string;
  brand?: string;
  search?: string;
}
