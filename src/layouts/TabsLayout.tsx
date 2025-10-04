import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AdminHeader from "../components/AdminHeader";
import AdminSidebar from "../components/AdminSidebar";
import TabBar from "../components/TabBar";
import UnsavedGuard from "../components/UnsavedGuard";
import { useTabs } from "../context/TabsContext";
import { isTabId, routeToTab, tabRegistry, type TabId } from "../routes/tab-registry";
import { useIsDesktop } from "../hooks/useMediaQuery";

function getInitialSidebarState(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(min-width: 768px)").matches;
}

export function TabsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { tabs, activeTabId, openTab, setActiveTab, closeTab } = useTabs();
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(getInitialSidebarState);
  const isDesktop = useIsDesktop();

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
    if (!isDesktop) {
      setIsSidebarOpen(false);
    }
  }, [activeTabId, location.pathname, location.search, navigate, isDesktop]);

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

  const sidebarWidthClass = isDesktop && isSidebarOpen ? "w-0 md:w-72 lg:w-80" : "w-0 md:w-0";

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <AdminHeader
        onToggleSidebar={() => setIsSidebarOpen((current) => !current)}
        isSidebarOpen={isSidebarOpen}
      />
      <div className="flex flex-1 overflow-hidden">
        <div
          className={`relative flex-shrink-0 overflow-hidden transition-[width] duration-300 ${sidebarWidthClass}`}
        >
          <AdminSidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
            <TabBar />
            <div className="min-h-0 flex-1 rounded-2xl bg-white p-4 shadow sm:p-6" role="presentation">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <section
                    key={tab.id}
                    role="tabpanel"
                    hidden={!isActive}
                    aria-hidden={!isActive}
                    className={isActive ? "block h-full" : "hidden"}
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
