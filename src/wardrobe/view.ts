import * as T from 'three';
import { Water } from '../game/scene/Water';
import { Boat } from '../game/scene/Boat';
import { bindFullscreenButton, FS_BUTTON } from '../ui/fullscreen';
import { ICON_BACK, LOGO } from '../ui/icons';
import { bindDriveButton, DRIVE_BUTTON } from '../ui/driveButton';
import { accessories, boats, defaults, headwear, shirts, onOutfitChanged, outfitFile, selectOutfit, type Accessory, type Outfit } from './store';
import './wardrobe.css';

const THUMB_W=160,THUMB_H=114;
/** button pictures stay for the session – the model only changes with a reload */
const thumbs=new Map<string,HTMLCanvasElement>();

export function mountWardrobe(root: HTMLElement) {
  function options(category: keyof Outfit | 'accessories', title: string, choices: Record<string,string>) {
    return `<section><h2>${title}</h2><div class="outfit-options">${Object.entries(choices).map(([id,label]) =>
      `<button type="button" data-category="${category}" data-option="${id}"><canvas width="${THUMB_W}" height="${THUMB_H}" aria-hidden="true"></canvas><span>${label}</span></button>`).join('')}</div></section>`;
  }
  root.innerHTML = `<div class="menu"><header class="set-bar">
      <a class="back-pill" href="#/">${ICON_BACK}Home</a>
      ${LOGO}
      <div class="bar-right">${DRIVE_BUTTON}${FS_BUTTON}</div>
    </header>
    <main class="menu-page"><h1 class="menu-title">Customize rower</h1><div class="wardrobe">
      <div class="outfit-controls">${options('boat','Boat',boats)}${options('headwear','Headwear',headwear)}${options('shirt','Shirt',shirts)}${options('accessories','Accessories',accessories)}</div>
      <div class="outfit-stage" aria-label="Animated 3D outfit preview"><span role="status">Loading rower…</span></div>
    </div></main></div>`;
  const offFs = bindFullscreenButton(root.querySelector<HTMLButtonElement>('[data-fs]')!);
  const offDrive = bindDriveButton(root.querySelector('.drive-wrap')!);
  const stage=root.querySelector<HTMLElement>('.outfit-stage')!;
  const buttons=Array.from(root.querySelectorAll<HTMLButtonElement>('[data-option]'));
  let boat: Boat | undefined;
  let showBoat = false;
  function refresh() {
    const selection=outfitFile();
    boat?.setOutfit(selection);
    for(const btn of buttons) btn.setAttribute('aria-pressed',String(btn.dataset.category==='accessories' ? selection[btn.dataset.option as Accessory] : selection[btn.dataset.category as keyof Outfit]===btn.dataset.option));
  }
  for(const btn of buttons) btn.onclick=()=>{
    showBoat=btn.dataset.category==='boat';
    const selected=outfitFile();
    const id=btn.dataset.option!;
    selectOutfit({...selected,...(btn.dataset.category==='accessories' ? {[id]:!selected[id as Accessory]} : {[btn.dataset.category!]:id})});
  };
  refresh();
  const off=onOutfitChanged(refresh);
  const thumbKey=(btn:HTMLButtonElement)=>btn.dataset.category+':'+btn.dataset.option;
  const paint=(btn:HTMLButtonElement,picture:HTMLCanvasElement)=>btn.querySelector('canvas')!.getContext('2d')!.drawImage(picture,0,0);
  // pictures made on an earlier visit come straight from memory, the rest are rendered later
  const missing=buttons.filter(btn=>{
    const picture=thumbs.get(thumbKey(btn));
    if(picture) paint(btn,picture);
    return !picture;
  });
  let closed=false,stop=()=>{};
  // WebGL, the model and its shaders only start once the page is on screen – the menu reacts at once
  const start=requestAnimationFrame(()=>setTimeout(()=>{ if(!closed) stop=startPreview(); }));
  return ()=>{closed=true;cancelAnimationFrame(start);stop();off();offDrive();offFs();};

  function startPreview() {
    let renderer:T.WebGLRenderer;
    try { renderer=new T.WebGLRenderer({antialias:true}); }
    catch { stage.textContent='3D preview requires WebGL.'; return ()=>{}; }
    const scene=new T.Scene();
    scene.background=new T.Color(0xc8e5ec);
    scene.add(new T.HemisphereLight(0xfffaf1,0x879bab,1.28));
    const sun=new T.DirectionalLight(0xffeddf,2.65);sun.position.set(-3,5,4);scene.add(sun);
    const rim=new T.DirectionalLight(0xcceaff,1.5);rim.position.set(2,3,-3);scene.add(rim);
    const water=new Water([64,128]);
    scene.add(water.mesh);
    const daylight={time:0,boatZ:0,speed:0,swell:0,water:new T.Color(0x387e97),sky:new T.Color(0xc8e5ec),sunColor:new T.Color(0xffedd4),sunDir:sun.position.clone().normalize(),light:1};
    water.milk=0;water.update(daylight);
    const camera=new T.PerspectiveCamera(32,1,.02,150);
    const thumbCamera=new T.PerspectiveCamera(32,THUMB_W/THUMB_H,.02,150);
    const rower=new Boat(false);scene.add(rower.group);
    boat=rower;
    // a second, hidden rower wears one option at a time for the pictures on the buttons
    const model=missing.length ? new Boat(false,defaults) : null;
    if(model){model.group.visible=false;scene.add(model.group);}
    /** the picture the next frame renders before the preview */
    let pending:{btn:HTMLButtonElement,done:()=>void} | null=null;
    let frame=0;
    const resize=()=>{
      const {width,height}=stage.getBoundingClientRect();
      renderer.setSize(Math.max(1,width),Math.max(1,height),false);
      camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();
    };
    const observer=new ResizeObserver(resize);
    const size=new T.Vector2();
    // render the picture into a corner of the preview canvas, copy it out, then the preview paints over it
    const renderThumb=(btn:HTMLButtonElement)=>{
      renderer.getSize(size);
      const w=Math.floor(Math.min(THUMB_W,size.x,size.y*THUMB_W/THUMB_H)),h=Math.floor(w*THUMB_H/THUMB_W);
      if(w<1 || h<1) return false;
      const pr=renderer.getPixelRatio(),canvas=renderer.domElement;
      rower.group.visible=false;model!.group.visible=true;
      renderer.setViewport(0,0,w,h);
      renderer.render(scene,thumbCamera);
      const picture=document.createElement('canvas');
      picture.width=THUMB_W;picture.height=THUMB_H;
      picture.getContext('2d')!.drawImage(canvas,0,canvas.height-Math.round(h*pr),Math.round(w*pr),Math.round(h*pr),0,0,THUMB_W,THUMB_H);
      thumbs.set(thumbKey(btn),picture);paint(btn,picture);
      rower.group.visible=true;model!.group.visible=false;
      renderer.setViewport(0,0,size.x,size.y);
      return true;
    };
    // one picture per frame; shaders compile in the background where the browser can (KHR_parallel_shader_compile)
    const makeThumbs=async()=>{
      if(!model?.ready) return;
      model.update(.28);
      const target=new T.Vector3();
      for(const btn of missing){
        const category=btn.dataset.category!;
        const id=btn.dataset.option!;
        model.setOutfit({...defaults,...(category==='accessories' ? {[id]:true} : {[category]:id})});
        const head=category==='headwear' || id==='sunglasses';
        if(category==='boat') {
          target.set(0,.1,0);
          thumbCamera.position.set(2.6,3.4,id==='default'?9.5:6.4);
        } else {
          model.group.getObjectByName(head?'mixamorigHead':'mixamorigSpine2')!.getWorldPosition(target);
          target.y+=id==='sunglasses'?.13:head?.20:.04;
          thumbCamera.position.copy(target).add(new T.Vector3(0,.09,head?1.04:1.34));
        }
        thumbCamera.lookAt(target);
        await renderer.compileAsync(model.group,thumbCamera,scene);
        if(closed) return;
        await new Promise<void>(done=>{pending={btn,done};});
        if(closed) return;
      }
      scene.remove(model.group);model.dispose();
    };
    void Promise.all([rower.loaded,model?.loaded]).then(async()=>{
      if(closed) return;
      if(!rower.ready){stage.textContent='The rower could not be loaded.';return;}
      renderer.setPixelRatio(Math.min(devicePixelRatio,2));
      resize();
      await renderer.compileAsync(scene,camera);
      if(closed) return;
      stage.replaceChildren(renderer.domElement);resize();observer.observe(stage);
      const reduce=matchMedia('(prefers-reduced-motion: reduce)');
      let yaw=0;
      let dragX:number | null=null;
      const canvas=renderer.domElement;
      canvas.tabIndex=0;
      canvas.setAttribute('aria-label','Rotate preview by dragging or using the left and right arrow keys');
      canvas.style.touchAction='pan-y';
      canvas.style.cursor='grab';
      canvas.onpointerdown=e=>{ dragX=e.clientX; canvas.setPointerCapture(e.pointerId); };
      canvas.onpointermove=e=>{
        if(dragX===null) return;
        yaw-=(e.clientX-dragX)*Math.PI*2/canvas.clientWidth;
        dragX=e.clientX;
      };
      canvas.onlostpointercapture=()=>{dragX=null;};
      canvas.onkeydown=e=>{
        if(e.key==='ArrowLeft' || e.key==='ArrowRight'){
          e.preventDefault(); yaw+=(e.key==='ArrowLeft'?-1:1)*Math.PI/12;
        } else if(e.key==='Home') {e.preventDefault();yaw=0;}
      };
      const focus=new T.Vector3();
      let zoom=0,previousTime=0;
      const draw=(time:number)=>{
        rower.update(reduce.matches?.28:(time%3400)/3400);
        const dt=previousTime ? Math.min(.1,(time-previousTime)/1000) : 0;
        previousTime=time;
        zoom=reduce.matches?Number(showBoat):T.MathUtils.lerp(zoom,Number(showBoat),1-Math.exp(-dt*6));
        const closeDistance=Math.max(2.85,2.7/camera.aspect);
        const wideDistance=Math.max(outfitFile().boat==='default'?10.8:7.6,6.2/camera.aspect);
        const distance=T.MathUtils.lerp(closeDistance,wideDistance,zoom);
        rower.group.getObjectByName('mixamorigHead')!.localToWorld(focus.set(-.008,0,0));
        const pivotZ=T.MathUtils.lerp(T.MathUtils.lerp(.24,focus.z,Math.abs(Math.sin(yaw))),0,zoom);
        camera.position.set(focus.x+Math.sin(yaw)*(distance+.11),T.MathUtils.lerp(1.4,4.3,zoom),pivotZ+Math.cos(yaw)*(distance+.11));
        camera.lookAt(focus.x,T.MathUtils.lerp(.78,.2,zoom),pivotZ);
        daylight.time=reduce.matches?0:time/1000;water.update(daylight);
        if(pending && renderThumb(pending.btn)){pending.done();pending=null;}
        renderer.render(scene,camera);
        frame=requestAnimationFrame(draw);
      };
      frame=requestAnimationFrame(draw);
      void makeThumbs();
    });
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();rower.dispose();model?.dispose();water.dispose();renderer.dispose();renderer.forceContextLoss();};
  }
}
