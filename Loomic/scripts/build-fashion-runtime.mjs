import { readFile, mkdir, writeFile, cp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(resolve(root, "scripts/creative-sources.json"), "utf8")).fashion;
const source = resolve(root, lock.directory);
const head = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== lock.commit) throw new Error("Fashion source does not match the pinned commit.");
const upstream = (name) => execFileSync("git", ["-C", source, "show", `${head}:${name}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const html = upstream("index.html");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]).filter((script) => script.trim());
if (scripts.length !== 2) throw new Error("Upstream fashion scripts changed; review the integration.");
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
if (!body) throw new Error("Fashion source has no complete document.");
const [styles, surface, copy, billing, selectStyles] = await Promise.all([
  readFile(resolve(root, "scripts/fashion/workspace.css"), "utf8"),
  readFile(resolve(root, "scripts/fashion/workspace-surface.mjs"), "utf8"),
  readFile(resolve(root, "scripts/fashion/workspace-copy.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "scripts/fashion/billing-surface.mjs"), "utf8"),
  readFile(resolve(root, "apps/web/src/components/ui/select.css"), "utf8"),
]);
const header = `<header class="hero">
  <div class="hero-copy"><h2 data-i18n="titleWord">服装图集</h2><p class="sub" data-i18n="subtitle"></p></div>
  <div class="hero-controls">
    <div class="langswitch" id="langswitch" role="group" aria-label="图集语言">
      <button type="button" data-lang="zh" aria-pressed="true">中文</button>
      <button type="button" data-lang="en" aria-pressed="false">English</button>
    </div>
    <button type="button" class="fitting-toggle" id="fittingToggle" aria-controls="fitting">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m16 3 5 4-3 4-2-1v11H8V10l-2 1-3-4 5-4c0 4 8 4 8 0Z"/></svg>
      <span data-i18n="fittingTab">开始试穿</span>
    </button>
  </div>
</header>`;
const icon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${path}</svg>`;
const layout = body
  .replace(/<header class="hero">[\s\S]*?<\/header>/, header)
  .replace(/<button\b[^>]*id="fitThemeToggle"[\s\S]*?<\/button>/, "")
  .replace(/<footer id="foot">[\s\S]*?<\/footer>/, '<footer id="foot"><span data-i18n="footerNote"></span> · <a href="/creative/fashion-LICENSE.txt" target="_blank" rel="noopener noreferrer">开源许可</a></footer>')
  .replace('<span class="ico">📷</span>', `<span class="ico" aria-hidden="true">${icon('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 16-5-5L5 21"/>')}</span>`)
  .replace('<span class="ico" aria-hidden="true">👗</span>', `<span class="ico" aria-hidden="true">${icon('<path d="m16 3 5 4-3 4-2-1v11H8V10l-2 1-3-4 5-4c0 4 8 4 8 0Z"/>')}</span>`)
  .replace('<span aria-hidden="true">🎲</span>', icon('<path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h3c6 0 6-12 12-12h5M2 6h3c2 0 3 1 4 3m6 6c1 2 2 3 4 3h3"/>'))
  .replaceAll('src="assets/', 'src="/fashion-gallery/');
let code = upstream("data.js") + "\n" + scripts[1];
code = code.replace("if(!ok){", "if(data?.code === 'TRY_ON_CANCELED'){showHint(data.message);return;}\n      if(!ok){");
code = code.replace("function refreshConfigUI(){", "function refreshConfigUI(){\n    queueMicrotask(()=>shell.dispatchEvent(new Event('loomic:select-sync')));");
code = code.replace("aiGenerate.disabled = b;", "aiGenerate.dataset.generating=String(b);aiGenerate.disabled = b;\n    queueMicrotask(()=>modelsBilling?.updateModelsState?.());");
code = code.replace("const THEME_STORAGE_KEY", `Object.assign(I18N.zh, ${JSON.stringify(copy.zh)});\nObject.assign(I18N.en, ${JSON.stringify(copy.en)});\nconst THEME_STORAGE_KEY`);
code = code.replace('aria-selected="${selected}"', 'aria-selected="${selected}" aria-controls="grid" tabindex="${selected ? 0 : -1}"');
code = code.replace("$('#grid').addEventListener('keydown',e=>{if(e.key==='Enter'){const c=e.target.closest('.card');if(c)openM(+c.dataset.i)}});", "$('#grid').addEventListener('keydown',e=>{if(e.target.closest('.tryon-chip'))return;if(e.key==='Enter'||e.key===' '){const c=e.target.closest('.card');if(c){e.preventDefault();openM(+c.dataset.i)}}});");
code = code.replace("oninput=e=>{clearTimeout(qt);qt=setTimeout(()=>{S.q=e.target.value.trim().toLowerCase();", "oninput=e=>{const query=e.target.value;clearTimeout(qt);qt=setTimeout(()=>{S.q=query.trim().toLowerCase();");
code = code.replaceAll("'assets/", "'/fashion-gallery/").replaceAll('"assets/', '"/fashion-gallery/');
code = code.replace(/'nvzhuang([^']*)'/g, (_, suffix) => `'loomic-fashion-' + host.userId + '${suffix}'`);
code = code.replace("'paipiange.tryon.history'", "'loomic-fashion-history-' + host.userId");
code = code.replace('id: `${createdAt}-${randomId}`', 'id: responseData.jobId || `${createdAt}-${randomId}`');
code = code.replace('      garmentSource: isUpload', '      jobId: responseData.jobId,\n      assetId: responseData.assetId,\n      garmentSource: isUpload');
code = code.replace("image: b64ToBlob(imageB64)", "image: b64ToBlob(imageB64, responseData.mimeType || 'image/png')");
code = code.replace("function b64ToBlob(value){", "function b64ToBlob(value, mimeType='image/png'){");
code = code.replace("return new Blob([bytes], {type:'image/png'});", "return new Blob([bytes], {type:mimeType});");
code = code.replace("aiResultImg.src = 'data:image/png;base64,' + data.data.image;", "aiResultImg.src = 'data:' + (data.data.mimeType || 'image/png') + ';base64,' + data.data.image;");
code = code.replace("await saveHistoryResult(data.data.image, data.data, selectedGarment);", "await saveHistoryResult(data.data.image, data.data, selectedGarment);\n        host.completed(data.data);");
code = code.replace('      // 成功：展示结果', '      data.data = host.prepareOutput(data.data);\n      // 成功：展示结果');
code = code.replace('        closeHistory();\n        showHint', `        const output = host.prepareOutput({image:aiResultB64,model:record.model,jobId:record.jobId,assetId:record.assetId});
        if(!record.jobId){record.jobId=output.jobId;await putHistoryRecord(record);}
        host.completed(output);
        closeHistory();
        showHint`);
code = code.replace("a.href='data:image/png;base64,'+aiResultB64;", "a.href=aiResultImg.src;");
code = code.replace("a.download='AI换装-'+Date.now()+'.png';", "a.download='AI换装-'+Date.now()+'.'+(aiResultImg.src.startsWith('data:image/webp')?'webp':aiResultImg.src.startsWith('data:image/jpeg')?'jpg':'png');");
code = code.replace("a.download = `AI换装-${record.garmentId || record.createdAt}.png`;", "a.download = `AI换装-${record.garmentId || record.createdAt}.` + (record.image.type === 'image/webp' ? 'webp' : record.image.type === 'image/jpeg' ? 'jpg' : 'png');");
code = code.replaceAll("'data:image/png;base64,'+aiResultB64", "aiResultImg.src");
code = code.replace("? 'http://127.0.0.1:8000' : DEFAULT_AI_API", "? (host.nativeAvailable ? DEFAULT_AI_API : 'http://127.0.0.1:8000') : DEFAULT_AI_API");
const historyClosure = '  updateHistoryCount();\n})();';
if (!code.includes(historyClosure)) throw new Error('Upstream history scope changed; review result recovery.');
code = code.replace(historyClosure, `  restore = async (payload) => {
    const output=host.prepareOutput(payload);
    aiResultB64=output.image;
    aiResultImg.src='data:'+output.mimeType+';base64,'+output.image;
    aiResultImg.style.display='block';aiResultEmpty.style.display='none';aiResultBar.style.display='flex';
    await saveHistoryResult(output.image,output,null);
    host.completed(output);
  };
  markSaved = async (jobId,assetId) => {
    const records=await getHistoryRecords();
    const record=records.find(entry=>entry.jobId===jobId || entry.id===jobId);
    if(!record) throw new Error('素材已保存，但本机历史记录缺失。');
    await putHistoryRecord({...record,assetId});
  };
  updateHistoryCount();
})();`);
// The source keeps all its workflows; only its platform request crosses this host boundary.
const module = `// Derived from ${lock.repository} @ ${head}; MIT. See /creative/fashion-LICENSE.txt.
${surface}
${billing}
export function mountFashion(container, host) {
  const shadow = container.shadowRoot || container.attachShadow({mode:'open'});
  const shell = window.document.createElement('div');
  shell.className = 'fashion-root';
  shell.dataset.theme = host.theme;
  const style = window.document.createElement('style');
  style.textContent = ${JSON.stringify(styles + "\n" + selectStyles)};
  shell.innerHTML = ${JSON.stringify(layout)};
  shadow.replaceChildren(style,shell);
  const disposeSurface = connectFashionSurface(shell);
  const document = new Proxy(window.document, {get(target,key) {
    if (key === 'body' || key === 'documentElement') return shell;
    if (key === 'activeElement') return shadow.activeElement;
    if (key === 'querySelector' || key === 'querySelectorAll') return shell[key].bind(shell);
    if (key === 'getElementById') return id => shell.querySelector('#'+CSS.escape(id));
    if (key === 'addEventListener' || key === 'removeEventListener') return shadow[key].bind(shadow);
    const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const globalWindow = window;
  const cleanups = [];
  const observers = [];
  const overrides = {};
  const localWindow = new Proxy(globalWindow,{get(target,key){if(key in overrides)return overrides[key];const value=Reflect.get(target,key,target);return typeof value==='function' && /^[a-z]/.test(String(key)) ? value.bind(target):value;},set(target,key,value){overrides[key]=value;return true;}});
  localWindow.AI_API_URL = location.origin + '/api/fashion';
  localWindow.addEventListener = (name,listener,options) => {globalWindow.addEventListener(name,listener,options);cleanups.push(()=>globalWindow.removeEventListener(name,listener,options));};
  const fetch = async (url,options) => {
    if(host.nativeAvailable && String(url) === localWindow.AI_API_URL + '/comfyui/health' && (!options?.method || options.method === 'GET')) {
      const reply=await host.checkNative();return new Response(JSON.stringify({code:0,data:{available:reply.ok,model:reply.model,message:reply.error || '本机 ComfyUI 已就绪'}}),{headers:{'content-type':'application/json'}});
    }
    if(String(url) === localWindow.AI_API_URL + '/tryon') {
      try {const payload=await host.generate(JSON.parse(options.body));return new Response(JSON.stringify({code:0,data:payload}),{headers:{'content-type':'application/json'}});}
      catch(error){return new Response(JSON.stringify({code:error.message === '已取消本次试穿。' ? 'TRY_ON_CANCELED' : 422,message:error.message}),{status:422,headers:{'content-type':'application/json'}});}
    }
    if(options?.method === 'POST' && String(url).endsWith('/tryon')) {
      const target = new URL(String(url),location.href);
      await host.confirmExternal({origin:target.origin,model:JSON.parse(options.body).client_config?.model || 'ComfyUI'});
    }
    return globalWindow.fetch(url,options);
  };
  const IntersectionObserver = class extends globalWindow.IntersectionObserver { constructor(...args){super(...args);observers.push(this);} };
  const scrollTo = options => container.scrollTo(options);
  const scrollY = 0;
  let restore, markSaved, applyTheme, modelsBilling;
  (function(window){
${code}
    modelsBilling=connectFashionBilling(shell,host);
    setTheme(host.theme);
    applyTheme = setTheme;
  })(localWindow);
  return {restore,markSaved,setStatus(message){modelsBilling.setStatus(message);},setTheme(theme){applyTheme(theme);},dispose(){modelsBilling.dispose();disposeSurface();cleanups.forEach(dispose=>dispose());observers.forEach(observer=>observer.disconnect());shadow.replaceChildren();}};
}
`;
const out = resolve(root, "apps/web/public/creative");
await mkdir(out, { recursive: true });
await writeFile(resolve(out, "fashion.mjs"), module);
await writeFile(resolve(out, "fashion-LICENSE.txt"), upstream("LICENSE"));
await writeFile(resolve(out, "fashion-source.json"), JSON.stringify(lock, null, 2));
const gallery = resolve(root, "apps/web/public/fashion-gallery");
const sourceCatalog = JSON.parse(upstream("data.js").match(/^const D=(\[.*\]);?\s*$/m)?.[1] ?? "null");
if (!Array.isArray(sourceCatalog) || !sourceCatalog.length) throw new Error("Pinned fashion catalog is invalid.");
await mkdir(gallery, { recursive: true });
await Promise.all(["img", "thumbs"].map(folder => cp(resolve(source, "assets", folder), resolve(gallery, folder), { recursive: true })));
await writeFile(resolve(gallery, "catalog.json"), JSON.stringify(sourceCatalog.map(item => ({ id: item.id, category: item["カテゴリ"], keywords: item["キーワード"], thumb: item["サムネ"], image: item["画像"] }))));
await writeFile(resolve(gallery, "LICENSE"), upstream("LICENSE"));
console.log(`Fashion runtime built from ${head}; all upstream UI workflows included.`);
