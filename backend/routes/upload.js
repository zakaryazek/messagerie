const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middleware/auth');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads'); // même dossier que celui servi par index.js

const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp'
};

// Signature (premiers octets) réelle de chaque format : on ne fait pas confiance au type annoncé par le client
const SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif': (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
};

async function hasValidSignature(filePath, mimetype) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await handle.read(head, 0, 12, 0);
    return bytesRead >= 12 && SIGNATURES[mimetype](head);
  } finally {
    await handle.close();
  }
}

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    // Extension imposée par le type autorisé (jamais celle envoyée par le client : ".html", ".svg"...)
    cb(null, unique + EXTENSIONS[file.mimetype]);
  }
});

const fileFilter = (req, file, cb) => {
  if (EXTENSIONS[file.mimetype]) cb(null, true);
  else cb(new Error('Type de fichier non autorisé'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// POST /upload — upload une image ou un GIF
router.post('/', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  try {
    if (!(await hasValidSignature(req.file.path, req.file.mimetype))) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(415).json({ error: "Le contenu du fichier ne correspond pas à une image valide" });
    }
  } catch (err) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    console.error('Erreur vérification upload:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});

module.exports = router;