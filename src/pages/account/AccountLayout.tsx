import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { useAuth } from '../../features/auth/useAuth';
import { cn } from '../../shared/lib/cn';
import { Button } from '../../shared/components/base/Button';
import { Input } from '../../shared/components/base/Input';
import { STORAGE_KEYS } from '../../shared/lib/storage-migrations';

const loginSchema = z.object({
  identifier: z.string().min(3, 'Informe e-mail ou CPF'),
  password: z.string().min(3, 'Informe a senha'),
  remember: z.boolean().optional()
});

type LoginForm = z.infer<typeof loginSchema>;

const tabs = [
  { to: '/conta/meus-dados', label: 'Meus Dados' },
  { to: '/conta/pedidos', label: 'Pedidos' }
];

export function AccountLayout() {
  const { user, login, status, error } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '', remember: true }
  });

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEYS.remember);
      if (stored) {
        const parsed = JSON.parse(stored) as { identifier?: string };
        if (parsed.identifier) {
          setValue('identifier', parsed.identifier);
        }
      }
    } catch (err) {
      console.warn('Não foi possível carregar o identificador salvo', err);
    }
  }, [setValue]);

  const onSubmit = async (values: LoginForm) => {
    try {
      await login(values.identifier, values.password);
      if (values.remember) {
        window.localStorage.setItem(STORAGE_KEYS.remember, JSON.stringify({ identifier: values.identifier }));
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.remember);
      }
      toast.success('Login realizado com sucesso!');
      navigate('/conta/meus-dados', { replace: true, state: { from: location.pathname } });
    } catch (err) {
      console.error(err);
      toast.error('Não foi possível autenticar. Verifique os dados.');
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto flex min-h-[70vh] items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 shadow-lg">
          <h1 className="text-2xl font-bold text-secondary">Acesse sua conta</h1>
          <p className="mt-2 text-sm text-gray-500">Use seu e-mail cadastrado ou CPF e a senha padrão de testes: 123456.</p>
          <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <Input
              label="E-mail ou CPF"
              placeholder="nome@exemplo.com"
              {...register('identifier')}
              error={errors.identifier?.message}
            />
            <Input
              label="Senha"
              type="password"
              placeholder="123456"
              {...register('password')}
              error={errors.password?.message}
            />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" {...register('remember')} />
              Lembrar meu acesso neste dispositivo
            </label>
            {status === 'error' && <p className="text-sm text-danger-600">{error ?? 'Falha de autenticação.'}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting || status === 'loading'}>
              {status === 'loading' ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
          <p className="mt-6 text-xs text-gray-500">
            Dica: utilize o e-mail <strong>julia.souza@cliente.com</strong> ou <strong>fernando.melo@eobicho.com.br</strong> com a senha 123456.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10">
      <div className="mb-8 rounded-3xl bg-secondary px-6 py-8 text-white shadow-lg">
        <p className="text-sm uppercase tracking-wide text-white/80">Minha conta</p>
        <h1 className="mt-2 text-3xl font-bold">Gerencie seus dados e pedidos</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/80">
          Altere informações pessoais, acompanhe seus pedidos e atualize suas preferências de assinatura.
        </p>
      </div>
      <nav className="mb-6 flex flex-wrap gap-3">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'rounded-full px-4 py-2 text-sm font-semibold transition',
                isActive ? 'bg-primary text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <Outlet />
      </div>
    </div>
  );
}
