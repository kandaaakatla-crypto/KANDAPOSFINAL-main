/* eslint-disable */
// Imperative behaviour for the shop-themed landing page: the shutter, the
// playable till and printer, the kitchen ticket rail and the scroll-driven day.
// Everything is scoped to `root` and torn down by the returned cleanup.
export default function initShop(root) {
  const timers = [], intervals = [], listeners = [];
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const every = (fn, ms) => { const id = setInterval(fn, ms); intervals.push(id); return id; };
  const on = (el, ev, fn, opts) => { el.addEventListener(ev, fn, opts); listeners.push([el, ev, fn, opts]); };
const $=s=>root.querySelector(s), $$=s=>[...root.querySelectorAll(s)];
const reduce=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const inr=n=>'₹'+n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const inr0=n=>'₹'+Math.round(n).toLocaleString('en-IN');
const toastEl=$('#toast'); let tt;
function toast(m){toastEl.textContent=m;toastEl.classList.add('on');clearTimeout(tt);tt=later(()=>toastEl.classList.remove('on'),2400);}

/* ---------- shutter ---------- */
const sh=$('#shutter');
function openShop(){ if(sh.classList.contains('up'))return; sh.classList.add('up'); later(()=>sh.classList.add('gone'),reduce?0:1550); }
function closeShop(){ sh.classList.remove('gone'); void sh.offsetWidth; requestAnimationFrame(()=>{sh.classList.remove('up'); later(openShop,2600);}); }
if(reduce){sh.classList.add('up','gone');} else later(openShop,1100);
sh.addEventListener('click',openShop); sh.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openShop();}});
$('#downBtn').addEventListener('click',closeShop);

/* ---------- till ---------- */
const MENU={
  'Biryani':[['Chicken Dum Biryani',320,0],['Mutton Biryani',420,0],['Veg Biryani',240,1],['Mutton Haleem',280,0],['Paneer 65',220,1],['Mirchi ka Salan',90,1]],
  'Chai & snacks':[['Irani Chai',20,1],['Osmania Biscuit',20,1],['Samosa',15,1],['Lukhmi',40,0],['Bun Maska',35,1],['Filter Coffee',30,1]],
  'Desserts':[['Double ka Meetha',120,1],['Qubani ka Meetha',140,1],['Kulfi',60,1],['Gulab Jamun (2)',50,1],['Falooda',110,1],['Badam Milk',60,1]]
};
const ALL={}; Object.values(MENU).flat().forEach(m=>ALL[m[0]]={name:m[0],price:m[1],veg:m[2]});
let cat='Biryani', ot='Dine in', billNo=142;
let cart=new Map([['Chicken Dum Biryani',1],['Irani Chai',2],['Osmania Biscuit',4]]);
const catsEl=$('#cats'), tilesEl=$('#tiles'), linesEl=$('#lines');
function renderCats(){catsEl.innerHTML=Object.keys(MENU).map(c=>`<button type="button" aria-pressed="${c===cat}" data-c="${c}">${c}</button>`).join('');}
function renderTiles(){tilesEl.innerHTML=MENU[cat].map(([n,p,v])=>{const q=cart.get(n)||0;return `<button type="button" class="tile" data-n="${n}" aria-label="Add ${n}, ${p} rupees">${q?`<span class="q">${q}</span>`:''}<i class="veg${v?'':' nv'}" aria-hidden="true"></i><b>${n}</b><span>₹${p}</span></button>`}).join('');}
function totals(){let sub=0;cart.forEach((q,n)=>sub+=ALL[n].price*q);const c=Math.round(sub*2.5)/100, s=c, raw=sub+c+s, tot=Math.round(raw);return {sub,c,s,ro:+(tot-raw).toFixed(2),tot};}
function renderBill(){
  const items=[...cart.entries()];
  linesEl.innerHTML=items.length?items.map(([n,q])=>`<div class="ln"><span class="qb"><button type="button" data-d="${n}" aria-label="Remove one ${n}">−</button><em>${q}</em><button type="button" data-a="${n}" aria-label="Add one ${n}">+</button></span><span class="nm">${n}</span><span class="am">${inr(ALL[n].price*q)}</span></div>`).join(''):'<div class="empty">Tap a dish to start an order.</div>';
  const t=totals(); $('#sSub').textContent=inr(t.sub); $('#sC').textContent=inr(t.c); $('#sS').textContent=inr(t.s); $('#sR').textContent=(t.ro>=0?'+':'−')+inr(Math.abs(t.ro)).slice(0); $('#sT').textContent=inr0(t.tot);
  let n=0;cart.forEach(q=>n+=q); $('#itemCount').textContent=n+(n===1?' item':' items');
  $('#billTitle').textContent=(ot==='Dine in'?'Table 4':ot)+' · #'+billNo;
  $('#bKot').disabled=$('#bPay').disabled=!items.length;
}
function add(n,d){const q=(cart.get(n)||0)+d; if(q<=0)cart.delete(n); else cart.set(n,q); renderTiles(); renderBill();}
catsEl.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;cat=b.dataset.c;renderCats();renderTiles();});
tilesEl.addEventListener('click',e=>{const b=e.target.closest('.tile');if(b)add(b.dataset.n,1);});
linesEl.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;b.dataset.a?add(b.dataset.a,1):add(b.dataset.d,-1);});
$$('.seg button').forEach(b=>b.addEventListener('click',()=>{ot=b.dataset.ot;$$('.seg button').forEach(x=>x.setAttribute('aria-pressed',x===b));renderBill();}));
renderCats();renderTiles();renderBill();

