// LIVYA HIMS remembered-session controller.
// A successful OTP login is remembered in this browser for 3 hours.
// Explicit Sign out clears the remembered state and requires OTP next time.
(function(){
  const KEY='livya-hims-login-meta';
  const TTL=3*60*60*1000;
  const client=window.__LIVYA_SB;
  if(!client)return;

  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(_){return null}};
  const write=(email,loginAt)=>{try{localStorage.setItem(KEY,JSON.stringify({email:String(email||'').trim().toLowerCase(),loginAt:Number(loginAt)||Date.now()}))}catch(_){} };
  const clear=()=>{try{localStorage.removeItem(KEY)}catch(_){} };
  const valid=m=>!!(m&&m.loginAt&&Date.now()-Number(m.loginAt)<TTL);
  const showLoginSafe=()=>{if(typeof window.showLogin==='function')window.showLogin();};
  const showAppSafe=()=>{if(typeof window.showApp==='function')window.showApp();};

  let starting=true;
  client.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_IN'&&session?.user){
      const existing=read();
      if(!valid(existing))write(session.user.email||'',Date.now());
      return;
    }
    if(event==='SIGNED_OUT'){
      clear();
      showLoginSafe();
    }
  });

  async function bootRememberedSession(){
    try{
      const meta=read();
      const {data,error}=await client.auth.getSession();
      if(error)throw error;
      const current=data?.session;
      if(!current){
        if(meta&&!valid(meta))clear();
        return;
      }
      if(!meta){
        // A session created before this controller existed is accepted once and starts a fresh 3-hour window.
        write(current.user?.email||'',Date.now());
      }else if(!valid(meta)){
        clear();
        await client.auth.signOut({scope:'local'});
        showLoginSafe();
        return;
      }
      // The original HIMS auth listener receives INITIAL_SESSION and populates its internal session variable.
      // Give that callback a moment before entering the application.
      setTimeout(()=>showAppSafe(),150);
    }catch(e){
      console.warn('LIVYA remembered session could not be restored:',e);
      showLoginSafe();
    }finally{starting=false;}
  }

  // Enforce the three-hour absolute browser-login window even while the tab stays open.
  setInterval(async()=>{
    const meta=read();
    if(!meta||valid(meta))return;
    clear();
    try{await client.auth.signOut({scope:'local'});}catch(_){}
    showLoginSafe();
  },60000);

  // When the user explicitly clicks Sign out, the native HIMS handler performs signOut().
  // We clear the remembered marker immediately so the next login cannot bypass OTP.
  document.addEventListener('click',e=>{
    const btn=e.target?.closest?.('#logout');
    if(btn)clear();
  },true);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootRememberedSession,{once:true});
  else bootRememberedSession();
})();
