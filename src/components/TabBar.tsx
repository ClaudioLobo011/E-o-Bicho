import { clsx } from "clsx";
import { useTabs } from "../context/TabsContext";
import type { TabId } from "../routes/tab-registry";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabs();

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto rounded-2xl bg-slate-200/60 p-2"
      role="tablist"
      aria-label="Abas do painel administrativo"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="presentation"
            className={clsx(
              "group flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-sm font-medium transition",
              isActive
                ? "border-slate-900/10 bg-white text-slate-900 shadow"
                : "border-transparent bg-transparent text-slate-600 hover:border-slate-300 hover:bg-white/80 hover:text-slate-900"
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id as TabId)}
              className="outline-none"
            >
              <span className="whitespace-nowrap">{tab.title}</span>
            </button>
            {tab.closable ? (
              <button
                type="button"
                className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label={`Fechar ${tab.title}`}
                onClick={() => closeTab(tab.id as TabId)}
              >
                ×
              </button>
            ) : (
              <span className="text-xs text-slate-400" aria-hidden>
                📌
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default TabBar;