/* printer */
const paper=$('#paper'), rcpt=$('#rcpt'), led=$('#led'), ledTxt=$('#ledTxt');
function qr(canvas,seed){const N=25,ctx=canvas.getContext&&canvas.getContext('2d');if(!ctx)return;canvas.width=N;canvas.height=N;ctx.fillStyle='#fff';ctx.fillRect(0,0,N,N);ctx.fillStyle='#111';
  let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){if(rnd()>.52)ctx.fillRect(x,y,1,1);}
  [[0,0],[N-7,0],[0,N-7]].forEach(([x,y])=>{ctx.fillStyle='#fff';ctx.fillRect(x-1<0?0:x-1,y-1<0?0:y-1,9,9);ctx.fillStyle='#111';ctx.fillRect(x,y,7,7);ctx.fillStyle='#fff';ctx.fillRect(x+1,y+1,5,5);ctx.fillStyle='#111';ctx.fillRect(x+2,y+2,3,3);});}
function print(){
  const t=totals(), now=new Date();
  const when=now.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
  rcpt.innerHTML=`<div class="c" style="font-weight:800;font-size:13px">DEMO RESTAURANT</div><div class="c m">Banjara Hills, Hyderabad<br>GSTIN 36AAACK1234F1Z8</div><hr>
  <div class="r m"><span>Bill #${billNo} · ${ot}</span><span>${when}</span></div><hr>
  ${[...cart.entries()].map(([n,q])=>`<div class="r"><span>${n} ×${q}</span><span>${(ALL[n].price*q).toFixed(2)}</span></div>`).join('')}<hr>
  <div class="r"><span>Subtotal</span><span>${t.sub.toFixed(2)}</span></div><div class="r m"><span>CGST 2.5%</span><span>${t.c.toFixed(2)}</span></div><div class="r m"><span>SGST 2.5%</span><span>${t.s.toFixed(2)}</span></div><div class="r m"><span>Round off</span><span>${t.ro.toFixed(2)}</span></div><hr>
  <div class="r big"><span>TOTAL</span><span>${inr0(t.tot)}</span></div>
  <canvas id="qrc" aria-label="Sample UPI QR code"></canvas><div class="c m">Scan to pay by UPI (sample)</div><div class="c" style="margin-top:6px">Thank you, visit again!</div>`;
  qr($('#qrc'),billNo*7919+t.tot);
  paper.classList.remove('show'); void paper.offsetWidth;
  led.className='busy'; ledTxt.textContent='PRINTING'; $('#prHint').textContent='Fresh bill, GST already worked out.';
  requestAnimationFrame(()=>paper.classList.add('show'));
  later(()=>{led.className='on';ledTxt.textContent='READY';},reduce?0:2400);
}
$('#bPay').addEventListener('click',()=>{print(); billNo++; later(()=>{cart=new Map();renderTiles();renderBill();},reduce?0:2500);});

