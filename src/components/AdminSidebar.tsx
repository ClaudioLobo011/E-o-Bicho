import { clsx } from "clsx";
import {
  Fragment,
  useEffect,
  useMemo,
  useState
} from "react";
import { useTabs } from "../context/TabsContext";
import type { TabId } from "../routes/tab-registry";
import { useIsDesktop } from "../hooks/useMediaQuery";

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

interface BaseNode {
  id: string;
  label: string;
  iconClass?: string;
  badge?: string;
}

interface SectionNode extends BaseNode {
  kind: "section";
  children: SidebarNode[];
}

interface TabLinkNode extends BaseNode {
  kind: "tab";
  tabId: TabId;
}

interface ExternalLinkNode extends BaseNode {
  kind: "external";
  href: string;
  target?: string;
}

interface PlaceholderNode extends BaseNode {
  kind: "placeholder";
  description?: string;
}

type SidebarNode = SectionNode | TabLinkNode | ExternalLinkNode | PlaceholderNode;

const SIDEBAR_STRUCTURE: SidebarNode[] = [
  {
    id: "home",
    kind: "tab",
    iconClass: "fas fa-house",
    label: "Página Principal",
    tabId: "home"
  },
  {
    id: "retaguarda",
    kind: "section",
    iconClass: "fas fa-warehouse",
    label: "Retaguarda",
    children: [
      {
        id: "retaguarda-empresa",
        kind: "section",
        iconClass: "fas fa-building",
        label: "Empresa",
        children: [
          {
            id: "retaguarda-empresa-cadastro",
            kind: "tab",
            iconClass: "fas fa-store",
            label: "Cadastro de Empresa",
            tabId: "nossas-lojas"
          },
          {
            id: "retaguarda-empresa-pdv",
            kind: "tab",
            iconClass: "fas fa-cash-register",
            label: "Cadastro de PDV",
            tabId: "cadastro-pdv"
          },
          {
            id: "retaguarda-empresa-config-pdv",
            kind: "tab",
            iconClass: "fas fa-sliders-h",
            label: "Configurações do PDV",
            tabId: "empresa-configuracoes-pdv"
          }
        ]
      }
    ]
  },
  {
    id: "fiscal",
    kind: "section",
    iconClass: "fas fa-file-invoice-dollar",
    label: "Fiscal",
    children: [
      {
        id: "fiscal-icms",
        kind: "tab",
        iconClass: "fas fa-balance-scale",
        label: "Cadastro de ICMS do Simples Nacional",
        tabId: "fiscal-icms-simples"
      },
      {
        id: "fiscal-regras",
        kind: "tab",
        iconClass: "fas fa-scroll",
        label: "Cadastro de Regra de Imposto",
        tabId: "fiscal-regras"
      }
    ]
  },
  {
    id: "financeiro",
    kind: "section",
    iconClass: "fas fa-wallet",
    label: "Financeiro",
    children: [
      {
        id: "financeiro-pagamentos",
        kind: "section",
        iconClass: "fas fa-receipt",
        label: "Pagamentos",
        children: [
          {
            id: "financeiro-meios-pagamento",
            kind: "tab",
            iconClass: "fas fa-credit-card",
            label: "Meios de Pagamento",
            tabId: "financeiro-meios-pagamento"
          }
        ]
      },
      {
        id: "financeiro-contabil",
        kind: "section",
        iconClass: "fas fa-book",
        label: "Contábil",
        badge: "Novo",
        children: [
          {
            id: "financeiro-contabil-conta-contabil",
            kind: "tab",
            iconClass: "fas fa-diagram-project",
            label: "Cadastro de Conta Contábil",
            tabId: "financeiro-contabil-cadastro-conta-contabil"
          },
          {
            id: "financeiro-contabil-contas-receber",
            kind: "tab",
            iconClass: "fas fa-arrow-down-short-wide",
            label: "Cadastro de Contas a Receber",
            tabId: "financeiro-contabil-cadastro-contas-receber"
          },
          {
            id: "financeiro-contabil-contas-pagar",
            kind: "tab",
            iconClass: "fas fa-arrow-up-short-wide",
            label: "Cadastro de Contas a Pagar",
            tabId: "financeiro-contabil-cadastro-contas-pagar"
          },
          {
            id: "financeiro-contabil-conta-corrente",
            kind: "tab",
            iconClass: "fas fa-building-columns",
            label: "Cadastro de Conta Corrente",
            tabId: "financeiro-contabil-cadastro-conta-corrente"
          }
        ]
      }
    ]
  },
  {
    id: "compras",
    kind: "section",
    iconClass: "fas fa-shopping-basket",
    label: "Compras",
    children: [
      {
        id: "compras-estoque",
        kind: "section",
        iconClass: "fas fa-boxes",
        label: "Estoque",
        children: [
          {
            id: "compras-estoque-depositos",
            kind: "tab",
            iconClass: "fas fa-warehouse",
            label: "Cadastro de Depósitos",
            tabId: "depositos"
          },
          {
            id: "compras-estoque-zerar",
            kind: "tab",
            iconClass: "fas fa-broom",
            label: "Zerar Depósito",
            tabId: "zerar-deposito"
          },
          {
            id: "compras-estoque-produtos",
            kind: "tab",
            iconClass: "fas fa-box-open",
            label: "Cadastro de Produtos",
            tabId: "produtos"
          },
          {
            id: "compras-estoque-servicos",
            kind: "tab",
            iconClass: "fas fa-briefcase",
            label: "Cadastro de Serviço",
            tabId: "servicos"
          },
          {
            id: "compras-estoque-categorias",
            kind: "tab",
            iconClass: "fas fa-tags",
            label: "Cadastro de Categorias",
            tabId: "categorias"
          },
          {
            id: "compras-estoque-servicos-grupos",
            kind: "tab",
            iconClass: "fas fa-layer-group",
            label: "Cadastro de Grupo de Serviço",
            tabId: "servicos-grupos"
          }
        ]
      },
      {
        id: "compras-promocoes",
        kind: "section",
        iconClass: "fas fa-bullhorn",
        label: "Promoções",
        children: [
          {
            id: "compras-promocoes-cadastro",
            kind: "tab",
            iconClass: "fas fa-tags",
            label: "Cadastro de Promoções",
            tabId: "promocoes"
          }
        ]
      }
    ]
  },
  {
    id: "rh",
    kind: "section",
    iconClass: "fas fa-user-friends",
    label: "RH",
    children: [
      {
        id: "rh-funcionarios",
        kind: "section",
        iconClass: "fas fa-users",
        label: "Funcionários",
        children: [
          {
            id: "rh-funcionarios-cadastro",
            kind: "tab",
            iconClass: "fas fa-id-badge",
            label: "Cadastro de Funcionários",
            tabId: "gerir-funcionarios"
          },
          {
            id: "rh-funcionarios-veterinario",
            kind: "section",
            iconClass: "fas fa-stethoscope",
            label: "Veterinário",
            children: [
              {
                id: "rh-funcionarios-veterinario-painel",
                kind: "external",
                iconClass: "fas fa-notes-medical",
                label: "Painel Veterinário",
                href: "/pages/funcionarios/veterinario.html"
              },
              {
                id: "rh-funcionarios-veterinario-documentos",
                kind: "external",
                iconClass: "fas fa-folder-open",
                label: "Documentos",
                href: "/pages/funcionarios/vet-documentos.html"
              },
              {
                id: "rh-funcionarios-veterinario-receitas",
                kind: "external",
                iconClass: "fas fa-prescription-bottle-medical",
                label: "Receitas",
                href: "/pages/funcionarios/vet-receitas.html"
              },
              {
                id: "rh-funcionarios-veterinario-assinatura",
                kind: "external",
                iconClass: "fas fa-signature",
                label: "Assinatura Digital",
                href: "/pages/funcionarios/vet-assinatura.html"
              }
            ]
          }
        ]
      },
      {
        id: "rh-clientes",
        kind: "section",
        iconClass: "fas fa-user-group",
        label: "Clientes",
        children: [
          {
            id: "rh-clientes-lista",
            kind: "external",
            iconClass: "fas fa-users",
            label: "Clientes",
            href: "/pages/funcionarios/clientes.html"
          },
          {
            id: "rh-clientes-pedidos",
            kind: "placeholder",
            iconClass: "fas fa-clipboard-list",
            label: "Relação de pedidos",
            description: "Em breve"
          }
        ]
      },
      {
        id: "rh-comissoes",
        kind: "section",
        iconClass: "fas fa-hand-holding-usd",
        label: "Comissões",
        children: [
          {
            id: "rh-comissoes-grupo",
            kind: "placeholder",
            iconClass: "fas fa-layer-group",
            label: "Cadastro de Comissão por Grupo",
            description: "Em breve"
          },
          {
            id: "rh-comissoes-profissional",
            kind: "placeholder",
            iconClass: "fas fa-user-tie",
            label: "Cadastro de Comissão por Profissional",
            description: "Em breve"
          }
        ]
      }
    ]
  },
  {
    id: "petshop",
    kind: "section",
    iconClass: "fas fa-paw",
    label: "PetShop",
    children: [
      {
        id: "petshop-destaques",
        kind: "tab",
        iconClass: "fas fa-star",
        label: "Destaques",
        tabId: "destaques"
      },
      {
        id: "petshop-agenda",
        kind: "external",
        iconClass: "fas fa-calendar-days",
        label: "Agenda Banho & Tosa",
        href: "/pages/funcionarios/banho-e-tosa.html"
      },
      {
        id: "petshop-ficha-clinica",
        kind: "external",
        iconClass: "fas fa-file-medical",
        label: "Ficha Clínica",
        href: "/pages/funcionarios/vet-ficha-clinica.html"
      },
      {
        id: "petshop-comissoes",
        kind: "external",
        iconClass: "fas fa-coins",
        label: "Minhas Comissões",
        href: "/pages/funcionarios/comissoes.html"
      }
    ]
  },
  {
    id: "vendas",
    kind: "section",
    iconClass: "fas fa-cash-register",
    label: "Vendas",
    children: [
      {
        id: "vendas-pdv",
        kind: "tab",
        iconClass: "fas fa-desktop",
        label: "PDV",
        tabId: "pdv"
      }
    ]
  },
  {
    id: "crm",
    kind: "placeholder",
    iconClass: "fas fa-comments",
    label: "CRM",
    description: "Em breve"
  },
  {
    id: "ecommerce",
    kind: "section",
    iconClass: "fas fa-shopping-cart",
    label: "Ecommerce",
    children: [
      {
        id: "ecommerce-importar",
        kind: "tab",
        iconClass: "fas fa-file-import",
        label: "Importar Planilha",
        tabId: "importar"
      }
    ]
  },
  {
    id: "bi",
    kind: "placeholder",
    iconClass: "fas fa-chart-line",
    label: "BI",
    description: "Em breve"
  },
  {
    id: "configuracoes",
    kind: "section",
    iconClass: "fas fa-sliders-h",
    label: "Configurações",
    children: [
      {
        id: "configuracoes-entregas",
        kind: "tab",
        iconClass: "fas fa-truck-fast",
        label: "Configurações de Entrega",
        tabId: "entregas"
      }
    ]
  }
];

