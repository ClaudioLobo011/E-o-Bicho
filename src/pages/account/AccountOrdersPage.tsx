import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { apiGet } from '../../shared/api/client';
import { Order } from '../../entities/order';
import { Button } from '../../shared/components/base/Button';

interface FiscalDocumentsResponse {
  nfce: { chave: string; descricao: string; urlConsulta: string };
  nfe: { chave: string; descricao: string; urlConsulta: string };
  nfse: { numero: string; codigoVerificacao: string; descricao: string; urlConsulta: string };
}

export function AccountOrdersPage() {
  const ordersQuery = useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: () => apiGet('/orders')
  });

  const fiscalQuery = useQuery<FiscalDocumentsResponse>({
    queryKey: ['fiscal', 'documents'],
    queryFn: () => apiGet('/fiscal/documents')
  });

  if (ordersQuery.isLoading) {
    return <p className="text-sm text-gray-500">Carregando pedidos...</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-secondary">Histórico de pedidos</h2>
        <p className="text-sm text-gray-500">Acompanhe o status e acesse suas notas fiscais.</p>
      </div>
      <div className="space-y-4">
        {(ordersQuery.data ?? []).map((order) => (
          <div key={order.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-secondary">Pedido #{order.id}</p>
                <p className="text-xs text-gray-500">
                  Realizado em {format(new Date(order.createdAt), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="badge capitalize">{order.status}</span>
                <span className="font-semibold text-secondary">Total: R$ {order.total.toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {order.items.map((item) => (
                <div key={item.productId} className="flex items-center gap-3 rounded-xl bg-white p-3">
                  <div className="h-12 w-12 rounded-lg bg-gray-200" aria-hidden />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-secondary">{item.product?.name}</p>
                    <p className="text-xs text-gray-500">Qtd {item.quantity}</p>
                  </div>
                </div>
              ))}
            </div>
            {fiscalQuery.data && (
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl bg-white p-4">
                  <p className="text-xs font-semibold uppercase text-gray-500">NFC-e</p>
                  <p className="mt-1 text-sm font-mono text-secondary">{fiscalQuery.data.nfce.chave}</p>
                  <p className="mt-1 text-xs text-gray-500">{fiscalQuery.data.nfce.descricao}</p>
                  <Button asChild variant="ghost" size="sm" className="mt-3 px-0 text-sm font-semibold text-primary">
                    <a href={fiscalQuery.data.nfce.urlConsulta} target="_blank" rel="noreferrer">
                      Consultar chave
                    </a>
                  </Button>
                </div>
                <div className="rounded-xl bg-white p-4">
                  <p className="text-xs font-semibold uppercase text-gray-500">NF-e</p>
                  <p className="mt-1 text-sm font-mono text-secondary">{fiscalQuery.data.nfe.chave}</p>
                  <p className="mt-1 text-xs text-gray-500">{fiscalQuery.data.nfe.descricao}</p>
                  <Button asChild variant="ghost" size="sm" className="mt-3 px-0 text-sm font-semibold text-primary">
                    <a href={fiscalQuery.data.nfe.urlConsulta} target="_blank" rel="noreferrer">
                      Consultar chave
                    </a>
                  </Button>
                </div>
                <div className="rounded-xl bg-white p-4">
                  <p className="text-xs font-semibold uppercase text-gray-500">NFS-e</p>
                  <p className="mt-1 text-sm font-mono text-secondary">
                    Nº {fiscalQuery.data.nfse.numero} — Código {fiscalQuery.data.nfse.codigoVerificacao}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">{fiscalQuery.data.nfse.descricao}</p>
                  <Button asChild variant="ghost" size="sm" className="mt-3 px-0 text-sm font-semibold text-primary">
                    <a href={fiscalQuery.data.nfse.urlConsulta} target="_blank" rel="noreferrer">
                      Consultar nota
                    </a>
                  </Button>
                </div>
              </div>
            )}
            <div className="mt-4 text-sm">
              <Link to="/checkout" className="text-primary hover:text-primary/80">
                Repetir pedido
              </Link>
            </div>
          </div>
        ))}
        {ordersQuery.data?.length === 0 && (
          <p className="text-sm text-gray-500">Você ainda não possui pedidos realizados.</p>
        )}
      </div>
    </div>
  );
}
