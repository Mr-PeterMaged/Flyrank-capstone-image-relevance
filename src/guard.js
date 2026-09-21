// A declared domain constraint, not the retrieval engine. Ranking uses model embeddings.
const aliases = {
  'red fox': ['red fox','red foxes','fox','foxes','vulpes vulpes'],
  'gray wolf': ['gray wolf','grey wolf','wolf','wolves','canis lupus'],
  'domestic dog': ['domestic dog','dog','dogs','puppy','puppies','canis lupus familiaris','canis familiaris'],
  'brown bear': ['brown bear','grizzly','bear','bears','ursus arctos'],
  deer: ['deer','stag','fawn','cervus elaphus'], pizza: ['pizza','pizzas'], coffee: ['coffee','espresso','cappuccino'],
  mountain: ['mountain','mountains','alpine','alps'], forest: ['forest','woodland'],
  car: ['car','cars','automobile','automobiles'], bicycle: ['bicycle','bicycles','bike','cycling'],
};
const categories = { 'red fox':'animal','gray wolf':'animal','domestic dog':'animal','brown bear':'animal',deer:'animal',pizza:'food',coffee:'food',mountain:'landscape',forest:'landscape',car:'vehicle',bicycle:'vehicle' };
export function intent(text) {
  let remaining = text.toLowerCase();
  const matches = new Set();
  // Consume longer scientific names before their prefixes (dog vs wolf).
  const entries = Object.entries(aliases).flatMap(([subject, words]) => words.map((word) => [subject, word])).sort((a,b) => b[1].length - a[1].length);
  for (const [subject, word] of entries) {
    const pattern = new RegExp(`\\b${word}\\b`, 'g');
    if (pattern.test(remaining)) { matches.add(subject); remaining = remaining.replace(pattern, ' '); }
  }
  // An animal article may naturally mention its forest/mountain habitat.
  const animals = [...matches].filter((s) => categories[s] === 'animal');
  if (animals.length) return { subjects: animals, category: 'animal' };
  return { subjects: [...matches], category: matches.size === 1 ? categories[[...matches][0]] : null };
}
export function cosine(a,b) {
  if (a.length !== b.length) throw new Error('embedding_dimension_mismatch');
  let value = 0; for (let i=0;i<a.length;i++) value += a[i]*b[i];
  return Math.max(-1, Math.min(1,value));
}
export function guard(expected, metadata, similarity, config, status = 'ready') {
  const reasons = [];
  if (!metadata || status !== 'ready') reasons.push('Image is awaiting processing or human review.');
  if (!metadata || metadata.confidence < config.confidence) reasons.push('Vision confidence below the acceptance threshold.');
  if (expected.subjects.length !== 1) reasons.push(expected.subjects.length ? 'Article has multiple subjects; human review is required.' : 'Article subject is outside the supported vocabulary; no confident match.');
  if (metadata && expected.subjects.length === 1) {
    if (metadata.subject !== expected.subjects[0]) reasons.push(`Subject mismatch: expected ${expected.subjects[0]}, detected ${metadata.subject}.`);
    if (metadata.category !== expected.category) reasons.push(`Category mismatch: expected ${expected.category}, detected ${metadata.category}.`);
    if (categories[metadata.subject] !== metadata.category) reasons.push('Image subject and category tags are inconsistent.');
  }
  if (!Number.isFinite(similarity) || similarity < config.similarity) reasons.push('Semantic similarity below the acceptance threshold.');
  return { accepted: reasons.length === 0, reasons: reasons.length ? reasons : ['Subject tags, semantic similarity and vision confidence all pass.'] };
}
export function rank(post, candidates, config) {
  const expected = intent(`${post.title} ${post.content}`);
  return candidates.map((image) => {
    const similarity = cosine(post.vector, image.vector);
    return { imageId: image.id, similarity, confidence: image.metadata?.confidence ?? 0,
      ...guard(expected, image.metadata, similarity, config, image.status) };
  }).sort((a,b) => Number(b.accepted)-Number(a.accepted) || b.similarity-a.similarity || a.imageId.localeCompare(b.imageId));
}