function collectActivePath(nodes: SidebarNode[], tabId: TabId): string[] | null {
  for (const node of nodes) {
    if (node.kind === "tab" && node.tabId === tabId) {
      return [];
    }
    if (node.kind === "section") {
      const childPath = collectActivePath(node.children, tabId);
      if (childPath) {
        return [node.id, ...childPath];
      }
    }
  }
  return null;
}

export default function AdminSidebar({ isOpen, onClose }: AdminSidebarProps) {
  const { activeTabId, openTab } = useTabs();
  const isDesktop = useIsDesktop();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const activePath = useMemo(() => {
    if (!activeTabId) {
      return null;
    }
    return collectActivePath(SIDEBAR_STRUCTURE, activeTabId);
  }, [activeTabId]);

  useEffect(() => {
    if (!activePath) {
      return;
    }
    setExpandedSections((current) => {
      let changed = false;
      const next = { ...current };
      for (const id of activePath) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activePath]);

  useEffect(() => {
    if (!isOpen || isDesktop) {
      document.body.classList.remove("overflow-hidden");
      return;
    }
    document.body.classList.add("overflow-hidden");
    return () => {
      document.body.classList.remove("overflow-hidden");
    };
  }, [isOpen, isDesktop]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleResize = () => {
      if (window.matchMedia("(min-width: 768px)").matches) {
        onClose();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen, onClose]);

  const handleSectionToggle = (id: string) => {
    setExpandedSections((current) => ({
      ...current,
      [id]: !current[id]
    }));
  };

  const handleTabClick = (tabId: TabId) => {
    openTab(tabId);
    if (!isDesktop) {
      onClose();
    }
  };

  const renderNode = (node: SidebarNode, depth = 0) => {
    const paddingClass = depth > 0 ? "pl-4" : "";

    if (node.kind === "section") {
      const isExpanded = Boolean(expandedSections[node.id]);
      return (
        <div key={node.id} className={clsx("space-y-2", depth > 0 && "mt-2")}> 
          <button
            type="button"
            onClick={() => handleSectionToggle(node.id)}
            className={clsx(
              "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 transition",
              "hover:bg-slate-100",
              "no-underline",
              paddingClass
            )}
            aria-expanded={isExpanded}
          >
            <span className="inline-flex items-center gap-2">
              {node.iconClass ? (
                <i aria-hidden className={clsx(node.iconClass, "text-emerald-500")}></i>
              ) : null}
              <span>{node.label}</span>
              {node.badge ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  {node.badge}
                </span>
              ) : null}
            </span>
            <i
              aria-hidden
              className={clsx(
                "fas fa-chevron-down text-xs text-slate-500 transition-transform",
                isExpanded && "rotate-180"
              )}
            ></i>
          </button>
          <div
            className={clsx(
              "space-y-1",
              paddingClass,
              "pl-3",
              !isExpanded && "hidden"
            )}
          >
            {node.children.map((child) => (
              <Fragment key={child.id}>{renderNode(child, depth + 1)}</Fragment>
            ))}
          </div>
        </div>
      );
    }

    if (node.kind === "tab") {
      const isActive = activeTabId === node.tabId;
      return (
        <button
          key={node.id}
          type="button"
          onClick={() => handleTabClick(node.tabId)}
          className={clsx(
            "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
            "no-underline",
            paddingClass,
            isActive
              ? "bg-emerald-50 font-semibold text-emerald-700 shadow-sm"
              : "text-slate-600 hover:bg-slate-100"
          )}
        >
          <span className="inline-flex items-center gap-2">
            {node.iconClass ? (
              <i aria-hidden className={clsx(node.iconClass, isActive ? "text-emerald-600" : "text-slate-400")}></i>
            ) : null}
            <span>{node.label}</span>
          </span>
          {isActive ? (
            <span className="sr-only">Aba ativa</span>
          ) : null}
        </button>
      );
    }

    if (node.kind === "external") {
      return (
        <a
          key={node.id}
          href={node.href}
          className={clsx(
            "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 transition",
            "hover:bg-slate-100",
            "no-underline",
            paddingClass
          )}
          onClick={() => {
            if (!isDesktop) {
              onClose();
            }
          }}
        >
          <span className="inline-flex items-center gap-2">
            {node.iconClass ? (
              <i aria-hidden className={clsx(node.iconClass, "text-slate-400")}></i>
            ) : null}
            <span>{node.label}</span>
          </span>
        </a>
      );
    }

    return (
      <div
        key={node.id}
        className={clsx(
          "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-slate-400",
          "bg-slate-50",
          paddingClass
        )}
      >
        <span className="inline-flex items-center gap-2">
          {node.iconClass ? (
            <i aria-hidden className={clsx(node.iconClass, "text-slate-300")}></i>
          ) : null}
          <span>{node.label}</span>
        </span>
        {node.description ? (
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {node.description}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="relative h-full w-full">
      <div
        role="presentation"
        onClick={() => {
          if (!isDesktop) {
            onClose();
          }
        }}
        className={clsx(
          "fixed inset-0 z-40 bg-slate-900/40 transition-opacity md:hidden",
          isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        )}
      ></div>
      <aside
        id="admin-sidebar"
        className={clsx(
          "fixed left-0 top-0 z-50 flex h-full w-72 max-w-full transform flex-col overflow-hidden bg-white shadow-2xl transition-transform duration-300",
          "md:static md:h-auto md:max-h-[calc(100vh-8rem)] md:rounded-2xl md:border md:border-slate-200 md:shadow",
          isOpen ? "translate-x-0 md:translate-x-0" : "-translate-x-full md:-translate-x-full"
        )}
        aria-label="Menu administrativo"
        aria-hidden={!isOpen}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4 md:hidden">
          <span className="text-base font-semibold text-slate-800">Menu Administrativo</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700"
          >
            <span className="sr-only">Fechar menu</span>
            <i aria-hidden className="fas fa-times"></i>
          </button>
        </div>
        <div className="hidden items-center justify-between border-b border-slate-100 px-4 py-4 md:flex">
          <span className="text-base font-semibold text-slate-800">Menu Administrativo</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-4 py-4" aria-label="Navegação do painel">
          <div className="space-y-3">
            {SIDEBAR_STRUCTURE.map((node) => (
              <Fragment key={node.id}>{renderNode(node)}</Fragment>
            ))}
          </div>
        </nav>
      </aside>
    </div>
  );
}
