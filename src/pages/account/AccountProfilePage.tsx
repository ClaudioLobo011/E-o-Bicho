import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { accountSchema, AccountFormValues } from '../../features/account/schemas';
import { useAccountQuery, useUpdateAccount } from '../../features/account/useAccountQuery';
import { Input } from '../../shared/components/base/Input';
import { Button } from '../../shared/components/base/Button';
import { toast } from 'sonner';

export function AccountProfilePage() {
  const { data, isLoading } = useAccountQuery();
  const updateMutation = useUpdateAccount();
  const {
    handleSubmit,
    register,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema)
  });

  useEffect(() => {
    if (data) {
      reset({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        cpf: data.cpf,
        phone: data.phone,
        address: data.address
      });
    }
  }, [data, reset]);

  const onSubmit = async (values: AccountFormValues) => {
    try {
      await updateMutation.mutateAsync(values);
      toast.success('Dados atualizados com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível salvar suas informações.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-secondary">Informações pessoais</h2>
        <p className="text-sm text-gray-500">Atualize seu nome, contato e documento.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Nome" placeholder="Nome" {...register('firstName')} error={errors.firstName?.message} disabled={isLoading} />
        <Input
          label="Sobrenome"
          placeholder="Sobrenome"
          {...register('lastName')}
          error={errors.lastName?.message}
          disabled={isLoading}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="E-mail" type="email" {...register('email')} error={errors.email?.message} disabled />
        <Input label="CPF" placeholder="000.000.000-00" {...register('cpf')} error={errors.cpf?.message} disabled={isLoading} />
      </div>
      <Input label="Telefone" placeholder="(11) 99999-9999" {...register('phone')} error={errors.phone?.message} disabled={isLoading} />
      <div>
        <h3 className="text-lg font-semibold text-secondary">Endereço de entrega</h3>
        <p className="text-sm text-gray-500">Usamos esse endereço nas suas próximas compras.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Rua" {...register('address.street')} error={errors.address?.street?.message} disabled={isLoading} />
        <Input label="Número" {...register('address.number')} error={errors.address?.number?.message} disabled={isLoading} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label="Complemento"
          {...register('address.complement')}
          error={errors.address?.complement?.message}
          disabled={isLoading}
        />
        <Input label="Bairro" {...register('address.district')} error={errors.address?.district?.message} disabled={isLoading} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Input label="Cidade" {...register('address.city')} error={errors.address?.city?.message} disabled={isLoading} />
        <Input label="UF" maxLength={2} {...register('address.state')} error={errors.address?.state?.message} disabled={isLoading} />
        <Input label="CEP" {...register('address.zipCode')} error={errors.address?.zipCode?.message} disabled={isLoading} />
      </div>
      <div className="flex justify-end gap-4">
        <Button type="reset" variant="ghost" onClick={() => reset()} disabled={isSubmitting || isLoading}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting || isLoading}>
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}
