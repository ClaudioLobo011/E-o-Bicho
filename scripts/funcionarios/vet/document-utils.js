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
      {
        token: '<LogoClinica>',
        description:
          'Logo da clínica. Ajuste o tamanho com atributos como largura="160" ou altura="120".',
      },
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

function escapeRegex(value) {
  return value.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
}

function buildKeywordRegexes(token) {
  const variants = [];
  if (!token) return variants;

  const escapedToken = escapeRegex(token);
  if (escapedToken) {
    variants.push(new RegExp(escapedToken, 'g'));
  }

  const trimmed = token.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner) {
      const escapedInner = escapeRegex(inner);
      const entityPatterns = [
        { pattern: `&lt;\\s*${escapedInner}\\s*&gt;`, flags: 'gi' },
        { pattern: `&#0*60;\\s*${escapedInner}\\s*&#0*62;`, flags: 'gi' },
        { pattern: `&#x0*3c;\\s*${escapedInner}\\s*&#x0*3e;`, flags: 'gi' },
      ];
      entityPatterns.forEach(({ pattern, flags }) => {
        try {
          variants.push(new RegExp(pattern, flags));
        } catch (_) {
          /* ignore malformed patterns */
        }
      });
    }
  }

  return variants;
}

function getKeywordRegexes(token) {
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  if (!normalizedToken) return [];
  if (!keywordRegexCache.has(normalizedToken)) {
    keywordRegexCache.set(normalizedToken, buildKeywordRegexes(normalizedToken));
  }
  return keywordRegexCache.get(normalizedToken) || [];
}

function escapeHtmlAttribute(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getWindowOrigin() {
  if (typeof window === 'undefined') return '';
  const { location } = window;
  if (!location) return '';

  if (location.origin && location.origin !== 'null') {
    return location.origin;
  }

  const protocol = location.protocol || '';
  const host = location.host || '';
  if (protocol && host) {
    return `${protocol}//${host}`;
  }

  return '';
}

export function resolveDocumentAssetUrl(path) {
  const raw = typeof path === 'string' ? path.trim() : '';
  if (!raw) return '';

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) {
    return raw;
  }

  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  const origin = getWindowOrigin();
  if (!origin) {
    return normalized;
  }

  try {
    return new URL(normalized, origin).href;
  } catch (error) {
    console.error('resolveDocumentAssetUrl', error);
    return `${origin.replace(/\/$/, '')}${normalized}`;
  }
}

const ALLOWED_DIMENSION_UNITS = ['px', '%', 'em', 'rem', 'vw', 'vh', 'vmin', 'vmax', 'cm', 'mm', 'in'];

function normalizeDimension(value, { fallbackUnit = 'px' } = {}) {
  const str = String(value || '').trim();
  if (!str) return '';
  if (str.toLowerCase() === 'auto') return 'auto';
  const match = str.match(/^(\d+(?:\.\d+)?)([a-z%]*)$/i);
  if (!match) return '';
  const unit = (match[2] || fallbackUnit).toLowerCase();
  if (!ALLOWED_DIMENSION_UNITS.includes(unit)) return '';
  return `${match[1]}${unit}`;
}

function parseTagAttributes(rawAttrs) {
  const attrs = {};
  const source = typeof rawAttrs === 'string' ? rawAttrs : '';
  if (!source) return attrs;

  const pattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1] ? match[1].toLowerCase() : '';
    if (!name) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = value;
  }
  return attrs;
}

function pickAttributeValue(attrs, ...names) {
  if (!attrs) return '';
  for (const name of names) {
    if (!name) continue;
    const key = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(attrs, key)) {
      const raw = attrs[key];
      if (raw === null || raw === undefined) continue;
      const value = String(raw).trim();
      if (value) return value;
    }
  }
  return '';
}

function extractTokenTagName(token) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return '';
  const angleMatch = raw.match(/^<\s*([^>\s]+)\s*>$/);
  if (angleMatch && angleMatch[1]) {
    return angleMatch[1].trim();
  }
  return raw.replace(/[<>]/g, '').trim();
}

function buildLogoStyles({ width, height, maxWidth, maxHeight, defaultMaxWidth }) {
  const styles = [];
  const normalizedWidth = width && width !== 'auto' ? width : '';
  const normalizedHeight = height && height !== 'auto' ? height : '';
  const normalizedMaxWidth = maxWidth && maxWidth !== 'auto' ? maxWidth : '';
  const normalizedMaxHeight = maxHeight && maxHeight !== 'auto' ? maxHeight : '';
  const normalizedDefault = normalizeDimension(defaultMaxWidth);

  if (normalizedWidth) {
    styles.push(`width:${normalizedWidth}`);
  }

  const resolvedMaxWidth = normalizedMaxWidth || (!normalizedWidth ? normalizedDefault : '100%');
  if (resolvedMaxWidth) {
    styles.push(`max-width:${resolvedMaxWidth}`);
  }

  if (normalizedHeight) {
    styles.push(`height:${normalizedHeight}`);
  } else {
    styles.push('height:auto');
  }

  if (normalizedMaxHeight) {
    styles.push(`max-height:${normalizedMaxHeight}`);
  }

  styles.push('display:block');
  return styles.join('; ');
}

