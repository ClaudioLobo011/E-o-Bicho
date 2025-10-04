import { useEffect } from "react";
import { legacyRoutes } from "../legacy/route-manifest";

export function HomePage() {
  useEffect(() => {
    document.title = "Painel de Administração - E o Bicho";
  }, []);

  return (
    <div className="space-y-6">
      <header className="bg-white shadow rounded-2xl p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Página Principal</h1>
        <p className="mt-2 text-sm text-slate-600">
          Bem-vindo ao novo painel administrativo com sistema de abas. Escolha um módulo no menu ao lado
          ou utilize os atalhos para abrir novas abas.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {legacyRoutes
          .filter((route) => route.tab !== "home")
          .slice(0, 6)
          .map((route) => (
            <article
              key={route.tab}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h2 className="text-base font-medium text-slate-900">{route.title}</h2>
              <p className="mt-2 text-sm text-slate-600">Acesse em {route.route}</p>
            </article>
          ))}
      </section>
    </div>
  );
}

export default HomePage;
