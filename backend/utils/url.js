const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';

// Transforme un chemin relatif (/uploads/xxx.png) en URL complète utilisable par le frontend
function fullUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return API_BASE + url;
}

module.exports = { fullUrl };