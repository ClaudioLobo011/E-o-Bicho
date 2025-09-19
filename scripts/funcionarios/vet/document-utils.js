export const KEYWORD_GROUPS = [
  {
    title: 'Tutor',
    items: [
      { token: '<NomeTutor>', description: 'Nome completo do tutor responsável pelo pet.' },
      { token: '<EmailTutor>', description: 'E-mail principal do tutor.' },
      { token: '<TelefoneTutor>', description: 'Telefone ou celular do tutor, formatado.' },
      {
        token: '<DocumentoTutor>',
        description: 'Documento principal (CPF ou CNPJ) informado pelo tutor.',
      },
    ],
  },
  {
    title: 'Pet',
    items: [
      { token: '<NomePet>', description: 'Nome do pet atendido.' },
      { token: '<EspeciePet>', description: 'Espécie do pet (cão, gato, etc.).' },
      { token: '<RacaPet>', description: 'Raça do pet.' },
      { token: '<SexoPet>', description: 'Sexo do pet.' },
      { token: '<NascimentoPet>', description: 'Data de nascimento do pet.' },
      { token: '<IdadePet>', description: 'Idade atual estimada do pet.' },
      { token: '<PesoPet>', description: 'Último peso registrado do pet.' },
      { token: '<MicrochipPet>', description: 'Número de microchip do pet, quando disponível.' },
    ],
  },
  {
    title: 'Atendimento',
    items: [
      { token: '<DataAtendimento>', description: 'Data agendada ou realizada do atendimento.' },
      { token: '<HoraAtendimento>', description: 'Horário do atendimento.' },
      { token: '<NomeServico>', description: 'Nome do serviço ou procedimento veterinário.' },
      { token: '<MotivoConsulta>', description: 'Motivo ou anamnese registrada para a consulta.' },
      { token: '<DiagnosticoConsulta>', description: 'Diagnóstico registrado na consulta.' },
      { token: '<ExameFisicoConsulta>', description: 'Resumo do exame físico registrado.' },
      { token: '<NomeVeterinario>', description: 'Nome do profissional responsável pelo atendimento.' },
    ],
  },
  {
    title: 'Clínica e sistema',
    items: [
      { token: '<NomeClinica>', description: 'Nome da clínica ou unidade onde o atendimento ocorreu.' },
      { token: '<EnderecoClinica>', description: 'Endereço completo da clínica.' },
      { token: '<TelefoneClinica>', description: 'Telefone principal da clínica.' },
      { token: '<WhatsappClinica>', description: 'WhatsApp oficial da clínica.' },
      { token: '<DataAtual>', description: 'Data atual no formato local.' },
      { token: '<HoraAtual>', description: 'Horário atual.' },
      { token: '<DataHoraAtual>', description: 'Data e hora atuais.' },
    ],
  },
];

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  let escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  escaped = escaped.replace(/\r\n|\n|\r/g, '<br />');
  return escaped;
}

