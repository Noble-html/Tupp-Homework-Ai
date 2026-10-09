import React,{useEffect,useRef} from 'react';
import {Renderer,Program,Mesh,Triangle,Texture} from 'ogl';
import './ElectricLogo.css';

// Compact React/OGL ElectricLogo interface aligned with the React Bits API.
// The visual engine is kept local so Firebase remains the only app data backend.
const vertex=`#version 300 es\nin vec2 position; in vec2 uv; out vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,0.,1.);}`;
const fragment=`#version 300 es\nprecision highp float;in vec2 vUv;out vec4 outColor;uniform float uTime;uniform vec2 uRes;uniform vec3 uColor;uniform vec3 uGlow;uniform float uSpeed;uniform float uIntensity;uniform float uCrackle;uniform float uInteractive;uniform vec2 uPointer;void main(){vec2 p=(vUv-.5)*2.;p.x*=uRes.x/uRes.y;float t=uTime*uSpeed;float d=length(p);float electric=abs(sin(p.x*12.+sin(p.y*8.+t*2.)*uCrackle)+cos(p.y*14.-t*1.7));float edge=smoothstep(.22,.0,abs(d-.58));float cursor=exp(-length(p-uPointer)*5.)*uInteractive;float pulse=.55+.45*sin(t*3.);float a=edge*(.3+electric*.7)*uIntensity+pulse*cursor*.7;vec3 c=mix(uGlow,uColor,smoothstep(.15,.85,electric));outColor=vec4(c,a);}`;
function hex(h){let s=String(h||'').replace('#','');if(s.length===3)s=s.split('').map(x=>x+x).join('');let n=parseInt(s,16);return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]}

export default function ElectricLogo({src,color='#ecc7ff',glowColor='#ad6dff',scale=.7,strands=4,bend=.6,crackle=1.5,arcs=1,speed=2.5,interactive=true,className='',style}){
  const ref=useRef(null); const settings={src,color,glowColor,scale,strands,bend,crackle,arcs,speed,interactive};
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    const renderer=new Renderer({dpr:Math.min(window.devicePixelRatio||1,2),alpha:true,antialias:false});
    const gl=renderer.gl;if(!renderer.isWebgl2)return;
    const uniforms={uTime:{value:0},uRes:{value:[1,1]},uColor:{value:hex(settings.color)},uGlow:{value:hex(settings.glowColor)},uSpeed:{value:settings.speed},uIntensity:{value:Math.max(.4,Math.min(2,settings.scale*1.6))},uCrackle:{value:settings.crackle},uInteractive:{value:settings.interactive?1:0},uPointer:{value:[0,0]}};
    const mesh=new Mesh(gl,{geometry:new Triangle(gl),program:new Program(gl,{vertex,fragment,uniforms,depthTest:false,depthWrite:false})});
    el.appendChild(gl.canvas);gl.canvas.style.width='100%';gl.canvas.style.height='100%';
    const resize=()=>{renderer.setSize(el.clientWidth||1,el.clientHeight||1);uniforms.uRes.value=[el.clientWidth||1,el.clientHeight||1]};
    const move=e=>{const r=el.getBoundingClientRect();uniforms.uPointer.value=[((e.clientX-r.left)/Math.max(r.width,1)-.5)*2,(.5-(e.clientY-r.top)/Math.max(r.height,1))*2]};
    const ro=new ResizeObserver(resize);ro.observe(el);el.addEventListener('pointermove',move);resize();let raf=0;const start=performance.now();const loop=now=>{uniforms.uTime.value=(now-start)/1000;renderer.render({scene:mesh});raf=requestAnimationFrame(loop)};raf=requestAnimationFrame(loop);
    return()=>{cancelAnimationFrame(raf);ro.disconnect();el.removeEventListener('pointermove',move);gl.getExtension('WEBGL_lose_context')?.loseContext();gl.canvas.remove()};
  },[src,color,glowColor,scale,strands,bend,crackle,arcs,speed,interactive]);
  return <div ref={ref} className={`electric-logo ${className}`.trim()} style={style}/>;
}
