// LIVYA HIMS V8.2.7 + GIMS frontend configuration.
const LIVYA_CONFIG = {
  SUPABASE_URL: 'https://weqghrrvgunfpsvtrlkw.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_DWdn7pbFd3kll2rbDmPkpQ_pH80mxTV',
  FUNCTION_NAME: 'hims-api',
  ADMIN_EMAILS: ['gearsganesh@gmail.com']
};
window.LIVYA_CONFIG = LIVYA_CONFIG;
document.title = 'LIVYA HIMS · V8.2.7 + GIMS';
(function(){
  function load(path,css){const e=document.createElement(css?'link':'script');if(css){e.rel='stylesheet';e.href=path}else{e.src=path;e.defer=true}document.head.appendChild(e)}
  load('stores.css',true);load('stores.js',false);
})();
