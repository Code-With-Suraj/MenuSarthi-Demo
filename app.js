const urlParams = new URLSearchParams(window.location.search);
const INIT_TABLE = urlParams.get('table') || '';
const INIT_PAGE = urlParams.get('page') || 'customer';

const SESSION_KEY='ms_session';const ADMIN_SESSION_KEY='ms_admin_session';const SESSION_TTL=2*60*60*1000;
const S={currentView:'landing',user:null,table:INIT_TABLE||'',menu:[],categories:[],cart:[],currentOrder:null,isAdmin:false,trackInterval:null,adminInterval:null,adminOrderCount:0,config:{},revisingOrderId:null,revisingNotes:'',revisionInterval:null,reportData:null,adminOrders:[],adminMenu:[],adminAddons:[],myOrders:[],subscriptionStatus:null,currentOrderDetails:null};
function saveSession(u){try{localStorage.setItem(SESSION_KEY,JSON.stringify({user:u}))}catch(e){}}
function loadSession(){try{const s=JSON.parse(localStorage.getItem(SESSION_KEY));if(s&&s.user){S.user=s.user;return true}clearSession()}catch(e){}return false}
function clearSession(){try{localStorage.removeItem(SESSION_KEY)}catch(e){};S.user=null}
async function verifyUserSessionFromServer(phone){
  try{
    const r=await callServer('validateUserSession',phone);
    if(r&&r.success&&r.data){
      S.user=r.data;
      saveSession(r.data);
      updateUserUI();
    }else{
      clearSession();
      updateUserUI();
      showToast('Your session has ended or account was removed.','info');
      if(['cart','orders','tracking'].includes(S.currentView))navigateTo('menu');
    }
  }catch(e){
    console.warn('Session validation deferred due to network connection:',e);
  }
}

function saveAdminSession(){try{localStorage.setItem(ADMIN_SESSION_KEY,JSON.stringify({isAdmin:true,expiry:Date.now()+SESSION_TTL}))}catch(e){}}
function loadAdminSession(){try{const s=JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY));if(s&&s.isAdmin&&s.expiry>Date.now()){S.isAdmin=true;return true}clearAdminSession()}catch(e){}return false}
function clearAdminSession(){try{localStorage.removeItem(ADMIN_SESSION_KEY)}catch(e){};S.isAdmin=false}
function checkAdminSessionExpiry(){try{const s=JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY));if(s&&s.expiry<=Date.now()){clearAdminSession();if(S.adminInterval)clearInterval(S.adminInterval);showToast('Admin session expired. Please login again.','info');if(S.currentView==='admin')navigateTo('landing')}}catch(e){}}


async function callServer(action, ...args) {
  if (!CONFIG.GAS_API_URL) {
    showToast("Backend API URL is not configured. Please set CONFIG.GAS_API_URL in config.js.", "error");
    throw new Error("GAS_API_URL not configured");
  }
  
  const params = _buildParams(action, args);
  
  try {
    const response = await fetch(CONFIG.GAS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({ action, params })
    });
    
    if (!response.ok) {
      throw new Error('HTTP error ' + response.status);
    }
    
    return await response.json();
  } catch (e) {
    console.error('API call failed:', e);
    throw e;
  }
}

function _buildParams(action, args) {
  switch(action) {
    case 'loginUser':
    case 'registerUser':
    case 'placeOrder':
    case 'addMenuItem':
    case 'updateMenuItem':
    case 'addAddOn':
    case 'updateAddOn':
    case 'updateAdminConfig':
      return args[0] || {};
    case 'validateUserSession':
      return { phone: args[0] };
    case 'adminLogin':
      return { password: args[0] };
    case 'getOrderStatus':
      return { orderId: args[0] };
    case 'getMyOrders':
      return { phone: args[0] };
    case 'getAddOnsForCart':
      return { cartItemIds: args[0] };
    case 'toggleItemAvailability':
    case 'deleteMenuItem':
      return { itemId: args[0] };
    case 'toggleAddOnAvailability':
    case 'deleteAddOn':
      return { addOnId: args[0] };
    case 'deleteOrder':
      return { orderId: args[0] };
    case 'updateOrderStatus':
      return { orderId: args[0], status: args[1], etaMinutes: args[2] };
    case 'updateOrderPaymentStatus':
      return { orderId: args[0], paymentStatus: args[1] };
    case 'createRazorpayOrder':
      return { orderId: args[0], amount: args[1] };
    case 'verifyRazorpayPayment':
      return { orderId: args[0], razorpayPaymentId: args[1], razorpayOrderId: args[2], razorpaySignature: args[3] };
    case 'createSubscriptionOrder':
      return { planId: args[0] };
    case 'verifySubscriptionPayment':
      return { planId: args[0], razorpayPaymentId: args[1], razorpayOrderId: args[2], razorpaySignature: args[3] };
    case 'refundRazorpayPayment':
      return { orderId: args[0] };
    case 'reviseOrder':
      return { orderId: args[0], ...args[1] };
    case 'getFinancialReport':
      return { startDate: args[0], endDate: args[1] };
    default:
      return args[0] || {};
  }
}
function $(id){return document.getElementById(id)}
function show(el){if(typeof el==='string')el=$(el);if(el)el.classList.remove('hidden')}
function hide(el){if(typeof el==='string')el=$(el);if(el)el.classList.add('hidden')}
function toggleDesc(btn){
  const parent=btn.closest('.desc');
  const shortEl=parent.querySelector('.desc-short');
  const fullEl=parent.querySelector('.desc-full');
  if(shortEl.style.display==='none'){
    shortEl.style.display='inline';
    fullEl.style.display='none';
    btn.textContent='Read More';
  }else{
    shortEl.style.display='none';
    fullEl.style.display='inline';
    btn.textContent='Read Less';
  }
}

// ===== TOAST =====
function showToast(msg,type='info'){const t=document.createElement('div');t.className='toast toast-'+type;t.textContent=msg;$('toast-container').appendChild(t);setTimeout(()=>t.remove(),3500)}

// ===== LOADER =====
function showLoader(t='Loading...'){$('loader-text').textContent=t;$('loader-overlay').classList.add('active')}
function hideLoader(){$('loader-overlay').classList.remove('active')}

// ===== NAVIGATION =====
function navigateTo(view){
  // Block customer navigation if subscription expired
  if (S.subscriptionStatus && !S.subscriptionStatus.isActive && view !== 'maintenance' && view !== 'admin') {
    // Customer mode: redirect to maintenance page
    if (INIT_PAGE !== 'admin') {
      view = 'maintenance';
    }
  }
  if (view !== 'tracking' && S.revisionInterval) {
    clearInterval(S.revisionInterval);
    S.revisionInterval = null;
  }
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const el=$('view-'+view);if(el)el.classList.add('active');
  S.currentView=view;
  $('app').classList.toggle('admin-mode-active', view === 'admin');
  if($('orders-search')) $('orders-search').value = '';
  document.querySelectorAll('.nav-item').forEach(n=>{n.classList.toggle('active',n.dataset.view===view)});
  const showNav=['menu','cart','tracking','orders'].includes(view) && view !== 'maintenance';
  $('bottom-nav').style.display=showNav?'flex':'none';
  const showFab=view==='menu'&&S.cart.length>0;
  $('cart-fab').classList.toggle('hidden',!showFab);
  if(view==='menu'&&!S.menu.length)loadMenu();
  if(view==='cart')renderCart();
  if(view==='orders')loadMyOrders();
  if(view==='admin')$('bottom-nav').style.display='none';
  if(view==='maintenance')$('bottom-nav').style.display='none';
}

// ===== AUTH =====
function showAuth(mode){
  navigateTo('auth');
  if(mode==='login'){show('auth-login');hide('auth-signup')}
  else{hide('auth-login');show('auth-signup')}
}

async function handleLogin(){
  const phone=$('login-phone').value.trim(),pw=$('login-password').value;
  if(!phone||!pw)return showToast('Fill all fields','error');
  showLoader('Logging in...');
  try{
    const r=await callServer('loginUser',{phone,password:pw});
    hideLoader();
    if(r.success){S.user=r.data;saveSession(r.data);showToast(r.message,'success');postAuthRedirect()}
    else showToast(r.message,'error');
  }catch(e){hideLoader();showToast('Login failed','error')}
}

async function handleRegister(){
  const name=$('signup-name').value.trim(),phone=$('signup-phone').value.trim(),pw=$('signup-password').value;
  if(!name||!phone||!pw)return showToast('Fill all fields','error');
  showLoader('Creating account...');
  try{
    const r=await callServer('registerUser',{name,phone,password:pw});
    hideLoader();
    if(r.success){S.user=r.data;saveSession(r.data);showToast(r.message,'success');postAuthRedirect()}
    else showToast(r.message,'error');
  }catch(e){hideLoader();showToast('Registration failed','error')}
}

function updateUserUI(){
  const g=$('user-greeting');
  if(S.user)g.innerHTML='Hi, <span>'+S.user.name+'</span>!';
  else g.textContent='';
}
function postAuthRedirect(){
  updateUserUI();
  if(S.cart.length>0){navigateTo('cart')}
  else{navigateTo('menu')}
}
function handleAccountClick(){if(S.user){if(confirm('Logout?')){clearSession();updateUserUI();showToast('Logged out','info')}}else showAuth('login')}
function handleOrdersNav(){if(!S.user){showToast('Login to view order history','info');showAuth('login');return}navigateTo('orders')}

// ===== MENU =====
async function loadMenu(){
  showLoader('Loading menu...');
  try{
    const r=await callServer('getMenuData');
    hideLoader();
    if(!r.success)return showToast(r.message,'error');
    S.categories=r.data.categories;S.menu=r.data.items;
    renderCategoryTabs();
    if(S.categories.length)renderMenuItems(S.categories[0]);
  }catch(e){hideLoader();showToast('Failed to load menu','error')}
}

function renderCategoryTabs(){
  const c=$('category-tabs');c.innerHTML='';
  S.categories.forEach((cat,i)=>{
    const t=document.createElement('button');t.className='cat-tab'+(i===0?' active':'');
    t.textContent=cat;t.onclick=()=>{
      c.querySelectorAll('.cat-tab').forEach(b=>b.classList.remove('active'));
      t.classList.add('active');renderMenuItems(cat)};
    c.appendChild(t)})
}

function renderMenuItems(cat){
  const g=$('menu-grid');g.innerHTML='';
  const items=S.menu[cat]||[];const q=$('menu-search').value.toLowerCase();
  const filtered=q?items.filter(it=>it.name.toLowerCase().includes(q)):items;
  if(!filtered.length){g.innerHTML='<div class="empty-state"><div class="empty-icon">🍽️</div><p>No items found</p></div>';return}
  filtered.forEach(item=>{
    const hasPortion=item.portions&&item.portions.length>0;
    const cartKey=item.id;
    const totalQty=S.cart.filter(c=>c.id.startsWith(cartKey)).reduce((s,c)=>s+c.qty,0);
    const badge=item.type==='Non-Veg'?'<span class="nonveg-badge"></span>':'<span class="veg-badge"></span>';
    const img=item.image?'<img src="'+item.image+'" alt="'+item.name+'" loading="lazy">':'<span style="font-size:2rem">🍛</span>';
    let priceStr=hasPortion?'₹'+Math.min(...item.portionPrices)+' – ₹'+Math.max(...item.portionPrices):'₹'+item.price;
    const ctrl=totalQty>0?'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:.8rem;color:var(--primary);font-weight:700">'+totalQty+' in cart</span><button class="add-btn" onclick="addToCart(\''+item.id+'\')">'+(hasPortion?'OPTIONS':'ADD+')+'</button></div>':'<button class="add-btn" onclick="addToCart(\''+item.id+'\')">'+(hasPortion?'SELECT':'ADD')+'</button>';
    let descHtml='';
    if(item.description){
      if(item.description.length>70){
        const shortDesc=item.description.substring(0,70);
        descHtml='<p class="desc desc-toggle"><span class="desc-short">'+shortDesc+'...</span><span class="desc-full" style="display:none">'+item.description+'</span><span class="read-more-btn" onclick="toggleDesc(this)">Read More</span></p>';
      }else{
        descHtml='<p class="desc">'+item.description+'</p>';
      }
    }
    g.innerHTML+='<div class="menu-item"><div class="menu-item-img">'+img+'</div><div class="menu-item-info"><div><h3>'+badge+' '+item.name+'</h3>'+descHtml+'</div><div class="menu-item-bottom"><span class="item-price">'+priceStr+'</span>'+ctrl+'</div></div></div>'
  })
}

function filterMenu(){const active=document.querySelector('.cat-tab.active');if(active)renderMenuItems(active.textContent)}

function findMenuItem(id){for(const cat of S.categories){const it=(S.menu[cat]||[]).find(i=>i.id===id);if(it)return it}return null}

function addToCart(id){
  const item=findMenuItem(id);if(!item)return;
  if(item.portions&&item.portions.length>0){showPortionModal(item);return}
  const existing=S.cart.find(c=>c.id===id);
  if(existing)existing.qty++;
  else S.cart.push({id:item.id,name:item.name,price:item.price,qty:1,type:item.type,portion:''});
  updateCartBadge();
  const active=document.querySelector('.cat-tab.active');if(active)renderMenuItems(active.textContent);
  showToast(item.name+' added','success')
}

function showPortionModal(item){
  const sheet=$('portion-sheet');
  let html='<div class="portion-handle"></div><h3>'+item.name+'</h3><p class="portion-desc">Select a portion size</p><div class="portion-cards">';
  item.portions.forEach((p,i)=>{
    html+='<div class="portion-card" onclick="addWithPortion(\''+item.id+'\',\''+p+'\','+item.portionPrices[i]+',\''+item.type+'\')"><span class="pc-name">'+p+'</span><span class="pc-price">₹'+item.portionPrices[i]+'</span></div>';
  });
  html+='</div>';
  sheet.innerHTML=html;
  $('portion-overlay').classList.add('active');
}
function closePortionModal(){$('portion-overlay').classList.remove('active')}
$('portion-overlay').addEventListener('click',e=>{if(e.target===$('portion-overlay'))closePortionModal()});

function addWithPortion(id,portion,price,type){
  const item=findMenuItem(id);if(!item)return;
  const cartId=id+'__'+portion;
  const existing=S.cart.find(c=>c.id===cartId);
  if(existing)existing.qty++;
  else S.cart.push({id:cartId,name:item.name,price:price,qty:1,type:type,portion:portion,baseId:id});
  updateCartBadge();closePortionModal();
  const active=document.querySelector('.cat-tab.active');if(active)renderMenuItems(active.textContent);
  showToast(item.name+' ('+portion+') added','success');
}

