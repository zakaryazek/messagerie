import { useState } from 'react';

const COLORS = [
  'bg-blue-600', 'bg-indigo-600', 'bg-purple-600', 'bg-pink-600',
  'bg-emerald-600', 'bg-orange-600', 'bg-teal-600', 'bg-rose-600',
];

// Couleur stable pour un nom donné (même pseudo = même couleur partout)
function colorFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function AvatarInner({ src, name = '?', size = 40, group = false, className = '' }) {
  // Si l'image ne se charge pas (404, fichier supprimé...), on retombe sur l'initiale
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, minWidth: size };

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        style={style}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
        onError={() => setFailed(true)}
      />
    );
  }

  const letter = group ? '#' : (Array.from(name.trim())[0] || '?').toUpperCase();
  return (
    <div
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
      className={`rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 select-none ${group ? 'bg-purple-600' : colorFor(name)} ${className}`}
      aria-label={name}
    >
      {letter}
    </div>
  );
}

// key = src : quand l'image change, l'état « échec » est réinitialisé
export default function Avatar(props) {
  return <AvatarInner key={props.src || 'none'} {...props} />;
}
