import * as T from 'three';
import { coverHair } from './coverHair';
import { makeGoldChain } from './goldChain';
import { makeSunglasses } from './sunglasses';
import { makeHat } from './hats';
import { dressRower } from './shirts';
import type { Outfit } from './store';

export function fitOutfit(root:T.Object3D, outfit:Outfit) {
  const attached:T.Group[]=[];
  const attach=(boneName:string,part:T.Group)=>{
    const bone=root.getObjectByName('mixamorig'+boneName);
    if(bone) bone.add(part);
    attached.push(part);
  };
  const body=root.getObjectByName('Rower') as T.SkinnedMesh;
  const hat=body && outfit.headwear!=='default' ? makeHat(outfit.headwear) : null;
  if(hat) attach('Head',hat);
  if(body && outfit.sunglasses) attach('Head',makeSunglasses());
  if(body && (outfit.chain || outfit.lei)) {
    const chest = body.skeleton.bones.findIndex(bone=>bone.name==='mixamorigSpine2');
    if(chest>=0 && outfit.chain) attach('Spine2', makeGoldChain(body,chest));
    if(chest>=0 && outfit.lei) attach('Spine2', makeGoldChain(body,chest,true));
  }
  const undress=body && outfit.shirt!=='default' ? dressRower(body,outfit.shirt) : null;
  const uncover=hat ? coverHair(body,outfit.headwear,hat) : null;
  return ()=>{
    uncover?.();
    undress?.();
    for(const group of attached){
      group.removeFromParent();
      group.traverse(obj=>{
        const mesh=obj as T.Mesh<T.BufferGeometry,T.Material>;
        if(obj instanceof T.InstancedMesh) obj.dispose();
        if(mesh.isMesh){mesh.geometry.dispose(); mesh.material.dispose();}
      });
    }
  };
}

