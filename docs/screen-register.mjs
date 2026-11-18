function registerRecords(payload) {
  const data = payload?.data ?? payload;
  if (!Array.isArray(data?.events) || !Array.isArray(data.watchlist) ||
      ![...data.events, ...data.watchlist].every(row => row && typeof row.id === 'string' && typeof row.title === 'string')) {
    throw Error('The screening register has an invalid event list.');
  }
  return data;
}

export function readPrivateRegister(text) {
  if (typeof text !== 'string' || text.length > 5_000_000) throw Error('Choose a screening register under 5 MB.');
  let data;
  try { data = registerRecords(JSON.parse(text.replace(/^\uFEFF/, ''))); }
  catch { throw Error('Choose a screening JSON register with events and watchlist arrays.'); }
  const entries = [...data.events, ...data.watchlist];
  const decisions = ['candidate','internal','watch','closed','excluded','unreviewed'];
  if (entries.length > 2000 || !/^\d{4}-\d{2}-\d{2}$/.test(data.asOf || '') ||
      new Set(entries.map(row => row.id)).size !== entries.length ||
      entries.some(row => !decisions.includes(row.screening?.decision) || !row.screening.reason ||
        typeof row.screening.reason !== 'string' || !Array.isArray(row.sources) || !row.sources.length ||
        row.sources.some(source => !source || typeof source.name !== 'string' || typeof source.url !== 'string'))) {
    throw Error('Each private register needs a review date, unique incident IDs, screening decisions, reasons, and source references.');
  }
  return data;
}
