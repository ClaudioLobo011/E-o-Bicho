import { Suspense } from "react";
import { TabsProvider } from "./context/TabsContext";
import { useCompatLinkAdapter } from "./legacy/compat-link-adapter";
import AppRoutes from "./routes";

export default function App() {
  useCompatLinkAdapter();

  return (
    <TabsProvider>
      <Suspense fallback={<div className="p-8 text-center">Carregando...</div>}>
        <AppRoutes />
      </Suspense>
    </TabsProvider>
  );
}
