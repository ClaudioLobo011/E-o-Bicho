import { useEffect, useMemo } from "react";
import rawLegacyHtml from "../../pages/admin/admin-pdv.html?raw";
import { initializeLegacyPdvPage } from "../legacy/pdv-legacy";

type LegacyMarkup = {
  className: string;
  innerHtml: string;
};

function extractLegacyMarkup(html: string): LegacyMarkup {
  const match = html.match(/<main[^>]*class=["']([^"']*)["'][^>]*>([\s\S]*?)<\/main>/i);
  if (!match) {
    return {
      className: "container mx-auto px-4 py-6",
      innerHtml:
        '<div class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">Não foi possível carregar o layout legado do PDV.</div>'
    };
  }

  const [, rawClassName, rawInnerHtml] = match;
  const className = rawClassName.replace(/\s+/g, " ").trim();
  let innerHtml = rawInnerHtml
    .replace(/<div id=["']admin-header-placeholder["']><\/div>/gi, "")
    .replace(
      /<aside[^>]*>\s*<div id=["']admin-sidebar-placeholder["']><\/div>\s*<\/aside>/gi,
      ""
    );

  return {
    className,
    innerHtml: innerHtml.trim()
  };
}

export default function PdvPage() {
  const legacyMarkup = useMemo(() => extractLegacyMarkup(rawLegacyHtml), []);

  useEffect(() => {
    const cleanup = initializeLegacyPdvPage();
    return () => {
      cleanup();
    };
  }, []);

  return (
    <main
      className={legacyMarkup.className}
      dangerouslySetInnerHTML={{ __html: legacyMarkup.innerHtml }}
    />
  );
}
