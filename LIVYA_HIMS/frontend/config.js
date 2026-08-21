// LIVYA HIMS V8.2.9 + GIMS frontend configuration.
const LIVYA_CONFIG = {
  SUPABASE_URL: 'https://weqghrrvgunfpsvtrlkw.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_DWdn7pbFd3kll2rbDmPkpQ_pH80mxTV',
  FUNCTION_NAME: 'hims-api',
  ADMIN_EMAILS: ['gearsganesh@gmail.com']
};
window.LIVYA_CONFIG = LIVYA_CONFIG;
document.title = 'LIVYA HIMS · V8.2.9 + GIMS';
(function(){
  function load(path,css,onload){
    const e=document.createElement(css?'link':'script');
    if(css){e.rel='stylesheet';e.href=path+'?v=8.2.9'}
    else{e.src=path+'?v=8.2.9';e.defer=true}
    if(onload)e.onload=onload;
    e.onerror=()=>console.error('LIVYA resource failed to load:',path);
    document.head.appendChild(e);
    return e;
  }

  function ensureGimsNav(){
    const n=document.querySelector('.nav');
    if(!n||document.getElementById('gimsNavBtn'))return;
    const b=document.createElement('button');
    b.id='gimsNavBtn';
    b.type='button';
    b.textContent='▦  GIMS';
    b.title='General Inventory & Stores';
    b.onclick=()=>{
      if(window.GIMS?.open){window.GIMS.open();}
      else{console.error('GIMS module is not ready');alert('GIMS is still loading. Please try again in a moment.');}
    };
    n.appendChild(b);
  }

  load('stores.css',true);
  load('stores.js',false,ensureGimsNav);

  const start=()=>{
    ensureGimsNav();
    if(document.body){
      const observer=new MutationObserver(()=>ensureGimsNav());
      observer.observe(document.body,{childList:true,subtree:true});
      setTimeout(()=>observer.disconnect(),120000);
    }
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
