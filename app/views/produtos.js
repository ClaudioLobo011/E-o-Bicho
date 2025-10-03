export default async function ProdutosView() {
  const root = document.createElement('div');
  root.className = 'w-full p-4';

  root.innerHTML = `
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-gray-800">Gerir Produtos</h1>
      <p class="text-gray-600 mt-1">Interface em construção.</p>
    </header>
  `;

  return root;
}
