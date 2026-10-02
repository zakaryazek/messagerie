const { z } = require('zod');

const pseudo = z
  .string({ error: 'Pseudo requis' })
  .trim()
  .min(3, 'Le pseudo doit faire au moins 3 caractères')
  .max(30, 'Le pseudo ne peut pas dépasser 30 caractères')
  .regex(/^[\p{L}\p{N}_. -]+$/u, 'Pseudo : lettres, chiffres, espaces, point, tiret et underscore uniquement');

const email = z
  .string({ error: 'Email requis' })
  .trim()
  .max(255, 'Email trop long')
  .email('Adresse email invalide');

// bcrypt ignore tout ce qui dépasse 72 octets : on refuse plutôt que de tronquer en silence
const password = z
  .string({ error: 'Mot de passe requis' })
  .min(8, 'Le mot de passe doit faire au moins 8 caractères')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Le mot de passe est trop long (72 octets maximum)');

const registerSchema = z.object({ pseudo, email, password });

// Modification du profil : tous les champs sont facultatifs. Une chaîne vide = « pas de changement »
const emptyToUndefined = (v) => (v === '' ? undefined : v);
const updateMeSchema = z.object({
  pseudo: z.preprocess(emptyToUndefined, pseudo.optional()),
  email: z.preprocess(emptyToUndefined, email.optional()),
  currentPassword: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  newPassword: z.preprocess(emptyToUndefined, password.optional()),
  avatar_url: z.string({ error: 'Image de profil invalide' }).max(300, 'Image de profil invalide').nullable().optional(),
  theme: z.enum(['system', 'light', 'dark'], { error: 'Thème invalide' }).optional(),
});

// À la connexion on ne rejoue PAS les règles d'inscription (anciens comptes), on vérifie juste les types
const loginSchema = z.object({
  pseudo: z.string({ error: 'Pseudo et mot de passe requis' }).min(1, 'Pseudo et mot de passe requis').max(50),
  password: z.string({ error: 'Pseudo et mot de passe requis' }).min(1, 'Pseudo et mot de passe requis').max(200),
});

// Renvoie { data } si valide, sinon { error: "premier message d'erreur" }
function validate(schema, input) {
  const result = schema.safeParse(input ?? {});
  return result.success
    ? { data: result.data }
    : { error: result.error.issues[0].message };
}

module.exports = { registerSchema, loginSchema, updateMeSchema, validate };