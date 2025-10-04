import { Product } from './product';

export interface CartItem {
  productId: string;
  quantity: number;
  subscription?: boolean;
}

export interface CartItemDetailed extends CartItem {
  product: Product;
}

export interface Coupon {
  code: string;
  percentage: number;
  description: string;
}
