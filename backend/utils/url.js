const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Transforme un chemin relatif (/uploads/xxx.png) en URL complète utilisable par le frontend
function fullUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return API_BASE + url;
}

// Une image de profil / de groupe doit être un fichier uploadé chez nous (jamais une URL externe).
// Renvoie le chemin relatif (/uploads/xxx.png), null pour « pas d'image », undefined si invalide.
function normalizeUploadUrl(url) {
  if (url === null || url === '') return null;
  if (typeof url !== 'string') return undefined;
  const rel = url.startsWith(API_BASE + '/') ? url.slice(API_BASE.length) : url;
  if (!/^\/uploads\/[^/\\?#]+$/.test(rel) || rel.includes('..')) return undefined;
  if (!fs.existsSync(path.join(UPLOADS_DIR, path.basename(rel)))) return undefined;
  return rel;
}

module.exports = { fullUrl, normalizeUploadUrl };