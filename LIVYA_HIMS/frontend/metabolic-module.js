/* LIVYA Metabolic Reset embedded module. */
(function () {
  'use strict';

  const APP_PATH = 'metabolic/index.html?v=8.3.7';
  const SUPABASE_STORAGE_KEY = 'sb-weqghrrvgunfpsvtrlkw-auth-token';
  const SESSION_BRIDGE = 'metabolic/hims-session-bridge.js?v=1';
  const CLINICAL_BRIDGE = 'metabolic/hims-clinical-dashboard.js?v=2';
  let frame;
  let overlay;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function getHimsSession() {
    try {
      const client = window.__LIVYA_SB || window.__LIVYA_HIMS_SUPABASE;
      if (client?.auth?.getSession) {
        const result = await client.auth.getSession();
        return result?.data?.session || null;
      }
    } catch (error) {
      console.warn('[LIVYA] Could not read HIMS auth session', error);
    }
    return null;
  }

  async function seedSession() {
    const session = await getHimsSession();
    if (!session?.access_token || !session?.refresh_token) return null;
    try {
      const serialized = JSON.stringify(session);
      localStorage.setItem('livya-metabolic-auth', serialized);
      localStorage.setItem(SUPABASE_STORAGE_KEY, serialized);
    } catch (_) {}
    return session;
  }

  function selectedHimsPatientId() {
    const node = document.querySelector('.selected-patient');
    const match = (node?.textContent || '').match(/Selected patient:\s*([^\s<]+)/i);
    return match ? match[1].trim() : null;
  }

  async function waitForHydration() {
    if (!frame?.contentWindow) return false;
    for (let i = 0; i < 100; i += 1) {
      try {
        const backend = frame.contentWindow.LIVYA_BACKEND;
        if (backend?.sessionUserId) {
          if (typeof frame.contentWindow.render === 'function') frame.contentWindow.render();
          return true;
        }
      } catch (_) {}
      await wait(100);
    }
    return false;
  }

  async function injectScript(id, src) {
    if (!frame?.contentWindow) return false;
    try {
      const doc = frame.contentWindow.document;
      const existing = doc.getElementById(id);
      if (existing) return true;
      const script = doc.createElement('script');
      script.id = id;
      script.src = src;
      script.async = false;
      (doc.head || doc.documentElement).appendChild(script);
      await new Promise(resolve => {
        script.addEventListener('load', resolve, {once: true});
        script.addEventListener('error', resolve, {once: true});
      });
      return !!doc.getElementById(id);
    } catch (error) {
      console.warn('[LIVYA] Could not inject iframe script', src, error);
      return false;
    }
  }

  async function injectSessionBridge() {
    return injectScript('livyaHimsSessionBridgeScript', SESSION_BRIDGE);
  }

  async function injectClinicalBridge() {
    return injectScript('livyaHimsClinicalBridgeScript', CLINICAL_BRIDGE);
  }

  async function postSessionToFrame(session) {
    if (!frame?.contentWindow || !session) return 'failed';
    await injectSessionBridge();

    return new Promise(resolve => {
      let settled = false;
      let attempts = 0;
      const finish = result => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        resolve(result);
      };
      const onMessage = event => {
        if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
        if (event.data?.type === 'LIVYA_METABOLIC_SESSION_RELOADING') finish('reloading');
        if (event.data?.type === 'LIVYA_METABOLIC_SESSION_ACCEPTED') finish('accepted');
        if (event.data?.type === 'LIVYA_METABOLIC_SESSION_FAILED') finish('failed');
      };
      window.addEventListener('message', onMessage);

      const send = () => {
        if (settled || !frame?.contentWindow) return;
        attempts += 1;
        try {
          frame.contentWindow.postMessage({type: 'LIVYA_HIMS_SESSION', session}, location.origin);
        } catch (_) {}
        if (attempts >= 40) finish('failed');
        else setTimeout(send, 125);
      };
      send();
    });
  }

  async function syncFrameSession() {
    const session = await seedSession();
    if (!session || !frame?.contentWindow) return 'failed';

    const bridgeResult = await postSessionToFrame(session);
    if (bridgeResult === 'accepted') {
      await waitForHydration();
      return 'accepted';
    }
    if (bridgeResult === 'reloading') return 'reloading';

    // Compatibility fallback for an older cached iframe that has not received
    // the new bridge yet. The next load will use the secure postMessage path.
    try {
      const client = frame.contentWindow.LIVYA_BACKEND?.client;
      if (client?.auth?.setSession) {
        const result = await client.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
        if (!result?.error) {
          await waitForHydration();
          return 'accepted';
        }
      }
    } catch (_) {}
    return 'failed';
  }

  async function applyPatientContext() {
    const patientId = selectedHimsPatientId();
    if (!patientId || !frame?.contentWindow) return false;
    try {
      const client = frame.contentWindow.LIVYA_BACKEND?.client;
      if (!client) return false;
      const result = await client
        .from('metabolic_clients')
        .select('id,full_name')
        .eq('hims_patient_id', patientId)
        .maybeSingle();
      if (result?.error || !result?.data) return false;

      const id = JSON.stringify(result.data.id);
      try {
        frame.contentWindow.eval(`if(typeof UI!=='undefined'){UI.clientId=${id};UI.view='health';if(typeof render==='function')render();}`);
      } catch (_) {}

      frame.contentWindow.postMessage({
        type: 'LIVYA_HIMS_PATIENT_CONTEXT',
        himsPatientId: patientId,
        metabolicClientId: result.data.id
      }, location.origin);

      await injectClinicalBridge();
      await wait(150);
      try {
        if (typeof frame.contentWindow.LIVYA_HIMS_CLINICAL?.render === 'function') {
          await frame.contentWindow.LIVYA_HIMS_CLINICAL.render();
        }
      } catch (_) {}
      return true;
    } catch (error) {
      console.warn('[LIVYA] Patient context handoff failed', error);
      return false;
    }
  }

  async function clearFrameSession() {
    try { await frame?.contentWindow?.LIVYA_BACKEND?.client?.auth?.signOut(); } catch (_) {}
    try {
      localStorage.removeItem('livya-metabolic-auth');
      localStorage.removeItem(SUPABASE_STORAGE_KEY);
    } catch (_) {}
  }

  function ensure() {
    if (document.getElementById('metabolicNavBtn')) return;
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const button = document.createElement('button');
    button.id = 'metabolicNavBtn';
    button.type = 'button';
    button.title = 'Metabolic Reset';
    button.textContent = 'Metabolic Reset';
    button.onclick = open;
    nav.appendChild(button);
  }

  async function handleFrameLoad() {
    const result = await syncFrameSession();
    if (result === 'reloading') return;
    if (result === 'accepted') {
      await wait(150);
      await applyPatientContext();
    }
  }

  async function open() {
    const session = await seedSession();
    if (!session) {
      console.warn('[LIVYA] Metabolic Reset blocked because HIMS has no active session');
      return;
    }

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'metabolicModuleOverlay';
      overlay.innerHTML = '<div class="metabolic-module-frame"><div class="metabolic-module-bar"><div class="metabolic-module-title">LIVYA <span>Metabolic Reset</span></div><button class="metabolic-module-close" type="button">Close</button></div><iframe id="metabolicModuleFrame" title="LIVYA Metabolic Reset"></iframe></div>';
      document.body.appendChild(overlay);
      frame = overlay.querySelector('#metabolicModuleFrame');
      overlay.querySelector('.metabolic-module-close').onclick = close;
      overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
      frame.addEventListener('load', () => { void handleFrameLoad(); });
    }

    overlay.classList.add('show');
    if (!frame.src || !frame.src.includes('/' + APP_PATH.split('?')[0])) {
      frame.src = APP_PATH;
    } else {
      await handleFrameLoad();
    }
  }

  function close() {
    if (overlay) overlay.classList.remove('show');
  }

  function bindLogout() {
    document.addEventListener('click', event => {
      const logout = event.target?.closest?.('#logout');
      if (logout) void clearFrameSession();
    }, true);
  }

  function start() {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'metabolic-module.css?v=7';
    document.head.appendChild(css);
    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(font);
    ensure();
    bindLogout();
    const observer = new MutationObserver(ensure);
    if (document.body) observer.observe(document.body, {childList:true, subtree:true});
    setTimeout(() => observer.disconnect(), 180000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();

  window.LIVYA_METABOLIC_MODULE = {
    open,
    close,
    clearSession: clearFrameSession,
    applyPatientContext
  };
})();
