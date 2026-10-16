const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const runtime = fs.readFileSync(path.join(root, 'scripts/core/danfe-a4.js'), 'utf8');

function xmlFixture(count, { longDescription = false, notes = 1, volumes = 1, duplicates = 0 } = {}) {
  const desc = 'Produto de teste com descrição completa e conteúdo preservado ';
  return `<nfeProc><NFe><infNFe Id="NFe35261000000000000000550010000000171787912319">
    <ide><nNF>17</nNF><serie>1</serie><natOp>Transferência de depósitos</natOp><tpNF>1</tpNF><tpAmb>2</tpAmb><mod>55</mod><dhEmi>2026-10-16T10:00:00-03:00</dhEmi></ide>
    <emit><xNome>EMITENTE DE TESTE</xNome><CNPJ>00000000000000</CNPJ><enderEmit><xLgr>Rua de teste</xLgr><nro>1</nro><xMun>Rio de Janeiro</xMun><UF>RJ</UF></enderEmit></emit>
    <dest><xNome>DESTINATÁRIO DE TESTE</xNome><CNPJ>00000000000000</CNPJ></dest>
    ${Array.from({length:count},(_,i)=>`<det nItem="${i+1}"><prod><cProd>COD${i+1}</cProd><xProd>${desc.repeat(longDescription && i===0 ? 200 : (i%3)+1)}FIM${i+1}</xProd><NCM>12345678</NCM><CFOP>6152</CFOP><uCom>UN</uCom><qCom>2</qCom><vUnCom>10</vUnCom><vProd>20</vProd></prod><imposto><ICMS><ICMS00><CST>00</CST></ICMS00></ICMS></imposto></det>`).join('')}
    <total><ICMSTot><vNF>${count*20}</vNF><vProd>${count*20}</vProd></ICMSTot></total>
    <transp><modFrete>9</modFrete>${'<vol><qVol>1</qVol><esp>CAIXA</esp><pesoB>1</pesoB></vol>'.repeat(volumes)}</transp>
    ${duplicates?`<cobr><fat><nFat>1</nFat><vLiq>20</vLiq></fat>${'<dup><nDup>1</nDup><dVenc>2026-10-20</dVenc><vDup>20</vDup></dup>'.repeat(duplicates)}</cobr>`:''}
    <infAdic><infCpl>${'Informação adicional de teste que deve permanecer inteira. '.repeat(notes)}FIM-OBSERVACOES</infCpl></infAdic>
    </infNFe></NFe></nfeProc>`;
}

async function render(page, file, count, options = {}, mode = 'full') {
  const source = fs.readFileSync(path.join(root,'scripts/admin',file),'utf8');
  const start=source.indexOf('  function buildDanfeHtml(');
  const end=source.indexOf('  function openPrintWindow(',start);
  const build=source.slice(start,end);
  const xml=xmlFixture(count,options);
  const html=await page.evaluate(({build,xml,mode})=>{
    const xmlGetText=(el,q)=>el?.querySelector(q)?.textContent || '';
    const formatNumber=(v,d=2)=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
    const formatBRL=v=>formatNumber(v,2);
    const formatDateTimeBR=v=>v;
    const formatChave=v=>v;
    const formatCep=v=>v;
    const normalizeDigits=v=>String(v||'').replace(/\D/g,'');
    const normalizeKeyword=v=>String(v||'').toLowerCase();
    const normalizeString=v=>String(v||'');
    const escapeHtml=v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const isEmprestimoEmissionSelected=()=>false;
    const clientFields={};
    return eval('('+build.trim()+')')(new DOMParser().parseFromString(xml,'text/xml'),{mode});
  },{build,xml,mode});
  await page.setContent(html);
  await page.emulateMedia({media:'print'});
  if (process.env.DANFE_BARCODE_SCRIPT) {
    await page.addScriptTag({content:fs.readFileSync(process.env.DANFE_BARCODE_SCRIPT,'utf8')});
    await page.evaluate(()=>{
      document.querySelectorAll('[data-danfe-barcode]').forEach(svg=>window.JsBarcode(svg,'35261000000000000000550010000000171787912319',{format:'CODE128',displayValue:false,height:48,margin:0,width:1.2}));
      document.querySelectorAll('[data-barcode-fallback]').forEach(el=>el.style.display='none');
    });
  }
  await page.addScriptTag({content:runtime});
  return page.evaluate(()=>window.EoBichoDanfeA4.paginate());
}

