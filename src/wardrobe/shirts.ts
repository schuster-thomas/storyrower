import * as T from 'three';
import type { Outfit } from './store';

function shirtPrint(id: Outfit['shirt']) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const c = canvas.getContext('2d')!;
  const colors = { default:'#fff', chelsea:'#1445b7', norway:'#e3212a', blossom:'#bf638b', danube:'#126b72', disco:'#9f8eb6', traffic:'#ff680b', goldChain:'#d69a4c', zebra:'#f6f3eb' };
  c.fillStyle=colors[id]; c.fillRect(0,0,512,512);
  function polygon(color:string, points:number[][]) {
    c.fillStyle=color; c.beginPath(); points.forEach(([x,y],i)=>i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); c.fill();
  }
  function line(color:string,width:number,x:number,y:number,ex:number,ey:number) {
    c.strokeStyle=color; c.lineWidth=width; c.beginPath(); c.moveTo(x,y); c.lineTo(ex,ey); c.stroke();
  }
  if(id==='chelsea') {
    c.fillStyle='#fff'; c.textAlign='center'; c.font='bold 47px Arial'; c.fillText('SAMSUNG',256,232);
    c.beginPath(); c.arc(332,152,23,0,2*Math.PI); c.strokeStyle='#f2d38a'; c.lineWidth=5; c.stroke();
    c.font='bold 16px Arial'; c.fillText('CFC',332,158);
  } else if(id==='norway') {
    for(const [color,width] of [['#fff8ed',80],['#122552',59]] as const) {
      line(color,width,0,177,512,177);
      line(color,width,176,0,176,512);
    }
    polygon('#dbb565',[[336,154],[369,154],[369,180],[365,191],[352,200],[340,191],[336,180]]);
    polygon('#da2630',[[340,159],[365,159],[365,180],[361,190],[352,196],[343,189],[340,180]]);
    for(const [color,width] of [['#fff8ed',6],['#122552',3]] as const) {
      line(color,width,340,175,365,175);
      line(color,width,350,159,350,193);
    }
  } else if(id==='blossom') {
    const petals = ['#ffe9ef', '#ffd2e1', '#f8a9c8', '#ed88b1'];
    for(let row=0;row<12;row++) for(let column=0;column<12;column++){
      const index=row*12+column;
      const x=(column+.5)*512/12+7*Math.sin(index*2.7);
      const y=(row+.5)*512/12+7*Math.cos(index*1.9);
      const size=12+4*(.5+.5*Math.sin(index*3.1));
      for(const offsetX of [-512,0,512]) for(const offsetY of [-512,0,512]){
        const centerX=x+offsetX, centerY=y+offsetY;
        for(let petal=0;petal<5;petal++){
          const angle=petal*Math.PI*2/5+index*.8;
          c.fillStyle=petals[(index+petal)%petals.length];
          c.beginPath();
          c.ellipse(centerX+size*.7*Math.cos(angle),centerY+size*.7*Math.sin(angle),size,size*.59,angle,0,Math.PI*2);
          c.fill();
        }
        c.fillStyle='#ffdc9b';
        c.beginPath();
        c.arc(centerX,centerY,2.4,0,Math.PI*2);
        c.fill();
      }
    }
  } else if(id==='goldChain') {
    for(let row=0;row<12;row++) for(let column=0;column<12;column++){
      const index=row*12+column;
      const x=(column+.5)*512/12+7*Math.sin(index*2.7);
      const y=(row+.5)*512/12+6*Math.cos(index*1.9);
      c.save();
      c.translate(x,y);
      c.rotate(index*1.8);
      c.fillStyle='#9f5128';
      c.beginPath();
      c.ellipse(0,0,12,8,0,0,2*Math.PI);
      c.fill();
      c.strokeStyle='#4b2618';
      c.lineWidth=4;
      for(const angle of [0,Math.PI]){
        c.beginPath();
        c.ellipse(0,0,12,8,0,angle+.18,angle+2.55);
        c.stroke();
      }
      c.restore();
    }
  } else if(id==='danube') {
    polygon('#eedbb0',[[0,0],[105,0],[512,415],[512,510]]);
    line('#eedbb0',6,335,145,370,181);line('#eedbb0',6,370,145,335,181);
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace=T.SRGBColorSpace;
  if(id==='blossom' || id==='goldChain') texture.wrapS=texture.wrapT=T.RepeatWrapping;
  return texture;
}

