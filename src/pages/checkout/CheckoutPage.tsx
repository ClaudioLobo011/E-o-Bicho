import { useCartTotals } from '../../features/cart/useCartTotals';
import { Button } from '../../shared/components/base/Button';
import { Input } from '../../shared/components/base/Input';
import { useCartStore } from '../../features/cart/store';
import { toast } from 'sonner';

export function CheckoutPage() {
  const totals = useCartTotals();
  const clear = useCartStore((state) => state.clear);

  const handleFinish = () => {
    toast.success('Pedido confirmado! Você receberá um e-mail com os detalhes.');
    clear();
  };

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-secondary">Checkout</h1>
      <p className="text-sm text-gray-500">Preencha os dados para finalizar sua compra com segurança.</p>
      <div className="mt-8 grid gap-8 lg:grid-cols-[2fr,1fr]">
        <form className="space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-xl font-semibold text-secondary">Dados do comprador</h2>
            <p className="text-sm text-gray-500">Utilizamos os dados da sua conta. Você pode ajustá-los em “Minha Conta”.</p>
          </div>
          <Input label="Nome completo" placeholder="Nome como no documento" required />
          <Input label="CPF" placeholder="000.000.000-00" required />
          <Input label="Telefone" placeholder="(11) 99999-9999" required />
          <div>
            <h3 className="text-lg font-semibold text-secondary">Endereço</h3>
          </div>
          <Input label="Rua" placeholder="Rua Exemplo" required />
          <div className="grid gap-4 md:grid-cols-3">
            <Input label="Número" placeholder="123" required />
            <Input label="Bairro" placeholder="Centro" required />
            <Input label="CEP" placeholder="00000-000" required />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-secondary">Pagamento</h3>
          </div>
          <Input label="Número do cartão" placeholder="0000 0000 0000 0000" required />
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Validade" placeholder="MM/AA" required />
            <Input label="CVV" placeholder="123" required />
          </div>
          <Button type="button" onClick={handleFinish} className="w-full">
            Confirmar pagamento
          </Button>
        </form>
        <aside className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-secondary">Resumo</h2>
          <div className="space-y-2 text-sm text-gray-600">
            {totals.items.map((item) => (
              <div key={item.productId} className="flex items-center justify-between">
                <span>
                  {item.quantity}x {item.product?.name}
                </span>
                <span>R$ {item.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-dashed border-gray-200 pt-4 text-sm font-semibold">
            <span>Total</span>
            <span>R$ {totals.total.toFixed(2)}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