/* ---------- kitchen rail ---------- */
const SRC={'Dine in':'#EA580C','Takeaway':'#16A34A','Swiggy':'#F97316','Zomato':'#DC2626','Delivery':'#2563EB','Counter':'#7C3AED'};
const rail=$('#rail'); let done=0, times=[];
let tickets=[
  {no:138,src:'Dine in',where:'Table 7',station:'Tandoor',items:[[2,'Chicken Tikka'],[4,'Butter Naan']],age:13*60+20,note:''},
  {no:139,src:'Zomato',where:'via UrbanPiper',station:'Biryani',items:[[1,'Mutton Biryani'],[1,'Mirchi ka Salan']],age:9*60+5,note:'extra raita'},
  {no:140,src:'Takeaway',where:'Token 27',station:'Chai',items:[[6,'Irani Chai'],[6,'Osmania Biscuit']],age:4*60+40,note:''},
  {no:141,src:'Swiggy',where:'via UrbanPiper',station:'Grill',items:[[2,'Paneer 65'],[1,'Veg Biryani']],age:1*60+10,note:'less spicy'}
];
const pool=[[[1,'Chicken Dum Biryani'],[2,'Irani Chai']],[[3,'Samosa'],[3,'Filter Coffee']],[[1,'Mutton Haleem'],[2,'Lukhmi']],[[2,'Double ka Meetha'],[1,'Falooda']]];
const fmt=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
function kotHTML(t){return `<div class="kot" data-no="${t.no}"><div class="top"><span>KOT #${t.no}</span><span>${t.station.toUpperCase()}</span></div><span class="src" style="background:${SRC[t.src]||'#555'}">${t.src.toUpperCase()}</span> <span style="font-size:11px;color:#7a7266">${t.where}</span><ul>${t.items.map(([q,n])=>`<li><b>${q}×</b><span>${n}</span></li>`).join('')}</ul>${t.note?`<div class="note">${t.note}</div>`:''}<div class="tm"><em>${fmt(t.age)}</em><button type="button" data-bump="${t.no}">BUMP</button></div></div>`;}
function renderRail(){rail.innerHTML=tickets.map(kotHTML).join('');paintAges();}
function paintAges(){tickets.forEach(t=>{const el=rail.querySelector(`[data-no="${t.no}"]`);if(!el)return;el.querySelector('em').textContent=fmt(t.age);el.classList.toggle('amber',t.age>=480&&t.age<720);el.classList.toggle('late',t.age>=720);});
  $('#kOpen').textContent=tickets.length;$('#kDone').textContent=done;$('#kAvg').textContent=times.length?fmt(Math.round(times.reduce((a,b)=>a+b,0)/times.length)):'—';}
function addTicket(t){tickets.push(t);rail.insertAdjacentHTML('beforeend',kotHTML(t));paintAges();}
rail.addEventListener('click',e=>{const b=e.target.closest('[data-bump]');if(!b)return;const no=+b.dataset.bump;const t=tickets.find(x=>x.no===no);const el=b.closest('.kot');el.classList.add('bump');times.push(t.age);done++;
  later(()=>{tickets=tickets.filter(x=>x.no!==no);el.remove();paintAges();},reduce?0:450);});
