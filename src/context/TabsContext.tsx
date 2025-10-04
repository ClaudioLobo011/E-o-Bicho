import {
  createContext,
  createElement,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import type { TabDefinition, TabId } from "../routes/tab-registry";
import { tabRegistry } from "../routes/tab-registry";

export interface TabInstance extends TabDefinition {
  element: ReactElement;
}

interface TabsContextValue {
  tabs: TabInstance[];
  activeTabId: TabId;
  openTab: (id: TabId) => void;
  closeTab: (id: TabId) => void;
  setActiveTab: (id: TabId) => void;
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

function createInstance(definition: TabDefinition): TabInstance {
  return {
    ...definition,
    element: createElement(definition.component)
  };
}

export function TabsProvider({ children }: PropsWithChildren) {
  const [tabs, setTabs] = useState<TabInstance[]>(() => [createInstance(tabRegistry.home)]);
  const [activeTabId, setActiveTabId] = useState<TabId>("home");

  const openTab = useCallback((id: TabId) => {
    const definition = tabRegistry[id];
    if (!definition) {
      return;
    }

    setTabs((current) => {
      if (current.some((tab) => tab.id === id)) {
        return current;
      }
      return [...current, createInstance(definition)];
    });
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id: TabId) => {
    if (id === "home") {
      return;
    }

    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      if (index === -1) {
        return current;
      }
      const nextTabs = current.filter((tab) => tab.id !== id);
      if (activeTabId === id) {
        const fallback = nextTabs[index - 1] ?? nextTabs[0] ?? createInstance(tabRegistry.home);
        setActiveTabId(fallback.id as TabId);
      }
      return nextTabs;
    });
  }, [activeTabId]);

  const setActiveTab = useCallback((id: TabId) => {
    if (!tabRegistry[id]) {
      return;
    }
    setActiveTabId(id);
  }, []);

  const value = useMemo(
    () => ({
      tabs,
      activeTabId,
      openTab,
      closeTab,
      setActiveTab
    }),
    [tabs, activeTabId, openTab, closeTab, setActiveTab]
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("useTabs must be used within a TabsProvider");
  }
  return context;
}
