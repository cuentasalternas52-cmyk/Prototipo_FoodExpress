/* FoodExpress · conexión con Firebase (Authentication + Firestore)
   Estrategia: app.js sigue trabajando con el estado S en memoria. Este archivo:
   1) escucha Firestore en tiempo real y actualiza S;
   2) tras cada render(), detecta lo que cambió en S y lo guarda (sync). */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,doc,getDoc,setDoc,collection,query,where,onSnapshot} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./firebase-config.js";

const auth=getAuth(initializeApp(firebaseConfig)),db=getFirestore();
const clean=o=>JSON.parse(JSON.stringify(o));
const stable=o=>JSON.stringify(o,(k,v)=>v&&typeof v=='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort()):v);
const last=new Map();          // última versión conocida de cada documento
let unsubs=[],profile=null;

const COL={
  restaurants:()=>Object.entries(S.bizs).map(([id,b])=>[id,{...b,id}]),
  products:()=>S.prods.map(p=>[p.id,p]),
  orders:()=>S.orders.map(o=>[String(o.id),o])
};
function sync(){
  const u=auth.currentUser;if(!u)return;
  for(const [c,get] of Object.entries(COL))for(const [id,o] of get()){
    const data=clean(c=='orders'&&!o.uid?{...o,uid:u.uid}:o),k=c+'/'+id,j=stable(data);
    if(last.get(k)!==j){last.set(k,j);setDoc(doc(db,c,id),data).catch(e=>console.error('Firestore',k,e.code))}
  }
}
const SAFE=['home','menu','track','orders','a_orders','a_sales'];
const refresh=()=>{if(SAFE.includes(S.view))render()};
const unsub=()=>{unsubs.forEach(f=>f());unsubs=[]};
function listen(){
  unsub();
  const feed=(c,q,fn)=>unsubs.push(onSnapshot(q,snap=>{
    const arr=[];snap.forEach(d=>{const x=d.data();last.set(c+'/'+d.id,stable(x));arr.push(x)});
    fn(arr);refresh();
  },e=>console.error('Firestore',c,e.code)));
  feed('restaurants',collection(db,'restaurants'),a=>S.bizs=Object.fromEntries(a.map(x=>[x.id,x])));
  feed('products',collection(db,'products'),a=>S.prods=a);
  const f=profile.role=='restaurante'?where('rid','==',profile.rid):where('uid','==',auth.currentUser.uid);
  feed('orders',query(collection(db,'orders'),f),a=>S.orders=a.sort((x,y)=>y.id-x.id));
}
const load=async uid=>(await getDoc(doc(db,'users',uid))).data();

window.FB={
  sync,
  async registerClient(name,email,phone,pass){
    const c=await createUserWithEmailAndPassword(auth,email,pass);
    profile={role:'cliente',name,phone,email};
    await setDoc(doc(db,'users',c.user.uid),profile);listen();
    return {uid:c.user.uid,...profile};
  },
  async loginClient(email,pass){
    const c=await signInWithEmailAndPassword(auth,email,pass);profile=await load(c.user.uid);
    if(!profile||profile.role!='cliente'){await signOut(auth);throw {message:'Esta cuenta no es de cliente. Usa "Acceso para restaurantes".'}}
    listen();return {uid:c.user.uid,...profile};
  },
  async registerRest(email,pass,biz){
    const c=await createUserWithEmailAndPassword(auth,email,pass),id='r'+Date.now();
    profile={role:'restaurante',rid:id,email,name:biz.name};
    await setDoc(doc(db,'users',c.user.uid),profile);
    const b={...biz,adminUid:c.user.uid,id};
    await setDoc(doc(db,'restaurants',id),clean(b));
    S.bizs[id]=b;last.set('restaurants/'+id,stable(clean(b)));listen();return id;
  },
  async loginAdmin(email,pass){
    const c=await signInWithEmailAndPassword(auth,email,pass);profile=await load(c.user.uid);
    if(!profile||profile.role!='restaurante'){await signOut(auth);throw {message:'Esta cuenta no administra un restaurante.'}}
    listen();return profile.rid;
  },
  async logout(){
    const wasAdmin=S.admin;await signOut(auth);unsub();last.clear();profile=null;
    S.user=null;S.admin=false;S.cart=[];S.bizs={};S.prods=[];S.orders=[];S.rid=null;
    go(wasAdmin?'a_login':'login');
  }
};

// Restaurar la sesión si ya estaba iniciada al abrir la página
let first=true;
onAuthStateChanged(auth,async u=>{
  if(!first)return;first=false;if(!u)return;
  profile=await load(u.uid);if(!profile)return;listen();
  if(profile.role=='cliente'){S.user={uid:u.uid,...profile};go('home')}
  else{S.admin=true;S.rid=profile.rid;S.editId='';go('a_orders')}
});
