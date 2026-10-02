const rateLimit = require('express-rate-limit');

function make(windowMs, limit, message, extra = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // en-têtes RateLimit-* lisibles par le client
    legacyHeaders: false,
    message: { error: message }, // même format que le reste de l'API : { error }
    ...extra,
  });
}

module.exports = {
  // Filet général contre les abus (par adresse IP)
  apiLimiter: make(60 * 1000, 600, 'Trop de requêtes, réessaie dans une minute.'),

  // Connexion : seules les tentatives ÉCHOUÉES comptent (une connexion réussie ne consomme rien)
  loginLimiter: make(
    15 * 60 * 1000, 10,
    'Trop de tentatives de connexion. Réessaie dans 15 minutes.',
    { skipSuccessfulRequests: true }
  ),

  // Inscription
  registerLimiter: make(60 * 60 * 1000, 20, "Trop d'inscriptions depuis cette adresse. Réessaie plus tard."),

  // Envoi de fichiers
  uploadLimiter: make(10 * 60 * 1000, 60, "Trop d'envois de fichiers. Réessaie dans quelques minutes."),
};