export function sanitizeDocumentHtml(html, { allowStyles = false } = {}) {
  if (typeof html !== 'string') return '';
  let safe = html;

  const blockedTagPatterns = [
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi,
    /<object[\s\S]*?>[\s\S]*?<\/object>/gi,
    /<embed[\s\S]*?>[\s\S]*?<\/embed>/gi,
    /<link[^>]*?>/gi,
    /<meta[^>]*?>/gi,
    /<base[^>]*?>/gi,
  ];

  blockedTagPatterns.forEach((pattern) => {
    safe = safe.replace(pattern, '');
  });

  if (!allowStyles) {
    safe = safe.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  }

  safe = safe
    .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(/\s+(?:xlink:)?href\s*=\s*(['"])\s*(?:javascript|vbscript):[^'">]*\1/gi, ' href="#"')
    .replace(/\s+src\s*=\s*(['"])\s*(?:javascript|vbscript):[^'">]*\1/gi, ' src="#"')
    .replace(/url\((['"]?)\s*(?:javascript|vbscript):[^)]*?\1\)/gi, 'url()')
    .replace(/data:text\/html/gi, '');

  return safe;
}

export function extractPlainText(html) {
  if (!html) return '';
  const temp = document.createElement('div');
  temp.innerHTML = html;
  return (temp.textContent || temp.innerText || '').trim();
}

export function getPreviewText(html, maxLength = 220) {
  const text = extractPlainText(html).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length > maxLength) {
    return `${text.slice(0, maxLength).trim()}…`;
  }
  return text;
}

const keywordRegexCache = new Map();

export function applyKeywordReplacements(html, replacements = {}) {
  if (typeof html !== 'string') return '';
  if (!replacements || typeof replacements !== 'object') {
    return html;
  }

  let output = html;
  Object.entries(replacements).forEach(([token, rawValue]) => {
    const normalizedToken = typeof token === 'string' ? token.trim() : '';
    if (!normalizedToken) return;
    const value = escapeHtml(rawValue);
    if (!keywordRegexCache.has(normalizedToken)) {
      const escapedToken = normalizedToken.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
      keywordRegexCache.set(normalizedToken, new RegExp(escapedToken, 'g'));
    }
    const regex = keywordRegexCache.get(normalizedToken);
    if (!regex) return;
    output = output.replace(regex, value);
  });

  return output;
}

function updatePreviewFrameHeight(frame, minHeight = 320) {
  if (!frame) return;
  try {
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) return;
    const body = doc.body;
    const html = doc.documentElement;
    const bodyHeight = body ? Math.max(body.scrollHeight, body.offsetHeight, body.clientHeight) : 0;
    const htmlHeight = html ? Math.max(html.scrollHeight, html.offsetHeight, html.clientHeight) : 0;
    const height = Math.max(bodyHeight, htmlHeight, minHeight);
    frame.style.height = `${height}px`;
  } catch (_) {
    // Ignore preview sizing errors
  }
}

export function renderPreviewFrameContent(
  frame,
  html,
  { minHeight = 320, padding = 24, background = '#f1f5f9', allowStyles = true } = {},
) {
  if (!frame) return '';
  frame.style.minHeight = `${minHeight}px`;
  frame.style.height = `${minHeight}px`;
  const sanitized = sanitizeDocumentHtml(html, { allowStyles });
  const hasContent = !!sanitized && sanitized.trim().length > 0;
  const placeholder = `
    <div class="preview-empty">
      Nenhum conteúdo para pré-visualizar.
    </div>
  `;
  const documentHtml = `<!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <base target="_blank" />
        <style>
          :root { color-scheme: light; }
          *, *::before, *::after { box-sizing: border-box; }
          body { margin: 0; background: ${background}; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; color: #0f172a; }
          .preview-wrapper { padding: ${padding}px; min-height: ${Math.max(minHeight - padding * 2, 0)}px; }
          img { max-width: 100%; height: auto; display: block; }
          table { width: 100%; border-collapse: collapse; }
          .preview-empty {
            display: grid;
            place-items: center;
            min-height: 160px;
            border-radius: 16px;
            border: 1px dashed rgba(148, 163, 184, 0.6);
            background: rgba(148, 163, 184, 0.12);
            color: #475569;
            font-size: 14px;
            line-height: 1.5;
            text-align: center;
            padding: 24px;
          }
        </style>
      </head>
      <body>
        <div class="preview-wrapper">
          ${hasContent ? sanitized : placeholder}
        </div>
      </body>
    </html>`;

  frame.srcdoc = documentHtml;

  if (!frame.dataset.previewInitialized) {
    frame.addEventListener('load', () => updatePreviewFrameHeight(frame, minHeight));
    frame.dataset.previewInitialized = 'true';
  }

  setTimeout(() => updatePreviewFrameHeight(frame, minHeight), 60);

  return sanitized;
}

export function openDocumentPrintWindow(html, { title = 'Documento', styles = '' } = {}) {
  if (typeof window === 'undefined') return false;
  const sanitized = sanitizeDocumentHtml(html, { allowStyles: true });
  const safeContent = sanitized && sanitized.trim()
    ? sanitized
    : '<p style="font-size:14px;color:#475569;">Documento sem conteúdo para impressão.</p>';

  const documentHtml = `<!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>${title ? String(title).replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Documento'}</title>
        <style>
          :root { color-scheme: light; }
          *, *::before, *::after { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 32px;
            background: #f8fafc;
            font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
            color: #0f172a;
            line-height: 1.6;
            font-size: 14px;
          }
          h1, h2, h3, h4, h5, h6 { color: #0f172a; margin-top: 1.2em; }
          table { width: 100%; border-collapse: collapse; }
          table th, table td { border: 1px solid #cbd5f5; padding: 8px; }
          img { max-width: 100%; height: auto; }
          ${styles || ''}
        </style>
      </head>
      <body>${safeContent}</body>
    </html>`;

  let printWindow = null;
  try {
    printWindow = window.open('', '_blank', 'noopener=yes');
    if (!printWindow) {
      return false;
    }

    const printDocument = printWindow.document;
    if (!printDocument) {
      if (typeof printWindow.close === 'function') {
        printWindow.close();
      }
      return false;
    }

    printDocument.open();
    printDocument.write(documentHtml);
    printDocument.close();

    let printed = false;
    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      try {
        printWindow.focus();
        printWindow.print();
      } catch (error) {
        console.error('openDocumentPrintWindow', error);
      }
    };

    let fallbackTimer = window.setTimeout(triggerPrint, 600);

    const handleReady = () => {
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      window.setTimeout(triggerPrint, 120);
    };

    if (printWindow.addEventListener) {
      printWindow.addEventListener('load', handleReady, { once: true });
    }

    if (printDocument.readyState === 'complete') {
      handleReady();
    } else if (printDocument.addEventListener) {
      const readyListener = () => {
        if (printDocument.readyState === 'complete') {
          printDocument.removeEventListener('readystatechange', readyListener);
          handleReady();
        }
      };
      printDocument.addEventListener('readystatechange', readyListener);
    }

    return true;
  } catch (error) {
    console.error('openDocumentPrintWindow', error);
    if (printWindow && typeof printWindow.close === 'function') {
      try {
        printWindow.close();
      } catch (_) {
        /* ignore */
      }
    }
    return false;
  }
}
