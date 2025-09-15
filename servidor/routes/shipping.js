const express = require('express');
const router = express.Router();
const https = require('https');
const Store = require('../models/Store');
const Vehicle = require('../models/Vehicle');
const DeliveryZone = require('../models/DeliveryZone');

// ===== Helpers =====
const geoCache = new Map(); // CEP(dígitos) -> { lat, lng }

function toRad(x) { return x * Math.PI / 180; }
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function normalize(s = '') {
  return s.toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acento
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // remove espaços, hífen, pontuação etc.
}
function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const x = Number(point.lng), y = Number(point.lat);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i].lng), yi = Number(polygon[i].lat);
    const xj = Number(polygon[j].lng), yj = Number(polygon[j].lat);
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function httpsJson(url, headers={}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// OpenStreetMap (Nominatim)
async function geocodeByPostalCode(cepDigits) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&country=Brazil&postalcode=${encodeURIComponent(cepDigits)}&limit=1`;
  const headers = { 'User-Agent': 'EoBichoShipping/1.0 (frete@eobicho.local)' };
  const json = await httpsJson(url, headers);
  if (Array.isArray(json) && json.length) {
    return { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) };
  }
  throw new Error('CEP sem resultado no Nominatim (postalcode).');
}
async function geocodeByAddress(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const headers = { 'User-Agent': 'EoBichoShipping/1.0 (frete@eobicho.local)' };
  const json = await httpsJson(url, headers);
  if (Array.isArray(json) && json.length) {
    return { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) };
  }
  throw new Error('Endereço sem resultado no Nominatim (q).');
}

// ViaCEP
async function viaCep(cepDigits) {
  const url = `https://viacep.com.br/ws/${encodeURIComponent(cepDigits)}/json/`;
  const json = await httpsJson(url);
  if (json && !json.erro) return json;
  throw new Error('CEP não encontrado no ViaCEP.');
}

// Resolve coords + bairro com múltiplos fallbacks
async function resolveCoordsAndBairro(cepRaw, bairroFromQuery) {
  const cepDigits = (cepRaw || '').replace(/\D/g, '');
  if (!cepDigits || cepDigits.length !== 8) {
    throw new Error('CEP inválido.');
  }
  if (geoCache.has(cepDigits)) {
    const cached = geoCache.get(cepDigits);
    return { ...cached, bairro: bairroFromQuery || cached.bairro || '' };
  }

  let bairro = bairroFromQuery || '';
  let coords = null;

  // 1) tenta por postalcode
  try {
    coords = await geocodeByPostalCode(cepDigits);
  } catch (_) { /* continua */ }

  // 2) ViaCEP -> endereço completo
  let vc = null;
  try {
    vc = await viaCep(cepDigits);
    if (!bairro) bairro = vc.bairro || '';
    if (!coords) {
      const parts = [
        vc.logradouro || '',
        bairro || vc.bairro || '',
        vc.localidade || '',
        vc.uf || '',
        'Brasil',
        cepDigits
      ].filter(Boolean).join(', ');
      coords = await geocodeByAddress(parts);
    }
  } catch (_) { /* continua */ }

  // 3) Centro da cidade (fallback final)
  if (!coords && vc && (vc.localidade || vc.uf)) {
    const partsCity = [vc.localidade || '', vc.uf || '', 'Brasil'].filter(Boolean).join(', ');
    coords = await geocodeByAddress(partsCity);
  }

  if (!coords) {
    throw new Error('Não foi possível geocodificar o CEP.');
  }

  geoCache.set(cepDigits, { ...coords, bairro: bairro || (vc && vc.bairro) || '' });
  return { ...coords, bairro: bairro || (vc && vc.bairro) || '' };
}

