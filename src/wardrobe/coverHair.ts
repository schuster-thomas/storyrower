import * as T from 'three';
import type { Outfit } from './store';

/** Clip in the head's bind space so the cut follows the same bone as the hat.
 * The open visor keeps the hairstyle above its band. */
export function coverHair(body:T.SkinnedMesh, hat:Outfit['headwear'], root:T.Group) {
  const material=body.material as T.MeshStandardMaterial;
  const covered=material.clone();
  const previous=material.onBeforeCompile.bind(material);
  const index=body.skeleton.bones.findIndex(b=>b.name==='mixamorigHead');
  const local=body.skeleton.boneInverses[index].clone().multiply(body.bindMatrix);
  const open=hat==='visor' || hat==='crown';
  const bottom=hat==='puffer'||hat==='traffic'||hat==='santa'||hat==='bucket'?-.009:hat==='egg'?-.008:.004;
  covered.customProgramCacheKey=()=>material.customProgramCacheKey()+(open?'-bound-hair':'-covered-head');
  covered.onBeforeCompile=(shader,renderer)=>{
    previous(shader,renderer);
    shader.uniforms.headFrame={value:local};
    shader.uniforms.hatOrigin={value:root.position};
    if(open){
      shader.uniforms.fromHead={value:local.clone().invert()};
      shader.vertexShader='uniform mat4 headFrame, fromHead; uniform vec3 hatOrigin;\n'+shader.vertexShader.replace('#include <begin_vertex>',`
        #include <begin_vertex>
        vec3 h=(headFrame*vec4(position,1.)).xyz-hatOrigin;
        float radius=length(h.xz/vec2(.061,.068));
        float influence=1.-smoothstep(.014,.035,abs(h.y));
        if(radius>1. && radius<2. && influence>0.){
          h.xz*=mix(1.,1./radius,influence);
          transformed=(fromHead*vec4(h+hatOrigin,1.)).xyz;
        }
      `);
      return;
    }
    shader.uniforms.coverage={value:new T.Vector2(bottom,1)};
    shader.vertexShader='uniform mat4 headFrame; uniform vec3 hatOrigin; varying vec3 hatPosition;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nhatPosition=(headFrame*vec4(position,1.)).xyz-hatOrigin;');
    shader.fragmentShader='uniform vec2 coverage; varying vec3 hatPosition;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(hatPosition.y>coverage.x && hatPosition.y<coverage.y && dot(hatPosition.xz,hatPosition.xz)<.016) discard;');
  };
  body.material=covered;
  return ()=>{body.material=material;covered.dispose();};
}
