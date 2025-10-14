const fs = require("fs");
const path = require("path");

const tailwindPath = path.join(process.cwd(), "node_modules", "tailwindcss");

if (!fs.existsSync(tailwindPath)) {
  console.error(
    "\n[tailwindcss] Dependência ausente: o diretório 'node_modules/tailwindcss' não foi encontrado."
  );
  console.error(
    "Execute 'npm install' na raiz do projeto para baixar as dependências antes de rodar 'npm run dev' ou 'npm run build'."
  );
  console.error(
    "Se o problema persistir, apague a pasta 'node_modules' e o 'package-lock.json' e repita o comando 'npm install'.\n"
  );
  process.exit(1);
}
