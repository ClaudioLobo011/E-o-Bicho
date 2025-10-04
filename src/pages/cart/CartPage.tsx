import { Link } from 'react-router-dom';
import { useCartStore } from '../../features/cart/store';
import { useCartTotals } from '../../features/cart/useCartTotals';
import { Button } from '../../shared/components/base/Button';
import { Input } from '../../shared/components/base/Input';

export function CartPage() {
  const { items, coupon, updateQuantity, toggleSubscription, removeItem, applyCoupon } = useCartStore();
  const totals = useCartTotals();

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-secondary">Meu carrinho</h1>
      <p className="mt-2 text-sm text-gray-500">Revise os itens antes de finalizar sua compra.</p>
      <div className="mt-8 grid gap-8 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-4">
          {totals.items.length === 0 && (
            <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-10 text-center">
              <p className="text-sm text-gray-600">Seu carrinho está vazio.</p>
              <Button asChild className="mt-4">
                <Link to="/produtos">Explorar produtos</Link>
              </Button>
            </div>
          )}
          {totals.items.map((item) => (
            <div key={item.productId} className="flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-6 md:flex-row">
              <div className="h-32 w-full rounded-2xl bg-gray-100 md:w-40" aria-hidden />
              <div className="flex-1 space-y-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-secondary">{item.product?.name}</h2>
                    <p className="text-sm text-gray-500">{item.product?.description}</p>
                  </div>
                  <button
                    type="button"
                    className="text-sm font-semibold text-danger-600 hover:text-danger-700"
                    onClick={() => removeItem(item.productId)}
                  >
                    Remover
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center rounded-full border border-gray-200">
                    <button
                      type="button"
                      className="px-4 py-2 text-lg font-semibold text-secondary"
                      onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                      aria-label="Diminuir quantidade"
                    >
                      −
                    </button>
                    <span className="w-12 text-center text-sm font-semibold">{item.quantity}</span>
                    <button
                      type="button"
                      className="px-4 py-2 text-lg font-semibold text-secondary"
                      onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                      aria-label="Aumentar quantidade"
                    >
                      +
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={item.subscription}
                      onChange={() => toggleSubscription(item.productId)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    Receber todo mês com 10% OFF
                  </label>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-400">Subtotal</p>
                <p className="text-xl font-bold text-secondary">R$ {item.total.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
        <aside className="space-y-6 rounded-3xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-secondary">Resumo</h2>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex items-center justify-between">
              <span>Subtotal</span>
              <span>R$ {totals.subtotal.toFixed(2)}</span>
            </div>
            {totals.hasSubscription && (
              <div className="flex items-center justify-between text-green-600">
                <span>Assinaturas</span>
                <span>Economia garantida</span>
              </div>
            )}
          </div>
          <Input
            label="Cupom de desconto"
            placeholder="DIGITEAQUI"
            value={coupon ?? ''}
            onChange={(event) => applyCoupon(event.target.value.toUpperCase())}
          />
          <Button asChild className="w-full">
            <Link to="/checkout">Finalizar compra</Link>
          </Button>
          <p className="text-xs text-gray-500">Você pode finalizar como convidado ou logado para salvar as preferências.</p>
        </aside>
      </div>
    </div>
  );
}
