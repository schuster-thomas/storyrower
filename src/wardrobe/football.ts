import * as T from 'three';

/** Truncate the corners of an icosahedron to form 12 pentagons and 20 hexagons. */
export function football() {
  const ico=new T.IcosahedronGeometry(1);
  const corners=ico.attributes.position;
  const pentagons=new Map<string,{axis:T.Vector3; rim:Map<string,T.Vector3>}>();
  const vertices:number[]=[], colors:number[]=[];
  const key=(v:T.Vector3)=>v.toArray().map(n=>Math.round(n*1000)).join(',');
  function panel(rim:T.Vector3[], color:T.Color) {
    const center=rim.reduce((sum,v)=>sum.add(v),new T.Vector3()).normalize();
    const border=rim.map(v=>v.clone().lerp(center,.025).normalize().multiplyScalar(1.002));
    for(let i=0;i<border.length;i++) {
      const a=border[i],b=border[(i+1)%border.length];
      const outward=a.clone().sub(center).cross(b.clone().sub(center)).dot(center)>0;
      const triangle=[center,outward?a:b,outward?b:a];
      const upper=triangle.flatMap((vertex,j)=>{
        const next=triangle[(j+1)%3];
        const kept=vertex.y>=0?[vertex]:[];
        if((vertex.y<0)!==(next.y<0)) {
          const edge=vertex.clone().lerp(next,vertex.y/(vertex.y-next.y));
          edge.y=0;
          kept.push(edge);
        }
        return kept;
      });
      for(let j=1;j+1<upper.length;j++) {
        for(const v of [upper[0],upper[j],upper[j+1]]) {
          vertices.push(...v.toArray()); colors.push(color.r,color.g,color.b);
        }
      }
    }
  }
  for(let i=0;i<corners.count;i+=3) {
    const face=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(corners,i+j));
    const hexagon=face.flatMap((a,j)=>{
      const b=face[(j+1)%3];
      const edge=[a.clone().lerp(b,1/3).normalize(),b.clone().lerp(a,1/3).normalize()];
      for(const [axis,point] of [[a,edge[0]],[b,edge[1]]]) {
        const id=key(axis);
        if(!pentagons.has(id)) pentagons.set(id,{axis,rim:new Map()});
        pentagons.get(id)!.rim.set(key(point),point);
      }
      return edge;
    });
    panel(hexagon,new T.Color(0xfaf8ef));
  }
  ico.dispose();
  for(const {axis,rim} of pentagons.values()) {
    const tangent=new T.Vector3(1,0,0).cross(axis).normalize(), bitangent=axis.clone().cross(tangent);
    const angle=(v:T.Vector3)=>Math.atan2(v.dot(bitangent),v.dot(tangent));
    panel([...rim.values()].sort((a,b)=>angle(a)-angle(b)),new T.Color(0x151619));
  }
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geo.setAttribute('normal',new T.Float32BufferAttribute(vertices,3));
  const ball=new T.Mesh(geo,new T.MeshStandardMaterial({vertexColors:true,roughness:.65}));
  ball.scale.set(.078,.088,.081);
  const seams=new T.Mesh(new T.SphereGeometry(.94,48,20,0,Math.PI*2,0,Math.PI/2),new T.MeshStandardMaterial({color:0x36383b,roughness:.88}));
  ball.add(seams);

  const brim = new T.Mesh(
    new T.SphereGeometry(1, 64, 24),
    new T.MeshStandardMaterial({ color: 0x218b39, roughness: .96 }),
  );
  brim.scale.set(.103, .008, .108);
  brim.position.set(0, -.005, .006);
  const hat = new T.Group();
  hat.add(brim, ball);
  return hat;
}