function applyLogoTokenReplacement(html, token, data) {
  const tagName = extractTokenTagName(token);
  if (!tagName) return html;

  const src = typeof data?.url === 'string' ? data.url.trim() : '';
  const defaultAlt = typeof data?.alt === 'string' ? data.alt.trim() : '';
  const defaultMaxWidth = data?.defaultMaxWidth;
  const pattern = new RegExp(`<${escapeRegex(tagName)}(?:\\s+([^>]*?))?\\s*/?>`, 'gi');

  if (!src) {
    return html.replace(pattern, '');
  }

  return html.replace(pattern, (_, attrText = '') => {
    const attrs = parseTagAttributes(attrText);
    const widthAttr = pickAttributeValue(attrs, 'width', 'largura', 'data-width');
    const heightAttr = pickAttributeValue(attrs, 'height', 'altura', 'data-height');
    const maxWidthAttr = pickAttributeValue(
      attrs,
      'max-width',
      'largura-maxima',
      'maxwidth',
      'data-max-width',
    );
    const maxHeightAttr = pickAttributeValue(
      attrs,
      'max-height',
      'altura-maxima',
      'maxheight',
      'data-max-height',
    );
    const altAttr = pickAttributeValue(attrs, 'alt', 'descricao');
    const titleAttr = pickAttributeValue(attrs, 'title', 'titulo');
    const classAttr = pickAttributeValue(attrs, 'class');
    const idAttr = pickAttributeValue(attrs, 'id');

    const width = normalizeDimension(widthAttr);
    const height = normalizeDimension(heightAttr);
    const maxWidth = normalizeDimension(maxWidthAttr);
    const maxHeight = normalizeDimension(maxHeightAttr);
    const style = buildLogoStyles({ width, height, maxWidth, maxHeight, defaultMaxWidth });

    const attributes = [
      `src="${escapeHtmlAttribute(src)}"`,
      `alt="${escapeHtmlAttribute(altAttr || defaultAlt || '')}"`,
    ];

    if (style) {
      attributes.push(`style="${escapeHtmlAttribute(style)}"`);
    }

    if (titleAttr) {
      attributes.push(`title="${escapeHtmlAttribute(titleAttr)}"`);
    }

    if (classAttr && /^[\w\-\s]+$/.test(classAttr)) {
      attributes.push(`class="${escapeHtmlAttribute(classAttr)}"`);
    }

    if (idAttr && /^[A-Za-z][-A-Za-z0-9_:.]*$/.test(idAttr)) {
      attributes.push(`id="${escapeHtmlAttribute(idAttr)}"`);
    }

    return `<img ${attributes.join(' ')} />`;
  });
}

function getReplacementKind(value) {
  if (!value || typeof value !== 'object') return '';
  return value.__kind || value.kind || '';
}

function isSpecialReplacement(value) {
  return !!getReplacementKind(value);
}

function applySpecialReplacement(html, token, value) {
  const kind = getReplacementKind(value);
  switch (kind) {
    case 'logo':
      return applyLogoTokenReplacement(html, token, value);
    default:
      return html;
  }
}

export function keywordAppearsInContent(content, token) {
  if (typeof content !== 'string') return false;
  const regexes = getKeywordRegexes(token);
  if (!regexes.length) return false;
  return regexes.some((regex) => {
    regex.lastIndex = 0;
    const matches = regex.test(content);
    regex.lastIndex = 0;
    return matches;
  });
}

