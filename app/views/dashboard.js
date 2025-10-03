const SHORTCUTS = [
  {
    label: 'Gerir Produtos',
    description: 'Adicionar e editar produtos do catálogo',
    icon: 'fa-box-open',
    href: '/pages/admin/admin-produtos.html',
  },
  {
    label: 'Cadastro de Serviços',
    description: 'Organize serviços e grupos de atendimento',
    icon: 'fa-scissors',
    href: '/pages/admin/admin-servicos.html',
  },
  {
    label: 'Funcionários',
    description: 'Controle permissões e dados da equipe',
    icon: 'fa-user-tie',
    href: '/pages/admin/admin-gerir-funcionarios.html',
  },
  {
    label: 'Configurações do PDV',
    description: 'Ajuste caixas, depósitos e integrações',
    icon: 'fa-cash-register',
    href: '/pages/admin/admin-empresa-configuracoes-pdv.html',
  },
  {
    label: 'Financeiro',
    description: 'Cadastre contas e meios de pagamento',
    icon: 'fa-wallet',
    href: '/pages/admin/admin-financeiro-meios-pagamento.html',
  },
  {
    label: 'Importações',
    description: 'Atualize cadastros com planilhas e integrações',
    icon: 'fa-file-import',
    href: '/pages/admin/admin-importar.html',
  },
];

export default async function DashboardView() {
  const root = document.createElement('div');
  root.className = 'w-full p-4 space-y-8';

  const header = document.createElement('section');
  header.innerHTML = `
    <div class="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
      <div>
        <h1 class="text-3xl font-semibold text-gray-900">Painel Principal</h1>
        <p class="text-sm text-gray-600">Escolha uma área para começar a trabalhar.</p>
      </div>
      <div class="flex flex-wrap gap-2 text-xs text-gray-500">
        <span class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">Layout SPA</span>
        <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-600">Sessão ativa</span>
      </div>
    </div>
  `;

  const grid = document.createElement('section');
  grid.className = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3';

  SHORTCUTS.forEach((shortcut) => {
    const link = document.createElement('a');
    link.href = shortcut.href;
    link.dataset.spa = 'true';
    link.className = 'group flex items-start gap-4 rounded-xl px-4 py-3 transition hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30';
    link.innerHTML = `
      <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <i class="fas ${shortcut.icon} text-xl"></i>
      </span>
      <span class="flex flex-col gap-1">
        <span class="text-base font-semibold text-gray-900 group-hover:text-primary">${shortcut.label}</span>
        <span class="text-sm text-gray-500">${shortcut.description}</span>
      </span>
    `;
    grid.appendChild(link);
  });

  const helper = document.createElement('section');
  helper.className = 'space-y-3 text-sm text-gray-600';
  helper.innerHTML = `
    <h2 class="text-lg font-semibold text-gray-800">Dicas rápidas</h2>
    <ul class="list-disc space-y-1 pl-5">
      <li>Use a busca no topo para encontrar qualquer tela instantaneamente.</li>
      <li>Os atalhos acima abrem as telas no mesmo espaço sem recarregar a página.</li>
      <li>Todas as páginas herdam o tema atual e se adaptam à largura total do navegador.</li>
    </ul>
  `;

  root.append(header, grid, helper);
  return root;
}
