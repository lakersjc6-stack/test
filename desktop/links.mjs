const retailerHosts = new Set(['pokemoncenter.com', 'www.pokemoncenter.com', 'target.com', 'www.target.com', 'walmart.com', 'www.walmart.com', 'kith.com', 'bdgastore.com', 'undefeated.com']);
export function allowedRetailerLink(input) {
  try { const url = new URL(input); return url.protocol === 'https:' && !url.username && !url.password && !url.port && retailerHosts.has(url.hostname) ? url.href : null; } catch { return null; }
}
