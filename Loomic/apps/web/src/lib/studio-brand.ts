export function keepStudioBrandTitle() {
  const title="视频创作 | Helstera";
  const sync=()=>{if(document.title!==title)document.title=title;};
  sync();
  // The embedded compiler updates document.title after every composition rebuild.
  const observer=new MutationObserver(sync);
  const element=document.querySelector("title");
  if(element)observer.observe(element,{childList:true,characterData:true,subtree:true});
  return ()=>observer.disconnect();
}
