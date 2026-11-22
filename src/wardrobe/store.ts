export const headwear = { default: 'Default', cowboy: 'Cowboy Hat', viking: 'Viking Helmet', puffer: 'Pufferfish', visor: 'Sun Visor', egg: 'Fried Egg', football: 'Football', crown: 'Crown', bucket: 'Pith Helmet', traffic: 'Traffic Cone', santa: 'Santa' };
export const shirts = { default: 'Default', chelsea: 'Chelsea Retro', norway: 'Norway', blossom: 'Cherry Blossom', danube: 'Sleeveless', disco: 'Disco Ball', traffic: 'Traffic Cone', goldChain: 'Leopard', zebra: 'Zebra' };
export const accessories = { sunglasses: 'Sunglasses', chain: 'Gold Chain', lei: 'Hawaiian Lei' };
export const boats = { default: 'Default', wooden: 'Wooden Boat', inflatable: 'Red Inflatable', duck: 'Racing Duck', banana: 'Banana Split', bathtub: 'Bathtub', pizza: 'Pizza Cruiser', snail: 'Snail Express', stadium: 'Stadium Splash', log: 'Log Rider' };
export type BoatStyle = keyof typeof boats;
export type Accessory = keyof typeof accessories;
export type Outfit = { headwear: keyof typeof headwear; shirt: keyof typeof shirts; boat: BoatStyle } & Record<Accessory, boolean>;
export const defaults: Outfit = { headwear: 'default', shirt: 'default', boat: 'default', sunglasses: false, chain: false, lei: false };
export interface OutfitFile extends Outfit { v: 1; updatedAt: string }
const key = 'storyrower.outfit';
export function parseOutfit(value: unknown): OutfitFile | null {
  const f = value as (Partial<Omit<OutfitFile, 'headwear' | 'shirt'>> & { headwear?: string; shirt?: string }) | null;
  const hat = f?.headwear === 'cap' || f?.headwear === 'band' ? defaults.headwear : f?.headwear;
  const shirt = f?.shirt === 'office' || f?.shirt === 'leather' || f?.shirt === 'santa' ? defaults.shirt : f?.shirt;
  if (!f || f.v !== 1 || !Object.hasOwn(headwear, hat ?? '') || !Object.hasOwn(shirts, shirt ?? '') || typeof f.updatedAt !== 'string' || !Number.isFinite(Date.parse(f.updatedAt))) return null;
  return { v: 1, updatedAt: f.updatedAt, headwear: hat as Outfit['headwear'], shirt: shirt as Outfit['shirt'], boat: Object.hasOwn(boats, f.boat ?? '') ? f.boat as BoatStyle : 'default', sunglasses: f.sunglasses === true,
    chain: f.chain === true || (f.chain === undefined && shirt === 'goldChain'), lei: f.lei === true };
}
let current: OutfitFile = { ...defaults, v: 1, updatedAt: new Date(0).toISOString() };
try { current = parseOutfit(JSON.parse(localStorage.getItem(key) ?? 'null')) ?? current; } catch { /* private browsing */ }
export const outfitFile = () => current;
const changes = new Set<() => void>();
const edits = new Set<() => void>();
export function onOutfitChanged(fn: () => void) { changes.add(fn); return () => changes.delete(fn); }
export function onOutfitEdited(fn: () => void) { edits.add(fn); return () => edits.delete(fn); }
export function applyOutfit(file: OutfitFile) {
  current = file;
  try { localStorage.setItem(key, JSON.stringify(file)); } catch { /* keep session selection */ }
  changes.forEach(fn => fn());
}
export function selectOutfit(selection: Outfit) {
  if (current.shirt === selection.shirt && current.headwear === selection.headwear && current.sunglasses === selection.sunglasses
    && current.chain === selection.chain && current.lei === selection.lei && current.boat === selection.boat) return;
  applyOutfit({ ...selection, v: 1, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString() });
  edits.forEach(fn => fn());
}