export function applyKeywordReplacements(html, replacements = {}) {
  if (typeof html !== 'string') return '';
  if (!replacements || typeof replacements !== 'object') {
    return html;
  }

  let output = html;
  Object.entries(replacements).forEach(([token, rawValue]) => {
    if (!isSpecialReplacement(rawValue)) return;
    try {
      output = applySpecialReplacement(output, token, rawValue);
    } catch (error) {
      console.error('applyKeywordReplacements', token, error);
    }
  });

  Object.entries(replacements).forEach(([token, rawValue]) => {
    if (isSpecialReplacement(rawValue)) return;
    const regexes = getKeywordRegexes(token);
    if (!regexes.length) return;
    const value = escapeHtml(rawValue);
    regexes.forEach((regex) => {
      regex.lastIndex = 0;
      output = output.replace(regex, value);
      regex.lastIndex = 0;
    });
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
  { minHeight = 320, padding = 24, background = '#f1f5f9', allowStyles = true, autoResize = true } = {},
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

  if (frame._previewResizeHandler) {
    frame.removeEventListener('load', frame._previewResizeHandler);
    frame._previewResizeHandler = null;
  }

  if (autoResize) {
    const handler = () => updatePreviewFrameHeight(frame, minHeight);
    frame._previewResizeHandler = handler;
    frame.addEventListener('load', handler);
    frame.dataset.previewAutoResize = 'true';
    frame.style.overflow = 'hidden';
    setTimeout(() => updatePreviewFrameHeight(frame, minHeight), 60);
  } else {
    frame.dataset.previewAutoResize = 'false';
    frame.style.overflow = 'auto';
  }

  return sanitized;
}

export function openDocumentPrintWindow(html, { title = 'Documento', styles = '' } = {}) {
  if (typeof window === 'undefined') return false;
  const sanitized = sanitizeDocumentHtml(html, { allowStyles: true });
  const safeContent = sanitized && sanitized.trim()
    ? sanitized
    : '<p style="font-size:14px;color:#475569;">Documento sem conteúdo para impressão.</p>';
  const origin = getWindowOrigin();
  const baseHref = origin ? `${origin.replace(/\/$/, '')}/` : '';
  const baseTag = baseHref ? `<base href="${escapeHtmlAttribute(baseHref)}" />` : '';

  const documentHtml = `<!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        ${baseTag}
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

  const urlFactory = typeof window !== 'undefined' ? window.URL || window.webkitURL : null;
  const supportsBlobUrl =
    typeof Blob !== 'undefined' &&
    !!urlFactory &&
    typeof urlFactory.createObjectURL === 'function';

  let printWindow = null;
  let blobUrl = '';
  let fallbackTimer = null;
  let readinessTimer = null;
  let readyAttempts = 0;
  let printed = false;

  const clearTimers = () => {
    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (readinessTimer) {
      window.clearTimeout(readinessTimer);
      readinessTimer = null;
    }
  };

  const releaseBlob = () => {
    if (blobUrl && urlFactory && typeof urlFactory.revokeObjectURL === 'function') {
      try {
        urlFactory.revokeObjectURL(blobUrl);
      } catch (_) {
        /* ignore */
      }
      blobUrl = '';
    }
  };

  const cleanup = () => {
    clearTimers();
    releaseBlob();
  };

  const triggerPrint = () => {
    if (printed || !printWindow) return;
    printed = true;
    try {
      printWindow.focus();
      printWindow.print();
    } catch (error) {
      console.error('openDocumentPrintWindow', error);
    } finally {
      window.setTimeout(releaseBlob, 1500);
    }
  };

  const waitForReady = () => {
    if (!printWindow) return;

    let isReady = true;
    try {
      const doc = printWindow.document;
      isReady = !!doc && doc.readyState === 'complete';
    } catch (error) {
      isReady = true;
    }

    if (!isReady && readyAttempts < 15) {
      readyAttempts += 1;
      readinessTimer = window.setTimeout(waitForReady, 120);
      return;
    }

    clearTimers();
    window.setTimeout(triggerPrint, 120);
  };

  try {
    if (supportsBlobUrl) {
      const blob = new Blob([documentHtml], { type: 'text/html' });
      blobUrl = urlFactory.createObjectURL(blob);
      printWindow = window.open(blobUrl, '_blank', 'noopener');
    } else {
      printWindow = window.open('', '_blank', 'noopener');
    }

    if (!printWindow) {
      cleanup();
      return false;
    }

    const handleLoad = () => {
      readyAttempts = 0;
      waitForReady();
    };

    if (!blobUrl) {
      const printDocument = printWindow.document;
      if (!printDocument) {
        if (typeof printWindow.close === 'function') {
          try {
            printWindow.close();
          } catch (_) {
            /* ignore */
          }
        }
        cleanup();
        return false;
      }

      printDocument.open();
      printDocument.write(documentHtml);
      printDocument.close();

      if (printWindow.addEventListener) {
        printWindow.addEventListener('load', handleLoad, { once: true });
      }

      if (printDocument.readyState === 'complete') {
        handleLoad();
      } else if (printDocument.addEventListener) {
        const readyListener = () => {
          if (printDocument.readyState === 'complete') {
            printDocument.removeEventListener('readystatechange', readyListener);
            handleLoad();
          }
        };
        printDocument.addEventListener('readystatechange', readyListener);
      }
    } else if (printWindow.addEventListener) {
      printWindow.addEventListener('load', handleLoad, { once: true });
    }

    if (printWindow.addEventListener) {
      printWindow.addEventListener('afterprint', cleanup);
      printWindow.addEventListener('beforeunload', cleanup);
    }

    fallbackTimer = window.setTimeout(() => {
      readyAttempts = 0;
      waitForReady();
    }, blobUrl ? 900 : 600);

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
    cleanup();
    return false;
  }
}
