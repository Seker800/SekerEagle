/** Basic color matching measured against Eagle 4.0 Build 23. Weights are fractions. */
export type ColorLab = readonly [number, number, number];
export interface SearchColorSwatch { hex: string; weight: number }
export const BASIC_COLOR_ACCURACY = 20;

export function hexColorLab(hex: string): ColorLab {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Invalid hex color');
  const [r,g,b] = [1,3,5].map(offset => {
    const v = parseInt(hex.slice(offset,offset+2),16)/255;
    return v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4;
  });
  const f=(v:number)=> v>0.008856 ? Math.cbrt(v) : 7.787*v+16/116;
  const x=f((r!*0.4124+g!*0.3576+b!*0.1805)/0.95047);
  const y=f(r!*0.2126+g!*0.7152+b!*0.0722);
  const z=f((r!*0.0193+g!*0.1192+b!*0.9505)/1.08883);
  // Eagle's color-convert.rgb.lab rounds the components.
  return [Math.round(116*y-16),Math.round(500*(x-y)),Math.round(200*(y-z))];
}

/** CIEDE2000, kL=kC=kH=1; Sharma/Wu/Dalal 2005 reference pairs. */
export function deltaE2000(a: ColorLab, b: ColorLab): number {
  const rad=Math.PI/180, pow25=25**7;
  const c1=Math.hypot(a[1],a[2]),c2=Math.hypot(b[1],b[2]);
  const cm=(c1+c2)/2;
  const g=(1-Math.sqrt(cm**7/(cm**7+pow25)))/2;
  const ap1=(1+g)*a[1],ap2=(1+g)*b[1];
  const cp1=Math.hypot(ap1,a[2]),cp2=Math.hypot(ap2,b[2]);
  const hue=(x:number,y:number)=> (Math.atan2(y,x)/rad+360)%360;
  const h1=cp1===0?0:hue(ap1,a[2]),h2=cp2===0?0:hue(ap2,b[2]);
  let dh=h2-h1;
  if(cp1*cp2===0)dh=0;
  else if(dh>180)dh-=360;
  else if(dh< -180)dh+=360;
  const dl=b[0]-a[0],dc=cp2-cp1,dH=2*Math.sqrt(cp1*cp2)*Math.sin(dh*rad/2);
  const lm=(a[0]+b[0])/2, cpm=(cp1+cp2)/2;
  let hm=h1+h2;
  if(cp1*cp2!==0)hm=Math.abs(h1-h2)<=180?hm/2:(hm<360?(hm+360)/2:(hm-360)/2);
  const t=1-0.17*Math.cos((hm-30)*rad)+0.24*Math.cos(2*hm*rad)+0.32*Math.cos((3*hm+6)*rad)-0.20*Math.cos((4*hm-63)*rad);
  const sl=1+0.015*(lm-50)**2/Math.sqrt(20+(lm-50)**2),sc=1+0.045*cpm,sh=1+0.015*cpm*t;
  const rt=-2*Math.sqrt(cpm**7/(cpm**7+pow25))*Math.sin(60*Math.exp(-(((hm-275)/25)**2))*rad);
  const l=dl/sl,c=dc/sc,h=dH/sh;
  return Math.sqrt(Math.max(0,l*l+c*c+h*h+rt*c*h));
}

export function paletteColorScore(targetHex: string, palette: readonly SearchColorSwatch[]): number|null {
  const first=palette[0],second=palette[1];
  if(!first || first.weight<0.25)return null;
  const target=targetHex.toLowerCase();
  if(first.hex.toLowerCase()===target || second?.hex.toLowerCase()===target)return 0.01;
  const lab=hexColorLab(target);
  const distance=(swatch:SearchColorSwatch)=> {
    const color=hexColorLab(swatch.hex);
    const d76=Math.hypot(...lab.map((v,i)=>v-color[i]!));
    return deltaE2000(lab,color)<BASIC_COLOR_ACCURACY && d76<BASIC_COLOR_ACCURACY+50 ? d76 : null;
  };
  if(first.weight>0.33){
    const d=distance(first);if(d!==null)return d;
    if(first.weight>0.50 && second && second.weight>0.08 && deltaE2000([100,0,0],hexColorLab(first.hex))<5){
      const d=distance(second);if(d!==null)return d+5;
    }
  }
  return second && second.weight>0.33 ? distance(second) : null;
}