function changeQty(cartId,delta){
  const item=S.cart.find(c=>c.id===cartId);if(!item)return;
  item.qty+=delta;
  if(item.qty<=0)S.cart=S.cart.filter(c=>c.id!==cartId);
  updateCartBadge();
  const active=document.querySelector('.cat-tab.active');if(active)renderMenuItems(active.textContent);
  if(S.currentView==='cart')renderCart()
}

function updateCartBadge(){
  const total=S.cart.reduce((s,c)=>s+c.qty,0);
  const b=$('cart-badge');b.textContent=total;
  b.classList.toggle('hidden',total===0);
  $('cart-fab').classList.toggle('hidden',total===0||S.currentView!=='menu')
}
function clearCart(){
  if(S.revisingOrderId){
    if(confirm('This will cancel your active order revision. Continue?')){
      S.revisingOrderId = null;
      S.revisingNotes = '';
    } else {
      return;
    }
  }
  S.cart=[];
  updateCartBadge();
  renderCart();
  showToast('Cart cleared','info');
}

// ===== CART =====
function renderCart(){
  const ci=$('cart-items'),cs=$('cart-summary-section'),adSec=$('cart-addons-section'),revBanner=$('cart-revision-banner-container');
  if(!S.cart.length){
    ci.innerHTML='<div class="cart-empty"><div class="empty-icon">🛒</div><h3>Cart is empty</h3><p style="color:var(--text3);margin-top:8px">Add items from the menu</p></div>';
    cs.innerHTML='';
    if(adSec)adSec.innerHTML='';
    if(revBanner)revBanner.innerHTML='';
    hide('clear-cart-btn');
    return;
  }
  show('clear-cart-btn');

  // Render revision banner if revising
  if(revBanner) {
    if (S.revisingOrderId) {
      revBanner.innerHTML = `
        <div class="revision-cart-banner glass" style="padding:12px;border:1px dashed var(--primary);background:rgba(255,107,53,0.05);border-radius:var(--radius);margin:0 16px 16px 16px;display:flex;justify-content:space-between;align-items:center;box-shadow:var(--shadow-sm);">
          <span style="font-size:0.85rem;color:var(--text1);">✏️ Revising Order: <strong>${S.revisingOrderId}</strong></span>
          <button class="btn btn-ghost btn-sm" style="color:var(--error);padding:4px 8px;font-weight:bold" onclick="cancelOrderRevision()">Cancel</button>
        </div>
      `;
    } else {
      revBanner.innerHTML = '';
    }
  }

  ci.innerHTML=S.cart.map(c=>{
    const label=c.portion?' ('+c.portion+')':'';
    return '<div class="cart-item"><div class="cart-item-info"><h4>'+(c.type==='Non-Veg'?'🔴':'🟢')+' '+c.name+label+'</h4><div class="cart-item-price">₹'+c.price+' × '+c.qty+' = ₹'+(c.price*c.qty)+'</div></div><div class="qty-control"><button class="qty-btn" onclick="changeQty(\''+c.id+'\',-1)">−</button><span class="qty-val">'+c.qty+'</span><button class="qty-btn" onclick="changeQty(\''+c.id+'\',1)">+</button></div></div>'
  }).join('');
  
  // Load add-ons
  loadCartAddOns();
  
  const subtotal=S.cart.reduce((s,c)=>s+c.price*c.qty,0);
  const itemCount=S.cart.reduce((s,c)=>s+c.qty,0);
  const gstOn=S.config&&S.config.gstEnabled;
  const gstRate=S.config?S.config.gstRate||5:5;
  const gstAmt=gstOn?Math.round(subtotal*gstRate/100*100)/100:0;
  const grandTotal=subtotal+gstAmt;
  const gstLine=gstOn?'<div class="row"><span>GST ('+gstRate+'%)</span><span>₹'+gstAmt.toFixed(2)+'</span></div>':'';
  const gstinLine=(gstOn&&S.config.gstNumber)?'<div style="font-size:.7rem;color:var(--text3);margin-top:6px;text-align:right">GSTIN: '+S.config.gstNumber+'</div>':'';
  
  if(!S.user){
    cs.innerHTML='<div class="cart-summary"><div class="row"><span>Subtotal ('+itemCount+')</span><span>₹'+subtotal+'</span></div>'+gstLine+'<div class="row total"><span>Total</span><span>₹'+grandTotal.toFixed(2)+'</span></div>'+gstinLine+'</div><div class="checkout-section glass" style="padding:20px;text-align:center;border:1px dashed var(--border);border-radius:var(--radius);margin-top:20px"><div style="font-size:1.5rem;margin-bottom:8px">🔒 Login Required</div><p style="font-size:.85rem;color:var(--text2);margin-bottom:16px">You must log in to place an order and track its status.</p><button class="btn btn-primary btn-block" onclick="showAuth(\'login\')">👤 Login / Sign Up to Order</button></div>';
    return;
  }

  const notesValue = S.revisingOrderId ? S.revisingNotes : '';
  const submitBtn = S.revisingOrderId ? 
    '<button class="btn btn-primary btn-block" style="background:linear-gradient(135deg,var(--primary),var(--secondary));" onclick="submitOrderRevision()">🔄 Update Order — ₹'+grandTotal.toFixed(2)+'</button>' : 
    '<button class="btn btn-primary btn-block" onclick="submitOrder()">🚀 Place Order — ₹'+grandTotal.toFixed(2)+'</button>';

  // Table field: auto-locked when customer came via QR scan
  const isQRTable = INIT_TABLE && INIT_TABLE !== '';
  let tableFieldHtml;
  if (isQRTable) {
    tableFieldHtml = '<div class="input-group"><label>Table Number</label>' +
      '<div class="qr-table-locked">' +
        '<div class="qr-table-badge"><span class="qr-table-icon">📍</span> Table <strong>' + S.table + '</strong></div>' +
        '<div class="qr-table-lock-hint">✅ Auto-detected via QR Code</div>' +
      '</div>' +
      '<input type="hidden" id="checkout-table" value="' + S.table + '">' +
    '</div>';
  } else {
    tableFieldHtml = '<div class="input-group"><label>Table Number (optional)</label>' +
      '<input type="number" id="checkout-table" value="' + S.table + '" placeholder="Enter table number (optional)" min="1">' +
    '</div>';
  }

  cs.innerHTML='<div class="cart-summary"><div class="row"><span>Subtotal ('+itemCount+')</span><span>₹'+subtotal+'</span></div>'+gstLine+'<div class="row total"><span>Total</span><span>₹'+grandTotal.toFixed(2)+'</span></div>'+gstinLine+'</div><div class="checkout-section">'+tableFieldHtml+'<div class="input-group"><label>Special Instructions (optional)</label><textarea id="checkout-notes" placeholder="e.g. Extra spicy, no onions...">'+notesValue+'</textarea></div>'+submitBtn+'</div>'
}

