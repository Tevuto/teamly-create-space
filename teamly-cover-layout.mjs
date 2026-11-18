export function rootCoverArt(subtitle, title) {
  const lines = (Array.isArray(subtitle) ? subtitle : [subtitle]).map(line => typeof line === 'string' ? line.trim() : '');
  if (!lines.length || lines.length > 2 || lines.some(line => !line)) {
    throw new Error('Укажите фразу для корневой обложки в одной или двух строках.');
  }
  if (lines.length === 1 && lines[0].length > 24) {
    const phrase = lines[0];
    const breaks = [...phrase.matchAll(/\s+/gu)].map(match => match.index);
    const middle = Math.floor(phrase.length / 2);
    const cut = breaks.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
    if (cut > 0) lines.splice(0, 1, phrase.slice(0, cut), phrase.slice(cut).trimStart());
  }
  // Привязка к названию пространства сохраняет форму при повторном запуске.
  let seed = 2166136261;
  for (const character of title) seed = Math.imul(seed ^ character.codePointAt(0), 16777619);
  const offset = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 25) % 23 - 11;
  };
  const topLeft = 164 + offset();
  const topRight = 157 + offset();
  const bottomLeft = 342 + offset();
  const bottomRight = 349 + offset();
  const tile = `M1608 210Q1611 ${topLeft} 1657 ${topLeft}L1742 ${topRight}
    Q1787 ${topRight} 1789 202L1792 299Q1793 ${bottomRight} 1748 ${bottomRight}
    L1652 ${bottomLeft}Q1607 ${bottomLeft} 1607 298Z`;
  return { lines, tile };
}
