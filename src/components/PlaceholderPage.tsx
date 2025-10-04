interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="space-y-4">
      <header className="rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description ? (
          <p className="mt-2 text-sm text-slate-600">{description}</p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Esta tela está sendo migrada para o novo painel em SPA. Algumas funcionalidades ainda podem
            estar em desenvolvimento.
          </p>
        )}
      </header>
    </div>
  );
}

export default PlaceholderPage;
