// Original choreography. The renderer receives only sanitized visual snapshots.
export const PRESENTATION_PLAYER = String.raw`(async ({scenes,config})=>{
  const gsap=window.gsap;
  if(!gsap)throw new Error('演示动画引擎未加载');
  gsap.ticker.lagSmoothing(0);
  document.title='网站介绍演示';
  document.documentElement.style.cssText='background:#edf0f5;overflow:hidden';
  document.body.replaceChildren();document.body.style.cssText='margin:0;font-family:system-ui,"Microsoft YaHei",sans-serif;overflow:hidden';
  const make=(tag,parent,css,text)=>{const node=document.createElement(tag);node.style.cssText=css;if(text)node.textContent=text;parent.append(node);return node;};
  const stage=make('div',document.body,'position:relative;width:1280px;height:720px;overflow:hidden;background:#f5f6f8;color:#202333');
  const header=make('header',stage,'position:absolute;inset:0 0 auto;height:48px;display:flex;align-items:center;gap:12px;padding:0 24px;background:#fff;border-bottom:1px solid #dfe3ea;z-index:30');
  make('b',header,'font-size:16px;letter-spacing:.2px','Loomic');
  make('span',header,'font-size:12px;color:#646b7d','网站介绍 · 多光标重建');
  const address=make('span',header,'margin-left:auto;max-width:600px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;color:#646b7d');
  const footer=make('footer',stage,'position:absolute;inset:auto 0 0;height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:#fff;border-top:1px solid #dfe3ea;z-index:30');
  const caption=make('span',footer,'font-size:12px;color:#525b70');
  const pageCounter=make('span',footer,'font-size:12px;color:#525b70');
  const progress=make('div',stage,'position:absolute;bottom:35px;left:0;height:2px;background:#4d5cce;z-index:40;width:0');
  const palette=['#385bd8','#c04673','#19816c','#ae661d','#7858c5','#247d9c'];
  const timeline=gsap.timeline({paused:true,onComplete:()=>{window.__loomicPresentation.done=true;caption.textContent='网站介绍演示已完成';}});
  const sceneDuration=config.durationSeconds/scenes.length;
  for(let sceneIndex=0;sceneIndex<scenes.length;sceneIndex++){
    const scene=scenes[sceneIndex],start=sceneIndex*sceneDuration,scale=1240/scene.width;
    const viewport=make('div',stage,'position:absolute;left:20px;top:62px;width:1240px;height:608px;overflow:hidden;border:1px solid #dbe0e8;border-radius:10px;background:'+scene.background+';opacity:0');
    const camera=make('div',viewport,'position:absolute;left:0;top:0;width:'+scene.width+'px;height:'+scene.height+'px;transform-origin:0 0;transform:scale('+scale+')');
    const full=make('img',camera,'position:absolute;inset:0;width:'+scene.width+'px;height:'+scene.height+'px;opacity:0;z-index:12;pointer-events:none');full.src=scene.image;
    const guide=make('div',camera,'position:absolute;top:0;bottom:0;width:1px;background:#e56060;opacity:0;z-index:4');
    const cursors=[];
    for(let i=0;i<config.cursorCount;i++){
      const cursor=make('div',camera,'position:absolute;left:0;top:0;z-index:20;opacity:0;pointer-events:none');
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','26');svg.setAttribute('height','32');svg.setAttribute('viewBox','0 0 26 32');
      const shape=document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d','M2 2L6 29L13 20L24 19Z');shape.setAttribute('fill',palette[i]);shape.setAttribute('stroke','#fff');shape.setAttribute('stroke-width','2');svg.append(shape);cursor.append(svg);
      const badge=make('span',cursor,'position:absolute;top:27px;left:14px;border-radius:5px;background:'+palette[i]+';color:#fff;font:12px system-ui;white-space:nowrap;padding:4px 7px','Agent '+(i+1));
      cursors.push({cursor,badge});
    }
    const sorted=[...scene.layers].sort((a,b)=>a.y-b.y||a.x-b.x);
    const lastRow=Math.max(1,Math.ceil(sorted.length/config.cursorCount));
    const slot=(sceneDuration*.76)/lastRow;
    sorted.forEach((layer,index)=>{
      const lane=index%config.cursorCount,row=Math.floor(index/config.cursorCount),time=start+.3+row*slot;
      const {cursor,badge}=cursors[lane],color=palette[lane];
      const duration=Math.max(.14,slot*.78),x=Math.max(0,layer.x),y=Math.max(0,layer.y);
      const box=make('div',camera,'position:absolute;box-sizing:border-box;overflow:hidden;left:'+x+'px;top:'+y+'px;width:'+layer.width+'px;height:'+layer.height+'px;border-radius:'+layer.radius+';opacity:0;pointer-events:none');
      if(layer.kind==='media'){
        box.style.backgroundImage='url('+scene.image+')';box.style.backgroundSize=scene.width+'px '+scene.height+'px';box.style.backgroundPosition=(-x)+'px '+(-y)+'px';
      }else if(layer.kind==='text'){
        Object.assign(box.style,{color:layer.color,fontFamily:layer.fontFamily,fontWeight:layer.fontWeight,fontSize:layer.fontSize,lineHeight:layer.lineHeight,textAlign:layer.align,whiteSpace:'pre-wrap',overflowWrap:'anywhere'});
      }else if(layer.kind==='field'){
        box.style.background='#e1e6ef';box.style.border='1px solid #c2cada';
      }else{box.style.background=layer.background;box.style.border=layer.border;}
      const outline=make('div',camera,'position:absolute;box-sizing:border-box;left:'+x+'px;top:'+y+'px;width:'+layer.width+'px;height:'+layer.height+'px;border:1px solid '+color+';opacity:0;z-index:8;pointer-events:none;transform-origin:0 0');
      const ruler=make('span',outline,'position:absolute;top:0;right:0;background:'+color+';color:#fff;padding:2px 4px;font:10px monospace',Math.round(layer.width)+' × '+Math.round(layer.height));
      const label=layer.kind==='text'?'输入文字':layer.kind==='media'?'铺放图片':layer.kind==='field'?'绘制表单':'描绘布局';
      timeline.set(cursor,{opacity:1},time).call(()=>{badge.textContent=label;caption.textContent=label+' · '+scene.title;},[],time);
      timeline.to(cursor,{x,y,duration:duration*.3,ease:'power2.inOut'},time);
      timeline.fromTo(outline,{opacity:1,scaleX:.02,scaleY:.02},{scaleX:1,scaleY:1,duration:duration*.6,ease:'power1.inOut'},time+duration*.25);
      timeline.to(cursor,{x:x+Math.min(layer.width,360),y:y+Math.min(layer.height,90),duration:duration*.5,ease:'power1.inOut'},time+duration*.3);
      timeline.set(box,{opacity:1},time+duration*.36);
      if(layer.kind==='text'){
        const count={value:0};timeline.to(count,{value:layer.text.length,duration:duration*.7,ease:'none',onUpdate:()=>{box.textContent=layer.text.slice(0,Math.round(count.value));}},time+duration*.3);
      }else{timeline.fromTo(box,{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',duration:duration*.6,ease:'power1.inOut'},time+duration*.35);}
      timeline.to(outline,{opacity:0,duration:.15},time+duration);
      if(index%12===0){timeline.set(guide,{x,opacity:.7},time).to(guide,{opacity:0,duration:.4},time+duration);}
    });
    timeline.set(viewport,{opacity:1},start).call(()=>{address.textContent=scene.url;pageCounter.textContent=(sceneIndex+1)+' / '+scenes.length;caption.textContent='重建页面布局 · '+scene.title;},[],start);
    if(scene.height*scale>608)timeline.to(camera,{y:-(scene.height*scale-608),duration:sceneDuration*.67,ease:'none'},start+sceneDuration*.15);
    timeline.to(full,{opacity:1,duration:.35},start+sceneDuration*.84);
    timeline.to(camera,{y:0,duration:sceneDuration*.08,ease:'power2.inOut'},start+sceneDuration*.87);
    timeline.to(cursors.map(item=>item.cursor),{opacity:0,duration:.2},start+sceneDuration*.86);
    if(sceneIndex<scenes.length-1)timeline.to(viewport,{opacity:0,duration:.25},start+sceneDuration-.25);
    await Promise.all([full.decode().catch(()=>{throw new Error('网页快照无法解码');})]);
  }
  timeline.to(progress,{width:1280,duration:config.durationSeconds,ease:'none'},0);
  window.__loomicPresentation={timeline,done:false,play:()=>{timeline.play();},pause:()=>{timeline.pause();},seek:value=>{timeline.seek(value,false);},progress:()=>timeline.progress()};
})`;
