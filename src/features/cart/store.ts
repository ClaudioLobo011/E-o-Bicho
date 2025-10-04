import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { CartItem } from '../../entities/cart';
import { STORAGE_KEYS } from '../../shared/lib/storage-migrations';

interface CartState {
  items: CartItem[];
  coupon?: string;
}

interface CartActions {
  addItem: (item: CartItem) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  toggleSubscription: (productId: string) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
  applyCoupon: (code?: string) => void;
}

export const useCartStore = create<CartState & CartActions>()(
  persist(
    immer((set) => ({
      items: [],
      coupon: undefined,
      addItem(item) {
        set((state) => {
          const existing = state.items.find((entry) => entry.productId === item.productId);
          if (existing) {
            existing.quantity += item.quantity;
            existing.subscription = item.subscription ?? existing.subscription;
          } else {
            state.items.push(item);
          }
        });
      },
      updateQuantity(productId, quantity) {
        set((state) => {
          const target = state.items.find((item) => item.productId === productId);
          if (target) {
            target.quantity = Math.max(1, quantity);
          }
        });
      },
      toggleSubscription(productId) {
        set((state) => {
          const target = state.items.find((item) => item.productId === productId);
          if (target) {
            target.subscription = !target.subscription;
          }
        });
      },
      removeItem(productId) {
        set((state) => {
          state.items = state.items.filter((item) => item.productId !== productId);
        });
      },
      clear() {
        set({ items: [], coupon: undefined });
      },
      applyCoupon(code) {
        set({ coupon: code });
      }
    })),
    {
      name: STORAGE_KEYS.cart
    }
  )
);
