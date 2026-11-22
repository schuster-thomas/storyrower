import * as T from 'three';
import { football } from './football';
import { sunVisor } from './visor';
import type { Outfit } from './store';

export function makeHat(id: Outfit['headwear']) {
  const group = new T.Group();
  function shape(geometry: T.BufferGeometry, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, metal = false) {
    const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ color, metalness: metal ? .45 : .02, roughness: metal ? .32 : .65 }));
    mesh.position.set(x,y,z); mesh.scale.set(sx,sy,sz); group.add(mesh);
    return mesh;
  }
  const oval = (c: number,x: number,y: number,z: number,a: number,b: number,d: number) => shape(new T.SphereGeometry(1,24,16),c,x,y,z,a,b,d);
  const ring = (c: number,y: number,h: number,a: number,b: number) => shape(new T.CylinderGeometry(.96,1,1,32,1,true),c,0,y,0,a,h,b);
  // Local head coordinates, in the rig's pre-scale units. The face looks along +Z.
  group.position.set(-.008,.135,.011);
  if (id === 'visor') {
    group.position.y+=.006;
    group.add(sunVisor());
  } else if (id === 'santa') {
    oval(0xfffaf0,0,0,0,.079,.014,.083);
    const cap=new T.CylinderGeometry(.008,.073,.118,48,20);
    const points=cap.attributes.position;
    for(let i=0;i<points.count;i++){
      const height=(points.getY(i)+.059)/.118;
      points.setX(i,points.getX(i)+.094*height**2);
      points.setY(i,points.getY(i)-.053*height**4);
    }
    cap.computeVertexNormals();
    shape(cap,0xc71b30,0,.066,0,1,1,1);
    oval(0xfffaf0,.094,.072,0,.019,.019,.019);
  } else if (id === 'traffic') {
    // All three frustums share their radii at the joins.
    const foot = new T.CylinderGeometry(.068,.071,.008,64);
    const rim = foot.attributes.position;
    for(let i=0;i<rim.count;i++){
      const x=rim.getX(i),z=rim.getZ(i),radius=Math.hypot(x,z);
      if(radius===0) continue;
      const scale=radius/Math.pow(x**8+z**8,1/8);
      rim.setX(i,x*scale);
      rim.setZ(i,z*scale);
    }
    foot.computeVertexNormals();
    const base=shape(foot,0xff5414,0,-.005,0,1,1,1);
    const collar=shape(new T.CylinderGeometry(.061,.067,.006,48),0xff6419,0,.001,0,1,1,1);
    for(const part of [base,collar]) (part.material as T.MeshStandardMaterial).roughness=.34;
    shape(new T.CylinderGeometry(.046,.060,.053,48),0xff680b,0,.0295,0,1,1,1);
    shape(new T.CylinderGeometry(.034,.046,.035,48,1,true),0xdde5eb,0,.0735,0,1,1,1,true);
    shape(new T.CylinderGeometry(.014,.034,.061,48),0xff680b,0,.1215,0,1,1,1);
  } else if (id === 'crown') {
    group.scale.set(.91,.82,.91);
    group.position.y-=.002;
    const wall = new T.CylinderGeometry(1.09,1,1,80,1,true);
    const points = wall.attributes.position;
    for(let i=0;i<points.count;i++){
      if(points.getY(i)<0) continue;
      const angle=Math.atan2(points.getX(i),points.getZ(i));
      const peak=1-Math.acos(Math.cos(angle*8))/Math.PI;
      points.setY(i,.1+.8*peak);
    }
    wall.computeVertexNormals();
    const gold = shape(wall,0xe9aa27,0,.027,0,.072,.077,.079,true);
    (gold.material as T.MeshStandardMaterial).side=T.DoubleSide;
    shape(new T.TorusGeometry(1,.055,10,64),0xffcf54,0,-.01,0,.074,.080,.070,true).rotation.x=Math.PI/2;
    shape(new T.TorusGeometry(1,.045,10,64),0xffcf54,0,.009,0,.075,.081,.070,true).rotation.x=Math.PI/2;
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4;
      const x=Math.sin(angle),z=Math.cos(angle);
      oval(0xffcd48,x*.079,.096,z*.087,.007,.007,.007);
      const jewel=shape(new T.OctahedronGeometry(1),i%2?0x2545a6:0xb11b35,x*.076,.024,z*.084,.010,.013,.008);
      jewel.rotation.y=angle;
    }
  } else if (id === 'bucket') {
    const profile = [[0,.066],[.027,.064],[.047,.055],[.063,.039],[.074,.020],
      [.079,.005],[.096,-.003],[.106,-.010],[.107,-.014],[.102,-.017],
      [.086,-.010],[.074,-.005],[0,-.005]];
    const shell = new T.LatheGeometry(profile.map(([r,y])=>new T.Vector2(r,y)),64);
    const helmet=shape(shell,0xd4bb87,0,0,0,1,1,1.08);
    (helmet.material as T.MeshStandardMaterial).side=T.DoubleSide;
    shape(new T.CylinderGeometry(.076,.080,.009,64,1,true),0xa48b60,0,.009,0,1,1,1.08);
    oval(0xc5aa77,0,.067,0,.013,.005,.014);
  } else if (id === 'football') {
    group.add(football());
  } else if (id === 'egg') {
    group.position.y += .017;
    const white = new T.SphereGeometry(1, 64, 24);
    const points = white.attributes.position;
    for (let i = 0; i < points.count; i++) {
      const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
      const angle = Math.atan2(z, x);
      const ripple = 1 + .10 * Math.cos(angle * 5) + .05 * Math.cos(angle * 9);
      points.setXYZ(i, x * ripple, y + .24 * (x * x + z * z) * Math.cos(angle * 5), z * ripple);
    }
    white.computeVertexNormals();
    shape(white, 0xfff5dd, 0, .003, 0, .098, .017, .102);
    const yolk = oval(0xffb51a, 0, .019, 0, .046, .032, .046);
    (yolk.material as T.MeshStandardMaterial).roughness = .28;
  } else if (id === 'cowboy') {
    const brim = new T.CylinderGeometry(1,1,.07,48,4);
    const p = brim.attributes.position;
    for (let i=0;i<p.count;i++) p.setY(i,p.getY(i)+.32*Math.pow(Math.abs(p.getX(i)),3));
    brim.computeVertexNormals();
    shape(brim,0x985e32,0,0,0,.116,.08,.104);
    shape(new T.CylinderGeometry(.76,1,1,20),0xb07943,0,.038,0,.078,.077,.077);
    ring(0x543523,.014,.013,.075,.073);
  } else if (id === 'viking') {
    shape(new T.SphereGeometry(1,20,12,0,Math.PI*2,0,Math.PI/2),0x929da9,0,0,0,.079,.07,.082,true);
    ring(0xbd8c49,.003,.016,.081,.084);
    for (const side of [-1,1]) {
      const curve = new T.QuadraticBezierCurve3(new T.Vector3(side*.064,.026,0),new T.Vector3(side*.119,.025,0),new T.Vector3(side*.107,.092,0));
      const g = new T.TubeGeometry(curve,12,.018,10,false);
      const pos = g.attributes.position;
      for(let i=0;i<pos.count;i++) {
        const t=Math.floor(i/11)/12, center=curve.getPointAt(t);
        const v=new T.Vector3().fromBufferAttribute(pos,i).lerp(center,t*.99);
        pos.setXYZ(i,v.x,v.y,v.z);
      }
      g.computeVertexNormals(); shape(g,0xffe6b6,0,0,0,1,1,1);
    }
  } else if (id === 'puffer') {
    oval(0xf5b829,0,.035,0,.09,.073,.085);
    for (const s of [-1,1]) {
      oval(0xffc345,s*.086,.036,-.004,.024,.012,.028);
      oval(0xffffff,s*.034,.06,.069,.019,.022,.013);
      oval(0x24213a,s*.034,.06,.08,.009,.012,.006);
    }
    oval(0xe07729,0,.032,.085,.017,.01,.008);
    for(let i=0;i<8;i++) for(const side of [-1,1]) {
      const y=.15+.8*((i*.618)%1), r=Math.sqrt(1-y*y), n=new T.Vector3(side*Math.abs(r*Math.cos(i*2.4)),y,r*Math.sin(i*2.4));
      const spike=shape(new T.ConeGeometry(1,1,5),0xf9d464,n.x*.086,.035+n.y*.074,n.z*.084,.009,.029,.009);
      spike.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),n);
    }
  }
  if(id==='visor'){
    // Opaque underlayer where the irregular hair meets the inside return of the band.
    oval(0x483120,0,0,0,.0635,.023,.0705);
  }
  return group;
}


