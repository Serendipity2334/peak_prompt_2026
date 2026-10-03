/**
 * Risolve i path dei tre layer a partire dall'id foto in percorso.json.
 * Non inventa dati: solo convenzioni di naming sulle cartelle esistenti.
 */

export function layerPaths(photo) {
  const id = photo.id;
  // bianco_nero usa sempre .jpg (anche per 27/28)
  const bw = `/assets/images/bianco_nero/${id}.jpg`;
  const red = `/assets/images/livelli_rosso_blu/${id}_rosso.png`;
  const blue = `/assets/images/livelli_rosso_blu/${id}_blu.png`;
  return { red, blue, bw };
}