// Project the design in the model's rest pose; skinning then carries the fabric through each stroke.
export function dressRower(mesh:T.Mesh, id:Outfit['shirt']) {
  const print=shirtPrint(id);
  const original=mesh.material as T.MeshStandardMaterial;
  const material=original.clone();
  const disco=id==='disco';
  material.roughness=.8;
  const traffic=id==='traffic';
  if(disco || traffic) material.envMap=mirrorEnvironment();
  material.customProgramCacheKey=()=>id;
  material.onBeforeCompile=shader=>{
    shader.uniforms.outfitPrint={value:print};
    shader.vertexShader='varying vec3 clothPos;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nclothPos=position;');
    shader.fragmentShader='varying vec3 clothPos; uniform sampler2D outfitPrint;\n'+shader.fragmentShader.replace('#include <map_fragment>',`
      #include <map_fragment>
      vec3 p=clothPos, col=pow(diffuseColor.rgb,vec3(1.0/2.2));
      bool fabric = (max(col.r,max(col.g,col.b))-min(col.r,min(col.g,col.b)) < .18 && col.r>.27) || (col.r>col.g*2.8 && col.r>col.b*2.);
      // In the bind pose the shorts run from the waist to y=-.25.
      // Their base texture has red panels and pale hems as well as dark seams.
      float chroma=max(col.r,max(col.g,col.b))-min(col.r,min(col.g,col.b));
      bool shorts = p.y>=-.25 && p.y<0. && (chroma<.18
        || (col.r>1.7*col.g && col.r>1.7*col.b && col.g<.34));
      bool outfitFabric = shorts || (p.y>-.04 && p.y<.69 && fabric);
      float tileFace = 0.;
      if(outfitFabric && ${id!=='default'}){
        vec2 uv=vec2(clamp(.5+p.x/.58,.005,.995),clamp((p.y+.01)/.71,.005,.995));
        if(p.z < -.08 && !shorts) uv.x=.012;
        if(shorts) uv=vec2(clamp(.5+p.x/.49,.005,.995),clamp((p.y+.25)/.25,.005,.995));
        diffuseColor.rgb=texture2D(outfitPrint,uv).rgb;
        ${id==='norway' ? 'if(shorts) { float stripe=abs(abs(p.x)-.087); diffuseColor.rgb=stripe<.017?vec3(.006,.019,.084):stripe<.024?vec3(.95,.90,.83):vec3(.77,.016,.024); }' : ''}
        ${id==='zebra' ? `
          float angle=atan(p.x,p.z);
          float wave=p.y*113. + 2.6*sin(3.*angle+p.y*19.) + .85*sin(7.*angle-p.y*29.);
          float stripe=sin(wave)+.25*sin(angle*5.+p.y*41.);
          float edge=max(fwidth(stripe),.01);
          diffuseColor.rgb=mix(vec3(.015,.016,.018),vec3(.93,.91,.86),smoothstep(-edge,edge,stripe));
        ` : ''}
        ${id==='blossom' ? `diffuseColor.rgb=texture2D(outfitPrint,vec2(atan(p.x,p.z)/6.2831853,p.y*1.65)).rgb;` : ''}
        ${id==='chelsea' ? `
          float acrossShoulder=fract((p.z+.062)/.017);
          if(shorts){
            diffuseColor.rgb=vec3(.008,.045,.36);
            if(abs(p.x)>.086 && p.z>-.048 && p.z<.003 && fract((p.z+.048)/.017)<.36) diffuseColor.rgb=vec3(.94);
          }
          if(!shorts && abs(p.x)>.108 && abs(p.x)<.35 && p.z>-.062 && p.z<-.011
            && p.y>.505-.48*abs(p.x) && acrossShoulder<.36) diffuseColor.rgb=vec3(.94);
        ` : ''}
        ${id==='goldChain' ? `
          diffuseColor.rgb=texture2D(outfitPrint,vec2(atan(p.x,p.z)/6.2831853,p.y*1.5)).rgb;
          float chestX=abs(p.x);
          float openingWidth=clamp((p.y-.363)*.35,0.,.089);
          bool front=!shorts && p.z>0.;
          bool chestOpening=front && chestX<openingWidth;
          if(front && p.y>.38 && p.y<.63 && abs(chestX-openingWidth-.016)<.011)
            diffuseColor.rgb=vec3(.36,.135,.035);
          if(front && p.y<.363 && chestX<.012)
            diffuseColor.rgb=vec3(.27,.088,.024);
          if(front && p.y>.09 && p.y<.35 && length(vec2(p.x,mod(p.y,.083)-.042))<.005)
            diffuseColor.rgb=vec3(.24,.20,.18);
          if(chestOpening){
            diffuseColor.rgb=vec3(.61,.22,.055);
            vec2 hairs=vec2(p.x,p.y)*vec2(180.,155.);
            hairs.x+=.38*sin(hairs.y*2.7);
            float strand=length((fract(hairs)-.5)*vec2(2.8,1.));
            float hairline=.49-4.0*p.x*p.x;
            if(chestOpening && p.y<hairline && strand<.23) diffuseColor.rgb=vec3(.095,.035,.012);
          }
        ` : ''}
        ${traffic ? `
          float height=shorts?(p.y+.25)/.25:p.y/.69;
          float stripe=min(abs(height-.27),abs(height-.49));
          float edge=max(fwidth(height),.001);
          tileFace=1.-smoothstep(.049-edge,.049+edge,stripe);
          diffuseColor.rgb=mix(vec3(1.,.139,.004),vec3(.76,.80,.85),tileFace);
        ` : ''}
        ${disco ? `
          vec2 tiles=vec2(atan(p.x,p.z)*7.,p.y*31.);
          vec2 within=fract(tiles);
          tileFace=step(.045,within.x)*step(.045,within.y);
          float tint=fract(sin(dot(floor(tiles),vec2(13.71,17.13)))*4375.18);
          diffuseColor.rgb=mix(vec3(.055,.067,.095),
            mix(vec3(.48,.57,.72),vec3(.86,.76,.93),tint),tileFace);
        ` : ''}
        ${id==='danube' ? "if(abs(p.x)>.205 && p.y>.25) diffuseColor.rgb=vec3(.61,.22,.055);" : ""}
      }
    `);
    if(disco || traffic) shader.fragmentShader=shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif(outfitFabric) roughnessFactor=mix(.85,.16,tileFace);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif(outfitFabric) metalnessFactor=.88*tileFace;');
  };
  mesh.material=material;
  return ()=>{mesh.material=original; material.dispose(); print.dispose();};
}

let reflection: T.CanvasTexture | undefined;

// A small shared reflection panorama also works in levels without an environment probe.
export function mirrorEnvironment() {
  if (reflection) return reflection;
  const canvas=document.createElement('canvas');
  canvas.width=512; canvas.height=256;
  const ctx=canvas.getContext('2d')!;
  const sky=ctx.createLinearGradient(0,0,0,256);
  for(const [offset,color] of [[0,'#172744'],[.34,'#87b5dd'],[.49,'#f6fbff'],[.54,'#405368'],[.72,'#838bb2'],[1,'#212937']] as const) sky.addColorStop(offset,color);
  ctx.fillStyle=sky;ctx.fillRect(0,0,512,256);
  for(const [x,y,w,h,color] of [[32,53,63,38,'#fff8eb'],[262,85,45,13,'#c2ebff'],[370,32,21,80,'#fff'],[431,149,35,27,'#aca1df']] as const){
    ctx.fillStyle=color;ctx.fillRect(x,y,w,h);
  }
  reflection=new T.CanvasTexture(canvas);
  reflection.colorSpace=T.SRGBColorSpace;
  reflection.mapping=T.EquirectangularReflectionMapping;
  return reflection;
}



