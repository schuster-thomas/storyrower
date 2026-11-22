import * as T from 'three';

/** A sewn oval band and a single curved bill. Both are symmetric about x=0. */
export function sunVisor() {
  const group = new T.Group();
  const width = .064, depth = .071;
  const fabric = new T.MeshStandardMaterial({color:0xfff6e6,roughness:.86});
  const bandProfile = [[.93,-.012],[.985,-.012],[1,-.010],[1,.01],[.985,.012],[.93,.012],[.93,-.012]];
  const band = new T.Mesh(new T.LatheGeometry(bandProfile.map(([r,y])=>new T.Vector2(r,y)),80),fabric);
  band.scale.set(width,1,depth);
  group.add(band);

  // The inside edge extends under the band. The outer edge has a tangent-continuous curve.
  const outline = new T.Shape();
  outline.moveTo(-.058,.018);
  outline.bezierCurveTo(-.068,.042,-.066,.096,-.034,.108);
  outline.bezierCurveTo(-.016,.115,.016,.115,.034,.108);
  outline.bezierCurveTo(.066,.096,.068,.042,.058,.018);
  outline.bezierCurveTo(.049,.046,.030,.062,0,.062);
  outline.bezierCurveTo(-.030,.062,-.049,.046,-.058,.018);
  const geo = new T.ExtrudeGeometry(outline,{depth:.0028,bevelEnabled:false,curveSegments:24});
  const position = geo.attributes.position;
  const colors:number[]=[];
  const top=new T.Color(0xfff5e8), trim=new T.Color(0xc53b4a);
  const capVertices=geo.groups[0].count;
  for(let i=0;i<position.count;i++){
    const x=position.getX(i), z=position.getY(i), thickness=position.getZ(i);
    position.setXYZ(i,x,-.003+thickness-.005*(x/.064)**2-.065*(z-.06),z);
    const color=i<capVertices ? top : trim;
    colors.push(color.r,color.g,color.b);
  }
  geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geo.computeVertexNormals();
  group.add(new T.Mesh(geo,new T.MeshStandardMaterial({vertexColors:true,side:T.DoubleSide,roughness:.82})));
  return group;
}
