import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { findLegacyRoute } from "./route-manifest";

function shouldIgnoreEvent(event: MouseEvent): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey
  );
}

export function useCompatLinkAdapter(): void {
  const navigate = useNavigate();

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (shouldIgnoreEvent(event)) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) {
        return;
      }

      const url = new URL(href, window.location.origin);
      if (!url.pathname.endsWith(".html")) {
        return;
      }

      const match = findLegacyRoute(url.pathname);
      if (!match) {
        return;
      }

      event.preventDefault();
      const destination = `${match.route}${url.search}${url.hash}`;
      navigate(destination);
    }

    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, [navigate]);
}
