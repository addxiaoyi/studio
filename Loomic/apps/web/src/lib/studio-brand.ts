export function keepStudioBrandTitle() {
  const title="视频创作 | Helstera";
  const sync=()=>{if(document.title!==title)document.title=title;};
  sync();
  // Next can stream title nodes into the body; compilation can also replace them.
  const containsTitle = (node: Node) => node instanceof Element && (node.tagName === "TITLE" || Boolean(node.querySelector("title")));
  const observer=new MutationObserver(records => {
    if (records.some(record => record.target instanceof HTMLTitleElement || record.target.parentElement instanceof HTMLTitleElement || [...record.addedNodes, ...record.removedNodes].some(containsTitle))) sync();
  });
  observer.observe(document.documentElement,{childList:true,characterData:true,subtree:true});
  return ()=>observer.disconnect();
}
