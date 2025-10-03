export default async function DashboardView() {
  const root = document.createElement('div');
  root.className = 'w-full p-4';

  root.innerHTML = `
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-gray-800">Painel Principal</h1>
      <p class="text-gray-600 mt-1">Selecione uma opção para começar.</p>
    </header>
    <section class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      <a data-spa href="/pages/admin/produtos" class="flex items-center justify-between rounded-xl border border-gray-200 bg-white/20 p-6 hover:border-primary/60 hover:bg-primary/5 transition">
        <div>
          <h2 class="text-lg font-semibold text-gray-800">Gerir Produtos</h2>
          <p class="text-sm text-gray-600">Adicionar e editar produtos</p>
        </div>
        <span class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <i class="fas fa-box-open"></i>
        </span>
      </a>
    </section>
  `;

  return root;
}