// ===== Rota principal =====
router.get('/quote', async (req, res) => {
  try {
    const cepRaw = (req.query.cep || '').trim();
    let bairro = (req.query.bairro || '').trim();
    let lat = req.query.lat ? parseFloat(req.query.lat) : null;
    let lng = req.query.lng ? parseFloat(req.query.lng) : null;

    if (!cepRaw) return res.status(400).json({ message: 'Informe o CEP.' });

    // Resolve coords/bairro (com fallbacks)
    if (!(lat && lng) || !bairro) {
      const r = await resolveCoordsAndBairro(cepRaw, bairro);
      lat = lat ?? r.lat;
      lng = lng ?? r.lng;
      bairro = bairro || r.bairro || '';
    }

    // Lojas com geo
    const stores = await Store.find({
      latitude: { $ne: null },
      longitude: { $ne: null }
    });
    if (!stores.length) {
      return res.status(400).json({ message: 'Nenhuma loja com localização cadastrada.' });
    }

    // Loja mais próxima
    let nearest = null, minDist = Infinity;
    stores.forEach(st => {
      if (typeof st.latitude === 'number' && typeof st.longitude === 'number') {
        const d = haversine(lat, lng, st.latitude, st.longitude);
        if (d < minDist) { minDist = d; nearest = st; }
      }
    });
    if (!nearest) {
      return res.status(400).json({ message: 'Não foi possível determinar a loja mais próxima.' });
    }

    // Zonas grátis (raio, polígono, bairro) da loja
    const zones = await DeliveryZone.find({ store: nearest._id, gratis: true });

    const p = { lat, lng };
    let freeReason = null;

    // 1) Raio
    for (const z of zones) {
      if ((z.tipo === 'raio' || z.raioKm) && Number(z.raioKm) > 0) {
        if (minDist <= Number(z.raioKm) + 1e-9) { freeReason = 'raio'; break; }
      }
    }
    // 2) Polígono (mapa)
    if (!freeReason) {
      for (const z of zones) {
        const poly = Array.isArray(z.polygon) ? z.polygon
                  : (Array.isArray(z.poligono) ? z.poligono : null);
        if (poly && poly.length >= 3 && pointInPolygon(p, poly)) {
          freeReason = 'mapa'; break;
        }
      }
    }
    // 3) Bairro
    if (!freeReason && bairro) {
      const bNorm = normalize(bairro);
      for (const z of zones) {
        if (z.tipo === 'bairro' && Array.isArray(z.bairros) && z.bairros.length) {
          const ok = z.bairros.some(b => {
            const bn = normalize(b);
            // bate exato ou por “contém” (cobre casos com sufixos como “RJ” etc.)
            return bn === bNorm || bn.includes(bNorm) || bNorm.includes(bn);
          });
          if (ok) { freeReason = 'bairro'; break; }
        }
      }
    }

    // Veículo mais barato (taxaMin + taxaKm * km)
    const vehicles = await Vehicle.find({});
    if (!vehicles.length) {
      return res.status(400).json({ message: 'Nenhum veículo configurado no admin.' });
    }

    const distKm = minDist;
    const arred2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

    let padrao = Infinity;
    vehicles.forEach(v => {
      const custo = Number(v.taxaMin || 0) + Number(v.taxaKm || 0) * distKm;
      if (custo < padrao) padrao = custo;
    });
    if (!isFinite(padrao)) padrao = 0;
    if (freeReason) padrao = 0;

    const express  = freeReason ? 0 : padrao * 2;
    const agendada = freeReason ? 0 : padrao * 0.9;

    res.json({
      store: {
        id: nearest._id,
        nome: nearest.nome,
        latitude: nearest.latitude,
        longitude: nearest.longitude,
        endereco: nearest.endereco,
        cep: nearest.cep
      },
      address: { cep: cepRaw, bairro, lat, lng },
      distanceKm: arred2(distKm),
      freeReason,
      methods: {
        padrao:   { label: 'Padrão',   price: arred2(padrao) },
        express:  { label: 'Express',  price: arred2(express) },
        agendada: { label: 'Agendada', price: arred2(agendada) },
        pickup:   { label: 'Retire na loja', price: 0 }
      }
    });
  } catch (err) {
    console.error('Erro em /shipping/quote:', err);
    const msg = /geocodificar|CEP inválido|ViaCEP/.test(String(err && err.message))
      ? (err.message || 'CEP inválido.')
      : 'Erro ao calcular frete.';
    // 400 para erros de CEP, 500 para demais
    const status = /geocodificar|CEP inválido|ViaCEP/.test(String(err && err.message)) ? 400 : 500;
    res.status(status).json({ message: msg });
  }
});

module.exports = router;
