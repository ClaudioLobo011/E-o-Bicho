import { CartItemDetailed } from './cart';

export type OrderStatus = 'processando' | 'enviado' | 'entregue' | 'cancelado';

export interface Order {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: OrderStatus;
  total: number;
  paymentMethod: 'cartao' | 'pix' | 'boleto';
  items: CartItemDetailed[];
  nfce?: string;
  nfe?: string;
  nfse?: string;
}
