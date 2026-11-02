// C = 2 integral_0^(pi/2) sqrt(X^2 sin^2(t) + Y^2 cos^2(t)) dt.
// X/Y are full diameters, not semiaxes. NIST DLMF 19.9.9.
const divisions=2048;
const sineSquared=Array.from({length:divisions+1},(_,i)=>Math.sin(i*Math.PI/(2*divisions))**2);
export function ellipsePerimeter(x:number,y:number){
 if(!Number.isFinite(x)||!Number.isFinite(y)||x<=0||y<=0)throw Error('椭圆直径必须为有限正数');
 if(x===y)return Math.PI*x;
 let previous=0;
 for(let n=16;n<=divisions;n*=2){
  let sum=x+y;
  for(let i=1;i<n;i++){const sin2=sineSquared[i*divisions/n];sum+=(i%2?4:2)*Math.sqrt(x*x*sin2+y*y*(1-sin2));}
  const current=sum*Math.PI/(3*n);
  if(previous&&Math.abs(current-previous)<1e-11)return current;
  previous=current;
 }
 return previous;
}
export function fixedPerimeterAxes(diameter:number,deformation:number){
 const target=Math.PI*diameter;
 const solve=(q:number)=>{if(q===0)return {x:diameter,y:diameter};const x=Math.exp(q),y=Math.exp(-q),scale=target/ellipsePerimeter(x,y);return {x:x*scale,y:y*scale};};
 const requested=Math.sign(deformation)*Math.log1p(Math.abs(deformation));
 let axes=solve(requested),limited=false;
 const fits=(a:{x:number;y:number})=>Math.min(a.x,a.y)>=0.01&&Math.max(a.x,a.y)<=655.35;
 if(!fits(axes)){
  // Reduce shape deformation, never clip one axis and break the perimeter.
  limited=true;let low=0,high=Math.abs(requested);
  for(let i=0;i<48;i++){const mid=(low+high)/2;if(fits(solve(Math.sign(requested)*mid)))low=mid;else high=mid;}
  axes=solve(Math.sign(requested)*low);
 }
 const x=axes.x.toFixed(6),y=axes.y.toFixed(6),actual=ellipsePerimeter(Number(x),Number(y));
 return {x,y,limited,target,actual,error:actual-target};
}
