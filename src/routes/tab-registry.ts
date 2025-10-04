import type { ComponentType } from "react";
import HomePage from "../pages/HomePage";
import CadastroPdvPage from "../pages/CadastroPdvPage";
import CategoriasPage from "../pages/CategoriasPage";
import DepositosPage from "../pages/DepositosPage";
import DestaquesPage from "../pages/DestaquesPage";
import EmpresaConfiguracoesPdvPage from "../pages/EmpresaConfiguracoesPdvPage";
import EntregasPage from "../pages/EntregasPage";
import FinanceiroContabilCadastroContaContabilPage from "../pages/FinanceiroContabilCadastroContaContabilPage";
import FinanceiroContabilCadastroContaCorrentePage from "../pages/FinanceiroContabilCadastroContaCorrentePage";
import FinanceiroContabilCadastroContasPagarPage from "../pages/FinanceiroContabilCadastroContasPagarPage";
import FinanceiroContabilCadastroContasReceberPage from "../pages/FinanceiroContabilCadastroContasReceberPage";
import FinanceiroMeiosPagamentoPage from "../pages/FinanceiroMeiosPagamentoPage";
import FiscalIcmsSimplesPage from "../pages/FiscalIcmsSimplesPage";
import FiscalRegrasPage from "../pages/FiscalRegrasPage";
import GerirFuncionariosPage from "../pages/GerirFuncionariosPage";
import ImportarPage from "../pages/ImportarPage";
import NossasLojasPage from "../pages/NossasLojasPage";
import PdvPage from "../pages/PdvPage";
import ProdutoEditarPage from "../pages/ProdutoEditarPage";
import ProdutosPage from "../pages/ProdutosPage";
import PromocoesPage from "../pages/PromocoesPage";
import ServicosGruposPage from "../pages/ServicosGruposPage";
import ServicosPage from "../pages/ServicosPage";
import ZerarDepositoPage from "../pages/ZerarDepositoPage";

export interface TabDefinition {
  id: string;
  title: string;
  route: string;
  closable: boolean;
  component: ComponentType;
}

