import { useEffect, useMemo } from "react";
import rawLegacyHtml from "../../pages/admin/admin-pdv.html?raw";
import { initializeLegacyPdvPage } from "../legacy/pdv-legacy";

type LegacyMarkup = {
  className: string;
  mainHtml: string;
  afterMainHtml: string;
};

function extractLegacyMarkup(html: string): LegacyMarkup {
  const mainMatch = html.match(/<main[^>]*class=["']([^"']*)["'][^>]*>([\s\S]*?)<\/main>/i);
  if (!mainMatch) {
    return {
      className: "container mx-auto px-4 py-6",
      mainHtml:
        '<div class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">Não foi possível carregar o layout legado do PDV.</div>',
      afterMainHtml: ""
    };
  }

  const [, rawClassName, rawInnerHtml] = mainMatch;
  const className = rawClassName.replace(/\s+/g, " ").trim();
  const mainHtml = rawInnerHtml
    .replace(/<div id=["']admin-header-placeholder["']><\/div>/gi, "")
    .replace(
      /<aside[^>]*>\s*<div id=["']admin-sidebar-placeholder["']><\/div>\s*<\/aside>/gi,
      ""
    )
    .trim();

  let afterMainHtml = "";
  const modalsMatch = html.match(/<\/main>([\s\S]*?)(?=<script\b|<\/body>)/i);
  if (modalsMatch) {
    afterMainHtml = modalsMatch[1].trim();
  }

  return {
    className,
    mainHtml,
    afterMainHtml
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
    <>
      <main
        className={legacyMarkup.className}
        dangerouslySetInnerHTML={{ __html: legacyMarkup.mainHtml }}
      />
      {legacyMarkup.afterMainHtml ? (
        <div
          data-legacy-after-main
          style={{ display: "contents" }}
          dangerouslySetInnerHTML={{ __html: legacyMarkup.afterMainHtml }}
        />
      ) : null}
    </>
  );
}
