import { clsx } from "clsx";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent
} from "react";
import { useTabs } from "../context/TabsContext";
import { tabRegistry, type TabDefinition, type TabId } from "../routes/tab-registry";

interface SearchEntry {
  id: TabId;
  label: string;
  subtitle: string;
  searchText: string;
}

const MIN_QUERY_LENGTH = 2;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default function AdminHeader() {
  const { openTab } = useTabs();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const entries = useMemo(() => {
    const definitions = Object.values(tabRegistry) as TabDefinition[];
    return definitions.map((definition) => {
      const cleanedTitle = definition.title
        .replace(/^Admin[:\u2014]?\s*/i, "")
        .replace(/\s+-\s+E o Bicho$/i, "")
        .trim();
      const label = cleanedTitle || definition.title;
      const subtitle = definition.title === label ? `Identificador: ${definition.id}` : definition.title;
      return {
        id: definition.id as TabId,
        label,
        subtitle,
        searchText: normalize([definition.title, label, definition.id, definition.route].join(" "))
      } satisfies SearchEntry;
    });
  }, []);

  const normalizedQuery = useMemo(() => normalize(query), [query]);

  const results = useMemo(() => {
    if (!normalizedQuery || normalizedQuery.length < MIN_QUERY_LENGTH) {
      return [] as SearchEntry[];
    }
    return entries
      .filter((entry) => entry.searchText.includes(normalizedQuery))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [entries, normalizedQuery]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handleClickOutside(event: MouseEvent) {
      if (!rootRef.current) {
        return;
      }
      if (event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!results.length) {
      setHighlightedIndex(-1);
      return;
    }
    if (highlightedIndex === -1 || highlightedIndex >= results.length) {
      setHighlightedIndex(0);
    }
  }, [highlightedIndex, results]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setIsOpen(true);
  };

  const handleSelect = (index: number) => {
    const entry = results[index];
    if (!entry) {
      return;
    }
    openTab(entry.id);
    setIsOpen(false);
    setQuery("");
    setHighlightedIndex(-1);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      if (!results.length) {
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((current) => {
        const next = current + 1;
        if (next >= results.length) {
          return 0;
        }
        return next;
      });
    } else if (event.key === "ArrowUp") {
      if (!results.length) {
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((current) => {
        const next = current - 1;
        if (next < 0) {
          return results.length - 1;
        }
        return next;
      });
    } else if (event.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < results.length) {
        event.preventDefault();
        handleSelect(highlightedIndex);
      }
    } else if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
  };

  const showEmptyState = isOpen && normalizedQuery.length < MIN_QUERY_LENGTH;
  const showNoResults = isOpen && normalizedQuery.length >= MIN_QUERY_LENGTH && results.length === 0;
  const showResults = isOpen && results.length > 0;

  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:gap-6">
        <div className="flex items-center gap-4 md:w-auto">
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700"
            aria-label="Menu do painel"
            disabled
          >
            <span aria-hidden>☰</span>
          </button>
          <a href="/" className="inline-flex">
            <img src="/image/logo.svg" alt="Logotipo E o Bicho" className="h-16 w-auto" />
          </a>
        </div>

        <div
          ref={rootRef}
          className="relative w-full md:flex-1"
          data-admin-screen-search
        >
          <label htmlFor="admin-search-input" className="sr-only">
            Pesquisar telas do painel
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
              <span aria-hidden>🔍</span>
            </span>
            <input
              ref={inputRef}
              id="admin-search-input"
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-controls="admin-search-results"
              placeholder="Buscar telas do painel"
              value={query}
              onChange={handleInputChange}
              onFocus={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-11 pr-4 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />
            <div
              className={clsx(
                "absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl",
                { hidden: !isOpen }
              )}
            >
              {showEmptyState ? (
                <div className="px-4 py-6 text-sm text-slate-500">
                  Comece a digitar para encontrar uma tela.
                </div>
              ) : null}
              {showNoResults ? (
                <div className="px-4 py-6 text-sm text-slate-500">
                  Nenhuma tela encontrada para essa pesquisa.
                </div>
              ) : null}
              {showResults ? (
                <ul
                  id="admin-search-results"
                  role="listbox"
                  className="max-h-80 divide-y divide-slate-100 overflow-auto"
                >
                  {results.map((entry, index) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={highlightedIndex === index}
                        className={clsx(
                          "flex w-full flex-col gap-1 px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-emerald-50",
                          highlightedIndex === index && "bg-emerald-50 text-emerald-900"
                        )}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleSelect(index);
                        }}
                        onMouseEnter={() => setHighlightedIndex(index)}
                      >
                        <span className="font-semibold text-slate-900 leading-tight">{entry.label}</span>
                        <span className="text-xs text-slate-500">{entry.subtitle}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center text-slate-500 md:ml-auto">
          <span className="mr-4 hidden h-6 border-l border-slate-300 md:inline" aria-hidden />
          <span className="text-sm font-semibold">Administrador</span>
        </div>
      </div>
    </header>
  );
}
