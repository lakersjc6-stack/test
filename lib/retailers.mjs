export const pokemonRetailers = [
  { id: 'pokemon-center', name: 'Pokémon Center US', domain: 'www.pokemoncenter.com', verified: false, kind: 'product-page', home: 'https://www.pokemoncenter.com/category/trading-card-game' },
  { id: 'target', name: 'Target', domain: 'www.target.com', verified: false, kind: 'product-page', home: 'https://www.target.com/s?searchTerm=pokemon+cards' },
  { id: 'walmart', name: 'Walmart', domain: 'www.walmart.com', verified: false, kind: 'product-page', home: 'https://www.walmart.com/search?q=pokemon+cards' },
];
export function retailerProductUrl(input, store) {
  let url;
  try { url = new URL(String(input)); } catch { throw new Error('Paste the full HTTPS product link for this retailer'); }
  const bare = store.domain.replace(/^www\./, '');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || ![bare, `www.${bare}`].includes(url.hostname)) throw new Error('Product link must belong to the selected retailer');
  const valid = store.id === 'pokemon-center' ? /^\/product\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(url.pathname)
    : store.id === 'target' ? /^\/p\/(?:[^/]+\/)?-\/A-\d+\/?$/.test(url.pathname)
    : store.id === 'walmart' ? /^\/ip\/(?:[a-zA-Z0-9_-]+\/)?\d+\/?$/.test(url.pathname) : false;
  if (!valid) throw new Error('Use a specific product page, not a category or search link');
  url.hostname = store.domain; url.search = ''; url.hash = '';
  return url.href;
}
export function parseRetailerProduct(html, productUrl) {
  if (/verify (?:that )?you (?:are|'re) human|access denied|unusual traffic|robot or human|captcha challenge|checking your browser/i.test(html)) throw new Error('Retailer verification required. Open the product in your browser; monitoring cannot read this page.');
  const candidates = [];
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const types = [value['@type']].flat();
    if (types.includes('Product')) candidates.push(value);
    if (value['@graph']) walk(value['@graph']);
    if (value.mainEntity) walk(value.mainEntity);
  };
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { walk(JSON.parse(match[1].trim())); } catch { /* Malformed structured data does not prove stock. */ }
  }
  const request = new URL(productUrl);
  const main = candidates.filter(p => {
    const reference = p.url || (typeof p['@id'] === 'string' && /^https?:/.test(p['@id']) ? p['@id'] : null);
    if (!reference) return candidates.length === 1;
    try { const url = new URL(reference, request); return url.hostname.replace(/^www\./, '') === request.hostname.replace(/^www\./, '') && url.pathname.replace(/\/$/, '') === request.pathname.replace(/\/$/, ''); } catch { return false; }
  });
  if (main.length !== 1) throw new Error('No unambiguous product stock data. Stock is unknown, not sold out.');
  const product = main[0];
  if (!/pok[eé]mon/i.test(String(product.name || ''))) throw new Error('This workspace monitors Pokémon products only');
  const rawOffers = [product.offers].flat().filter(Boolean).flatMap(o => o['@type'] === 'AggregateOffer' ? [o.offers].flat().filter(Boolean) : [o]);
  const offers = rawOffers.filter(o => ['InStock', 'OutOfStock', 'SoldOut', 'Discontinued', 'PreOrder', 'PreSale', 'LimitedAvailability'].includes(String(o.availability || '').split(/[\/#]/).at(-1)));
  if (!offers.length) throw new Error('Page has no explicit availability data. Stock is unknown.');
  const variants = offers.map((offer, index) => {
    const status = String(offer.availability).split(/[\/#]/).at(-1);
    const price = offer.price !== undefined && Number.isFinite(Number(offer.price)) && Number(offer.price) >= 0 ? Number(offer.price) : null;
    return { id: String(index + 1), title: 'Any', options: ['Any'], available: ['InStock', 'PreOrder', 'PreSale', 'LimitedAvailability'].includes(status), price, currency: offer.priceCurrency || null, offerStatus: status };
  });
  return { handle: productUrl, title: String(product.name), variants, url: productUrl };
}
export async function readBoundedResponse(response, limit = 2_000_000) {
  if (Number(response.headers.get('content-length') || 0) > limit) throw new Error('Retailer response too large');
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > limit) throw new Error('Retailer response too large'); chunks.push(value); } } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString();
}
