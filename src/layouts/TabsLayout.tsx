import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AdminHeader from "../components/AdminHeader";
import AdminSidebar from "../components/AdminSidebar";
import TabBar from "../components/TabBar";
import UnsavedGuard from "../components/UnsavedGuard";
import { useTabs } from "../context/TabsContext";
import { isTabId, routeToTab, tabRegistry, type TabId } from "../routes/tab-registry";

export function TabsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { tabs, activeTabId, openTab, setActiveTab, closeTab } = useTabs();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get("tab");
    let target: TabId = "home";
    if (isTabId(tabParam)) {
      target = tabParam;
    } else {
      const fromRoute = routeToTab.get(location.pathname);
      if (fromRoute) {
        target = fromRoute;
      }
    }
    openTab(target);
    setActiveTab(target);
  }, [location.pathname, location.search, openTab, setActiveTab]);

  useEffect(() => {
    const definition = tabRegistry[activeTabId];
    if (!definition) {
      return;
    }
    const params = new URLSearchParams(location.search);
    if (params.get("tab") !== activeTabId) {
      params.set("tab", activeTabId);
    }
    const searchString = params.toString();
    const nextUrl = `${definition.route}?${searchString}`;
    const currentUrl = `${location.pathname}${location.search}`;
    if (currentUrl !== nextUrl) {
      navigate(nextUrl, { replace: true });
    }
    document.title = definition.title;
    setIsSidebarOpen(false);
  }, [activeTabId, location.pathname, location.search, navigate]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.defaultPrevented) {
        return;
      }
      const isShift = event.shiftKey;
      if (event.key === "w" || event.key === "W") {
        event.preventDefault();
        closeTab(activeTabId);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
        if (currentIndex === -1) {
          return;
        }
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
        setActiveTab(tabs[nextIndex].id as TabId);
        return;
      }

      if (!isShift && event.key >= "1" && event.key <= "9") {
        const index = Number(event.key) - 1;
        if (index < tabs.length) {
          event.preventDefault();
          setActiveTab(tabs[index].id as TabId);
        }
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [tabs, activeTabId, closeTab, setActiveTab]);

  return (
    <div className="min-h-screen bg-slate-100">
      <AdminHeader
        onToggleSidebar={() => setIsSidebarOpen((current) => !current)}
        isSidebarOpen={isSidebarOpen}
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
        <div className="md:sticky md:top-28 md:h-fit md:flex-shrink-0">
          <AdminSidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
        </div>
        <div className="flex-1">
          <div className="flex flex-col gap-4">
            <TabBar />
            <div className="rounded-2xl bg-white p-6 shadow" role="presentation">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <section
                    key={tab.id}
                    role="tabpanel"
                    hidden={!isActive}
                    aria-hidden={!isActive}
                    className={isActive ? "block" : "hidden"}
                  >
                    <UnsavedGuard>{tab.element}</UnsavedGuard>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TabsLayout;
