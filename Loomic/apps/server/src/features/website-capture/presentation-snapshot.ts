import type { Page } from "playwright";

export type PresentationLayer = {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "box" | "text" | "media" | "field";
  text: string;
  color: string;
  background: string;
  border: string;
  radius: string;
  fontSize: string;
  fontWeight: string;
  fontFamily: string;
  lineHeight: string;
  align: string;
};
export type PresentationScene = {
  url: string;
  title: string;
  width: number;
  height: number;
  background: string;
  image: string;
  layers: PresentationLayer[];
};

// Only visual values are exported. No page markup, scripts, input values or event handlers.
export const PRESENTATION_SNAPSHOT_SCRIPT = String.raw`(() => {
  const width=innerWidth,height=Math.min(Math.max(document.documentElement.scrollHeight,document.body.scrollHeight,innerHeight),2160);
  const layers=[];let inspected=0;
  const hidden=el=>{const css=getComputedStyle(el);return css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0;};
  const geometry=el=>{const r=el.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};};
  const visible=r=>r.width>2&&r.height>2&&r.x<width&&r.x+r.width>0&&r.y<height&&r.y+r.height>0;
  const style=el=>{const c=getComputedStyle(el);return {color:c.color,background:c.backgroundColor,border:c.border,radius:c.borderRadius,fontSize:c.fontSize,fontWeight:c.fontWeight,fontFamily:c.fontFamily,lineHeight:c.lineHeight,align:c.textAlign};};
  const walk=el=>{
    if(inspected++>1600||layers.length>=120||hidden(el)||/^(SCRIPT|STYLE|NOSCRIPT|HEAD|META|LINK|TEMPLATE)$/.test(el.tagName))return;
    const r=geometry(el);if(!visible(r))return;
    const css=style(el);
    if(el.matches('input,textarea,select,[contenteditable="true"]')){layers.push({...r,...css,kind:'field',text:'输入区域'});return;}
    if(el.matches('img,svg,canvas,video,iframe,picture')){layers.push({...r,...css,kind:'media',text:el.getAttribute('alt')?.slice(0,80)||'图片'});return;}
    const hasBackground=!['rgba(0, 0, 0, 0)','transparent'].includes(css.background);
    if(el!==document.body&&(hasBackground||parseFloat(getComputedStyle(el).borderWidth)>0)&&r.width*r.height>180)layers.push({...r,...css,kind:'box',text:''});
    for(const node of el.childNodes){
      if(layers.length>=120)break;
      if(node.nodeType===Node.ELEMENT_NODE)walk(node);
      else if(node.nodeType===Node.TEXT_NODE&&node.textContent.trim()){
        const range=document.createRange();range.selectNodeContents(node);const b=range.getBoundingClientRect();
        const rect={x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height};
        if(visible(rect))layers.push({...rect,...css,background:'transparent',border:'none',kind:'text',text:node.textContent.replace(/\s+/g,' ').trim().slice(0,240)});
      }
    }
  };
  walk(document.body);
  const bg=getComputedStyle(document.body).backgroundColor;
  const contentBottom=Math.max(innerHeight,...layers.filter(layer=>layer.kind!=='box').map(layer=>layer.y+layer.height+64));
  const captureHeight=Math.min(height,Math.ceil(contentBottom));
  return {width,height:captureHeight,background:['transparent','rgba(0, 0, 0, 0)'].includes(bg)?'#ffffff':bg,layers:layers.map(layer=>({...layer,height:Math.min(layer.height,captureHeight-layer.y)})).filter(layer=>layer.height>0)};
})()`;

export async function capturePresentationScene(
  page: Page,
): Promise<PresentationScene> {
  await page.evaluate("Promise.race([document.fonts.ready, new Promise(resolve=>setTimeout(resolve,2000))]).then(()=>undefined)");
  const maxScroll=await page.evaluate("Math.min(Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)-innerHeight,1440)") as number;
  const offsets=Array.from({length:Math.ceil(Math.max(0,maxScroll)/480)+1},(_,index)=>Math.min(index*480,Math.max(0,maxScroll)));
  for(const offset of offsets){
    await page.evaluate(`window.scrollTo(0,${offset})`);await page.waitForTimeout(550);
  }
  await page.evaluate("window.scrollTo(0,0)");
  await page.waitForTimeout(550);
  const snapshot = (await page.evaluate(PRESENTATION_SNAPSHOT_SCRIPT)) as Omit<
    PresentationScene,
    "url" | "title" | "image"
  >;
  if (!snapshot.layers?.length)
    throw new Error("此页面没有可用于演示的可见内容。");
  const image = await page.screenshot({
    type: "jpeg",
    quality: 82,
    fullPage: true,
    clip: { x: 0, y: 0, width: snapshot.width, height: snapshot.height },
    mask: [page.locator('input,textarea,select,[contenteditable="true"]')],
    maskColor: "#d8dee8",
    timeout: 10_000,
  });
  if (image.length > 4 * 1024 * 1024)
    throw new Error("网页演示快照过大，请选择内容更少的页面。");
  const source = new URL(page.url());
  return {
    ...snapshot,
    url: source.origin + source.pathname,
    title: (await page.title()).slice(0, 160),
    image: `data:image/jpeg;base64,${image.toString("base64")}`,
  };
}
