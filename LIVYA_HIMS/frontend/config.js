// LIVYA HIMS V8.3.1 + Stores frontend configuration.
const LIVYA_CONFIG = {
  SUPABASE_URL: 'https://weqghrrvgunfpsvtrlkw.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_DWdn7pbFd3kll2rbDmPkpQ_pH80mxTV',
  FUNCTION_NAME: 'hims-api',
  ADMIN_EMAILS: ['gearsganesh@gmail.com']
};
window.LIVYA_CONFIG = LIVYA_CONFIG;
document.title = 'LIVYA HIMS · V8.3.1 + Stores';

(function(){
  function load(path,css,onload){
    const e=document.createElement(css?'link':'script');
    if(css){e.rel='stylesheet';e.href=path+'?v=8.3.1'}
    else{e.src=path+'?v=8.3.1';e.defer=true}
    if(onload)e.onload=onload;
    e.onerror=()=>console.error('LIVYA resource failed to load:',path);
    document.head.appendChild(e);
    return e;
  }

  /* Keep the HIMS login session available to the Stores client as well.
     The main HIMS client uses a non-persistent session, while Stores uses
     a separate Supabase client. */
  if(window.supabase?.createClient && !window.__LIVYA_CREATE_CLIENT_PATCHED){
    const originalCreateClient=window.supabase.createClient.bind(window.supabase);
    window.supabase.createClient=function(url,key,opts){
      const o={...(opts||{})};
      o.auth={...(o.auth||{}),persistSession:true,autoRefreshToken:true};
      return originalCreateClient(url,key,o);
    };
    window.__LIVYA_CREATE_CLIENT_PATCHED=true;
  }

  function moveUserbox(){
    const top=document.querySelector('.top');
    const box=document.querySelector('.userbox');
    if(!top||!box)return;
    if(!top.contains(box)){
      box.classList.add('top-userbox');
      top.appendChild(box);
    }
  }

  function addUiStyles(){
    if(document.getElementById('livyaUiFix'))return;
    const s=document.createElement('style');
    s.id='livyaUiFix';
    s.textContent=`
      .top>#topUser{display:none!important}
      .top .top-userbox{
        position:static!important;
        left:auto!important;
        right:auto!important;
        bottom:auto!important;
        margin:0 0 0 16px!important;
        padding:0!important;
        border-top:0!important;
        color:var(--taupe);
        display:flex!important;
        align-items:center;
        gap:12px;
        font-size:11px;
      }
      .top .top-userbox .userline{margin:0!important;gap:8px;align-items:center}
      .top .top-userbox .avatar.sm{width:34px;height:34px}
      .top .top-userbox #logout{width:auto!important;min-width:82px;padding:8px 12px}

      /* Public module name: GIMS is the internal technical name; the UI is Stores. */
      #gimsNavBtn{font-size:0!important}
      #gimsNavBtn::after{content:'▦  Stores';font-size:16px}
      #gimsPage .titlebar h2{font-size:0!important}
      #gimsPage .titlebar h2::after{content:'Stores · General Inventory & Stores';font-size:26px}
      .gims-modal h3{font-size:0!important}
      .gims-modal h3::after{content:'Stores';font-size:22px}

      @media(max-width:700px){
        .top .top-userbox{margin-left:8px!important;gap:6px}
        .top .top-userbox .userline>div{display:none}
        .top .top-userbox #logout{min-width:auto;padding:7px 10px}
      }
    `;
    document.head.appendChild(s);
  }

  let storesLoaded=false;

  function ensureGimsNav(){
    const n=document.querySelector('.nav');
    if(!n)return;
    if(document.getElementById('gimsNavBtn'))return;
    const b=document.createElement('button');
    b.id='gimsNavBtn';
    b.type='button';
    b.textContent='▦  Stores';
    b.title='Stores · General Inventory & Stores';
    b.onclick=()=>{
      if(window.GIMS?.open){
        try{window.GIMS.open();}
        catch(err){console.error('Stores open failed:',err);alert('Stores could not be opened. Check the browser console for details.');}
      }else{
        alert('Stores is still loading. Please wait a moment and try again.');
      }
    };
    n.appendChild(b);
  }

  function loadStoresAfterLogin(){
    moveUserbox();
    const email=document.getElementById('sideEmail')?.textContent?.trim();
    if(!email)return;
    if(storesLoaded){
      ensureGimsNav();
      return;
    }
    storesLoaded=true;
    load('stores.css',true);
    load('stores.js',false,()=>{
      ensureGimsNav();
      moveUserbox();
    });
  }

  function start(){
    addUiStyles();
    moveUserbox();
    load('pharmacy-fix.js',false);
    loadStoresAfterLogin();
    if(document.body){
      const observer=new MutationObserver(()=>{
        addUiStyles();
        moveUserbox();
        loadStoresAfterLogin();
        ensureGimsNav();
      });
      observer.observe(document.body,{childList:true,subtree:true});
      setTimeout(()=>observer.disconnect(),180000);
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
