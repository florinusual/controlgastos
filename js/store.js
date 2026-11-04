// Capa de datos. Con Firebase configurado usa Firestore + inicio de sesión con Google;
// si no, un almacén local (localStorage) con la misma interfaz para probar la app.
//
// Firestore: users/{uid}/{coleccion}/{id}
//   cards     → tarjetas de crédito
//   periodos  → datos de cada corte ({cardId}_{YYYY-MM})
//   movs      → movimientos (salidas y entradas)
//   super     → lista del súper
import { firebaseConfig } from './firebase-config.js';

export const COLECCIONES = ['cards', 'periodos', 'movs', 'super'];
export const isConfigured = !!firebaseConfig?.apiKey && !firebaseConfig.apiKey.startsWith('TU_');
const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';

export async function createStore() {
  return isConfigured ? firebaseStore() : localStore();
}

const nuevoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

async function firebaseStore() {
  const [appMod, authMod, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }
  let uid = null;
  const col = (c) => fs.collection(db, 'users', uid, c);
  const limpio = (o) => JSON.parse(JSON.stringify(o)); // quita undefined

  return {
    mode: 'firebase',
    onAuth(cb) {
      authMod.getRedirectResult(auth).catch(() => {});
      return authMod.onAuthStateChanged(auth, (u) => {
        uid = u?.uid ?? null;
        cb(u ? { name: u.displayName || u.email, email: u.email } : null);
      });
    },
    async signIn() {
      const gp = new authMod.GoogleAuthProvider();
      gp.setCustomParameters({ prompt: 'select_account' });
      try {
        await authMod.signInWithPopup(auth, gp);
      } catch (e) {
        if (/popup-blocked|operation-not-supported/.test(e?.code || '')) return authMod.signInWithRedirect(auth, gp);
        throw e;
      }
    },
    signOut: () => authMod.signOut(auth),
    watch(cb, onError) {
      const data = {};
      const unsubs = COLECCIONES.map((c) => fs.onSnapshot(col(c), (s) => {
        data[c] = {};
        s.docs.forEach((d) => { data[c][d.id] = { id: d.id, ...d.data() }; });
        if (COLECCIONES.every((k) => data[k])) cb({ ...data });
      }, onError));
      return () => unsubs.forEach((u) => u());
    },
    async put(c, id, patch) {
      const ref = fs.doc(col(c), id || nuevoId());
      await fs.setDoc(ref, limpio({ ...patch, id: undefined }), { merge: true });
      return ref.id;
    },
    del: (c, id) => fs.deleteDoc(fs.doc(col(c), id)),
    async delMany(pares) {
      const b = fs.writeBatch(db);
      pares.forEach(([c, id]) => b.delete(fs.doc(col(c), id)));
      await b.commit();
    },
  };
}

function localStore() {
  const KEY = 'control-gastos-demo-v1';
  const vacio = () => Object.fromEntries(COLECCIONES.map((c) => [c, {}]));
  let data;
  try { data = { ...vacio(), ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { data = vacio(); }
  const listeners = new Set();
  const commit = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* sin almacenamiento */ }
    const copia = structuredClone(data);
    listeners.forEach((cb) => cb(copia));
  };
  return {
    mode: 'local',
    isEmpty: () => Object.keys(data.cards).length === 0 && Object.keys(data.movs).length === 0,
    onAuth(cb) { setTimeout(() => cb({ name: 'Modo demo', email: '' }), 0); return () => {}; },
    signIn: async () => {}, signOut: async () => {},
    watch(cb) { listeners.add(cb); cb(structuredClone(data)); return () => listeners.delete(cb); },
    async put(c, id, patch) {
      const k = id || nuevoId();
      const sinNull = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      data[c][k] = { ...(data[c][k] || {}), ...sinNull, id: k };
      commit(); return k;
    },
    async del(c, id) { delete data[c][id]; commit(); },
    async delMany(pares) { pares.forEach(([c, id]) => delete data[c][id]); commit(); },
    async seed(d) { data = { ...vacio(), ...d }; commit(); },
    async reset() { data = vacio(); commit(); },
  };
}