export const tabRegistry = {
  home: {
    id: 'home',
    title: 'Painel de Administração - E o Bicho',
    route: '/app',
    closable: false,
    component: HomePage
  },
  'cadastro-pdv': {
    id: 'cadastro-pdv',
    title: 'Admin: Cadastro de PDV - E o Bicho',
    route: '/app/cadastro-pdv',
    closable: true,
    component: CadastroPdvPage
  },
  'categorias': {
    id: 'categorias',
    title: 'Admin: Categorias - E o Bicho',
    route: '/app/categorias',
    closable: true,
    component: CategoriasPage
  },
  'depositos': {
    id: 'depositos',
    title: 'Admin: Depósitos - E o Bicho',
    route: '/app/depositos',
    closable: true,
    component: DepositosPage
  },
  'destaques': {
    id: 'destaques',
    title: 'Admin: Produtos em Destaque - E o Bicho',
    route: '/app/destaques',
    closable: true,
    component: DestaquesPage
  },
  'empresa-configuracoes-pdv': {
    id: 'empresa-configuracoes-pdv',
    title: 'Admin: Configurações do PDV - E o Bicho',
    route: '/app/empresa-configuracoes-pdv',
    closable: true,
    component: EmpresaConfiguracoesPdvPage
  },
  'entregas': {
    id: 'entregas',
    title: 'Admin: Entregas - E o Bicho',
    route: '/app/entregas',
    closable: true,
    component: EntregasPage
  },
  'financeiro-contabil-cadastro-conta-contabil': {
    id: 'financeiro-contabil-cadastro-conta-contabil',
    title: 'Admin: Cadastro de Conta Contábil - E o Bicho',
    route: '/app/financeiro-contabil-cadastro-conta-contabil',
    closable: true,
    component: FinanceiroContabilCadastroContaContabilPage
  },
  'financeiro-contabil-cadastro-conta-corrente': {
    id: 'financeiro-contabil-cadastro-conta-corrente',
    title: 'Admin: Cadastro de Conta Corrente - E o Bicho',
    route: '/app/financeiro-contabil-cadastro-conta-corrente',
    closable: true,
    component: FinanceiroContabilCadastroContaCorrentePage
  },
  'financeiro-contabil-cadastro-contas-pagar': {
    id: 'financeiro-contabil-cadastro-contas-pagar',
    title: 'Admin: Cadastro de Contas a Pagar - E o Bicho',
    route: '/app/financeiro-contabil-cadastro-contas-pagar',
    closable: true,
    component: FinanceiroContabilCadastroContasPagarPage
  },
  'financeiro-contabil-cadastro-contas-receber': {
    id: 'financeiro-contabil-cadastro-contas-receber',
    title: 'Admin: Cadastro de Contas a Receber - E o Bicho',
    route: '/app/financeiro-contabil-cadastro-contas-receber',
    closable: true,
    component: FinanceiroContabilCadastroContasReceberPage
  },
  'financeiro-meios-pagamento': {
    id: 'financeiro-meios-pagamento',
    title: 'Admin: Meios de Pagamento - E o Bicho',
    route: '/app/financeiro-meios-pagamento',
    closable: true,
    component: FinanceiroMeiosPagamentoPage
  },
  'fiscal-icms-simples': {
    id: 'fiscal-icms-simples',
    title: 'Admin: Cadastro de ICMS - Simples Nacional',
    route: '/app/fiscal-icms-simples',
    closable: true,
    component: FiscalIcmsSimplesPage
  },
  'fiscal-regras': {
    id: 'fiscal-regras',
    title: 'Admin: Regras Fiscais Automáticas',
    route: '/app/fiscal-regras',
    closable: true,
    component: FiscalRegrasPage
  },
  'gerir-funcionarios': {
    id: 'gerir-funcionarios',
    title: 'Gerir Funcionários - Admin',
    route: '/app/gerir-funcionarios',
    closable: true,
    component: GerirFuncionariosPage
  },
  'importar': {
    id: 'importar',
    title: 'Admin: Importar Produtos - E o Bicho',
    route: '/app/importar',
    closable: true,
    component: ImportarPage
  },
  'nossas-lojas': {
    id: 'nossas-lojas',
    title: 'Admin: Nossas Lojas - E o Bicho',
    route: '/app/nossas-lojas',
    closable: true,
    component: NossasLojasPage
  },
  'pdv': {
    id: 'pdv',
    title: 'Admin: PDV - E o Bicho',
    route: '/app/pdv',
    closable: true,
    component: PdvPage
  },
  'produto-editar': {
    id: 'produto-editar',
    title: 'Admin: Editar Produto - E o Bicho',
    route: '/app/produto-editar',
    closable: true,
    component: ProdutoEditarPage
  },
  'produtos': {
    id: 'produtos',
    title: 'Admin: Produtos - E o Bicho',
    route: '/app/produtos',
    closable: true,
    component: ProdutosPage
  },
  'promocoes': {
    id: 'promocoes',
    title: 'Admin: Promoções - E o Bicho',
    route: '/app/promocoes',
    closable: true,
    component: PromocoesPage
  },
  'servicos-grupos': {
    id: 'servicos-grupos',
    title: 'Admin — Cadastro de Grupo de Serviço',
    route: '/app/servicos-grupos',
    closable: true,
    component: ServicosGruposPage
  },
  'servicos': {
    id: 'servicos',
    title: 'Admin — Cadastro de Serviço',
    route: '/app/servicos',
    closable: true,
    component: ServicosPage
  },
  'zerar-deposito': {
    id: 'zerar-deposito',
    title: 'Admin: Zerar Depósito - E o Bicho',
    route: '/app/zerar-deposito',
    closable: true,
    component: ZerarDepositoPage
  }
} as const;

export type TabId = keyof typeof tabRegistry;

export const routeToTab = new Map<string, TabId>([
  ['/app', 'home'],
  ['/app/cadastro-pdv', 'cadastro-pdv'],
  ['/app/categorias', 'categorias'],
  ['/app/depositos', 'depositos'],
  ['/app/destaques', 'destaques'],
  ['/app/empresa-configuracoes-pdv', 'empresa-configuracoes-pdv'],
  ['/app/entregas', 'entregas'],
  ['/app/financeiro-contabil-cadastro-conta-contabil', 'financeiro-contabil-cadastro-conta-contabil'],
  ['/app/financeiro-contabil-cadastro-conta-corrente', 'financeiro-contabil-cadastro-conta-corrente'],
  ['/app/financeiro-contabil-cadastro-contas-pagar', 'financeiro-contabil-cadastro-contas-pagar'],
  ['/app/financeiro-contabil-cadastro-contas-receber', 'financeiro-contabil-cadastro-contas-receber'],
  ['/app/financeiro-meios-pagamento', 'financeiro-meios-pagamento'],
  ['/app/fiscal-icms-simples', 'fiscal-icms-simples'],
  ['/app/fiscal-regras', 'fiscal-regras'],
  ['/app/gerir-funcionarios', 'gerir-funcionarios'],
  ['/app/importar', 'importar'],
  ['/app/nossas-lojas', 'nossas-lojas'],
  ['/app/pdv', 'pdv'],
  ['/app/produto-editar', 'produto-editar'],
  ['/app/produtos', 'produtos'],
  ['/app/promocoes', 'promocoes'],
  ['/app/servicos-grupos', 'servicos-grupos'],
  ['/app/servicos', 'servicos'],
  ['/app/zerar-deposito', 'zerar-deposito']
]);

export function isTabId(value: string | null | undefined): value is TabId {
  if (!value) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(tabRegistry, value);
}
