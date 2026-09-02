/* LIVYA Metabolic Reset embedded module. */
(function(){
  'use strict';
  const APP_PATH='metabolic/index.html';
  let frame,overlay;
  function sessionPayload(){
    try{return window.__LIVYA_HIMS_SUPABASE?.auth?.getSession?.() || null}catch(e){return null}
  }
  async function seedSession(){
    try{
      const client=window.supabase?.createClient && window.LIVYA_CONFIG ? window.supabase.createClient(window.LIVYA_CONFIG.SUPABASE_URL,window.LIVYA_CONFIG.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}}):null;
      if(!client)return;
      window.__LIVYA_HIMS_SUPABASE=client;
      const r=await client.auth.getSession();
      const s=r?.data?.session;
      if(!s)return;
      localStorage.setItem('livya-metabolic-auth',JSON.stringify(s));
    }catch(e){console.warn('[LIVYA] Could not seed Metabolic session',e)}
  }
  function ensure(){
    if(document.getElementById('metabolicNavBtn'))return;
    const nav=document.querySelector('.nav'); if(!nav)return;
    const b=document.createElement('button'); b.id='metabolicNavBtn'; b.type='button'; b.title='Metabolic Reset'; b.textContent='Metabolic Reset'; b.onclick=open;
    nav.appendChild(b);
  }
  async function open(){
    await seedSession();
    if(!overlay){
      overlay=document.createElement('div'); overlay.id='metabolicModuleOverlay';
      overlay.innerHTML='<div class="metabolic-module-frame"><div class="metabolic-module-bar"><div class="metabolic-module-title">LIVYA <span>Metabolic Reset</span></div><button class="metabolic-module-close" type="button">Close</button></div><iframe id="metabolicModuleFrame" title="LIVYA Metabolic Reset"></iframe></div>';
      document.body.appendChild(overlay); frame=overlay.querySelector('#metabolicModuleFrame'); overlay.querySelector('.metabolic-module-close').onclick=close;
      overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
      frame.addEventListener('load',async()=>{
        try{await seedSession(); frame.contentWindow.postMessage({type:'LIVYA_HIMS_SESSION_READY'},location.origin)}catch(e){console.warn(e)}
      });
    }
    overlay.classList.add('show');
    if(!frame.src || !frame.src.endsWith('/'+APP_PATH)) frame.src=APP_PATH;
  }
  function close(){if(overlay)overlay.classList.remove('show')}
  function start(){
    const css=document.createElement('link');css.rel='stylesheet';css.href='metabolic-module.css?v=1';document.head.appendChild(css);
    const font=document.createElement('link');font.rel='stylesheet';font.href='https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';document.head.appendChild(font);
    ensure();
    const observer=new MutationObserver(ensure); if(document.body)observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),180000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.LIVYA_METABOLIC_MODULE={open,close};
})();