test('A4: real builders preserve items, values and text across measured pages', async () => {
  const browser=await chromium.launch({headless:true, ...(process.env.TEST_CHROMIUM_EXECUTABLE?{executablePath:process.env.TEST_CHROMIUM_EXECUTABLE}:{})});
  try {
    const page=await browser.newPage();
    for(const file of ['admin-nfe.js','admin-compras-transferencias-cadastro.js']) {
      for(const [count,opts,mode] of [[0,{},'full'],[1,{},'full'],[17,{},'full'],[80,{},'full'],[300,{},'full'],[3,{longDescription:true},'full'],[4,{notes:100},'full'],[17,{volumes:35},'full'],[17,{duplicates:120},'full'],[80,{},'simple']]) {
        const result=await render(page,file,count,opts,mode);
        const actual=await page.evaluate(()=>{
          const pages=Array.from(document.querySelectorAll('.a4-page'));
          return {
            text:document.body.textContent,
            rows:Array.from(document.querySelectorAll('.items tbody tr')).filter(r=>!r.dataset.itemContinuation).map(r=>Array.from(r.cells,c=>c.textContent)),
            labels:pages.map(p=>p.querySelector('.danfe-folha').textContent),
            notes:pages.map(p=>p.querySelector('.a4-footer table')?.rows[1]?.cells[0]?.textContent || '').join(''),
            descriptions:Array.from(document.querySelectorAll('.items tbody tr')).map(r=>r.cells[document.querySelector('.items colgroup').children.length===15?2:1]?.textContent || '').join(''),
            overflows:pages.flatMap((p,i)=>Array.from(p.querySelectorAll('.a4-flow > :not(.a4-fill)')).filter(el=>el.getBoundingClientRect().bottom>p.querySelector('.a4-flow').getBoundingClientRect().bottom+.5).map(()=>i)),
            footers:pages.map(p=>Math.abs(p.getBoundingClientRect().bottom-p.querySelector('.a4-footer').getBoundingClientRect().bottom)),
            tables:pages.filter(p=>p.querySelector('.items')).map(p=>Array.from(p.querySelector('.items').rows[0].cells,c=>c.getBoundingClientRect().width)),
          };
        });
        const label=`${file}, ${count}, ${JSON.stringify(opts)}, ${mode}`;
        assert.deepEqual(actual.overflows,[],label+' no overflow');
        assert.ok(actual.footers.every(n=>n<1),label+' fixed footer');
        assert.deepEqual(actual.labels,Array.from({length:result.pages},(_,i)=>`Folha ${i+1}/${result.pages}`),label);
        if(count) assert.equal(actual.rows.length,count,label+' item count');
        for(let i=1;i<=count;i++) {
          assert.equal(actual.rows[i-1][0],String(i),label+' item order');
          assert.ok(actual.text.includes('FIM'+i),label+' full description');
          assert.equal(actual.rows[i-1][mode==='full'?9:4],'20,00',label+' value');
        }
        if(mode==='full') assert.equal(actual.notes,'Informação adicional de teste que deve permanecer inteira. '.repeat(opts.notes||1)+'FIM-OBSERVACOES',label+' exact notes preserved');
        if(count) assert.equal(actual.descriptions,Array.from({length:count},(_,i)=>'Produto de teste com descrição completa e conteúdo preservado '.repeat(opts.longDescription&&i===0?200:(i%3)+1)+'FIM'+(i+1)).join(''),label+' exact descriptions preserved');
        for(const widths of actual.tables) widths.forEach((w,i)=>assert.ok(Math.abs(w-actual.tables[0][i])<.1,label+' columns'));
        console.log(label, '=>',result.pages,'pages');
      }
    }
    await render(page,'admin-nfe.js',80);
    if(process.env.DANFE_TEST_OUTPUT) {
      fs.mkdirSync(process.env.DANFE_TEST_OUTPUT,{recursive:true});
      await page.pdf({path:path.join(process.env.DANFE_TEST_OUTPUT,'danfe-a4-80-itens.pdf'),preferCSSPageSize:true,printBackground:true});
      await page.locator('.a4-page').first().screenshot({path:path.join(process.env.DANFE_TEST_OUTPUT,'danfe-a4-pagina-1.png')});
      await page.locator('.a4-page').nth(1).screenshot({path:path.join(process.env.DANFE_TEST_OUTPUT,'danfe-a4-pagina-2.png')});
    }
  } finally { await browser.close(); }
});
