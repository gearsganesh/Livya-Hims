(function(){
  'use strict';
  let done=false;
  const started=Date.now();
  function patch(){
    if(done || typeof window.pharmacyDashboard!=='function' || typeof window.pharmacyPurchaseOrder!=='function') return;
    const originalDashboard=window.pharmacyDashboard;
    const originalPurchaseOrder=window.pharmacyPurchaseOrder;
    window.pharmacyDashboard=async function(){
      const originalPO=window.pharmacyPurchaseOrder;
      let suppressed=false;
      window.pharmacyPurchaseOrder=function(){
        if(arguments.length===0){
          suppressed=true;
          return Promise.resolve();
        }
        return originalPO.apply(this,arguments);
      };
      try{
        await originalDashboard.apply(this,arguments);
      }finally{
        window.pharmacyPurchaseOrder=originalPO;
      }
      const btn=document.getElementById('phQpo');
      if(btn) btn.onclick=()=>window.pharmacyPurchaseOrder();
      return suppressed;
    };
    done=true;
  }
  patch();
  const timer=setInterval(()=>{
    patch();
    if(done || Date.now()-started>30000) clearInterval(timer);
  },50);
})();