renderRail();
let nextNo=200;
every(()=>{tickets.forEach(t=>t.age++);paintAges();},1000);
every(()=>{ if(tickets.length<5&&!document.hidden){const srcs=['Swiggy','Zomato','Dine in','Takeaway','Counter'];const s=srcs[Math.floor(Math.random()*srcs.length)];
  addTicket({no:nextNo++,src:s,where:s==='Dine in'?'Table '+(2+Math.floor(Math.random()*12)):(s==='Swiggy'||s==='Zomato')?'via UrbanPiper':'Token '+(30+Math.floor(Math.random()*40)),station:['Biryani','Grill','Chai','Tandoor'][Math.floor(Math.random()*4)],items:pool[Math.floor(Math.random()*pool.length)],age:0,note:''});}},11000);
$('#bKot').addEventListener('click',()=>{
  const items=[...cart.entries()].map(([n,q])=>[q,n]);
  addTicket({no:billNo,src:ot==='Delivery'?'Delivery':ot,where:ot==='Dine in'?'Table 4':ot==='Takeaway'?'Token 28':'Rider assigned',station:'Pass',items,age:0,note:'from the till ↑'});
  toast('KOT #'+billNo+' sent to the kitchen rail below');
});

/* ---------- day ---------- */
const MOM=[
  [420,'07:00 – 09:00','Chai rush','Fifty Irani chais before nine. Quick keys and saved favourites keep the queue moving.'],
  [810,'13:30 – 15:00','Lunch, every table','The floor plan fills up live. Orders split by station, bills split by guest.'],
  [1020,'17:00 – 18:30','Retail restock','Low stock alerts and reorder points tell you what to buy before you run out.'],
  [1245,'20:45 – 22:00','Delivery peak','Swiggy, Zomato, riders and pickup on one board, so nothing gets lost in the rush.'],
  [1410,'23:30','Lights out','Cash drawer closed, GST report ready, tomorrow’s prep list waiting on the owner’s phone.']
];
const SKY=[[420,'#F7A866','#FDE8CC'],[600,'#8CC8F0','#E6F4FF'],[810,'#4FAAE8','#CFEBFF'],[1020,'#E9883A','#FCD9A8'],[1110,'#B4466A','#F7A35C'],[1200,'#2B1B4A','#9C3D2E'],[1410,'#070B1E','#1B1A3A']];
const ORD=[[420,0],[540,48],[780,70],[900,190],[1020,215],[1170,260],[1320,390],[1410,412]];
const lerp=(a,b,t)=>a+(b-a)*t;
const hx=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const mix=(a,b,t)=>{const A=hx(a),B=hx(b);return 'rgb('+A.map((v,i)=>Math.round(lerp(v,B[i],t))).join(',')+')';};
function interp(tab,m,idx){for(let i=0;i<tab.length-1;i++){if(m<=tab[i+1][0]){const t=(m-tab[i][0])/(tab[i+1][0]-tab[i][0]);return idx===undefined?lerp(tab[i][1],tab[i+1][1],t):mix(tab[i][idx],tab[i+1][idx],t);}}const l=tab[tab.length-1];return idx===undefined?l[1]:l[idx];}
const day=$('#day'), sky=$('#sky'), orb=$('#orb'), clock=$('#clock'), stars=$('#stars'), stick=day.querySelector('.stick');
// stars
(function(){const c=stars,ctx=c.getContext&&c.getContext('2d');function draw(){if(!ctx)return;c.width=c.offsetWidth;c.height=c.offsetHeight;let s=7;const r=()=>(s=(s*16807)%2147483647)/2147483647;ctx.fillStyle='#fff';for(let i=0;i<140;i++){ctx.globalAlpha=.3+r()*.7;ctx.fillRect(r()*c.width,r()*c.height*.6,1.4,1.4);}}draw();on(window,'resize',draw);})();
let lastM=-1;
function paintDay(){
  const r=day.getBoundingClientRect(), span=day.offsetHeight-innerHeight;
  const p=Math.min(1,Math.max(0,-r.top/span)); const m=Math.round(lerp(420,1410,p)/5)*5;
  if(m===lastM)return; lastM=m;
  sky.style.background=`linear-gradient(${interp(SKY,m,1)},${interp(SKY,m,2)})`;
  const night=m>=1170; stick.style.setProperty('--dayfg',night?'#FBF6EC':'#1E1A16');
  stars.style.opacity=Math.max(0,Math.min(1,(m-1140)/120));
  // orb path
  const sunP=Math.min(1,(m-420)/(1140-420)), moonP=Math.max(0,(m-1170)/(1410-1170));
  orb.classList.toggle('moon',m>=1150);
  const op=m>=1150?moonP:sunP; orb.style.left=lerp(8,92,op)+'%'; orb.style.top=(70-Math.sin(op*Math.PI)*52)+'%';
  orb.style.opacity=(m>1110&&m<1170)?Math.abs(m-1140)/30:1;
  $('#cityFill').setAttribute('fill',night?'#0d0b14':mix('#3a2a1e','#2a2018',sunP));
  $('#windows').setAttribute('opacity',Math.max(0,Math.min(1,(m-1080)/90)));
  $('#arch').setAttribute('opacity',Math.max(0,Math.min(.6,(m-1100)/90)));
  const hh=Math.floor(m/60), mm=m%60; clock.innerHTML=String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
  let k=0; MOM.forEach((x,i)=>{if(Math.abs(m-x[0])<Math.abs(m-MOM[k][0]))k=i;});
  $('#mWhen').textContent=MOM[k][1]; $('#mTitle').textContent=MOM[k][2]; $('#mBody').textContent=MOM[k][3];
  const o=Math.round(interp(ORD,m)); $('#stO').textContent=o; $('#stS').textContent=inr0(o*318);
  $('#scrubBar').style.width=(p*100)+'%';
}
let ticking=false; on(window,'scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(()=>{paintDay();ticking=false;});}},{passive:true});
on(window,'resize',()=>{lastM=-1;paintDay();}); paintDay();

/* footer sign lights up when seen */


/* ---------- menu board ---------- */
const DISH=[
  ['Order management','All','Dine in, delivery and collection orders on one fast screen, built for busy shifts.'],
  ['Retail checkout','Retail','Barcode scanning, product variants and quick checkout for shops.'],
  ['Kitchen display','Restaurants','Tickets routed to the right station in real time, with prep timers.'],
  ['Tables & floor plan','Restaurants','Arrange tables in your own layout, with live status and reservations.'],
  ['Dispatch & delivery','Restaurants','Rider assignment and live order tracking.'],
  ['Inventory & waste','All','Stock levels, low stock alerts and reorder points.'],
  ['Staff & workforce','All','PIN login, time clock, shift scheduling and tips.'],
  ['Reports & GST','All','Daily rollups, peak-hour heatmaps and GST-ready invoices.'],
  ['WhatsApp updates','All','Bills and order updates sent straight to the customer.'],
  ['Voice & AI assistant','All','Phone orders and AI help, answered automatically.']
];
$('#dishes').innerHTML=DISH.map(d=>`<div class="dish"><div class="row"><span>${d[0]}</span><span class="dots"></span><span class="pr">included</span></div><p>${d[2]}</p></div>`).join('');


$$('[data-copy]').forEach(b=>b.addEventListener('click',()=>{const v=b.dataset.copy;
  const sel=()=>{const r=document.createRange();r.selectNodeContents(b.parentElement.querySelector('b'));const s=getSelection();s.removeAllRanges();s.addRange(r);toast('Selected. Press Ctrl+C to copy.');};
  try{navigator.clipboard.writeText(v).then(()=>toast('Email copied'),sel);}catch(e){sel();}}));
  return () => {
    timers.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    listeners.forEach(([el, ev, fn, opts]) => el.removeEventListener(ev, fn, opts));
  };
}
