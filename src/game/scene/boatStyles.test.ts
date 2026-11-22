import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { fitBoat } from './boatStyles';

describe('alternate boat hulls', () => {
  it('restores the original hull and both oars after switching away from wood', () => {
    const root = new T.Group(); root.name = 'Boat';
    const hull = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()); hull.name = 'Hull'; root.add(hull);
    const oars = ['Blade', 'Blade001', 'Blade001_1'].map(name => {
      const part = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
      part.name = name; root.add(part); return { part, geometry: part.geometry, material: part.material };
    });
    const remove = fitBoat(root, 'wooden');
    expect(hull.visible).toBe(false);
    for (const { part, geometry, material } of oars) {
      expect(part.geometry).not.toBe(geometry); expect(part.material).not.toBe(material);
    }
    remove();
    expect(hull.visible).toBe(true);
    expect(root.getObjectByName('CustomHull')).toBeUndefined();
    for (const { part, geometry, material } of oars) {
      expect(part.geometry).toBe(geometry); expect(part.material).toBe(material);
    }
  });

  it('points inflatable normals outward so the upper tube is visible', () => {
    const root = new T.Group(); const remove = fitBoat(root, 'inflatable');
    const geometry = (root.getObjectByName('InflatableChambers') as T.Mesh).geometry;
    const normal = geometry.getAttribute('normal');
    // First station is the front: outside points forward, the top points up.
    expect(normal.getZ(0)).toBeGreaterThan(.9);
    expect(normal.getY(3)).toBeGreaterThan(.9);
    remove();
  });

  it.each(['duck', 'banana', 'bathtub', 'inflatable', 'pizza', 'snail', 'stadium', 'log'] as const)('switches away from %s without leaving attachments on animated oars', style => {
    const root = new T.Group(); root.name = 'Boat';
    const feathers = ['R', 'L'].map(side => {
      const feather = new T.Group(); feather.name = 'Feather' + side; root.add(feather);
      const blade = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
      blade.name = 'Blade001_0'; feather.add(blade);
      return { feather, blade };
    });
    const remove = fitBoat(root, style);
    expect(root.getObjectByName(style === 'log' ? 'LogHull' : style === 'stadium' ? 'StadiumHull' : style === 'inflatable' ? 'InflatableChambers' : 'NoveltyHull')).toBeDefined();
    if (style === 'stadium') {
      expect(root.getObjectByName('RedGrandstand')).toBeInstanceOf(T.Mesh);
      expect(root.getObjectByName('BlueGrandstand')).toBeInstanceOf(T.Mesh);
    }
    root.traverse(obj => {
      if (!(obj as T.Mesh).isMesh) return;
      const positions = (obj as T.Mesh).geometry.getAttribute('position');
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    });
    for (const { feather, blade } of feathers) {
      expect(blade.visible).toBe(false);
      expect(feather.children.length).toBe(2);
    }
    remove();
    expect(root.getObjectByName('CustomHull')).toBeUndefined();
    for (const { feather, blade } of feathers) {
      expect(blade.visible).toBe(true);
      expect(feather.children).toEqual([blade]);
    }
  });
});