async function loadCartAddOns(){
  const adSec=$('cart-addons-section');if(!adSec||!S.cart.length){if(adSec)adSec.innerHTML='';return}
  
  // Show skeleton loading animations
  adSec.innerHTML = `
    <div class="addon-section">
      <h3>🍽️ Complete Your Meal</h3>
      <div class="addon-scroll">
        <div class="addon-card" style="pointer-events:none;opacity:0.8">
          <div class="addon-card-img skeleton" style="height:80px;width:100%"></div>
          <div class="skeleton" style="height:12px;width:80%;margin:8px auto 6px auto"></div>
          <div class="skeleton" style="height:12px;width:40%;margin:0 auto 10px auto"></div>
          <div class="skeleton" style="height:26px;width:100%;border-radius:var(--radius-xs)"></div>
        </div>
        <div class="addon-card" style="pointer-events:none;opacity:0.8">
          <div class="addon-card-img skeleton" style="height:80px;width:100%"></div>
          <div class="skeleton" style="height:12px;width:70%;margin:8px auto 6px auto"></div>
          <div class="skeleton" style="height:12px;width:50%;margin:0 auto 10px auto"></div>
          <div class="skeleton" style="height:26px;width:100%;border-radius:var(--radius-xs)"></div>
        </div>
        <div class="addon-card" style="pointer-events:none;opacity:0.8">
          <div class="addon-card-img skeleton" style="height:80px;width:100%"></div>
          <div class="skeleton" style="height:12px;width:75%;margin:8px auto 6px auto"></div>
          <div class="skeleton" style="height:12px;width:45%;margin:0 auto 10px auto"></div>
          <div class="skeleton" style="height:26px;width:100%;border-radius:var(--radius-xs)"></div>
        </div>
      </div>
    </div>
  `;

  const ids=S.cart.map(c=>c.baseId||c.id.split('__')[0]);
  try{
    const r=await callServer('getAddOnsForCart',ids);
    if(!r.success||!r.data||!r.data.length){adSec.innerHTML='';return}
    // Filter out items already in cart
    const cartIds=S.cart.map(c=>c.id.split('__')[0]);
    const addons=r.data.filter(a=>!cartIds.includes(a.id));
    if(!addons.length){adSec.innerHTML='';return}
    let html='<div class="addon-section"><h3>🍽️ Complete Your Meal</h3><div class="addon-scroll">';
    addons.forEach(a=>{
      const imgHtml = a.image ? '<img src="' + a.image + '" alt="' + a.name + '" loading="lazy">' : '<span style="font-size:1.8rem">🍛</span>';
      const badge = a.type === 'Non-Veg' ? '🔴' : '🟢';
      html+='<div class="addon-card"><div class="addon-card-img">'+imgHtml+'</div><div class="ac-name">'+badge+' '+a.name+'</div><div class="ac-price">₹'+a.price+'</div><button class="ac-add" onclick="addAddOnToCart(\''+a.id+'\',\''+a.name.replace(/'/g,"\\'")+'\','+a.price+',\''+a.type+'\')">+ ADD</button></div>';
    });
    html+='</div></div>';adSec.innerHTML=html;
  }catch(e){adSec.innerHTML=''}
}

function addAddOnToCart(id,name,price,type){
  const existing=S.cart.find(c=>c.id===id);
  if(existing)existing.qty++;
  else S.cart.push({id:id,name:name,price:price,qty:1,type:type,portion:'',isAddOn:true});
  updateCartBadge();renderCart();showToast(name+' added','success');
}

async function submitOrder(){
  if(!S.user){
    showToast('Please login to place order','error');
    showAuth('login');
    return;
  }
  const table=$('checkout-table').value;
  if(!S.cart.length)return showToast('Cart is empty','error');
  showLoader('Placing order...');
  const data={tableNumber:table,customerName:S.user.name,customerPhone:S.user.phone,items:S.cart.map(c=>({id:c.id,name:c.name + (c.portion ? ' (' + c.portion + ')' : ''),qty:c.qty,price:c.price})),specialInstructions:$('checkout-notes')?$('checkout-notes').value:''};
  try{
    const r=await callServer('placeOrder',data);hideLoader();
    if(r.success){
      S.currentOrder=r.data;
      S.cart=[];
      updateCartBadge();
      showToast('Order placed! Proceeding to payment...', 'success');
      openPaymentPage(r.data.orderId, r.data.total);
    }
    else showToast(r.message,'error');
  }catch(e){hideLoader();showToast('Order failed','error')}
}

// ===== ORDER TRACKING =====
function startTracking(orderId){
  if(S.trackInterval)clearInterval(S.trackInterval);
  pollStatus(orderId);
  S.trackInterval=setInterval(()=>pollStatus(orderId),30000)
}

async function pollStatus(orderId){
  try{
    const r=await callServer('getOrderStatus',orderId);
    if(r.success)updateTrackingUI(r.data);
  }catch(e){}
}

function updateTrackingUI(data){
  S.currentOrderDetails = data;
  if (S.etaInterval) {
    clearInterval(S.etaInterval);
    S.etaInterval = null;
  }

  $('track-order-id').textContent=data.orderId;
  $('track-table').textContent=data.table ? 'Table '+data.table : 'Takeaway';
  $('track-time').textContent=data.timestamp;
  const steps=['Received','Preparing','Ready','Completed'];
  const idx=steps.indexOf(data.status);
  const pct=idx<0?0:(idx/(steps.length-1))*100;
  $('progress-line').style.width=pct+'%';
  document.querySelectorAll('.step').forEach((s,i)=>{
    s.classList.remove('active','completed');
    if(i<idx)s.classList.add('completed');
    else if(i===idx)s.classList.add('active')
  });
  let html='<h3>Order Details</h3>';
  (data.items||[]).forEach(it=>{html+='<div class="tracking-item"><span>'+it.name+' × '+it.qty+'</span><span>₹'+(it.price*it.qty)+'</span></div>'});
  html+='<div class="tracking-total"><span>Total</span><span>₹'+data.total+'</span></div>';
  if(data.specialInstructions)html+='<div style="margin-top:8px;font-size:.8rem;color:var(--secondary)">📝 '+data.specialInstructions+'</div>';
  $('track-items-section').innerHTML=html;

  // Render dynamic ETA countdown timer
  const timerContainer = $('eta-timer-container');
  if (timerContainer) {
    if (data.status === 'Preparing' && data.estimatedReadyTime) {
      const targetTime = new Date(data.estimatedReadyTime).getTime();
      
      const updateETADisplay = () => {
        const now = Date.now();
        const diffMs = targetTime - now;
        
        if (diffMs <= 0) {
          if (S.etaInterval) {
            clearInterval(S.etaInterval);
            S.etaInterval = null;
          }
          timerContainer.innerHTML = `
            <div class="eta-timer-card glass text-center mt-4" style="padding: 20px; border: 1px solid var(--success); background: rgba(34,197,94,0.06); border-radius: var(--radius); margin-top: 16px;">
              <div style="font-size: 2rem; margin-bottom: 8px;">🎉 Ready Soon!</div>
              <p style="font-size: 0.85rem; color: var(--text2); margin: 0;">Chef is finishing up! Your order will be served hot any second now.</p>
            </div>
          `;
          return;
        }
        
        const totalSecs = Math.floor(diffMs / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        const timeStr = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
        
        // Circular progress calculation: circumference = 2 * PI * 45 ≈ 282.7
        const totalDuration = 1800; // default 30 minutes reference for visual ring scaling
        const progressPercentage = Math.min(100, (totalSecs / totalDuration) * 100);
        const strokeDashoffset = 282.7 - (282.7 * progressPercentage / 100);
        
        timerContainer.innerHTML = `
          <div class="eta-timer-card glass text-center mt-4" style="padding: 20px; border-radius: var(--radius); margin-top: 16px;">
            <div class="eta-timer-title" style="font-size: 0.9rem; font-weight: 600; color: var(--text2); margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>⏱️</span> Prep Countdown
            </div>
            <div class="eta-timer-wrapper" style="position: relative; width: 120px; height: 120px; margin: 0 auto 12px auto; display: flex; align-items: center; justify-content: center;">
              <svg class="eta-timer-svg" style="transform: rotate(-90deg); width: 100%; height: 100%;" viewBox="0 0 100 100">
                <circle class="eta-timer-bg" style="fill: none; stroke: var(--border); stroke-width: 6;" cx="50" cy="50" r="45"></circle>
                <circle class="eta-timer-progress" style="fill: none; stroke: var(--primary); stroke-width: 6; stroke-linecap: round; stroke-dasharray: 282.7; transition: stroke-dashoffset 0.5s ease;" cx="50" cy="50" r="45" stroke-dashoffset="${strokeDashoffset}"></circle>
              </svg>
              <div class="eta-timer-text" style="position: absolute; font-size: 1.5rem; font-weight: bold; color: var(--text1);">${timeStr}</div>
            </div>
            <div class="eta-timer-hint" style="font-size: 0.75rem; color: var(--text3);">Preparing fresh items just for you!</div>
          </div>
        `;
      };
      
      updateETADisplay();
      S.etaInterval = setInterval(updateETADisplay, 1000);
    } else {
      timerContainer.innerHTML = '';
    }
  }

  // Render order revision countdown
  if (S.revisionInterval) {
    clearInterval(S.revisionInterval);
    S.revisionInterval = null;
  }
  const revBannerEl = $('revision-banner-container');
  if (revBannerEl) {
    if (data.status === 'Received' && data.remainingRevisionSeconds > 0) {
      let secondsLeft = data.remainingRevisionSeconds;
      const updateTimerDisplay = () => {
        const timerEl = $('revision-timer');
        if (timerEl) timerEl.textContent = secondsLeft + 's';
        if (secondsLeft <= 0) {
          clearInterval(S.revisionInterval);
          S.revisionInterval = null;
          revBannerEl.innerHTML = '';
          pollStatus(data.orderId);
        }
      };

      const itemsStr = JSON.stringify(data.items).replace(/"/g, '&quot;');
      const notesStr = (data.specialInstructions || '').replace(/'/g, "\\'");
      const tableStr = data.table || '';

      revBannerEl.innerHTML = `
        <div class="revision-banner glass mt-4" style="padding: 16px; border: 1px solid var(--primary); background: rgba(255, 107, 53, 0.08); border-radius: var(--radius); text-align: center; margin-top: 16px; box-shadow: var(--shadow-sm);">
          <div style="font-size: 1.1rem; font-weight: bold; color: var(--primary); margin-bottom: 6px;">⏳ Order Revision Active</div>
          <p style="font-size: 0.8rem; color: var(--text2); margin-bottom: 12px;">You can revise your order items or instructions in the next <strong id="revision-timer">${secondsLeft}s</strong>.</p>
          <button class="btn btn-primary btn-block" style="background: linear-gradient(135deg, var(--primary), var(--secondary));" onclick="startOrderRevision('${data.orderId}', ${itemsStr}, '${notesStr}', '${tableStr}')">✏️ Revise Order</button>
        </div>
      `;
      S.revisionInterval = setInterval(() => {
        secondsLeft--;
        updateTimerDisplay();
      }, 1000);
    } else {
      revBannerEl.innerHTML = '';
    }
  }

  // Render payment prompt
  const paymentPromptEl = $('payment-prompt-container');
  if (paymentPromptEl) {
    if (data.status === 'Completed') {
      paymentPromptEl.innerHTML = 
        '<div class="payment-prompt-card glass mt-4" style="padding:20px; border: 1px solid var(--success); text-align: center; background: rgba(34,197,94,0.08)">' +
          '<div style="font-size: 2.2rem; margin-bottom: 8px;">🍽️😋</div>' +
          '<div style="font-size: 1.2rem; color: var(--success); font-weight: bold; margin-bottom: 6px;">Order Completed!</div>' +
          '<p style="font-size: 0.85rem; color: var(--text2); margin-bottom: 16px;">Hope you enjoyed your delicious meal! Thank you for dining with us. Visit again! ❤️</p>' +
          '<button class="btn btn-success btn-block" style="background: linear-gradient(135deg, var(--success), #2ed573); border: none; max-width: 260px; margin: 0 auto;" onclick="downloadReceipt(\'' + data.orderId + '\')">🧾 Download Receipt</button>' +
        '</div>';
    } else if (data.paymentStatus === 'Paid') {
      paymentPromptEl.innerHTML = 
        '<div class="payment-prompt-card glass mt-4" style="padding:16px; border: 1px solid var(--success); text-align: center; background: rgba(34,197,94,0.08)">' +
          '<div style="font-size: 1.2rem; color: var(--success); font-weight: bold; margin-bottom: 4px;">✅ Payment Confirmed</div>' +
          '<p style="font-size: 0.8rem; color: var(--text2);">Amount Paid: ₹' + data.total + '. Your order is being processed.</p>' +
        '</div>';
    } else if (data.paymentStatus === 'Refunded') {
      paymentPromptEl.innerHTML = 
        '<div class="payment-prompt-card glass mt-4" style="padding:16px; border: 1px solid var(--secondary); text-align: center; background: rgba(255, 107, 53, 0.08)">' +
          '<div style="font-size: 1.2rem; color: var(--primary); font-weight: bold; margin-bottom: 4px;">💰 Order Refunded</div>' +
          '<p style="font-size: 0.8rem; color: var(--text2);">This order has been refunded. Amount will be credited back via Razorpay.</p>' +
        '</div>';
    } else {
      // Payment Pending
      paymentPromptEl.innerHTML = 
        '<div class="payment-prompt-card glass mt-4" style="padding:16px; border: 1px solid var(--primary); text-align: center; animation: pulse 2s infinite;">' +
          '<div style="font-size: 1.3rem; margin-bottom: 8px;">⏳ Payment Required</div>' +
          '<p style="font-size: 0.85rem; color: var(--text2); margin-bottom: 12px;">Please complete the payment of <strong>₹' + data.total + '</strong> to start preparation.</p>' +
          '<button class="btn btn-primary btn-block" style="background: linear-gradient(135deg, var(--primary), var(--secondary));" onclick="openPaymentPage(\'' + data.orderId + '\', ' + data.total + ')">💳 Pay Now</button>' +
        '</div>';
    }
  }

  if(data.status==='Completed'){
    if(S.trackInterval){clearInterval(S.trackInterval);S.trackInterval=null}
    const actEl=$('tracking-actions-container');
    if(actEl)actEl.innerHTML='<button class="btn btn-secondary" style="flex:1" onclick="navigateTo(\'menu\')">🍽️ Order More</button><button class="btn btn-primary" style="flex:1" onclick="reorder(\''+encodeURIComponent(JSON.stringify(data.items))+'\')">🔁 Re-Order</button>';
  } else {
    const actEl=$('tracking-actions-container');
    if(actEl)actEl.innerHTML='<button class="btn btn-secondary" style="flex:1" onclick="navigateTo(\'menu\')">🍽️ Order More</button><button class="btn btn-primary" style="flex:1" onclick="refreshTracking()">🔄 Refresh</button>';
  }
}

function startOrderRevision(orderId, items, specialInstructions, table) {
  if (!confirm('Do you want to revise this order? This will load the items back into your cart so you can modify them.')) {
    return;
  }
  if (S.trackInterval) { clearInterval(S.trackInterval); S.trackInterval = null; }
  if (S.revisionInterval) { clearInterval(S.revisionInterval); S.revisionInterval = null; }

  S.cart = [];
  items.forEach(it => {
    let name = it.name;
    let portion = '';
    const match = name.match(/(.+)\s\((.+)\)$/);
    if (match) {
      name = match[1];
      portion = match[2];
    }
    const cartId = it.id;
    const baseIdPart = cartId.split('__')[0];
    const isAddOn = it.isAddOn || false;

    S.cart.push({
      id: cartId,
      name: name,
      price: it.price,
      qty: it.qty,
      type: it.type || 'Veg',
      portion: portion,
      baseId: portion ? baseIdPart : undefined,
      isAddOn: isAddOn
    });
  });

  S.revisingOrderId = orderId;
  S.revisingNotes = specialInstructions;
  S.table = table;

  updateCartBadge();
  navigateTo('cart');
  showToast('Order loaded into cart for revision!', 'success');
}

function cancelOrderRevision() {
  if (confirm('Cancel revising this order? Your current cart changes will be discarded.')) {
    const orderId = S.revisingOrderId;
    S.revisingOrderId = null;
    S.revisingNotes = '';
    S.cart = [];
    updateCartBadge();
    navigateTo('tracking');
    startTracking(orderId);
  }
}

async function submitOrderRevision() {
  if (!S.revisingOrderId) return;
  const table = $('checkout-table').value;
  if (!S.cart.length) return showToast('Cart is empty', 'error');

  showLoader('Updating order...');
  const data = {
    orderId: S.revisingOrderId,
    tableNumber: table,
    customerName: S.user.name,
    customerPhone: S.user.phone,
    items: S.cart.map(c => ({
      id: c.id,
      name: c.name + (c.portion ? ' (' + c.portion + ')' : ''),
      qty: c.qty,
      price: c.price,
      isAddOn: c.isAddOn || false
    })),
    specialInstructions: $('checkout-notes') ? $('checkout-notes').value : ''
  };

  try {
    const r = await callServer('reviseOrder', data.orderId, data);
    hideLoader();
    if (r.success) {
      const orderId = S.revisingOrderId;
      S.revisingOrderId = null;
      S.revisingNotes = '';
      S.cart = [];
      updateCartBadge();
      showToast('Order updated successfully! 🎉', 'success');
      navigateTo('tracking');
      startTracking(orderId);
    } else {
      showToast(r.message, 'error');
    }
  } catch (e) {
    hideLoader();
    showToast('Failed to update order', 'error');
  }
}

function openPaymentPage(orderId, amount) {
  if (!S.config) S.config = {};
  
  $('pay-merchant-name').textContent = S.config.restaurantName || 'MenuSarthi';
  $('pay-amount-val').textContent = parseFloat(amount).toFixed(2);
  $('pay-order-id').textContent = orderId;
  
  const statusLabel = $('pay-status-label');
  if (statusLabel) {
    statusLabel.textContent = 'Unpaid';
    statusLabel.style.color = 'var(--warning)';
  }
  
  S.payingOrderId = orderId;
  S.payingAmount = amount;
  
  if (S.trackInterval) {
    clearInterval(S.trackInterval);
    S.trackInterval = null;
  }
  
  navigateTo('payment');
}

function cancelPayment() {
  if (S.payingOrderId) {
    navigateTo('tracking');
    startTracking(S.payingOrderId);
  } else {
    navigateTo('menu');
  }
}

async function triggerRazorpayPayment() {
  if (!S.payingOrderId || !S.payingAmount) return;
  if (!S.config || !S.config.razorpayEnabled) {
    showToast('Online payment is not enabled by the restaurant. Please pay via UPI or Cash.', 'error');
    return;
  }
  showLoader('Initializing payment...');
  try {
    const r = await callServer('createRazorpayOrder', S.payingOrderId, S.payingAmount);
    hideLoader();
    if (!r.success) {
      showToast(r.message || 'Failed to initialize payment', 'error');
      return;
    }
    const rzpData = r.data;
    const options = {
      "key": rzpData.keyId || S.config.razorpayKeyId,
      "amount": Math.round(S.payingAmount * 100),
      "currency": rzpData.currency || "INR",
      "name": S.config.restaurantName || "MenuSarthi",
      "description": "Payment for Order " + S.payingOrderId,
      "order_id": rzpData.razorpayOrderId,
      "handler": async function (response) {
        showLoader('Verifying payment...');
        try {
          const verifyRes = await callServer(
            'verifyRazorpayPayment',
            S.payingOrderId,
            response.razorpay_payment_id,
            response.razorpay_order_id,
            response.razorpay_signature
          );
          hideLoader();
          if (verifyRes.success) {
            showToast('Payment successful! 🎉', 'success');
            const statusLabel = $('pay-status-label');
            if (statusLabel) {
              statusLabel.textContent = 'Paid';
              statusLabel.style.color = 'var(--success)';
            }
            navigateTo('tracking');
            startTracking(S.payingOrderId);
          } else {
            showToast(verifyRes.message || 'Verification failed', 'error');
          }
        } catch (e) {
          hideLoader();
          showToast('Error verifying payment', 'error');
        }
      },
      "prefill": {
        "name": S.user ? S.user.name : "",
        "contact": S.user ? S.user.phone : ""
      },
      "theme": {
        "color": "#ff6b35"
      },
      "modal": {
        "ondismiss": function() {
          showToast('Payment modal closed', 'info');
        }
      }
    };
    const rzp = new Razorpay(options);
    rzp.open();
  } catch (e) {
    hideLoader();
    showToast('Payment setup failed: ' + e.message, 'error');
  }
}
function refreshTracking(){if(S.currentOrder)pollStatus(S.currentOrder.orderId);showToast('Refreshed','info')}

// ===== ORDER HISTORY =====
async function loadMyOrders(){
  if(!S.user)return;
  showLoader('Loading orders...');
  try{
    const r=await callServer('getMyOrders',S.user.phone);hideLoader();
    if(!r.success)return showToast(r.message,'error');
    S.myOrders = r.data || [];
    renderMyOrders();
  }catch(e){hideLoader();showToast('Failed to load orders','error')}
}

function renderMyOrders(){
  const list=$('orders-list');
  if(!list) return;
  const orders = S.myOrders || [];
  if(!orders.length){list.innerHTML='<div class="empty-state"><div class="empty-icon">📦</div><p>No orders yet</p></div>';return}
  
  const query = $('orders-search') ? $('orders-search').value.toLowerCase().trim() : '';
  let filtered = orders;
  if(query){
    filtered = orders.filter(o => 
      o.orderId.toLowerCase().includes(query) ||
      o.status.toLowerCase().includes(query) ||
      o.timestamp.toLowerCase().includes(query) ||
      o.table.toString().toLowerCase().includes(query) ||
      (o.items || []).some(i => i.name.toLowerCase().includes(query))
    );
  }
  
  if(!filtered.length){list.innerHTML='<div class="empty-state"><div class="empty-icon">🔍</div><p>No matching orders</p></div>';return}
  
  list.innerHTML=filtered.map(o=>{
    const sc='status-'+o.status.toLowerCase();
    const items=(o.items||[]).map(i=>i.name+' × '+i.qty).join(', ');
    const trackBtn = o.status!=='Completed'?'<button class="btn btn-primary btn-sm" onclick="S.currentOrder={orderId:\''+o.orderId+'\'};navigateTo(\'tracking\');startTracking(\''+o.orderId+'\')">Track Order</button>':'';
    const reorderBtn = '<button class="btn btn-secondary btn-sm" onclick="reorder(\''+encodeURIComponent(JSON.stringify(o.items))+'\')">🔁 Re-Order</button>';
    const receiptBtn = o.status==='Completed'?'<button class="btn btn-success btn-sm" style="background:var(--success);color:#fff;border:none" onclick="downloadReceipt(\''+o.orderId+'\')">🧾 Receipt</button>':'';
    return '<div class="order-history-item"><div class="oh-header"><span class="oh-id">'+o.orderId+'</span><span class="status-badge '+sc+'">'+o.status+'</span></div><div class="oh-details"><div>🕐 '+o.timestamp+'</div><div>📍 Table '+o.table+'</div><div>🍽️ '+items+'</div><div style="font-weight:600;margin-top:4px">Total: ₹'+o.total+'</div></div><div style="display:flex;gap:8px;margin-top:8px">'+trackBtn+reorderBtn+receiptBtn+'</div></div>'
  }).join('')
}

function reorder(encodedItems){
  try{
    const items=JSON.parse(decodeURIComponent(encodedItems));
    if(!items||!items.length)return showToast('No items to reorder','error');
    
    items.forEach(it=>{
      let name=it.name;
      let portion='';
      const match=name.match(/(.+)\s\((.+)\)$/);
      if(match){
        name=match[1];
        portion=match[2];
      }
      
      const cartId = portion ? it.id + '__' + portion : it.id;
      const existing = S.cart.find(c => c.id === cartId);
      if(existing){
        existing.qty += it.qty;
      }else{
        const menuItem = findMenuItem(it.id);
        const type = menuItem ? menuItem.type : 'Veg';
        const baseId = portion ? it.id : undefined;
        S.cart.push({
          id: cartId,
          name: name,
          price: it.price,
          qty: it.qty,
          type: type,
          portion: portion,
          baseId: baseId
        });
      }
    });
    
    updateCartBadge();
    showToast('Items added to cart!','success');
    navigateTo('cart');
  }catch(e){
    showToast('Failed to reorder','error');
  }
}

async function downloadReceipt(orderId) {
  let order = null;
  
  if (S.myOrders && S.myOrders.length) {
    order = S.myOrders.find(o => o.orderId === orderId);
  }
  
  if (!order && S.currentOrderDetails && S.currentOrderDetails.orderId === orderId) {
    order = S.currentOrderDetails;
  }
  
  if (!order) {
    showLoader('Loading receipt...');
    try {
      const r = await callServer('getOrderStatus', orderId);
      hideLoader();
      if (r.success) {
        order = r.data;
      } else {
        showToast('Receipt details not found', 'error');
        return;
      }
    } catch(e) {
      hideLoader();
      showToast('Error loading receipt', 'error');
      return;
    }
  }
  
  generateReceiptWindow(order);
}

function generateReceiptWindow(order) {
  const printWindow = window.open('', '_blank', 'width=450,height=700');
  if (!printWindow) {
    showToast('Please allow pop-ups to print receipt', 'error');
    return;
  }
  
  const restaurantName = S.config.restaurantName || 'MenuSarthi';
  const tagline = S.config.restaurantTagline || 'Thank you for dining with us!';
  const logoUrl = S.config.logoUrl || '';
  const gstEnabled = S.config.gstEnabled === true || S.config.gstEnabled === 'true';
  const gstRate = parseFloat(S.config.gstRate) || 5;
  const gstNumber = S.config.gstNumber || '';
  
  printWindow.document.title = 'Receipt - ' + order.orderId;
  
  const subtotal = (order.items || []).reduce((sum, it) => sum + (parseFloat(it.price) * parseInt(it.qty)), 0);
  const gstAmount = gstEnabled ? Math.round(subtotal * gstRate / 100 * 100) / 100 : 0;
  const cgstAmount = gstAmount / 2;
  const sgstAmount = gstAmount / 2;
  
  const logoHtml = logoUrl 
    ? `<img src="${logoUrl}" alt="Logo" style="width:60px;height:60px;border-radius:14px;object-fit:cover;margin-bottom:10px">`
    : `<span style="font-size:3rem;margin-bottom:10px;display:inline-block">🍽️</span>`;
    
  const itemsHtml = (order.items || []).map(it => `
    <tr>
      <td style="padding: 8px 0; text-align: left; vertical-align: top;">
        <span style="font-weight: 600; color: #1f2937;">${it.name}</span>
      </td>
      <td style="padding: 8px 0; text-align: center; vertical-align: top; color: #4b5563;">${it.qty}</td>
      <td style="padding: 8px 0; text-align: right; vertical-align: top; color: #4b5563;">₹${parseFloat(it.price).toFixed(2)}</td>
      <td style="padding: 8px 0; text-align: right; vertical-align: top; font-weight: 600; color: #1f2937;">₹${(parseFloat(it.price) * parseInt(it.qty)).toFixed(2)}</td>
    </tr>
  `).join('');

  let gstRowsHtml = '';
  if (gstEnabled) {
    gstRowsHtml = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.85rem; color: #4b5563;">
        <span>CGST (${(gstRate/2).toFixed(1)}%)</span>
        <span>₹${cgstAmount.toFixed(2)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.85rem; color: #4b5563;">
        <span>SGST (${(gstRate/2).toFixed(1)}%)</span>
        <span>₹${sgstAmount.toFixed(2)}</span>
      </div>
    `;
  }
  
  const isPaid = order.paymentStatus === 'Paid';
  const payStatusBadge = isPaid
    ? `<span style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1.5px solid #10b981; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">PAID</span>`
    : `<span style="background: rgba(245, 158, 11, 0.1); color: #f59e0b; border: 1.5px solid #f59e0b; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">PENDING</span>`;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Receipt - ${order.orderId}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&display=swap');
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', sans-serif;
          background: #f3f4f6;
          color: #1f2937;
          padding: 20px 10px;
          display: flex;
          flex-direction: column;
          align-items: center;
          min-height: 100vh;
        }
        
        .no-print-header {
          width: 100%;
          max-width: 400px;
          margin-bottom: 16px;
          display: flex;
          justify-content: center;
        }
        
        .btn-print {
          background: #ff5e14;
          color: white;
          border: none;
          padding: 12px 24px;
          font-family: 'Outfit', sans-serif;
          font-size: 0.95rem;
          font-weight: 700;
          border-radius: 10px;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(255, 94, 20, 0.3);
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .btn-print:hover {
          background: #e04f0f;
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgba(255, 94, 20, 0.4);
        }
        
        .receipt-card {
          background: white;
          width: 100%;
          max-width: 400px;
          border-radius: 20px;
          padding: 28px 24px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
          border: 1px solid #e5e7eb;
          position: relative;
        }
        
        .receipt-header {
          text-align: center;
          margin-bottom: 24px;
        }
        
        .restaurant-name {
          font-family: 'Outfit', sans-serif;
          font-size: 1.5rem;
          font-weight: 800;
          color: #111827;
          margin-bottom: 4px;
        }
        
        .restaurant-tagline {
          font-size: 0.85rem;
          color: #6b7280;
          margin-bottom: 14px;
        }
        
        .invoice-title {
          display: inline-block;
          font-family: 'Outfit', sans-serif;
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 1px;
          background: #f3f4f6;
          color: #374151;
          padding: 4px 12px;
          border-radius: 6px;
          text-transform: uppercase;
        }
        
        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 20px;
          font-size: 0.82rem;
          border-top: 1px dashed #e5e7eb;
          border-bottom: 1px dashed #e5e7eb;
          padding: 16px 0;
        }
        
        .meta-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        
        .meta-item .label {
          color: #9ca3af;
          font-weight: 500;
        }
        
        .meta-item .value {
          color: #374151;
          font-weight: 600;
        }
        
        .receipt-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
          font-size: 0.85rem;
        }
        
        .receipt-table th {
          font-family: 'Outfit', sans-serif;
          font-weight: 700;
          color: #4b5563;
          padding-bottom: 10px;
          border-bottom: 1px solid #f3f4f6;
        }
        
        .summary-section {
          border-top: 1px dashed #e5e7eb;
          padding-top: 16px;
          margin-bottom: 20px;
        }
        
        .grand-total-row {
          display: flex;
          justify-content: space-between;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1.5px solid #111827;
          font-family: 'Outfit', sans-serif;
          font-size: 1.15rem;
          font-weight: 800;
          color: #111827;
        }
        
        .receipt-footer {
          text-align: center;
          margin-top: 24px;
          border-top: 1px dashed #e5e7eb;
          padding-top: 20px;
        }
        
        .status-wrapper {
          margin-bottom: 16px;
        }
        
        .thankyou-msg {
          font-size: 0.85rem;
          color: #6b7280;
          margin-bottom: 12px;
          font-style: italic;
        }
        
        .powered-by {
          font-size: 0.7rem;
          color: #9ca3af;
          font-weight: 500;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        
        @media print {
          body {
            background: white;
            padding: 0;
          }
          .no-print {
            display: none !important;
          }
          .receipt-card {
            box-shadow: none;
            border: none;
            padding: 0;
            max-width: 100%;
          }
        }
      </style>
    </head>
    <body>
      <div class="no-print no-print-header">
        <button class="btn-print" onclick="window.print()">
          🖨️ Print / Save as PDF
        </button>
      </div>
      
      <div class="receipt-card">
        <div class="receipt-header">
          ${logoHtml}
          <div class="restaurant-name">${restaurantName}</div>
          <div class="restaurant-tagline">${tagline}</div>
          <div class="invoice-title">${gstEnabled ? 'Tax Invoice' : 'Bill'}</div>
        </div>
        
        <div class="meta-grid">
          <div class="meta-item">
            <span class="label">Invoice No</span>
            <span class="value">${order.orderId}</span>
          </div>
          <div class="meta-item">
            <span class="label">Date & Time</span>
            <span class="value">${order.timestamp}</span>
          </div>
          <div class="meta-item">
            <span class="label">Table</span>
            <span class="value">${order.table ? 'Table ' + order.table : 'Takeaway'}</span>
          </div>
          <div class="meta-item">
            <span class="label">Customer</span>
            <span class="value">${order.customerName || 'Guest'}${order.customerPhone ? `<br><span style="font-size:0.75rem;color:#6b7280;font-weight:normal">📞 ${order.customerPhone}</span>` : ''}</span>
          </div>
        </div>
        
        <table class="receipt-table">
          <thead>
            <tr>
              <th style="text-align: left;">Item</th>
              <th style="text-align: center; width: 40px;">Qty</th>
              <th style="text-align: right; width: 80px;">Price</th>
              <th style="text-align: right; width: 90px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
        
        <div class="summary-section">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.85rem; color: #4b5563;">
            <span>Subtotal</span>
            <span>₹${subtotal.toFixed(2)}</span>
          </div>
          ${gstRowsHtml}
          <div class="grand-total-row">
            <span>Grand Total</span>
            <span>₹${parseFloat(order.total).toFixed(2)}</span>
          </div>
        </div>
        
        <div class="receipt-footer">
          <div class="status-wrapper">
            ${payStatusBadge}
          </div>
          ${gstNumber ? `<div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 8px;">GSTIN: ${gstNumber}</div>` : ''}
          <div class="thankyou-msg">Thank you for dining with us! Visit again.</div>
          <div class="powered-by">Powered by MenuSarthi</div>
        </div>
      </div>
      
      <script>
        window.addEventListener('load', function() {
          setTimeout(function() {
            window.print();
          }, 600);
        });
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

async function handleAdminLogin(){
  const pw=$('admin-password').value;if(!pw)return showToast('Enter password','error');
  showLoader('Verifying...');
  try{
    const r=await callServer('adminLogin',pw);hideLoader();
    if(r.success){
      S.isAdmin=true;
      saveAdminSession();
      hide('admin-login-screen');
      show('admin-dashboard');
      // Check subscription status for admin
      renderSubscriptionBanner();
      if(S.subscriptionStatus && !S.subscriptionStatus.isActive){
        // Block admin dashboard — only show expired banner
        const dashEl=$('admin-dashboard');
        if(dashEl) dashEl.classList.add('admin-expired-overlay');
      } else {
        loadAdminData();
        startAdminRefresh();
      }
    }
    else showToast(r.message,'error');
  }catch(e){hideLoader();showToast('Login failed','error')}
}
function handleAdminLogout(){
  clearAdminSession();
  if(S.adminInterval)clearInterval(S.adminInterval);
  show('admin-login-screen');
  hide('admin-dashboard');
  navigateTo('landing');
}

function switchAdminTab(btn,tabId){
  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');
  ['admin-orders-tab','admin-menu-tab','admin-addons-tab','admin-reports-tab','admin-qr-tab','admin-settings-tab'].forEach(id=>{$(id).classList.toggle('hidden',id!==tabId)});
  
  if($('admin-orders-search')) $('admin-orders-search').value = '';
  if($('admin-menu-search')) $('admin-menu-search').value = '';
  if($('admin-addons-search')) $('admin-addons-search').value = '';

  if(tabId==='admin-menu-tab')loadAdminMenu();
  if(tabId==='admin-addons-tab')loadAdminAddOns();
  if(tabId==='admin-reports-tab')initReportsTab();
  if(tabId==='admin-qr-tab')initQRTab();
  if(tabId==='admin-settings-tab')loadAdminSettings()
}

function initReportsTab() {
  const today = new Date();
  const formatLocal = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const startEl = $('rep-start-date');
  const endEl = $('rep-end-date');
  if (startEl && !startEl.value) startEl.value = formatLocal(today);
  if (endEl && !endEl.value) endEl.value = formatLocal(today);
  loadFinancialReport();
}

async function loadFinancialReport() {
  const start = $('rep-start-date').value;
  const end = $('rep-end-date').value;
  if (!start || !end) return showToast('Please select both start and end dates', 'error');

  showLoader('Generating report...');
  try {
    const r = await callServer('getFinancialReport', start, end);
    hideLoader();
    if (!r.success) return showToast(r.message, 'error');

    S.reportData = r.data;

    // Render summaries
    $('rep-stat-count').textContent = r.data.summary.totalOrders;
    $('rep-stat-subtotal').textContent = '₹' + r.data.summary.totalSubtotal.toFixed(2);
    $('rep-stat-gst').textContent = '₹' + r.data.summary.totalGst.toFixed(2);
    $('rep-stat-total').textContent = '₹' + r.data.summary.totalAmount.toFixed(2);

    // Render detailed table
    const tbody = $('reports-table-body');
    if (!r.data.orders.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text3)">No orders found in this period</td></tr>';
      return;
    }

    tbody.innerHTML = r.data.orders.map(o => {
      const payClass = o.paymentStatus === 'Paid' ? 'status-ready' : 'status-received';
      return `
        <tr style="border-bottom: 1px solid var(--border); color: var(--text);">
          <td style="padding: 8px 4px; font-weight:600; color:var(--primary); font-size:0.75rem">${o.orderId}</td>
          <td style="padding: 8px 4px; color:var(--text2); font-size:0.75rem">${o.timestamp}</td>
          <td style="padding: 8px 4px; color:var(--text2); font-size:0.75rem">${o.customerName}${o.customerPhone ? `<br><a href="tel:${o.customerPhone}" style="color:inherit;text-decoration:none;font-weight:600">📞 ${o.customerPhone}</a>` : ''}</td>
          <td style="padding: 8px 4px; color:var(--text2)">${o.tableNumber}</td>
          <td style="padding: 8px 4px; text-align:right">₹${o.subtotal.toFixed(2)}</td>
          <td style="padding: 8px 4px; text-align:right">₹${o.gstAmount.toFixed(2)}</td>
          <td style="padding: 8px 4px; text-align:right; font-weight:600">₹${o.total.toFixed(2)}</td>
          <td style="padding: 8px 4px; text-align:center">
            <span class="status-badge ${payClass}" style="padding: 2px 6px; font-size: 0.6rem;">${o.paymentStatus}</span>
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    hideLoader();
    showToast('Failed to load report data', 'error');
  }
}

function exportFinancialReportCSV() {
  if (!S.reportData || !S.reportData.orders || !S.reportData.orders.length) {
    return showToast('No report data available to export. Fetch a report first.', 'error');
  }

  const start = $('rep-start-date').value;
  const end = $('rep-end-date').value;

  const cleanCSVCell = (val) => {
    let str = (val || '').toString().replace(/"/g, '""');
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
      return '"' + str + '"';
    }
    return str;
  };

  const csvRows = [
    ['Order ID', 'Date & Time', 'Customer Name', 'Customer Phone', 'Table', 'Items Summary', 'Taxable Amount (Subtotal)', 'GST Amount', 'Total Amount', 'Status', 'Payment Status']
  ];

  S.reportData.orders.forEach(o => {
    csvRows.push([
      cleanCSVCell(o.orderId),
      cleanCSVCell(o.timestamp),
      cleanCSVCell(o.customerName),
      cleanCSVCell(o.customerPhone),
      cleanCSVCell(o.tableNumber),
      cleanCSVCell(o.itemsSummary),
      o.subtotal.toFixed(2),
      o.gstAmount.toFixed(2),
      o.total.toFixed(2),
      cleanCSVCell(o.status),
      cleanCSVCell(o.paymentStatus)
    ]);
  });

  csvRows.push([]);
  csvRows.push(['TOTALS', '', '', '', '', '', S.reportData.summary.totalSubtotal.toFixed(2), S.reportData.summary.totalGst.toFixed(2), S.reportData.summary.totalAmount.toFixed(2), '', '']);

  const csvContent = csvRows.map(e => e.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `MenuSarthi_Financial_Report_${start}_to_${end}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Report CSV downloaded!', 'success');
}

function isAdminSearching() {
  const oSearch = $('admin-orders-search');
  const mSearch = $('admin-menu-search');
  const aSearch = $('admin-addons-search');
  if (oSearch && (oSearch.value.trim() !== '' || document.activeElement === oSearch)) return true;
  if (mSearch && (mSearch.value.trim() !== '' || document.activeElement === mSearch)) return true;
  if (aSearch && (aSearch.value.trim() !== '' || document.activeElement === aSearch)) return true;
  return false;
}

async function loadAdminData(){
  if (isAdminSearching()) return;
  try{
    const[orders,stats]=await Promise.all([callServer('getLiveOrders'),callServer('getOrderStats')]);
    if(orders.success){
      S.adminOrders = orders.data;
      renderAdminOrders(orders.data);
    }
    if(stats.success){const d=stats.data;$('stat-total').textContent=d.totalOrders;$('stat-revenue').textContent='₹'+d.totalRevenue;$('stat-active').textContent=d.activeOrders;$('stat-avg').textContent='₹'+d.avgOrderValue;
      if(orders.success&&orders.data.length>S.adminOrderCount&&S.adminOrderCount>0)try{new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH+Jj4WBfXx9gYeOkI2Jh4aIjJGUko+Nh4WGiY6UmJaSjomGhYaKkZibmpiTjYeFhYmPl5yenJiSjIiFhYqSmZ6gnpqUjoqHh4uUm6Chn5yXkY2Kio2Wnp+fnZqWkY6MjZGZnp6dnJmVkY+OkZabnZ2cm5mWlJKSlZqdnJycm5qYlpWUl5udnJycm5qZl5aWmZydnJycm5qZmJeYm52cnJybm5qZmJibnZ2dnJybm5qamZqcnZ2cnJybm5ubm5ydnZ2cnJybm5ubm5ydnZ2cnJybm5ubnJ2dnZ2cnJyb').play()}catch(e){}
      S.adminOrderCount=orders.success?orders.data.length:0}
  }catch(e){showToast('Failed to load data','error')}
}

function filterAdminOrders() {
  renderAdminOrders(S.adminOrders || []);
}

function renderAdminOrders(orders){
  const el=$('admin-orders-list');
  if(!orders || !orders.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">🎉</div><p>No active orders</p></div>';return}
  
  const query = $('admin-orders-search') ? $('admin-orders-search').value.toLowerCase().trim() : '';
  let filtered = orders;
  if(query){
    filtered = orders.filter(o => 
      o.orderId.toLowerCase().includes(query) ||
      (o.customerName || '').toLowerCase().includes(query) ||
      (o.customerPhone || '').toLowerCase().includes(query) ||
      (o.status || '').toLowerCase().includes(query) ||
      (o.paymentStatus || '').toLowerCase().includes(query) ||
      (o.table || 'takeaway').toString().toLowerCase().includes(query) ||
      (o.items || []).some(i => i.name.toLowerCase().includes(query))
    );
  }

  if(!filtered.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">🔍</div><p>No matching orders</p></div>';return}
  el.innerHTML=filtered.map(o=>{
    const items=(o.items||[]).map(i=>i.name+' × '+i.qty).join(', ');
    let btns='';
    if(o.status==='Received')btns='<button class="btn btn-warning btn-sm" onclick="promptPreparingETA(\''+o.orderId+'\')">👨‍🍳 Start Preparing</button>';
    if(o.status==='Preparing')btns='<button class="btn btn-success btn-sm" onclick="updateStatus(\''+o.orderId+'\',\'Ready\')">✅ Mark Ready</button>';
    if(o.status==='Ready')btns='<button class="btn btn-secondary btn-sm" onclick="updateStatus(\''+o.orderId+'\',\'Completed\')">✔️ Complete</button>';
    
    // Red delete button next to status button
    btns+=' <button class="btn btn-error btn-sm" style="background:var(--error);color:#fff" onclick="deleteAdminOrder(\''+o.orderId+'\')">🗑️ Delete</button>';
    
    const sc='status-'+o.status;
    
    let payBadge = '';
    if (o.paymentStatus === 'Paid') {
      payBadge = '<span class="status-badge status-ready" style="margin-left:8px;font-weight:700">💳 PAID</span>' +
                 ' <button class="btn btn-secondary btn-sm" style="background: rgba(255, 107, 53, 0.1); color: var(--primary); border: 1px solid rgba(255, 107, 53, 0.2); margin-left: 8px; padding: 2px 6px;" onclick="refundOrder(\''+o.orderId+'\')">💰 Refund</button>';
    } else if (o.paymentStatus === 'Refunded') {
      payBadge = '<span class="status-badge status-completed" style="margin-left:8px;font-weight:700; background: var(--border); color: var(--text3);">💰 REFUNDED</span>';
    } else {
      payBadge = '<span class="status-badge status-received" style="margin-left:8px;font-weight:700">⏳ UNPAID</span>';
    }
    
    return '<div class="admin-order '+sc+'"><div class="ao-top"><span class="ao-id">'+o.orderId+'</span><span class="ao-time">'+o.elapsed+'</span></div><div class="ao-meta"><span>📍 Table '+(o.table || 'Takeaway')+'</span><span>👤 '+o.customerName+(o.customerPhone ? ' | 📞 <a href="tel:'+o.customerPhone+'" style="color:inherit;text-decoration:none">'+o.customerPhone+'</a>' : '')+'</span><span class="status-badge '+sc.toLowerCase()+'">'+o.status+'</span>'+payBadge+'</div><div class="ao-items">'+items+'</div>'+(o.specialInstructions?'<div class="ao-instructions">📝 '+o.specialInstructions+'</div>':'')+'<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;color:var(--primary)">₹'+o.total+'</span><div class="ao-actions">'+btns+'</div></div></div>'
  }).join('')
}

function promptPreparingETA(orderId) {
  const html = `
    <div class="modal-header">
      <h3>⏰ Set Preparation Time</h3>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding: 16px 0; text-align: center;">
      <p style="font-size: 0.9rem; color: var(--text2); margin-bottom: 20px;">Select preparation time for Order <strong>${orderId}</strong>:</p>
      
      <div class="eta-presets" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px;">
        <button class="btn btn-secondary" onclick="confirmPreparingETA('${orderId}', 10)">10m</button>
        <button class="btn btn-secondary" onclick="confirmPreparingETA('${orderId}', 15)">15m</button>
        <button class="btn btn-secondary" onclick="confirmPreparingETA('${orderId}', 20)">20m</button>
        <button class="btn btn-secondary" onclick="confirmPreparingETA('${orderId}', 30)">30m</button>
      </div>
      
      <div class="input-group" style="text-align: left;">
        <label>Or enter custom duration (minutes)</label>
        <input type="number" id="custom-eta-input" placeholder="Minutes" min="1" max="180">
      </div>
      
      <button class="btn btn-primary btn-block" style="margin-top: 15px;" onclick="confirmPreparingETA('${orderId}', null)">
        🚀 Start Preparing
      </button>
    </div>
  `;
  $('modal-content').innerHTML = html;
  $('modal-overlay').classList.add('active');
}

async function confirmPreparingETA(orderId, presetMinutes) {
  let minutes = presetMinutes;
  if (minutes === null) {
    const customInput = $('custom-eta-input');
    minutes = parseInt(customInput.value, 10);
    if (!minutes || isNaN(minutes) || minutes <= 0) {
      showToast('Please enter a valid number of minutes', 'error');
      return;
    }
  }
  closeModal();
  showLoader('Starting preparation...');
  try {
    const r = await callServer('updateOrderStatus', orderId, 'Preparing', minutes);
    hideLoader();
    if (r.success) {
      showToast(r.message, 'success');
      loadAdminData();
    } else {
      showToast(r.message, 'error');
    }
  } catch (e) {
    hideLoader();
    showToast('Failed to update status', 'error');
  }
}

async function refundOrder(orderId) {
  if (!confirm('Are you sure you want to refund the payment for order ' + orderId + '? This will process a refund via Razorpay API.')) {
    return;
  }
  showLoader('Processing refund...');
  try {
    const r = await callServer('refundRazorpayPayment', orderId);
    hideLoader();
    if (r.success) {
      showToast('Refund initiated successfully! 🎉', 'success');
      loadAdminData();
    } else {
      showToast(r.message || 'Refund failed', 'error');
    }
  } catch (e) {
    hideLoader();
    showToast('Failed to process refund', 'error');
  }
}

async function updateStatus(id,status,etaMinutes){
  try{const r=await callServer('updateOrderStatus',id,status,etaMinutes);if(r.success){showToast(r.message,'success');loadAdminData()}else showToast(r.message,'error')}catch(e){showToast('Update failed','error')}
}

async function deleteAdminOrder(id){
  if(!confirm('Are you sure you want to permanently delete order '+id+'? This action cannot be undone.'))return;
  showLoader('Deleting order...');
  try{
    const r=await callServer('deleteOrder',id);
    hideLoader();
    if(r.success){
      showToast(r.message,'success');
      loadAdminData();
    }else{
      showToast(r.message,'error');
    }
  }catch(e){
    hideLoader();
    showToast('Failed to delete order','error');
  }
}

function startAdminRefresh(){if(S.adminInterval)clearInterval(S.adminInterval);S.adminInterval=setInterval(loadAdminData,15000)}

async function loadAdminMenu(){
  try{
    const r=await callServer('getAllMenuItems');
    if(!r.success)return;
    S.adminMenu = r.data;
    renderAdminMenu();
  }catch(e){showToast('Failed to load menu','error')}
}

function renderAdminMenu(){
  const listEl = $('admin-menu-list');
  if(!listEl) return;
  const query = $('admin-menu-search') ? $('admin-menu-search').value.toLowerCase().trim() : '';
  const items = S.adminMenu || [];
  
  let filtered = items;
  if(query){
    filtered = items.filter(it => 
      it.name.toLowerCase().includes(query) || 
      it.category.toLowerCase().includes(query) || 
      it.id.toLowerCase().includes(query)
    );
  }
  
  if(!filtered.length){
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>No matching items</p></div>';
    return;
  }
  
  listEl.innerHTML=filtered.map(it=>'<div class="admin-menu-item"><div class="ami-info"><h4>'+(it.type==='Non-Veg'?'🔴':'🟢')+' '+it.name+'</h4><div class="ami-meta">'+it.category+' • ₹'+it.price+' • '+it.id+'</div></div><label class="toggle-switch"><input type="checkbox" '+(it.available?'checked':'')+' onchange="toggleAvail(\''+it.id+'\')"><span class="slider"></span></label><button class="btn btn-ghost btn-sm" onclick="showEditItemModal(\''+it.id+'\',\''+encodeURIComponent(JSON.stringify(it))+'\')">✏️</button><button class="btn btn-ghost btn-sm" style="color:var(--error)" onclick="deleteItem(\''+it.id+'\',\''+it.name+'\')">🗑️</button></div>').join('');
}

async function toggleAvail(id){try{await callServer('toggleItemAvailability',id);showToast('Updated','success')}catch(e){showToast('Failed','error')}}
async function deleteItem(id,name){if(!confirm('Delete '+decodeURIComponent(name)+'?'))return;try{const r=await callServer('deleteMenuItem',id);if(r.success){showToast('Deleted','success');loadAdminMenu()}else showToast(r.message,'error')}catch(e){showToast('Failed','error')}}

function showAddItemModal(){
  const html='<div class="modal-header"><h3>Add Menu Item</h3><button class="modal-close" onclick="closeModal()">✕</button></div><div class="input-group"><label>Category</label><select id="mi-cat"><option>Starters</option><option>Main Course</option><option>Breads</option><option>Beverages</option><option>Desserts</option></select></div><div class="input-group"><label>Name</label><input id="mi-name" placeholder="Item name"></div><div class="input-group"><label>Description</label><input id="mi-desc" placeholder="Short description"></div><div class="input-group"><label>Price (₹) (Single Portion)</label><input id="mi-price" type="number" placeholder="0"></div><div class="input-group"><label>Portions (comma-separated, optional)</label><input id="mi-portions" placeholder="e.g. Half,Full"></div><div class="input-group"><label>Portion Prices (comma-separated, optional)</label><input id="mi-portion-prices" placeholder="e.g. 149,249"></div><div class="input-group"><label>Image URL</label><input id="mi-img" placeholder="https://..."></div><div class="input-group"><label>Type</label><select id="mi-type"><option>Veg</option><option>Non-Veg</option></select></div><button class="btn btn-primary btn-block" onclick="saveNewItem()">Add Item</button>';
  $('modal-content').innerHTML=html;$('modal-overlay').classList.add('active')
}

function showEditItemModal(id,encoded){
  const it=JSON.parse(decodeURIComponent(encoded));
  const html='<div class="modal-header"><h3>Edit Item</h3><button class="modal-close" onclick="closeModal()">✕</button></div><div class="input-group"><label>Category</label><input id="mi-cat" value="'+it.category+'"></div><div class="input-group"><label>Name</label><input id="mi-name" value="'+it.name+'"></div><div class="input-group"><label>Description</label><input id="mi-desc" value="'+(it.description||'')+'"></div><div class="input-group"><label>Price (Single Portion)</label><input id="mi-price" type="number" value="'+it.price+'"></div><div class="input-group"><label>Portions (comma-separated)</label><input id="mi-portions" value="'+(it.portions||'')+'" placeholder="e.g. Half,Full"></div><div class="input-group"><label>Portion Prices (comma-separated)</label><input id="mi-portion-prices" value="'+(it.portionPrices||'')+'" placeholder="e.g. 149,249"></div><div class="input-group"><label>Image URL</label><input id="mi-img" value="'+(it.image||'')+'"></div><div class="input-group"><label>Type</label><select id="mi-type"><option'+(it.type==='Veg'?' selected':'')+'>Veg</option><option'+(it.type==='Non-Veg'?' selected':'')+'>Non-Veg</option></select></div><button class="btn btn-primary btn-block" onclick="saveEditItem(\''+id+'\')">Save Changes</button>';
  $('modal-content').innerHTML=html;$('modal-overlay').classList.add('active')
}

async function saveNewItem(){
  const data={category:$('mi-cat').value,name:$('mi-name').value,description:$('mi-desc').value,price:$('mi-price').value,image:$('mi-img').value,type:$('mi-type').value,portions:$('mi-portions').value,portionPrices:$('mi-portion-prices').value};
  if(!data.name||!data.price)return showToast('Name and price required','error');
  showLoader('Adding...');try{const r=await callServer('addMenuItem',data);hideLoader();if(r.success){showToast('Added!','success');closeModal();loadAdminMenu()}else showToast(r.message,'error')}catch(e){hideLoader();showToast('Failed','error')}
}

async function saveEditItem(id){
  const data={id,category:$('mi-cat').value,name:$('mi-name').value,description:$('mi-desc').value,price:$('mi-price').value,image:$('mi-img').value,type:$('mi-type').value,available:true,portions:$('mi-portions').value,portionPrices:$('mi-portion-prices').value};
  showLoader('Saving...');try{const r=await callServer('updateMenuItem',data);hideLoader();if(r.success){showToast('Saved!','success');closeModal();loadAdminMenu()}else showToast(r.message,'error')}catch(e){hideLoader();showToast('Failed','error')}
}

function closeModal(){$('modal-overlay').classList.remove('active')}
$('modal-overlay').addEventListener('click',e=>{if(e.target===$('modal-overlay'))closeModal()});

async function loadAdminSettings(){
  try{
    const r=await callServer('getInitData');
    if(r.success){
      const d=r.data;
      $('cfg-name').value=d.restaurantName||'';
      $('cfg-tagline').value=d.restaurantTagline||'';
      $('cfg-logo').value=d.logoUrl||'';
      $('cfg-tables').value=d.totalTables||20;
      $('cfg-upi-id').value=d.ownerUpiId||'';
      $('cfg-upi-name').value=d.ownerUpiName||'';
      $('cfg-gst-enabled').checked=d.gstEnabled===true;
      $('cfg-gst-rate').value=d.gstRate||5;
      $('cfg-gst-number').value=d.gstNumber||'';
      $('cfg-razorpay-enabled').checked=d.razorpayEnabled===true;
      $('cfg-razorpay-key-id').value=d.razorpayKeyId||'';
      $('cfg-razorpay-key-secret').value='';
      
      loadSubscriptionInSettings();
    }
  }catch(e){}
}

async function saveAdminSettings(){
  const data={
    restaurantName:$('cfg-name').value,
    restaurantTagline:$('cfg-tagline').value,
    logoUrl:$('cfg-logo').value,
    totalTables:$('cfg-tables').value,
    newPassword:$('cfg-password').value,
    ownerUpiId:$('cfg-upi-id').value,
    ownerUpiName:$('cfg-upi-name').value,
    gstEnabled:$('cfg-gst-enabled').checked,
    gstRate:parseFloat($('cfg-gst-rate').value)||5,
    gstNumber:$('cfg-gst-number').value,
    razorpayEnabled:$('cfg-razorpay-enabled').checked,
    razorpayKeyId:$('cfg-razorpay-key-id').value
  };
  const secret=$('cfg-razorpay-key-secret').value;
  if(secret){
    data.razorpayKeySecret=secret;
  }
  showLoader('Saving...');
  try{
    const r=await callServer('updateAdminConfig',data);
    hideLoader();
    if(r.success){
      showToast('Settings saved!','success');
      S.config.restaurantName=data.restaurantName;
      S.config.restaurantTagline=data.restaurantTagline;
      S.config.logoUrl=data.logoUrl;
      S.config.totalTables=data.totalTables;
      S.config.ownerUpiId=data.ownerUpiId;
      S.config.ownerUpiName=data.ownerUpiName;
      S.config.gstEnabled=data.gstEnabled;
      S.config.gstRate=data.gstRate;
      S.config.gstNumber=data.gstNumber;
      S.config.razorpayEnabled=data.razorpayEnabled;
      S.config.razorpayKeyId=data.razorpayKeyId;
      document.title=data.restaurantName+' — Digital Menu';
      $('landing-name').textContent=data.restaurantName;
      $('landing-tagline').textContent=data.restaurantTagline;
      const logoEl=$('landing-logo');
      if(data.logoUrl){logoEl.innerHTML='<img src="'+data.logoUrl+'" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:28px">'}
      else{logoEl.innerHTML='🍽️'}
      $('cfg-razorpay-key-secret').value='';
    }
    else showToast(r.message,'error');
  }catch(e){hideLoader();showToast('Failed','error')}
}

// ===== ADMIN ADD-ONS =====
async function loadAdminAddOns(){
  try{
    const r=await callServer('getAllAddOns');
    if(!r.success)return;
    S.adminAddons = r.data;
    renderAdminAddOns();
  }catch(e){showToast('Failed to load add-ons','error')}
}

function renderAdminAddOns(){
  const listEl = $('admin-addons-list');
  if(!listEl) return;
  const query = $('admin-addons-search') ? $('admin-addons-search').value.toLowerCase().trim() : '';
  const items = S.adminAddons || [];
  
  let filtered = items;
  if(query){
    filtered = items.filter(it => 
      it.name.toLowerCase().includes(query) || 
      (it.linkedItems || '').toLowerCase().includes(query) ||
      it.id.toLowerCase().includes(query)
    );
  }
  
  if(!filtered.length){
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>No matching add-ons</p></div>';
    return;
  }
  
  listEl.innerHTML=filtered.map(it=>'<div class="admin-menu-item"><div class="ami-info"><h4>'+(it.type==='Non-Veg'?'🔴':'🟢')+' '+it.name+'</h4><div class="ami-meta">₹'+it.price+' • Links: '+(it.linkedItems || 'None')+' • '+it.id+'</div></div><label class="toggle-switch"><input type="checkbox" '+(it.available?'checked':'')+' onchange="toggleAddOnAvail(\''+it.id+'\')"><span class="slider"></span></label><button class="btn btn-ghost btn-sm" onclick="showEditAddOnModal(\''+it.id+'\',\''+encodeURIComponent(JSON.stringify(it))+'\')">✏️</button><button class="btn btn-ghost btn-sm" style="color:var(--error)" onclick="deleteAddOn(\''+it.id+'\',\''+it.name+'\')">🗑️</button></div>').join('');
}
async function toggleAddOnAvail(id){try{await callServer('toggleAddOnAvailability',id);showToast('Updated','success')}catch(e){showToast('Failed','error')}}
async function deleteAddOn(id,name){if(!confirm('Delete Add-On '+decodeURIComponent(name)+'?'))return;try{const r=await callServer('deleteAddOn',id);if(r.success){showToast('Deleted','success');loadAdminAddOns()}else showToast(r.message,'error')}catch(e){showToast('Failed','error')}}

async function showAddAddOnModal(){
  showLoader('Loading items...');
  try {
    if(!S.categories || !S.categories.length){
      const r=await callServer('getMenuData');
      if(r.success){S.categories=r.data.categories;S.menu=r.data.items;}
    }
  } catch(e){}
  hideLoader();

  const html='<div class="modal-header"><h3>Add Add-On Item</h3><button class="modal-close" onclick="closeModal()">✕</button></div>' +
    '<div class="input-group"><label>Name</label><input id="ao-name" placeholder="Add-on name"></div>' +
    '<div class="input-group"><label>Price (₹)</label><input id="ao-price" type="number" placeholder="0"></div>' +
    '<div class="input-group" style="position:relative"><label>Linked Dishes</label>' +
      '<input type="text" id="ao-linked-search" placeholder="Search dish by name..." oninput="searchDishesToLink(this.value)">' +
      '<div id="ao-linked-suggestions" class="suggestions-dropdown hidden"></div>' +
      '<div id="ao-linked-pills" class="selected-pills-container"></div>' +
      '<input type="hidden" id="ao-links">' +
    '</div>' +
    '<div class="input-group"><label>Image URL</label><input id="ao-img" placeholder="https://..."></div>' +
    '<div class="input-group"><label>Type</label><select id="ao-type"><option>Veg</option><option>Non-Veg</option></select></div>' +
    '<button class="btn btn-primary btn-block" onclick="saveNewAddOn()">Add Add-On</button>';
  $('modal-content').innerHTML=html;$('modal-overlay').classList.add('active');
  initLinkedItemsSelector('');
}

async function showEditAddOnModal(id,encoded){
  const it=JSON.parse(decodeURIComponent(encoded));
  showLoader('Loading items...');
  try {
    if(!S.categories || !S.categories.length){
      const r=await callServer('getMenuData');
      if(r.success){S.categories=r.data.categories;S.menu=r.data.items;}
    }
  } catch(e){}
  hideLoader();

  const html='<div class="modal-header"><h3>Edit Add-On</h3><button class="modal-close" onclick="closeModal()">✕</button></div>' +
    '<div class="input-group"><label>Name</label><input id="ao-name" value="'+it.name+'"></div>' +
    '<div class="input-group"><label>Price</label><input id="ao-price" type="number" value="'+it.price+'"></div>' +
    '<div class="input-group" style="position:relative"><label>Linked Dishes</label>' +
      '<input type="text" id="ao-linked-search" placeholder="Search dish by name..." oninput="searchDishesToLink(this.value)">' +
      '<div id="ao-linked-suggestions" class="suggestions-dropdown hidden"></div>' +
      '<div id="ao-linked-pills" class="selected-pills-container"></div>' +
      '<input type="hidden" id="ao-links" value="'+(it.linkedItems||'')+'">' +
    '</div>' +
    '<div class="input-group"><label>Image URL</label><input id="ao-img" value="'+(it.image||'')+'"></div>' +
    '<div class="input-group"><label>Type</label><select id="ao-type"><option'+(it.type==='Veg'?' selected':'')+'>Veg</option><option'+(it.type==='Non-Veg'?' selected':'')+'>Non-Veg</option></select></div>' +
    '<button class="btn btn-primary btn-block" onclick="saveEditAddOn(\''+id+'\')">Save Changes</button>';
  $('modal-content').innerHTML=html;$('modal-overlay').classList.add('active');
  initLinkedItemsSelector(it.linkedItems || '');
}

async function saveNewAddOn(){
  const data={name:$('ao-name').value,price:$('ao-price').value,image:$('ao-img').value,type:$('ao-type').value,linkedItems:$('ao-links').value};
  if(!data.name||!data.price)return showToast('Name and price required','error');
  showLoader('Adding...');try{const r=await callServer('addAddOn',data);hideLoader();if(r.success){showToast('Added!','success');closeModal();loadAdminAddOns()}else showToast(r.message,'error')}catch(e){hideLoader();showToast('Failed','error')}
}

async function saveEditAddOn(id){
  const data={id,name:$('ao-name').value,price:$('ao-price').value,image:$('ao-img').value,type:$('ao-type').value,linkedItems:$('ao-links').value,available:true};
  showLoader('Saving...');try{const r=await callServer('updateAddOn',data);hideLoader();if(r.success){showToast('Saved!','success');closeModal();loadAdminAddOns()}else showToast(r.message,'error')}catch(e){hideLoader();showToast('Failed','error')}
}

// ===== LINKED ITEMS SELECTOR SYSTEM =====
let activeLinkedIds = [];

function initLinkedItemsSelector(initialIdsString) {
  activeLinkedIds = (initialIdsString || '').split(',').map(s => s.trim()).filter(Boolean);
  renderLinkedPills();
  document.removeEventListener('click', handleSuggestionsOutsideClick);
  document.addEventListener('click', handleSuggestionsOutsideClick);
}

function handleSuggestionsOutsideClick(e) {
  const dropdown = $('ao-linked-suggestions');
  const searchInput = $('ao-linked-search');
  if (dropdown && searchInput && e.target !== searchInput && !dropdown.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
}

function renderLinkedPills() {
  const container = $('ao-linked-pills');
  if (!container) return;
  
  container.innerHTML = activeLinkedIds.map(id => {
    const dish = findMenuItem(id);
    const displayName = dish ? dish.name : id;
    return '<span class="select-pill">' + displayName + ' <span class="remove-pill" onclick="removeLinkedItem(\'' + id + '\')">✕</span></span>';
  }).join('');
  
  const hiddenInput = $('ao-links');
  if (hiddenInput) {
    hiddenInput.value = activeLinkedIds.join(',');
  }
}

function removeLinkedItem(id) {
  activeLinkedIds = activeLinkedIds.filter(x => x !== id);
  renderLinkedPills();
}

function searchDishesToLink(query) {
  const dropdown = $('ao-linked-suggestions');
  if (!dropdown) return;
  
  if (!query || query.trim().length === 0) {
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
    return;
  }
  
  const q = query.toLowerCase().trim();
  const matches = [];
  
  for (const cat of S.categories) {
    const items = S.menu[cat] || [];
    for (const it of items) {
      if (it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q)) {
        matches.push(it);
      }
    }
  }
  
  if (matches.length === 0) {
    dropdown.innerHTML = '<div style="padding: 10px; font-size: 0.8rem; color: var(--text3); text-align: center;">No matches found</div>';
    dropdown.classList.remove('hidden');
    return;
  }
  
  dropdown.innerHTML = matches.map(it => {
    const isSelected = activeLinkedIds.includes(it.id);
    return '<div class="suggestion-item ' + (isSelected ? 'selected' : '') + '" onclick="' + (isSelected ? '' : 'selectLinkedItem(\'' + it.id + '\')') + '">' +
             '<span>' + it.name + ' <small style="color: var(--text3)">(' + it.id + ')</small></span>' +
             '<span style="font-size: 0.75rem; color: var(--primary)">' + (isSelected ? 'Added' : '+ Add') + '</span>' +
           '</div>';
  }).join('');
  dropdown.classList.remove('hidden');
}

function selectLinkedItem(id) {
  if (!activeLinkedIds.includes(id)) {
    activeLinkedIds.push(id);
    renderLinkedPills();
  }
  const searchInput = $('ao-linked-search');
  if (searchInput) searchInput.value = '';
  const dropdown = $('ao-linked-suggestions');
  if (dropdown) {
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
  }
}

// ===== QR CODE GENERATOR =====
function initQRTab() {
  const totalTables = parseInt(S.config.totalTables) || 20;
  if ($('qr-to') && !$('qr-to').dataset.initialized) {
    $('qr-to').value = totalTables;
    $('qr-to').dataset.initialized = 'true';
  }
  if (!S.selectedQRDesign) {
    S.selectedQRDesign = 'classic';
  }
}

function selectQRDesign(el, designId) {
  S.selectedQRDesign = designId;
  const options = document.querySelectorAll('.qr-design-option');
  options.forEach(opt => opt.classList.remove('active'));
  el.classList.add('active');
  
  // Re-generate if cards are already generated to update live preview instantly
  const grid = $('qr-cards-grid');
  if (grid && grid.children.length > 0) {
    generateTableQRCodes();
  }
}

function getAppBaseUrl() {
  // Return the current window location (Vercel URL)
  return window.location.href.split('?')[0].split('#')[0];
}

function generateTableQRCodes() {
  const from = parseInt($('qr-from').value) || 1;
  const to = parseInt($('qr-to').value) || 10;

  if (from > to) return showToast('From table must be ≤ To table', 'error');
  if (to - from > 99) return showToast('Maximum 100 tables at a time', 'error');

  const baseUrl = getAppBaseUrl();
  const restaurantName = S.config.restaurantName || 'MenuSarthi';
  const logoUrl = S.config.logoUrl || '';
  const grid = $('qr-cards-grid');
  const design = S.selectedQRDesign || 'classic';
  
  let html = '';
  for (let t = from; t <= to; t++) {
    const tableUrl = baseUrl + '?table=' + t;
    const qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(tableUrl) + '&bgcolor=ffffff&color=1a1a2e&margin=10';

    const logoHtml = logoUrl 
      ? '<img src="' + logoUrl + '" alt="Logo" style="width:36px;height:36px;border-radius:10px;object-fit:cover">'
      : '<span style="font-size:1.5rem">🍽️</span>';

    html += `
      <div class="qr-card qr-design-${design}" id="qr-card-${t}">
        <div class="qr-card-header">
          <div class="qr-card-logo">${logoHtml}</div>
          <div>
            <div class="qr-card-brand">${restaurantName}</div>
            <div class="qr-card-subtitle">Digital Menu</div>
          </div>
        </div>
        <div class="qr-card-table-number">Table ${t}</div>
        <div class="qr-card-qr-wrapper">
          <img src="${qrApiUrl}" alt="QR Code Table ${t}" loading="lazy" crossorigin="anonymous">
        </div>
        <div class="qr-card-instruction">
          <span style="font-size:1.1rem">📱</span> Scan to Order
        </div>
        <div class="qr-card-footer">
          Powered by MenuSarthi
        </div>
        <div class="qr-card-actions">
          <button class="btn btn-ghost btn-sm" style="color:inherit;border:1px solid rgba(128,128,128,0.2)" onclick="printSingleQR(${t})">🖨️ Print</button>
          <button class="btn btn-ghost btn-sm" style="color:inherit;border:1px solid rgba(128,128,128,0.2)" onclick="downloadSingleQR(${t})">📥 Save</button>
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;
  
  // Show print all button
  const printAllContainer = $('qr-print-all-container');
  if (printAllContainer) {
    printAllContainer.classList.remove('hidden');
    printAllContainer.style.display = 'flex';
  }
  
  showToast(`${to - from + 1} QR codes generated with ${design.toUpperCase()} design!`, 'success');
}

function getQRPrintStyles(design) {
  const currentDesign = design || S.selectedQRDesign || 'classic';
  
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800;900&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #ffffff; color: #1a1a2e; padding: 0; margin: 0; }
    
    .print-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      padding: 24px;
      max-width: 900px;
      margin: 0 auto;
    }
    
    .print-card {
      border-radius: 20px;
      padding: 24px 20px;
      text-align: center;
      page-break-inside: avoid;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
      min-height: 380px;
    }
    
    .print-card-header {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-bottom: 12px;
      width: 100%;
    }
    
    .print-card-logo {
      width: 36px; height: 36px; border-radius: 9px;
      overflow: hidden; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .print-card-logo img { width: 100%; height: 100%; object-fit: cover; }
    
    .print-card-brand {
      font-family: 'Outfit', sans-serif;
      font-size: 14px; font-weight: 800; text-align: left;
    }
    
    .print-card-subtitle {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; text-align: left;
    }
    
    .print-card-table {
      font-family: 'Outfit', sans-serif;
      font-size: 28px; font-weight: 900;
      margin-bottom: 12px;
      padding-bottom: 8px;
      width: 100%;
    }
    
    .print-card-qr {
      background: #ffffff;
      padding: 10px;
      border-radius: 12px;
      display: inline-block;
      margin: 8px auto 12px;
    }
    .print-card-qr img { width: 130px; height: 130px; display: block; }
    
    .print-card-scan {
      font-size: 13px; font-weight: 700;
      margin-bottom: 6px;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      font-family: 'Outfit', sans-serif;
    }
    
    .print-card-footer {
      font-size: 9px; font-weight: 700; letter-spacing: 0.3px;
    }
    
    /* THEME SPECIFIC PRINT STYLES */
    
    /* 1. CLASSIC */
    .print-design-classic {
      background: #111217;
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }
    .print-design-classic .print-card-logo { background: linear-gradient(135deg, #ff5e14, #ff8940); }
    .print-design-classic .print-card-brand { color: #ffffff; }
    .print-design-classic .print-card-subtitle { color: #8e909c; }
    .print-design-classic .print-card-table { color: #ff5e14; border-bottom: 2px dashed rgba(255,255,255,0.1); }
    .print-design-classic .print-card-qr { box-shadow: 0 6px 15px rgba(0,0,0,0.5); }
    .print-design-classic .print-card-scan { color: #ffffff; }
    .print-design-classic .print-card-footer { color: #8e909c; }
    
    /* 2. MINIMAL */
    .print-design-minimal {
      background: #ffffff;
      border: 2px solid #1a1a2e;
      color: #1a1a2e;
    }
    .print-design-minimal .print-card-logo { background: #f1f3f5; border: 1px solid #dee2e6; }
    .print-design-minimal .print-card-brand { color: #1a1a2e; }
    .print-design-minimal .print-card-subtitle { color: #868e96; }
    .print-design-minimal .print-card-table { color: #1a1a2e; border-bottom: 2px solid #dee2e6; }
    .print-design-minimal .print-card-qr { border: 1px solid #dee2e6; }
    .print-design-minimal .print-card-scan { color: #212529; }
    .print-design-minimal .print-card-footer { color: #adb5bd; }
    
    /* 3. GRADIENT */
    .print-design-gradient {
      background: linear-gradient(135deg, #3f51b5 0%, #9c27b0 100%);
      border: 1px solid rgba(255,255,255,0.2);
      color: #ffffff;
    }
    .print-design-gradient .print-card-logo { background: rgba(255,255,255,0.2); }
    .print-design-gradient .print-card-brand { color: #ffffff; }
    .print-design-gradient .print-card-subtitle { color: rgba(255,255,255,0.8); }
    .print-design-gradient .print-card-table { color: #ffeb3b; border-bottom: 2px dashed rgba(255,255,255,0.3); }
    .print-design-gradient .print-card-scan { color: #ffffff; }
    .print-design-gradient .print-card-footer { color: rgba(255,255,255,0.8); }
    
    /* 4. NEON */
    .print-design-neon {
      background: #0a0b10;
      border: 2px solid #ff007f;
      color: #39ff14;
    }
    .print-design-neon .print-card-logo { background: #12131a; border: 1px solid #ff007f; }
    .print-design-neon .print-card-brand { color: #ffffff; }
    .print-design-neon .print-card-subtitle { color: #00ffff; }
    .print-design-neon .print-card-table { color: #00ffff; border-bottom: 2px dashed #ff007f; }
    .print-design-neon .print-card-qr { box-shadow: 0 0 10px rgba(0, 255, 255, 0.4); }
    .print-design-neon .print-card-scan { color: #39ff14; }
    .print-design-neon .print-card-footer { color: #66fcf1; }
    
    /* 5. ROYAL */
    .print-design-royal {
      background: linear-gradient(135deg, #111111 0%, #2a2a2a 100%);
      border: 2px solid #dfba6b;
      color: #dfba6b;
    }
    .print-design-royal .print-card-logo { background: #dfba6b; }
    .print-design-royal .print-card-brand { color: #ffffff; }
    .print-design-royal .print-card-subtitle { color: #dfba6b; }
    .print-design-royal .print-card-table { color: #ffffff; border-bottom: 2px solid #dfba6b; }
    .print-design-royal .print-card-qr { border: 1px solid #dfba6b; }
    .print-design-royal .print-card-scan { color: #dfba6b; }
    .print-design-royal .print-card-footer { color: #8e8e8e; }
    
    /* 6. VIBRANT */
    .print-design-vibrant {
      background: #ff5757;
      border: 3px solid #212529;
      color: #ffffff;
    }
    .print-design-vibrant .print-card-logo { background: #ffeb3b; border: 2px solid #212529; }
    .print-design-vibrant .print-card-brand { color: #ffffff; }
    .print-design-vibrant .print-card-subtitle { color: #ffeb3b; }
    .print-design-vibrant .print-card-table { color: #ffeb3b; border-bottom: 3px solid #212529; }
    .print-design-vibrant .print-card-qr { border: 3px solid #212529; }
    .print-design-vibrant .print-card-scan { color: #ffeb3b; }
    .print-design-vibrant .print-card-footer { color: #ffffff; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
      .print-grid { padding: 10px; gap: 12px; }
      .no-print { display: none !important; }
    }
  `;
}

function buildPrintCardsHTML(tableNumbers) {
  const baseUrl = getAppBaseUrl();
  const restaurantName = S.config.restaurantName || 'MenuSarthi';
  const logoUrl = S.config.logoUrl || '';
  const design = S.selectedQRDesign || 'classic';

  let cardsHtml = '';
  tableNumbers.forEach(t => {
    const tableUrl = baseUrl + '?table=' + t;
    const qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(tableUrl) + '&bgcolor=ffffff&color=1a1a2e&margin=8';
    const logoHtml = logoUrl 
      ? '<img src="' + logoUrl + '" alt="Logo">'
      : '<span style="font-size:1.2rem">🍽️</span>';

    cardsHtml += `
      <div class="print-card print-design-${design}">
        <div class="print-card-header">
          <div class="print-card-logo">${logoHtml}</div>
          <div>
            <div class="print-card-brand">${restaurantName}</div>
            <div class="print-card-subtitle">Digital Menu</div>
          </div>
        </div>
        <div class="print-card-table">Table ${t}</div>
        <div class="print-card-qr">
          <img src="${qrApiUrl}" alt="QR Table ${t}" crossorigin="anonymous">
        </div>
        <div class="print-card-scan">📱 Scan to Order</div>
        <div class="print-card-footer">Powered by MenuSarthi</div>
      </div>
    `;
  });
  return cardsHtml;
}

function printSingleQR(tableNum) {
  const printWindow = window.open('', '_blank', 'width=420,height=600');
  if (!printWindow) { showToast('Please allow pop-ups for printing', 'error'); return; }
  
  const design = S.selectedQRDesign || 'classic';
  printWindow.document.title = 'QR Code - Table ' + tableNum;
  
  // Inject style
  const styleEl = printWindow.document.createElement('style');
  styleEl.textContent = getQRPrintStyles(design) + `
    .print-grid { grid-template-columns: 1fr; max-width: 300px; padding: 10px; }
    .print-card { min-height: 400px; }
    .print-card-table { font-size: 32px; }
    .print-card-qr img { width: 160px; height: 160px; }
  `;
  printWindow.document.head.appendChild(styleEl);
  
  // Inject content
  printWindow.document.body.innerHTML = `
    <div class="print-grid">${buildPrintCardsHTML([tableNum])}</div>
  `;
  
  // Print
  setTimeout(function() {
    try {
      printWindow.focus();
      printWindow.print();
    } catch(e) {
      console.error(e);
    }
  }, 1200);
}

function printAllQRCodes() {
  const from = parseInt($('qr-from').value) || 1;
  const to = parseInt($('qr-to').value) || 10;
  const tables = [];
  for (let t = from; t <= to; t++) tables.push(t);

  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) { showToast('Please allow pop-ups for printing', 'error'); return; }

  const design = S.selectedQRDesign || 'classic';
  printWindow.document.title = 'QR Codes - Table ' + from + ' to ' + to;
  
  // Inject style
  const styleEl = printWindow.document.createElement('style');
  styleEl.textContent = getQRPrintStyles(design);
  printWindow.document.head.appendChild(styleEl);
  
  // Inject content
  printWindow.document.body.innerHTML = `
    <div class="no-print" style="text-align:center;padding:16px;font-family:Inter,sans-serif;background:#f8f9fa;border-bottom:1px solid #e9ecef;margin-bottom:20px">
      <h2 style="margin-bottom:8px;font-family:Outfit,sans-serif;color:#1a1a2e">🖨️ QR Codes Ready to Print</h2>
      <p style="color:#666;font-size:14px;margin-bottom:16px">Table ${from} to ${to} (${tables.length} cards) • <b>Theme: ${design.toUpperCase()}</b></p>
      <button class="no-print-btn" style="padding:12px 32px;background:#ff6b35;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">Print Now</button>
    </div>
    <div class="print-grid">${buildPrintCardsHTML(tables)}</div>
  `;

  // Attach button click event handler programmatically
  const printBtn = printWindow.document.querySelector('.no-print-btn');
  if (printBtn) {
    printBtn.onclick = function() { printWindow.print(); };
  }

  // Print automatically after loaded
  setTimeout(function() {
    try {
      printWindow.focus();
      printWindow.print();
    } catch(e) {
      console.error(e);
    }
  }, 1500);
}

function downloadAllQRPDF() {
  const from = parseInt($('qr-from').value) || 1;
  const to = parseInt($('qr-to').value) || 10;
  const tables = [];
  for (let t = from; t <= to; t++) tables.push(t);

  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) { showToast('Please allow pop-ups', 'error'); return; }

  const design = S.selectedQRDesign || 'classic';
  printWindow.document.title = 'QR Codes - Table ' + from + ' to ' + to;
  
  // Inject style
  const styleEl = printWindow.document.createElement('style');
  styleEl.textContent = getQRPrintStyles(design);
  printWindow.document.head.appendChild(styleEl);
  
  // Inject content
  printWindow.document.body.innerHTML = `
    <div class="no-print" style="text-align:center;padding:20px;font-family:Inter,sans-serif;background:#f8f9fa;border-bottom:1px solid #e9ecef;margin-bottom:20px">
      <h2 style="margin-bottom:8px;font-family:Outfit,sans-serif;color:#1a1a2e">📥 QR Code Print Sheet</h2>
      <p style="color:#666;font-size:14px;margin-bottom:8px">Table ${from} to ${to} (${tables.length} cards) • <b>Theme: ${design.toUpperCase()}</b></p>
      <p style="color:#999;font-size:12px;margin-bottom:16px">Use <b>Ctrl+P</b> → <b>Save as PDF</b> to download</p>
      <button class="no-print-btn" style="padding:12px 32px;background:#ff6b35;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">📥 Save as PDF</button>
    </div>
    <div class="print-grid">${buildPrintCardsHTML(tables)}</div>
  `;

  // Attach button click event handler programmatically
  const printBtn = printWindow.document.querySelector('.no-print-btn');
  if (printBtn) {
    printBtn.onclick = function() { printWindow.print(); };
  }

  showToast('Print sheet opened! Use Save as PDF to download', 'info');
}

function downloadSingleQR(tableNum) {
  const baseUrl = getAppBaseUrl();
  const tableUrl = baseUrl + '?table=' + tableNum;
  const qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(tableUrl) + '&bgcolor=ffffff&color=1a1a2e&margin=20';
  
  const link = document.createElement('a');
  link.href = qrApiUrl;
  link.target = '_blank';
  link.download = 'QR_Table_' + tableNum + '.png';
  link.click();
  showToast('QR image opened — right-click to save', 'info');
}

// ===== SUBSCRIPTION MANAGEMENT =====
const WHATSAPP_RENEW_NUMBER = '918851666208';
const WHATSAPP_RENEW_MSG = 'Hi MenuSarthi Team! I want to renew my restaurant subscription. Please help.';

function openSubscriptionRenewal() {
  switchAdminTab(document.querySelector('.admin-tab[data-tab="admin-settings-tab"]'), 'admin-settings-tab');
  setTimeout(() => {
    const el = $('cfg-sub-plans-grid');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px dashed var(--primary)';
      setTimeout(() => { el.style.outline = 'none'; }, 2500);
    }
  }, 300);
}

/**
 * Renders subscription banner in admin dashboard
 * Shows warning (expiring soon) or expired banner
 */
function renderSubscriptionBanner() {
  const container = $('subscription-banner-container');
  if (!container) return;
  const sub = S.subscriptionStatus;
  if (!sub || !sub.found) { container.innerHTML = ''; return; }

  const waLink = 'https://wa.me/' + WHATSAPP_RENEW_NUMBER + '?text=' + encodeURIComponent(WHATSAPP_RENEW_MSG);

  if (!sub.isActive) {
    // EXPIRED BANNER
    container.innerHTML = `
      <div class="subscription-expired">
        <div class="sub-banner-icon">🚨</div>
        <div class="sub-banner-title">Subscription Expired</div>
        <div class="sub-banner-desc">
          Your MenuSarthi subscription has expired. Renew now via Razorpay to instantly restore your digital menu.
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
          <button class="sub-renew-razorpay-btn" onclick="openSubscriptionRenewal()">
            💳 Renew Subscription Online
          </button>
          <a href="${waLink}" target="_blank" class="sub-renew-whatsapp-link">
            💬 Or renew manually via WhatsApp
          </a>
        </div>
        <div class="sub-expiry-info">
          <span>Expired: ${sub.expiryDate}</span>
          <span class="sub-plan-badge">${sub.plan} Plan</span>
        </div>
      </div>
    `;
  } else if (sub.isExpiringSoon) {
    // WARNING BANNER (≤7 days remaining)
    container.innerHTML = `
      <div class="subscription-warning" style="background:rgba(251,191,36,0.06); border:1px solid rgba(251,191,36,0.3); border-radius:var(--radius); padding:20px; margin-bottom:20px; text-align:center;">
        <div class="sub-banner-icon" style="font-size:1.8rem; margin-bottom:6px;">⚠️</div>
        <div class="sub-banner-title" style="font-family:var(--font-head); font-weight:800; font-size:1.1rem; color:var(--warning); margin-bottom:6px;">Subscription Expiring Soon</div>
        <div class="sub-banner-desc" style="font-size:0.85rem; color:var(--text2); margin-bottom:12px;">
          Your ${sub.plan} subscription expires on <strong>${sub.expiryDate}</strong> (⏳ ${sub.daysRemaining} days remaining).
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
          <button class="sub-renew-razorpay-btn" onclick="openSubscriptionRenewal()">
            💳 Renew Now
          </button>
          <a href="${waLink}" target="_blank" class="sub-renew-whatsapp-link" style="margin-top:4px;">
            💬 Or renew via WhatsApp
          </a>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = '';
  }
}

let selectedSubPlanId = null;

async function loadSubscriptionInSettings() {
  const statusCard = $('cfg-sub-status-card');
  const plansGrid = $('cfg-sub-plans-grid');
  if (!statusCard || !plansGrid) return;

  statusCard.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text3)">Loading subscription status...</div>';
  plansGrid.innerHTML = '';

  try {
    const r = await callServer('getSubscriptionDetails');
    if (r.success && r.data) {
      const sub = r.data.subscription;
      const plans = r.data.plans;

      // Update S.subscriptionStatus just in case it updated
      S.subscriptionStatus = sub;

      // Render status card
      const statusText = sub.isActive 
        ? '<span style="color:var(--success); font-weight:bold">Active</span>' 
        : '<span style="color:var(--error); font-weight:bold">Expired</span>';
      
      const expiryText = sub.isLifetime ? 'Lifetime Access' : (sub.expiryDate || 'N/A');
      const daysText = sub.isLifetime ? 'Unlimited' : (sub.daysRemaining !== undefined ? sub.daysRemaining + ' days' : 'N/A');

      statusCard.innerHTML = `
        <div class="sub-status-card">
          <div class="status-row">
            <span class="status-label">Subscription Plan:</span>
            <span class="status-value">${sub.plan || 'None'}</span>
          </div>
          <div class="status-row">
            <span class="status-label">Status:</span>
            <span class="status-value">${statusText}</span>
          </div>
          <div class="status-row">
            <span class="status-label">Start Date:</span>
            <span class="status-value">${sub.startDate || 'N/A'}</span>
          </div>
          <div class="status-row">
            <span class="status-label">Expiry Date:</span>
            <span class="status-value">${expiryText}</span>
          </div>
          <div class="status-row">
            <span class="status-label">Days Remaining:</span>
            <span class="status-value" style="color: ${sub.isExpiringSoon ? 'var(--warning)' : 'inherit'};">${daysText}</span>
          </div>
        </div>
      `;

      // Render plan cards
      plansGrid.innerHTML = `
        <div class="sub-plans-grid">
          ${plans.map(p => {
            const isCurrent = sub.plan && sub.plan.toLowerCase() === p.name.toLowerCase() && sub.isActive;
            const cardClass = isCurrent ? 'plan-card active' : 'plan-card';
            const savingsHtml = p.savings ? `<div class="plan-savings-badge">Save ${p.savings}</div>` : '';
            const recClass = p.id === 'yearly' ? 'recommended' : '';
            return `
              <div class="${cardClass} ${recClass}" id="plan-${p.id}" onclick="selectSubPlan('${p.id}')">
                <div class="plan-name">${p.name}</div>
                <div class="plan-price">₹${p.price}</div>
                <div class="plan-duration">${p.description}</div>
                ${savingsHtml}
              </div>
            `;
          }).join('')}
        </div>
        <button id="btn-pay-sub" class="btn btn-primary btn-block" style="margin-top:16px;" onclick="paySelectedSubscription()" disabled>
          💳 Select a plan above to Renew
        </button>
      `;

      // Pre-select yearly plan if not currently active
      if (plans.length > 0) {
        const defaultPlan = plans.find(p => p.id === 'yearly') || plans[0];
        selectSubPlan(defaultPlan.id);
      }
    } else {
      statusCard.innerHTML = '<div style="color:var(--error); text-align:center; padding:10px;">Failed to load subscription status</div>';
    }
  } catch (e) {
    statusCard.innerHTML = '<div style="color:var(--error); text-align:center; padding:10px;">Error loading subscription details</div>';
  }
}

function selectSubPlan(planId) {
  selectedSubPlanId = planId;
  document.querySelectorAll('.plan-card').forEach(el => el.classList.remove('selected'));
  const selectedCard = $('plan-' + planId);
  if (selectedCard) {
    selectedCard.classList.add('selected');
  }

  const payBtn = $('btn-pay-sub');
  if (payBtn) {
    payBtn.disabled = false;
    const planName = planId === 'monthly' ? 'Monthly' : planId === 'semiyearly' ? 'Semi-Yearly' : 'Yearly';
    const planPrice = planId === 'monthly' ? '999' : planId === 'semiyearly' ? '4999' : '9999';
    payBtn.innerHTML = `💳 Pay ₹${planPrice} via Razorpay — Renew ${planName}`;
  }
}

async function paySelectedSubscription() {
  if (!selectedSubPlanId) return showToast('Please select a plan first', 'error');

  showLoader('Creating payment order...');
  try {
    const r = await callServer('createSubscriptionOrder', selectedSubPlanId);
    hideLoader();
    if (!r.success) {
      showToast(r.message || 'Failed to initialize subscription payment', 'error');
      return;
    }

    const rzpData = r.data;
    const options = {
      "key": rzpData.keyId,
      "amount": Math.round(rzpData.amount * 100),
      "currency": rzpData.currency || "INR",
      "name": "MenuSarthi Subscription",
      "description": "Renewal of " + rzpData.planName + " Plan",
      "order_id": rzpData.razorpayOrderId,
      "handler": async function (response) {
        showLoader('Processing subscription renewal...');
        try {
          const verifyRes = await callServer(
            'verifySubscriptionPayment',
            rzpData.planId,
            response.razorpay_payment_id,
            response.razorpay_order_id,
            response.razorpay_signature
          );
          hideLoader();
          if (verifyRes.success) {
            showToast('Subscription renewed successfully! 🎉', 'success');
            S.subscriptionStatus = verifyRes.data;
            
            // Re-render banner
            renderSubscriptionBanner();
            
            // Remove overlays
            const dashEl = $('admin-dashboard');
            if (dashEl) dashEl.classList.remove('admin-expired-overlay');
            
            // Reload settings
            loadSubscriptionInSettings();
          } else {
            showToast(verifyRes.message || 'Verification failed', 'error');
          }
        } catch (e) {
          hideLoader();
          showToast('Error verifying subscription payment', 'error');
        }
      },
      "prefill": {
        "name": S.user ? S.user.name : "",
        "contact": S.user ? S.user.phone : ""
      },
      "theme": {
        "color": "#ff6b35"
      },
      "modal": {
        "ondismiss": function() {
          showToast('Payment cancelled', 'info');
        }
      }
    };
    const rzp = new Razorpay(options);
    rzp.open();
  } catch (e) {
    hideLoader();
    showToast('Failed to start checkout: ' + e.message, 'error');
  }
}

async function init(){
  if(S.table){$('table-badge').style.display='flex';$('table-display').textContent=S.table}
  // Restore session
  if(loadSession()){
    updateUserUI();
    verifyUserSessionFromServer(S.user.phone);
  }
  
  // Restore admin session
  if(loadAdminSession()){
    S.isAdmin=true;
    hide('admin-login-screen');
    show('admin-dashboard');
  }
  
  setInterval(checkAdminSessionExpiry,60000);
  
  try{
    const r=await callServer('getInitData');
    if(r.success){
      const d=r.data;S.config=d;
      // Store deployment URL
      if(d.deploymentUrl) S.config.deploymentUrl = d.deploymentUrl;
      
      // Store subscription status
      if(d.subscriptionStatus) S.subscriptionStatus = d.subscriptionStatus;
      
      // White-label branding
      const rName=d.restaurantName||'MenuSarthi';
      $('landing-name').textContent=rName;
      $('landing-tagline').textContent=d.restaurantTagline||'';
      document.title=rName+' — Digital Menu';
      // Dynamic logo
      const logoEl=$('landing-logo');
      if(d.logoUrl){logoEl.innerHTML='<img src="'+d.logoUrl+'" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:28px">'}
      // Powered by footer
      const pbEl=$('powered-by-landing');
      if(pbEl)pbEl.innerHTML='Powered by <a href="#">MenuSarthi</a>';
      
      // ===== SUBSCRIPTION GATE =====
      const sub = S.subscriptionStatus;
      if (sub && !sub.isActive && sub.found) {
        if (INIT_PAGE === 'admin') {
          // Admin mode: allow login, but show expired after login
          navigateTo('admin');
          // If already logged in via session, show expired state
          if (S.isAdmin) {
            renderSubscriptionBanner();
            const dashEl = $('admin-dashboard');
            if (dashEl) dashEl.classList.add('admin-expired-overlay');
          }
          return;
        } else {
          // Customer mode: show maintenance page
          navigateTo('maintenance');
          return;
        }
      }
      
      // Active subscription — proceed normally
      if (S.isAdmin) {
        loadAdminData();
        startAdminRefresh();
        renderSubscriptionBanner(); // Show warning if expiring soon
      }
    }
  }catch(e){}
  if(INIT_PAGE==='admin'){navigateTo('admin');return}
}
init();