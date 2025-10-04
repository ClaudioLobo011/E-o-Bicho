import { useMemo, useState, useCallback } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import { useProductsQuery } from '../../features/products/useProductsQuery';
import { Product } from '../../entities/product';
import { Table } from '../../shared/components/base/Table';
import { Button } from '../../shared/components/base/Button';
import { Modal } from '../../shared/components/base/Modal';
import { Input } from '../../shared/components/base/Input';
import { adminProductSchema, AdminProductForm } from '../../features/admin-products/schema';

export function AdminProductsPage() {
  const { data } = useProductsQuery();
  const queryClient = useQueryClient();
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const products = data?.data ?? [];

  const { register, handleSubmit, reset, formState } = useForm<AdminProductForm>({
    resolver: zodResolver(adminProductSchema)
  });

  const openCreateModal = useCallback(() => {
    setEditingProduct(null);
    reset({ id: '', name: '', category: '', brand: '', price: 0, stock: 0, promotionalPrice: undefined });
    setModalOpen(true);
  }, [reset]);

  const handleEdit = useCallback((product: Product) => {
    setEditingProduct(product);
    reset({
      id: product.id,
      name: product.name,
      category: product.category,
      brand: product.brand,
      price: product.price,
      promotionalPrice: product.promotionalPrice,
      stock: product.stock
    });
    setModalOpen(true);
  }, [reset]);

  const handleRemove = useCallback((product: Product) => {
    const current = queryClient.getQueryData(['products']) as { data: Product[]; meta: any } | undefined;
    if (!current) return;
    queryClient.setQueryData(['products'], {
      ...current,
      data: current.data.filter((item) => item.id !== product.id)
    });
    toast.success(`Produto ${product.name} removido.`);
  }, [queryClient]);

  const onSubmit = useCallback((values: AdminProductForm) => {
    const current = queryClient.getQueryData(['products']) as { data: Product[]; meta: any } | undefined;
    if (!current) return;

    const payload: Product = {
      id: values.id,
      name: values.name,
      category: values.category,
      brand: values.brand,
      price: values.price,
      promotionalPrice: values.promotionalPrice,
      description: editingProduct?.description ?? 'Produto cadastrado pelo painel administrativo.',
      images: editingProduct?.images ?? ['https://placehold.co/600x400?text=Produto'],
      rating: editingProduct?.rating ?? 0,
      stock: values.stock,
      highlights: editingProduct?.highlights ?? []
    };

    const exists = current.data.findIndex((item) => item.id === values.id);
    if (exists >= 0) {
      current.data[exists] = payload;
      toast.success('Produto atualizado com sucesso.');
    } else {
      current.data.push(payload);
      toast.success('Produto cadastrado com sucesso.');
    }

    queryClient.setQueryData(['products'], { ...current, data: [...current.data] });
    setModalOpen(false);
  }, [editingProduct, queryClient]);

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      { header: 'Produto', accessorKey: 'name' },
      { header: 'Categoria', accessorKey: 'category' },
      {
        header: 'Preço',
        accessorKey: 'price',
        cell: ({ getValue }) => <span>R$ {(getValue<number>() ?? 0).toFixed(2)}</span>
      },
      {
        header: 'Promoção',
        accessorKey: 'promotionalPrice',
        cell: ({ getValue }) => {
          const value = getValue<number | undefined>();
          return value ? <span className="text-primary">R$ {value.toFixed(2)}</span> : <span>—</span>;
        }
      },
      { header: 'Estoque', accessorKey: 'stock' },
      {
        header: 'Ações',
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleEdit(row.original)}>
              Editar
            </Button>
            <Button variant="danger" size="sm" onClick={() => handleRemove(row.original)}>
              Remover
            </Button>
          </div>
        )
      }
    ],
    [handleEdit, handleRemove]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-secondary">Catálogo de produtos</h2>
          <p className="text-sm text-gray-500">Gerencie preços, estoque e informações comerciais.</p>
        </div>
        <Button onClick={openCreateModal}>Novo produto</Button>
      </div>
      <Table data={products} columns={columns} />
      <Modal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title={editingProduct ? 'Editar produto' : 'Novo produto'}
        description="Preencha as informações obrigatórias marcadas com *."
        footer={
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit(onSubmit)} disabled={formState.isSubmitting}>
              Salvar
            </Button>
          </div>
        }
      >
        <form className="grid gap-3" onSubmit={handleSubmit(onSubmit)}>
          <Input label="ID" placeholder="Identificador único" {...register('id')} error={formState.errors.id?.message} />
          <Input label="Nome" placeholder="Nome comercial" {...register('name')} error={formState.errors.name?.message} />
          <Input label="Categoria" {...register('category')} error={formState.errors.category?.message} />
          <Input label="Marca" {...register('brand')} error={formState.errors.brand?.message} />
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              label="Preço"
              type="number"
              step="0.01"
              {...register('price', { valueAsNumber: true })}
              error={formState.errors.price?.message}
            />
            <Input
              label="Preço promocional"
              type="number"
              step="0.01"
              {...register('promotionalPrice', { valueAsNumber: true })}
              error={formState.errors.promotionalPrice?.message}
            />
            <Input
              label="Estoque"
              type="number"
              {...register('stock', { valueAsNumber: true })}
              error={formState.errors.stock?.message}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}
