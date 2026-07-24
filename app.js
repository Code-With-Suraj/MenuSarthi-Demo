const urlParams = new URLSearchParams(window.location.search);
const INIT_TABLE = urlParams.get('table') || '';
const INIT_PAGE = urlParams.get('page') || 'customer';

const SESSION_KEY='ms_session';const ADMIN_SESSION_KEY='ms_admin_session';const SESSION_TTL=2*60*60*1000;
const S={currentView:'landing',user:null,table:INIT_TABLE||'',menu:[],categories:[],cart:[],currentOrder:null,isAdmin:false,trackInterval:null,adminInterval:null,adminOrderCount:0,config:{},revisingOrderId:null,revisingNotes:'',revisionInterval:null,reportData:null,adminOrders:[],adminMenu:[],adminAddons:[],myOrders:[],subscriptionStatus:null,subscriptionPlans:[],billingPeriod:'monthly',currentOrderDetails:null,combos:[],offers:[],appliedOffer:null,discountAmount:0,orderType:'DINE_IN',deliveryAddress:'',deliveryLandmark:'',deliveryLat:null,deliveryLng:null,pickupTime:'',savedAddresses:[],selectedAddressId:null,adminOrderTypeFilter:'ALL'};

// ===== CLIENT-SIDE DATA CACHE (BOOTSTRAP LOADING & OFFLINE RESILIENCY) =====
const DataCache = {
  get: function(key) {
    try {
      const data = localStorage.getItem('ms_cache_' + key);
      return data ? JSON.parse(data) : null;
    } catch(e) { return null; }
  },
  set: function(key, val) {
    try {
      localStorage.setItem('ms_cache_' + key, JSON.stringify(val));
    } catch(e) {}
  },
  clear: function(key) {
    try {
      localStorage.removeItem('ms_cache_' + key);
    } catch(e) {}
  }
};

// ===== NETWORK MONITORING & RETRY QUEUE =====
let isOffline = !navigator.onLine;
let offlineQueue = [];

const NetworkMonitor = {
  init: function() {
    window.addEventListener('online', () => this.handleNetworkChange(true));
    window.addEventListener('offline', () => this.handleNetworkChange(false));
    this.updateBanner();
  },
  handleNetworkChange: function(online) {
    isOffline = !online;
    this.updateBanner();
    if (online) {
      showToast('You are back online! Syncing data...', 'success');
      this.processQueue();
    } else {
      showToast('Connection lost. Working in offline mode.', 'warning');
    }
  },
  updateBanner: function() {
    const banner = document.getElementById('network-banner');
    if (banner) {
      if (isOffline) {
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    }
  },
  enqueue: function(action, params, resolve, reject) {
    offlineQueue.push({ action, params, resolve, reject });
    showToast('Working Offline — Action queued for sync', 'info');
  },
  processQueue: async function() {
    if (offlineQueue.length === 0) return;
    const queue = [...offlineQueue];
    offlineQueue = [];
    for (const task of queue) {
      try {
        const res = await callServer(task.action, ...task.params);
        task.resolve(res);
      } catch(e) {
        if (isOffline) {
          offlineQueue.push(task); // Re-queue if still offline
        } else {
          task.reject(e);
        }
      }
    }
  }
};

async function retryNetworkConnection() {
  showLoader('Checking connection...');
  // Force check online state
  if (navigator.onLine) {
    isOffline = false;
    NetworkMonitor.handleNetworkChange(true);
    // Reload bootstrap data to ensure UI sync
    await bootstrapApp();
  } else {
    showToast('Still offline. Please check your internet connection.', 'error');
  }
  hideLoader();
}

// Call NetworkMonitor init on script load
setTimeout(() => NetworkMonitor.init(), 100);

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
  if (isOffline) {
    // If it's a read query, return from Cache if available
    if (['getBootstrapData', 'getMenuData', 'getInitData', 'getCombosData', 'getAllAddOns'].includes(action)) {
      const cached = DataCache.get(action);
      if (cached) {
        console.log('Serving cached data for action:', action);
        return cached;
      }
    }
    
    // If it's a critical customer action, queue it in NetworkMonitor
    if (['placeOrder', 'registerUser', 'loginUser', 'updateExistingOrder', 'reviseOrder', 'addReview'].includes(action)) {
      return new Promise((resolve, reject) => {
        NetworkMonitor.enqueue(action, args, resolve, reject);
      });
    }
    
    showToast('Offline Mode: Cannot connect to server', 'error');
    throw new Error('Offline: Server connection not available');
  }

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
    
    const res = await response.json();
    
    // Save to client-side cache if successful read action
    if (res && res.success && ['getBootstrapData', 'getMenuData', 'getInitData', 'getCombosData', 'getAllAddOns'].includes(action)) {
      DataCache.set(action, res);
    }
    
    return res;
  } catch (e) {
    console.error('API call failed:', e);
    // On slow network/fetch failure, try fallback to cache for read queries
    if (['getBootstrapData', 'getMenuData', 'getInitData', 'getCombosData', 'getAllAddOns'].includes(action)) {
      const cached = DataCache.get(action);
      if (cached) {
        console.warn('Fallback to cache due to API error:', e);
        return cached;
      }
    }
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
    case 'addCombo':
    case 'updateCombo':
      return args[0] || {};
    case 'validateUserSession':
      return { phone: args[0] };
    case 'getActiveOrder':
      return { phone: args[0] };
    case 'updateExistingOrder':
      return { orderId: args[0], ...args[1] };
    case 'adminLogin':
      return { password: args[0] };
    case 'getOrderStatus':
      return { orderId: args[0] };
    case 'getMyOrders':
      return { phone: args[0] };
    case 'getAddOnsForCart':
      return { cartItemIds: args[0] };
    case 'getItemReviews':
    case 'toggleItemAvailability':
    case 'deleteMenuItem':
      return { itemId: args[0] };
    case 'toggleAddOnAvailability':
    case 'deleteAddOn':
      return { addOnId: args[0] };
    case 'deleteOrder':
      return { orderId: args[0] };
    case 'deleteCombo':
      return { comboId: args[0] };
    case 'deleteOffer':
    case 'toggleOfferAvailability':
      return { offerId: args[0] };
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
  if (view !== 'tracking') {
    if (S.revisionInterval) {
      clearInterval(S.revisionInterval);
      S.revisionInterval = null;
    }
    if (S.trackInterval) {
      clearInterval(S.trackInterval);
      S.trackInterval = null;
    }
    try { FirebaseSync.stopListeningToOrder(); } catch(e) {}
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
  if(view==='menu' && Object.keys(S.menu || {}).length === 0)loadMenu();
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
    g.innerHTML+='<div class="menu-item" onclick="if(!event.target.closest(\'.add-btn\') && !event.target.closest(\'.read-more-btn\')) openDishDetail(\''+item.id+'\')"><div class="menu-item-img">'+img+'</div><div class="menu-item-info"><div><h3>'+badge+' '+item.name+'</h3>'+descHtml+'</div><div class="menu-item-bottom"><span class="item-price">'+priceStr+'</span>'+ctrl+'</div></div></div>'
  })
}

function filterMenu() {
  const q = ($('menu-search').value || '').toLowerCase().trim();
  const activeTab = document.querySelector('.cat-tab.active');
  const activeCat = activeTab ? activeTab.textContent : (S.categories[0] || '');
  
  if (!q) {
    if (activeCat) renderMenuItems(activeCat);
    return;
  }
  
  // 1. Check if the currently active category has a match (prevents unnecessary tab jumping)
  const currentHasMatch = (S.menu[activeCat] || []).some(it => it.name.toLowerCase().includes(q));
  
  let matchedCat = null;
  if (currentHasMatch) {
    matchedCat = activeCat;
  } else {
    // 2. Search other categories
    for (const cat of S.categories) {
      if (cat === activeCat) continue;
      const hasMatch = (S.menu[cat] || []).some(it => it.name.toLowerCase().includes(q));
      if (hasMatch) {
        matchedCat = cat;
        break;
      }
    }
  }
  
  if (matchedCat) {
    if (matchedCat !== activeCat) {
      // Switch active tab indicator visually
      const tabs = document.querySelectorAll('.cat-tab');
      tabs.forEach(tab => {
        if (tab.textContent === matchedCat) {
          tabs.forEach(b => b.classList.remove('active'));
          tab.classList.add('active');
          tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      });
    }
    renderMenuItems(matchedCat);
  } else {
    // No match found anywhere, render empty state under current category tab
    renderMenuItems(activeCat);
  }
}

function findMenuItem(id){for(const cat of S.categories){const it=(S.menu[cat]||[]).find(i=>i.id===id);if(it)return it}return null}

function addToCart(id){
  const item=findMenuItem(id);if(!item)return;
  if(item.portions&&item.portions.length>0){showPortionModal(item);return}
  
  // Smart Upselling Touchpoint 2: Check for matching combos or linked add-ons before adding
  const matchingCombos = (S.combos || []).filter(c => c.available && c.includedItems && c.includedItems.split(',').map(s=>s.trim()).includes(id));
  const matchingAddons = (S.adminAddons || []).filter(a => a.available && a.linkedItems && a.linkedItems.split(',').map(s=>s.trim()).includes(id));
  
  if ((matchingCombos.length > 0 || matchingAddons.length > 0) && !S.cart.some(c => c.id === id)) {
    showUpsellModal(item, matchingCombos, matchingAddons);
    return;
  }
  
  addStandardToCart(id);
}

function addStandardToCart(id){
  const item=findMenuItem(id);if(!item)return;
  const existing=S.cart.find(c=>c.id===id);
  if(existing)existing.qty++;
  else S.cart.push({id:item.id,name:item.name,price:item.price,qty:1,type:item.type,portion:''});
  updateCartBadge();
  const active=document.querySelector('.cat-tab.active');if(active)renderMenuItems(active.textContent);
  showToast(item.name+' added','success');
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

// ===== SMART CHECKOUT UPSELLING MODAL =====
function showUpsellModal(item, combos, addons, selectedPortion, selectedPrice) {
  const sheet = $('upsell-sheet');
  const overlay = $('upsell-overlay');
  if (!sheet || !overlay) return;

  // Determine the correct "add item" call based on whether a portion was pre-selected
  const hasPortion = selectedPortion && selectedPortion !== '';
  const addItemCall = hasPortion
    ? `addWithPortion('${item.id}','${selectedPortion}',${selectedPrice},'${item.type}')`
    : `addStandardToCart('${item.id}')`;
  const justAddLabel = hasPortion
    ? `Just add ${item.name} (${selectedPortion}) — ₹${selectedPrice}`
    : `Just add standard ${item.name}`;

  let html = `
    <div class="portion-handle"></div>
    <div class="upsell-title-container">
      <div class="upsell-title">✨ Make it a Feast!</div>
      <div class="upsell-subtitle">Specially curated deals for your selection</div>
    </div>
    <div class="upsell-grid">
  `;

  // 1. Render Combos
  if (combos.length > 0) {
    combos.forEach(c => {
      const img = c.image ? `<img src="${c.image}" alt="${c.name}" loading="lazy">` : '<span style="font-size: 2.2rem">🍱</span>';
      html += `
        <div class="upsell-card" onclick="addComboToCart('${c.id}'); closeUpsellModal();">
          <span class="upsell-card-tag">🔥 Best Deal</span>
          <div class="upsell-card-img">${img}</div>
          <div class="upsell-card-info">
            <div>
              <div class="upsell-card-name">Upgrade to ${c.name}</div>
              ${c.description ? `<div class="upsell-card-desc" style="font-weight: 600; color: var(--text2); margin-bottom: 2px;">${c.description}</div>` : ''}
              <div class="upsell-card-desc" style="font-style: italic;">Includes: ${c.includedNames || 'Delicious combination'}</div>
            </div>
            <div class="upsell-card-footer">
              <span class="upsell-card-price">₹${c.price}</span>
              <button class="upsell-add-btn">Upgrade</button>
            </div>
          </div>
        </div>
      `;
    });
  }

  // 2. Render Add-ons
  if (addons.length > 0) {
    addons.forEach(a => {
      const img = a.image ? `<img src="${a.image}" alt="${a.name}" loading="lazy">` : '<span style="font-size: 2.2rem">🍛</span>';
      html += `
        <div class="upsell-card" onclick="addAddOnToCart('${a.id}', '${a.name.replace(/'/g,"\\'")}', ${a.price}, '${a.type}'); ${addItemCall}; closeUpsellModal();">
          <span class="upsell-card-tag" style="background:linear-gradient(135deg,#2ecc71,#27ae60); color:#fff">Extra</span>
          <div class="upsell-card-img">${img}</div>
          <div class="upsell-card-info">
            <div>
              <div class="upsell-card-name">Add ${a.name}</div>
              <div class="upsell-card-desc">Tastes best with ${item.name}!</div>
            </div>
            <div class="upsell-card-footer">
              <span class="upsell-card-price">+ ₹${a.price}</span>
              <button class="upsell-add-btn" style="background:var(--success)">Add Both</button>
            </div>
          </div>
        </div>
      `;
    });
  }

  html += `
    </div>
    <div class="upsell-actions">
      <button class="btn btn-secondary btn-block" onclick="${addItemCall}; closeUpsellModal();">${justAddLabel}</button>
    </div>
  `;

  sheet.innerHTML = html;
  overlay.classList.add('active');
}

function closeUpsellModal() {
  const overlay = $('upsell-overlay');
  if (overlay) overlay.classList.remove('active');
}

// Add touch/click-outside dismiss for upsell modal
setTimeout(() => {
  const upsellOverlay = $('upsell-overlay');
  if (upsellOverlay) {
    upsellOverlay.addEventListener('click', e => {
      if (e.target === upsellOverlay) closeUpsellModal();
    });
  }
}, 200);

function addAddOnToCart(id, name, price, type) {
  const cartId = 'addon_' + id;
  const existing = S.cart.find(c => c.id === cartId);
  if (existing) {
    existing.qty++;
  } else {
    S.cart.push({
      id: cartId,
      name: name,
      price: price,
      qty: 1,
      type: type || 'Veg',
      portion: '',
      isAddOn: true
    });
  }
  updateCartBadge();
  if (S.currentView === 'cart') renderCart();
  showToast(name + ' added to cart! 🧩', 'success');
}

function loadCartAddOns() {
  const adSec = $('cart-addons-section');
  if (!adSec) return;

  if (!S.cart || !S.cart.length || !S.adminAddons || !S.adminAddons.length) {
    adSec.innerHTML = '';
    return;
  }

  const cartBaseIds = S.cart.map(c => (c.baseId || c.id).split('__')[0]);
  const cartAddOnIds = S.cart.filter(c => c.isAddOn).map(c => c.id.replace('addon_', ''));

  const matchingAddons = S.adminAddons.filter(a => {
    if (!a.available || cartAddOnIds.includes(a.id)) return false;
    if (!a.linkedItems || a.linkedItems.trim() === '') return true;
    const linkedList = a.linkedItems.split(',').map(s => s.trim());
    return linkedList.some(linkId => cartBaseIds.includes(linkId));
  });

  if (!matchingAddons.length) {
    adSec.innerHTML = '';
    return;
  }

  adSec.innerHTML = `
    <div class="cart-addons-wrapper glass" style="padding:14px; border:1px solid var(--border); border-radius:var(--radius); margin-bottom:16px;">
      <h4 style="font-size:0.9rem; font-weight:700; color:var(--text1); margin-bottom:10px; display:flex; align-items:center; gap:6px;">
        <span>🧩 Recommended Add-Ons</span>
      </h4>
      <div class="cart-addons-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:10px;">
        ${matchingAddons.map(a => `
          <div class="cart-addon-item" style="display:flex; justify-content:space-between; align-items:center; background:var(--bg2); padding:8px 12px; border-radius:var(--radius-xs); border:1px solid var(--border);">
            <div>
              <div style="font-size:0.82rem; font-weight:600; color:var(--text1);">${a.type === 'Non-Veg' ? '🔴' : '🟢'} ${a.name}</div>
              <div style="font-size:0.75rem; color:var(--primary); font-weight:700;">+ ₹${a.price}</div>
            </div>
            <button class="btn btn-primary btn-sm" style="padding:4px 8px; font-size:0.75rem; margin:0;" onclick="addAddOnToCart('${a.id}', '${a.name.replace(/'/g, "\\'")}', ${a.price}, '${a.type}')">+ Add</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function addComboToCart(comboId) {
  const combo = (S.combos || []).find(c => c.id === comboId);
  if (!combo) return;
  const cartId = 'combo_' + comboId;
  const existing = S.cart.find(c => c.id === cartId);
  if (existing) {
    existing.qty++;
  } else {
    S.cart.push({
      id: cartId,
      name: combo.name,
      price: combo.price,
      qty: 1,
      type: 'Veg',
      portion: '',
      isCombo: true
    });
  }
  updateCartBadge();
  showToast(combo.name + ' Added to Cart! 🏷️', 'success');
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
  S.appliedOffer=null;
  S.discountAmount=0;
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

  // Recalculate discount
  let discountAmt = 0;
  if (S.appliedOffer) {
    if (subtotal < S.appliedOffer.minOrderValue) {
      const removedCode = S.appliedOffer.code;
      S.appliedOffer = null;
      S.discountAmount = 0;
      // Use setTimeout to avoid interfering with render loop Toast showing
      setTimeout(() => showToast(`Offer ${removedCode} removed as minimum order value not met`, 'warning'), 100);
    } else {
      if (S.appliedOffer.type === 'discount_percent') {
        discountAmt = Math.round((subtotal * S.appliedOffer.value / 100) * 100) / 100;
      } else if (S.appliedOffer.type === 'discount_flat') {
        discountAmt = Math.min(subtotal, S.appliedOffer.value);
      } else if (S.appliedOffer.type === 'free_dish') {
        if (S.appliedOffer.freeDishId && S.appliedOffer.freeDishId !== 'any') {
          const freeCartItem = S.cart.find(c => c.id.split('__')[0] === S.appliedOffer.freeDishId);
          if (freeCartItem) {
            discountAmt = freeCartItem.price;
          }
        } else {
          let minPrice = Infinity;
          S.cart.forEach(c => {
            if (c.price > 0 && c.price < minPrice) {
              minPrice = c.price;
            }
          });
          if (minPrice !== Infinity) {
            discountAmt = minPrice;
          }
        }
      }
      S.discountAmount = discountAmt;
    }
  } else {
    S.discountAmount = 0;
  }

  const taxableSubtotal = Math.max(0, subtotal - S.discountAmount);
  const gstOn=S.config&&S.config.gstEnabled;
  const gstRate=S.config?S.config.gstRate||5:5;
  const gstAmt=gstOn?Math.round(taxableSubtotal*gstRate/100*100)/100:0;

  // Calculate delivery fee
  let deliveryFeeAmt = 0;
  let deliveryFeeLine = '';
  if (S.orderType === 'DELIVERY') {
    const flatFee = (S.config && S.config.flatDeliveryFee !== undefined) ? parseFloat(S.config.flatDeliveryFee) : 40;
    const freeThreshold = (S.config && S.config.freeDeliveryThreshold !== undefined) ? parseFloat(S.config.freeDeliveryThreshold) : 500;
    if (subtotal >= freeThreshold && freeThreshold > 0) {
      deliveryFeeAmt = 0;
      deliveryFeeLine = '<div class="row" style="color:var(--success); font-weight:600;"><span>🛵 Delivery Fee</span><span>FREE</span></div>';
    } else {
      deliveryFeeAmt = flatFee;
      deliveryFeeLine = '<div class="row"><span>🛵 Delivery Fee</span><span>₹' + flatFee.toFixed(2) + '</span></div>';
    }
  }

  const grandTotal = taxableSubtotal + gstAmt + deliveryFeeAmt;

  const discountLine = S.appliedOffer ? `<div class="row" style="color: var(--success); font-weight: 600;"><span>🏷️ Discount (${S.appliedOffer.code})</span><span>-₹${S.discountAmount.toFixed(2)}</span></div>` : '';
  const gstLine=gstOn?'<div class="row"><span>GST ('+gstRate+'%)</span><span>₹'+gstAmt.toFixed(2)+'</span></div>':'';
  const gstinLine=(gstOn&&S.config.gstNumber)?'<div style="font-size:.7rem;color:var(--text3);margin-top:6px;text-align:right">GSTIN: '+S.config.gstNumber+'</div>':'';
  
  if(!S.user){
    cs.innerHTML='<div class="cart-summary"><div class="row"><span>Subtotal ('+itemCount+')</span><span>₹'+subtotal+'</span></div>'+discountLine+gstLine+deliveryFeeLine+'<div class="row total"><span>Total</span><span>₹'+grandTotal.toFixed(2)+'</span></div>'+gstinLine+'</div><div class="checkout-section glass" style="padding:20px;text-align:center;border:1px dashed var(--border);border-radius:var(--radius);margin-top:20px"><div style="font-size:1.5rem;margin-bottom:8px">🔒 Login Required</div><p style="font-size:.85rem;color:var(--text2);margin-bottom:16px">You must log in to place an order and track its status.</p><button class="btn btn-primary btn-block" onclick="showAuth(\'login\')">👤 Login / Sign Up to Order</button></div>';
    return;
  }

  // Available Offers Section
  let offersHtml = '';
  const activeOffers = (S.offers || []).filter(o => o.isActive);
  if (activeOffers.length > 0) {
    offersHtml = `
      <div class="offers-section">
        <h4 style="margin-bottom:12px; display:flex; align-items:center; gap:6px;">🏷️ Available Offers</h4>
        <div class="offers-list">
          ${activeOffers.map(o => {
            const isApplicable = subtotal >= o.minOrderValue;
            const isApplied = S.appliedOffer && S.appliedOffer.id === o.id;
            let btnHtml = '';
            if (isApplied) {
              btnHtml = `<button class="btn btn-secondary btn-sm" style="color:var(--error); border-color:var(--error); margin-bottom:0; padding:4px 10px;" onclick="removeOffer()">Remove</button>`;
            } else if (isApplicable) {
              btnHtml = `<button class="btn btn-primary btn-sm" style="margin-bottom:0; padding:4px 10px;" onclick="applyOffer('${o.id}')">Apply</button>`;
            } else {
              btnHtml = `<button class="btn btn-secondary btn-sm" disabled style="margin-bottom:0; padding:4px 10px; opacity:0.5;">Apply</button>`;
            }
            
            const reqMore = o.minOrderValue - subtotal;
            const hintHtml = !isApplicable ? `<div class="offer-hint">Add ₹${reqMore.toFixed(0)} more to unlock this offer</div>` : '';
            
            let valueLabel = '';
            if (o.type === 'discount_percent') valueLabel = `${o.value}% Off`;
            else if (o.type === 'discount_flat') valueLabel = `₹${o.value} Off`;
            else if (o.type === 'free_dish') valueLabel = `Free Any Dish`;
            
            return `
              <div class="offer-card ${isApplied ? 'applied' : ''} ${isApplicable ? '' : 'disabled'}">
                <div class="offer-info">
                  <div class="offer-badge-row">
                    <span class="offer-code-badge">${o.code}</span>
                    <strong class="offer-type-tag">${valueLabel}</strong>
                  </div>
                  <div class="offer-desc">${o.description}</div>
                  ${hintHtml}
                </div>
                <div>
                  ${btnHtml}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  const notesValue = S.revisingOrderId ? S.revisingNotes : '';
  const submitBtn = S.revisingOrderId ? 
    '<button class="btn btn-primary btn-block" style="background:linear-gradient(135deg,var(--primary),var(--secondary));" onclick="submitOrderRevision()">🔄 Update Order — ₹'+grandTotal.toFixed(2)+'</button>' : 
    '<button class="btn btn-primary btn-block" onclick="submitOrder()">🚀 Place Order — ₹'+grandTotal.toFixed(2)+'</button>';

  // Order mode selector pills
  const dineInActive = (S.orderType === 'DINE_IN' || !S.orderType) ? 'active' : '';
  const takeawayActive = S.orderType === 'TAKEAWAY' ? 'active' : '';
  const deliveryActive = S.orderType === 'DELIVERY' ? 'active' : '';

  const orderModePillsHtml = `
    <div class="input-group" style="margin-bottom:16px;">
      <label>Choose Fulfillment Mode</label>
      <div class="order-type-pills">
        <button type="button" class="order-type-pill ${dineInActive}" id="om-pill-dinein" onclick="selectOrderMode('DINE_IN')">🍽️ Dine-In</button>
        <button type="button" class="order-type-pill ${takeawayActive}" id="om-pill-takeaway" onclick="selectOrderMode('TAKEAWAY')">🛍️ Takeaway</button>
        <button type="button" class="order-type-pill ${deliveryActive}" id="om-pill-delivery" onclick="selectOrderMode('DELIVERY')">🛵 Home Delivery</button>
      </div>
    </div>
  `;

  // Specific fulfillment fields
  let fulfillmentFieldsHtml = '';
  if (S.orderType === 'DINE_IN' || !S.orderType) {
    const isQRTable = INIT_TABLE && INIT_TABLE !== '';
    if (isQRTable) {
      fulfillmentFieldsHtml = '<div class="input-group"><label>Table Number</label>' +
        '<div class="qr-table-locked">' +
          '<div class="qr-table-badge"><span class="qr-table-icon">📍</span> Table <strong>' + S.table + '</strong></div>' +
          '<div class="qr-table-lock-hint">✅ Auto-detected via QR Code</div>' +
        '</div>' +
        '<input type="hidden" id="checkout-table" value="' + S.table + '">' +
      '</div>';
    } else {
      fulfillmentFieldsHtml = '<div class="input-group"><label>Table Number (optional)</label>' +
        '<input type="number" id="checkout-table" value="' + S.table + '" placeholder="Enter table number (optional)" min="1">' +
      '</div>';
    }
  } else if (S.orderType === 'TAKEAWAY') {
    fulfillmentFieldsHtml = `
      <div class="input-group">
        <label>Expected Pickup Time (optional)</label>
        <input type="time" id="checkout-pickup-time" value="${S.pickupTime || ''}" onchange="S.pickupTime=this.value">
      </div>
    `;
  } else if (S.orderType === 'DELIVERY') {
    fulfillmentFieldsHtml = `
      <div id="saved-addresses-container"></div>
      <div class="input-group">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="margin:0;">Delivery Address <span style="color:var(--error)">*</span></label>
          <button type="button" class="btn btn-ghost btn-sm" style="padding:2px 8px; font-size:0.75rem; color:var(--primary);" onclick="getUserLocationGPS()">📍 Use GPS Location</button>
        </div>
        <textarea id="checkout-address" placeholder="Flat / House No., Building, Street Name..." style="min-height:70px;">${S.deliveryAddress || ''}</textarea>
      </div>
      <div class="input-group">
        <label>Landmark (optional)</label>
        <input type="text" id="checkout-landmark" placeholder="e.g. Near HDFC Bank, Opposite Park" value="${S.deliveryLandmark || ''}">
      </div>
      <div style="margin-bottom:16px;">
        <button type="button" class="btn btn-secondary btn-sm" style="width:100%; font-size:0.8rem;" onclick="saveCurrentAddress()">💾 Save this Address for Future</button>
      </div>
    `;

    setTimeout(loadUserSavedAddresses, 50);
  }

  cs.innerHTML='<div class="cart-summary"><div class="row"><span>Subtotal ('+itemCount+')</span><span>₹'+subtotal+'</span></div>'+discountLine+gstLine+deliveryFeeLine+'<div class="row total"><span>Total</span><span>₹'+grandTotal.toFixed(2)+'</span></div>'+gstinLine+'</div>' + offersHtml + '<div class="checkout-section">' + orderModePillsHtml + fulfillmentFieldsHtml + '<div class="input-group"><label>Special Instructions (optional)</label><textarea id="checkout-notes" placeholder="e.g. Extra spicy, no onions...">'+notesValue+'</textarea></div>'+submitBtn+'</div>';
}

// ===== DELIVERY & ADDRESS MANAGEMENT =====
function selectOrderMode(mode) {
  S.orderType = mode;

  // Update Landing page cards
  const cardDineIn = $('om-card-dinein');
  const cardTakeaway = $('om-card-takeaway');
  const cardDelivery = $('om-card-delivery');
  if (cardDineIn) cardDineIn.classList.toggle('active', mode === 'DINE_IN');
  if (cardTakeaway) cardTakeaway.classList.toggle('active', mode === 'TAKEAWAY');
  if (cardDelivery) cardDelivery.classList.toggle('active', mode === 'DELIVERY');

  // Update Cart pills if rendered
  const pillDineIn = $('om-pill-dinein');
  const pillTakeaway = $('om-pill-takeaway');
  const pillDelivery = $('om-pill-delivery');
  if (pillDineIn) pillDineIn.classList.toggle('active', mode === 'DINE_IN');
  if (pillTakeaway) pillTakeaway.classList.toggle('active', mode === 'TAKEAWAY');
  if (pillDelivery) pillDelivery.classList.toggle('active', mode === 'DELIVERY');

  if (S.currentView === 'cart') {
    renderCart();
  }
}

function setAdminOrderTypeFilter(type) {
  S.adminOrderTypeFilter = type;
  document.querySelectorAll('.admin-order-filter-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.filter === type);
  });
  renderAdminOrders(S.adminOrders || []);
}

async function loadUserSavedAddresses() {
  if (!S.user || !S.user.phone) return;
  try {
    const r = await callServer('getUserAddresses', S.user.phone);
    if (r.success && Array.isArray(r.data)) {
      S.savedAddresses = r.data;
      renderSavedAddressesSelector();
    }
  } catch (e) {
    console.error('Failed to load user addresses:', e);
  }
}

function renderSavedAddressesSelector() {
  const container = $('saved-addresses-container');
  if (!container) return;

  if (!S.savedAddresses || S.savedAddresses.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <div class="input-group">
      <label>📍 Saved Addresses</label>
      <div class="saved-addresses-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:10px; margin-bottom:12px;">
  `;

  S.savedAddresses.forEach(addr => {
    const isSelected = S.selectedAddressId === addr.id;
    html += `
      <div class="address-card glass ${isSelected ? 'active' : ''}" style="padding:10px 12px; border:1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}; border-radius:var(--radius-xs); cursor:pointer; position:relative;" onclick="selectSavedAddress('${addr.id}')">
        <div style="font-weight:700; font-size:0.82rem; color:var(--text1); display:flex; justify-content:space-between; align-items:center;">
          <span>${addr.label || 'Home'}</span>
          <button class="btn btn-ghost btn-sm" style="padding:2px 4px; color:var(--error); font-size:0.7rem;" onclick="event.stopPropagation(); deleteUserSavedAddress('${addr.id}')">✕</button>
        </div>
        <div style="font-size:0.75rem; color:var(--text2); margin-top:4px; line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${addr.address}</div>
        ${addr.landmark ? `<div style="font-size:0.7rem; color:var(--text3); margin-top:2px;">🚩 ${addr.landmark}</div>` : ''}
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function selectSavedAddress(addressId) {
  const addr = (S.savedAddresses || []).find(a => a.id === addressId);
  if (!addr) return;

  S.selectedAddressId = addressId;
  if ($('checkout-address')) $('checkout-address').value = addr.address;
  if ($('checkout-landmark')) $('checkout-landmark').value = addr.landmark || '';
  if (addr.lat) S.deliveryLat = addr.lat;
  if (addr.lng) S.deliveryLng = addr.lng;

  renderSavedAddressesSelector();
  showToast('Selected address: ' + (addr.label || 'Saved address'), 'info');
}

async function saveCurrentAddress() {
  if (!S.user || !S.user.phone) return showToast('Please login to save address', 'error');
  const address = $('checkout-address') ? $('checkout-address').value.trim() : '';
  const landmark = $('checkout-landmark') ? $('checkout-landmark').value.trim() : '';

  if (!address) return showToast('Please enter an address first', 'error');

  const label = prompt('Enter a label for this address (e.g. Home, Office, Friend):', 'Home');
  if (!label) return;

  showLoader('Saving address...');
  try {
    const r = await callServer('saveUserAddress', S.user.phone, {
      label: label,
      address: address,
      landmark: landmark,
      lat: S.deliveryLat || '',
      lng: S.deliveryLng || ''
    });
    hideLoader();
    if (r.success) {
      showToast('Address saved to address book! 🏠', 'success');
      loadUserSavedAddresses();
    } else {
      showToast(r.message || 'Failed to save address', 'error');
    }
  } catch (e) {
    hideLoader();
    showToast('Failed to save address', 'error');
  }
}

async function deleteUserSavedAddress(addressId) {
  if (!confirm('Are you sure you want to delete this saved address?')) return;
  showLoader('Deleting address...');
  try {
    const r = await callServer('deleteUserAddress', S.user.phone, addressId);
    hideLoader();
    if (r.success) {
      showToast('Address deleted', 'success');
      if (S.selectedAddressId === addressId) S.selectedAddressId = null;
      loadUserSavedAddresses();
    } else {
      showToast(r.message || 'Failed to delete address', 'error');
    }
  } catch (e) {
    hideLoader();
    showToast('Failed to delete address', 'error');
  }
}

function getUserLocationGPS() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser', 'error');
    return;
  }

  showLoader('Detecting exact GPS location & address...');
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      S.deliveryLat = lat;
      S.deliveryLng = lng;

      let formattedAddress = '';

      // Primary Service: High-precision OpenStreetMap Nominatim with zoom=18 & address details
      try {
        const osmRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
          headers: { 'Accept-Language': 'en' }
        });
        if (osmRes.ok) {
          const osmData = await osmRes.json();
          if (osmData && osmData.address) {
            const addr = osmData.address;
            const parts = [];
            
            const placeName = addr.building || addr.house_number || addr.amenity || addr.shop || '';
            const street = addr.road || addr.pedestrian || addr.footway || '';
            const area = addr.suburb || addr.neighbourhood || addr.residential || addr.subdistrict || '';
            const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
            const state = addr.state || '';
            const postcode = addr.postcode || '';

            if (placeName) parts.push(placeName);
            if (street) parts.push(street);
            if (area) parts.push(area);
            if (city) parts.push(city);
            if (state) parts.push(state + (postcode ? ` - ${postcode}` : ''));

            if (parts.length > 0) {
              formattedAddress = parts.join(', ');
            } else if (osmData.display_name) {
              formattedAddress = osmData.display_name;
            }
          }
        }
      } catch (e) {
        console.warn('OSM Geocode error:', e);
      }

      // Secondary Fallback Service: BigDataCloud Reverse Geocode Client API
      if (!formattedAddress) {
        try {
          const bdcRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
          if (bdcRes.ok) {
            const bdcData = await bdcRes.json();
            const parts = [];
            if (bdcData.locality) parts.push(bdcData.locality);
            if (bdcData.city) parts.push(bdcData.city);
            if (bdcData.principalSubdivision) parts.push(bdcData.principalSubdivision);
            if (bdcData.postcode) parts.push(bdcData.postcode);

            if (parts.length > 0) {
              formattedAddress = parts.join(', ');
            }
          }
        } catch (e) {
          console.warn('BigDataCloud Geocode error:', e);
        }
      }

      // Final fallback if both APIs fail
      if (!formattedAddress) {
        formattedAddress = `Location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      }

      hideLoader();
      const addrInput = $('checkout-address');
      if (addrInput) {
        addrInput.value = formattedAddress;
        S.deliveryAddress = formattedAddress;
      }
      showToast('📍 Exact GPS address detected!', 'success');
    },
    (err) => {
      hideLoader();
      console.error('GPS Location error:', err);
      showToast('Could not fetch location. Please type your address manually.', 'warning');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

async function updateDeliveryStatus(orderId, newDeliveryStatus) {
  showLoader('Updating delivery status...');
  try {
    const r = await callServer('updateDeliveryStatus', orderId, newDeliveryStatus);
    hideLoader();
    if (r.success) {
      showToast('Delivery status updated to ' + newDeliveryStatus, 'success');
      try { FirebaseSync.updateDeliveryStatus(orderId, newDeliveryStatus); } catch (e) {}
      loadAdminData();
    } else {
      showToast(r.message || 'Failed to update delivery status', 'error');
    }
  } catch (e) {
    hideLoader();
    showToast('Failed to update delivery status', 'error');
  }
}

async function submitOrder(){
  if(!S.user){
    showToast('Please login to place order','error');
    showAuth('login');
    return;
  }
  if(!S.cart.length)return showToast('Cart is empty','error');

  const orderType = S.orderType || 'DINE_IN';
  const table = $('checkout-table') ? $('checkout-table').value : '';
  const deliveryAddress = $('checkout-address') ? $('checkout-address').value.trim() : '';
  const landmark = $('checkout-landmark') ? $('checkout-landmark').value.trim() : '';
  const pickupTime = $('checkout-pickup-time') ? $('checkout-pickup-time').value : '';

  if (orderType === 'DELIVERY' && !deliveryAddress) {
    return showToast('Please enter your delivery address', 'error');
  }
  
  showLoader('Checking order status...');
  try {
    const activeRes = await callServer('getActiveOrder', S.user.phone);
    hideLoader();
    
    if (activeRes.success && activeRes.data) {
      const activeOrder = activeRes.data;
      const status = activeOrder.status;
      
      if (status === 'Received' || status === 'Preparing') {
        showCustomModal(
          '🔔 Active Order in Progress',
          `You already have an active order <strong>${activeOrder.orderId}</strong>. Would you like to update your active order with these new items? You will only pay the difference amount.`,
          [
            { text: '🔄 Update Active Order', class: 'btn-primary', onclick: `handleUpdateExistingOrder('${activeOrder.orderId}')` },
            { text: '📍 Track Active Order', class: 'btn-secondary', onclick: `closeCustomModal(); navigateTo('tracking'); startTracking('${activeOrder.orderId}')` },
            { text: '❌ Cancel', class: 'btn-ghost', onclick: 'closeCustomModal()' }
          ]
        );
      } else {
        showCustomModal(
          '🍽️ Order is Ready!',
          `Your active order <strong>${activeOrder.orderId}</strong> is already prepared/ready. You cannot add more items to it now. Please ask staff to complete/bill this order before placing a new one.`,
          [
            { text: '📍 Track Active Order', class: 'btn-primary', onclick: `closeCustomModal(); navigateTo('tracking'); startTracking('${activeOrder.orderId}')` },
            { text: '❌ Close', class: 'btn-ghost', onclick: 'closeCustomModal()' }
          ]
        );
      }
      return;
    }
  } catch (e) {
    hideLoader();
    console.error('Failed to pre-check active order:', e);
    showToast('Connection issue, please try again.', 'error');
    return;
  }
  
  showLoader('Placing order...');
  const data={
    orderType: orderType,
    tableNumber: orderType === 'DINE_IN' ? table : '',
    deliveryAddress: orderType === 'DELIVERY' ? deliveryAddress : '',
    landmark: orderType === 'DELIVERY' ? landmark : '',
    pickupTime: orderType === 'TAKEAWAY' ? pickupTime : '',
    latitude: orderType === 'DELIVERY' && S.deliveryLat ? S.deliveryLat : '',
    longitude: orderType === 'DELIVERY' && S.deliveryLng ? S.deliveryLng : '',
    customerName: S.user.name,
    customerPhone: S.user.phone,
    items: S.cart.map(c=>({id:c.id,name:c.name + (c.portion ? ' (' + c.portion + ')' : ''),qty:c.qty,price:c.price})),
    specialInstructions: $('checkout-notes')?$('checkout-notes').value:'',
    appliedOfferCode: S.appliedOffer ? S.appliedOffer.code : '',
    discountAmount: S.discountAmount || 0
  };
  try{
    const r=await callServer('placeOrder',data);hideLoader();
    if(r.success){
      callServer('syncPendingOrders').catch(err => console.warn('Background sync failed:', err));
      
      S.currentOrder=r.data;
      
      try {
        FirebaseSync.pushOrder({
          orderId: r.data.orderId,
          orderType: r.data.orderType || data.orderType,
          status: 'Received',
          table: data.tableNumber,
          deliveryAddress: data.deliveryAddress,
          landmark: data.landmark,
          pickupTime: data.pickupTime,
          deliveryFee: r.data.deliveryFee || 0,
          deliveryStatus: r.data.deliveryStatus || (data.orderType === 'DELIVERY' ? 'Pending' : ''),
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          items: data.items,
          total: r.data.total,
          paymentStatus: 'Pending',
          timestamp: r.data.timestamp || new Date().toISOString(),
          specialInstructions: data.specialInstructions,
          discountAmount: r.data.discountAmount || 0,
          appliedOffer: r.data.appliedOfferCode || ''
        });
      } catch(fberr) {
        console.error("Firebase sync error on placement:", fberr);
      }

      S.cart=[];
      S.appliedOffer=null;
      S.discountAmount=0;
      updateCartBadge();
      
      const isPostpaid = S.config && S.config.paymentTiming === 'postpaid';
      if (isPostpaid) {
        showToast('Order placed successfully! 🎉', 'success');
        navigateTo('tracking');
        startTracking(r.data.orderId);
      } else {
        showToast('Order placed! Proceeding to payment...', 'success');
        openPaymentPage(r.data.orderId, r.data.total);
      }
    }
    else showToast(r.message,'error');
  }catch(e){hideLoader();showToast('Order failed','error')}
}

// ===== ORDER TRACKING =====
function startTracking(orderId) {
  if (S.trackInterval) { clearInterval(S.trackInterval); S.trackInterval = null; }
  try { FirebaseSync.stopListeningToOrder(); } catch(e) {}

  // Run initial status poll from GAS to fetch data first time
  pollStatus(orderId, true);

  // Bind Firebase Realtime listener for instant updates
  try {
    FirebaseSync.listenToOrder(orderId, (orderData) => {
      if (orderData) {
        updateTrackingUI(orderData);
        
        // Push notification popup & sound to customer on status change
        if (S._lastTrackedStatus && S._lastTrackedStatus !== orderData.status) {
          const statusMsgs = {
            'Preparing': '👨‍🍳 Your order is being prepared by our chef!',
            'Ready': '🎉 Your food is READY! Please collect it.',
            'Completed': '✅ Order completed. Thank you!'
          };
          if (statusMsgs[orderData.status]) {
            showToast(statusMsgs[orderData.status], 'success');
            try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH+Jj4WBfXx9gYeOkI2Jh4aIjJGUko+Nh4WGiY6UmJaSjomGhYaKkZibmpiTjYeFhYmPl5yenJiSjIiFhYqSmZ6gnpqUjoqHh4uUm6Chn5yXkY2Kio2Wnp+fnZqWkY6MjZGZnp6dnJmVkY+OkZabnZ2cm5mWlJKSlZqdnJycm5qYlpWUl5udnJycm5qZl5aWmZydnJycm5qZmJeYm52cnJybm5qZmJibnZ2dnJybm5qamZqcnZ2cnJybm5ubm5ydnZ2cnJybm5ubm5ydnZ2cnJybm5ubnJ2dnZ2cnJyb').play() } catch (e) {}
          }
        }
        S._lastTrackedStatus = orderData.status;
      }
    });
  } catch(e) {
    console.error("Firebase tracking listener subscription failed:", e);
  }
}

async function pollStatus(orderId, syncToFirebase = false) {
  try {
    const r = await callServer('getOrderStatus', orderId);
    if (r.success) {
      updateTrackingUI(r.data);
      if (syncToFirebase) {
        try {
          FirebaseSync.pushOrder({
            orderId: r.data.orderId,
            status: r.data.status,
            table: r.data.table,
            customerName: r.data.customerName,
            customerPhone: r.data.customerPhone,
            items: r.data.items,
            total: r.data.total,
            paymentStatus: r.data.paymentStatus,
            timestamp: r.data.timestamp,
            specialInstructions: r.data.specialInstructions,
            discountAmount: r.data.discountAmount,
            appliedOffer: r.data.appliedOffer
          });
        } catch(fberr) {
          console.error("Error syncing during pollStatus:", fberr);
        }
      }
    }
  } catch (e) {
    console.error("Error fetching order status:", e);
  }
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
  if (data.discountAmount > 0) {
    html += '<div class="tracking-item" style="color:var(--success); border-top: 1px dashed var(--border); padding-top: 8px;"><span>🏷️ Discount (' + (data.appliedOffer || 'Coupon') + ')</span><span>-₹' + data.discountAmount.toFixed(2) + '</span></div>';
  }
  html+='<div class="tracking-total"><span>Total</span><span>₹'+data.total.toFixed(2)+'</span></div>';
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
  const isPostpaidMode = S.config && S.config.paymentTiming === 'postpaid';
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
    } else if (isPostpaidMode) {
      // POSTPAID MODE: No payment prompt — show dine-in message
      paymentPromptEl.innerHTML = 
        '<div class="payment-prompt-card glass mt-4" style="padding:18px; border: 1px solid rgba(251, 191, 36, 0.3); text-align: center; background: rgba(251, 191, 36, 0.06)">' +
          '<div style="font-size: 1.8rem; margin-bottom: 8px;">🍽️</div>' +
          '<div style="font-size: 1.05rem; color: var(--secondary); font-weight: bold; margin-bottom: 6px;">Pay After Dining</div>' +
          '<p style="font-size: 0.82rem; color: var(--text2); line-height: 1.5;">Enjoy your meal! Payment of <strong>₹' + data.total + '</strong> will be collected at the counter after you finish dining.</p>' +
        '</div>';
    } else {
      // PREPAID MODE: Payment Pending
      const outstanding = Math.max(0, Math.round((data.total - (data.amountPaid || 0)) * 100) / 100);
      if (outstanding <= 0 && data.paymentStatus !== 'Paid') {
        paymentPromptEl.innerHTML = 
          '<div class="payment-prompt-card glass mt-4" style="padding:16px; border: 1px solid var(--success); text-align: center; background: rgba(34,197,94,0.08)">' +
            '<div style="font-size: 1.2rem; color: var(--success); font-weight: bold; margin-bottom: 4px;">✅ Payment Confirmed</div>' +
            '<p style="font-size: 0.8rem; color: var(--text2);">Your payment has been received.</p>' +
          '</div>';
      } else {
        const payText = (data.amountPaid || 0) > 0 ? 
          `Please complete the payment of the difference amount: <strong>₹${outstanding}</strong>` : 
          `Please complete the payment of <strong>₹${outstanding}</strong> to start preparation.`;
        paymentPromptEl.innerHTML = 
          '<div class="payment-prompt-card glass mt-4" style="padding:16px; border: 1px solid var(--primary); text-align: center; animation: pulse 2s infinite;">' +
            '<div style="font-size: 1.3rem; margin-bottom: 8px;">⏳ Payment Required</div>' +
            '<p style="font-size: 0.85rem; color: var(--text2); margin-bottom: 12px;">' + payText + '</p>' +
            '<button class="btn btn-primary btn-block" style="background: linear-gradient(135deg, var(--primary), var(--secondary));" onclick="openPaymentPage(\'' + data.orderId + '\', ' + outstanding + ')">💳 Pay Now</button>' +
          '</div>';
      }
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
    specialInstructions: $('checkout-notes') ? $('checkout-notes').value : '',
    appliedOfferCode: S.appliedOffer ? S.appliedOffer.code : '',
    discountAmount: S.discountAmount || 0
  };

  try {
    const r = await callServer('reviseOrder', data.orderId, data);
    hideLoader();
    if (r.success) {
      const orderId = S.revisingOrderId;
      S.revisingOrderId = null;
      S.revisingNotes = '';
      S.cart = [];
      S.appliedOffer = null;
      S.discountAmount = 0;
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

  const optionsContainer = $('payment-options-container');
  if (optionsContainer) {
    if (S.config.razorpayEnabled) {
      optionsContainer.innerHTML = `
        <button id="btn-trigger-razorpay" class="btn btn-primary btn-block" style="background: linear-gradient(135deg, #339af0, #228be6); box-shadow: 0 4px 15px rgba(34, 139, 230, 0.3);" onclick="triggerRazorpayPayment()">
          💳 Pay via Razorpay (Card/UPI/Wallet)
        </button>
      `;
    } else {
      const upiId = S.config.ownerUpiId || '';
      const upiName = S.config.ownerUpiName || S.config.restaurantName || 'Merchant';
      
      if (upiId && upiId.includes('@')) {
        const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${parseFloat(amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent('Order ' + orderId)}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUri)}&bgcolor=ffffff&color=1a1a2e&margin=10`;
        
        optionsContainer.innerHTML = `
          <div style="text-align: center; margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--border);">
            <div style="font-size: 0.8rem; color: var(--text2); margin-bottom: 12px; font-weight: 500;">
              Scan QR code with GPay, PhonePe, or Paytm to pay directly
            </div>
            <div style="margin: 0 auto 12px auto; display: block; background: #fff; padding: 10px; border-radius: 8px; width: 180px; height: 180px;">
              <img src="${qrCodeUrl}" alt="UPI QR Code" style="width: 160px; height: 160px; display: block; border-radius: 4px; border: none;">
            </div>
            <div style="font-size: 0.85rem; font-weight: 700; color: #fff; font-family: 'JetBrains Mono', monospace; word-break: break-all;">
              UPI: ${upiId}
            </div>
          </div>
          <button class="btn btn-secondary btn-block" onclick="confirmOfflinePayment()">
            ✅ I have paid / Pay Cash at Counter
          </button>
        `;
      } else {
        optionsContainer.innerHTML = `
          <div style="text-align: center; padding: 20px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); border: 1px solid var(--border); margin-bottom: 20px;">
            <div style="font-size: 1.8rem; margin-bottom: 10px;">💵</div>
            <div style="font-size: 0.85rem; color: var(--text2); font-weight: 500; line-height: 1.5;">
              Online card payment is disabled by the restaurant.<br>
              <strong>Please pay UPI or Cash directly at the counter.</strong>
            </div>
          </div>
          <button class="btn btn-primary btn-block" onclick="confirmOfflinePayment()">
            👍 Done / Pay Cash
          </button>
        `;
      }
    }
  }
  
  navigateTo('payment');
}

function confirmOfflinePayment() {
  showToast('Offline payment/cash request recorded! Please wait for approval.', 'success');
  navigateTo('tracking');
  startTracking(S.payingOrderId);
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
            try { FirebaseSync.updatePaymentStatus(S.payingOrderId, 'Paid'); } catch(e) {}
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
      showLoader('Authenticating real-time sync...');
      try {
        await FirebaseSync.loginAdmin();
      } catch(e) {
        console.error("Firebase admin login error:", e);
      }
      hideLoader();
      hide('admin-login-screen');
      show('admin-dashboard');
      // Check subscription status for admin
      renderSubscriptionBanner();
      if(S.subscriptionStatus && !S.subscriptionStatus.isActive){
        // Block admin dashboard — only show expired banner
        const dashEl=$('admin-dashboard');
        if(dashEl) dashEl.classList.add('admin-expired-overlay');
      } else {
        // Switch to dashboard home tab upon login
        switchAdminTab(document.querySelector('[data-tab=admin-dashboard-tab]'), 'admin-dashboard-tab');
        startAdminRefresh();
      }
    }
    else showToast(r.message,'error');
  }catch(e){hideLoader();showToast('Login failed','error')}
}
function handleAdminLogout(){
  clearAdminSession();
  if(S.adminInterval)clearInterval(S.adminInterval);
  try { FirebaseSync.logoutAdmin(); } catch(e) {}
  show('admin-login-screen');
  hide('admin-dashboard');
  navigateTo('landing');
}

function switchAdminTab(btn,tabId){
  const isStarter = S.subscriptionStatus && S.subscriptionStatus.isActive && S.subscriptionStatus.plan && S.subscriptionStatus.plan.toLowerCase().includes('starter');
  const restricted = ['admin-addons-tab', 'admin-combos-tab', 'admin-offers-tab'];
  if (isStarter && restricted.includes(tabId)) {
    showToast('Add-ons, Combos, and Offers are not supported on the Starter plan. Please upgrade.', 'warning');
    if (tabId !== 'admin-dashboard-tab') {
      const dashBtn = document.querySelector('.admin-tab[data-tab="admin-dashboard-tab"]');
      switchAdminTab(dashBtn, 'admin-dashboard-tab');
    }
    return;
  }

  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));
  if(btn) btn.classList.add('active');
  
  const tabs = ['admin-dashboard-tab','admin-orders-tab','admin-menu-tab','admin-addons-tab','admin-combos-tab','admin-offers-tab','admin-reports-tab','admin-qr-tab','admin-settings-tab'];
  tabs.forEach(id=>{
    const el=$(id);
    if(el) el.classList.toggle('hidden',id!==tabId);
  });
  
  // Update title
  const titleMap = {
    'admin-dashboard-tab': '📊 Dashboard',
    'admin-orders-tab': '🔔 Orders Queue',
    'admin-menu-tab': '📋 Menu Management',
    'admin-addons-tab': '🧩 Add-Ons Management',
    'admin-combos-tab': '🏷️ Combos Management',
    'admin-offers-tab': '🎁 Offers Management',
    'admin-reports-tab': '📊 Financial Reports',
    'admin-qr-tab': '📱 QR Code Generator',
    'admin-settings-tab': '⚙️ Settings'
  };
  const cleanTitle = titleMap[tabId] || 'Staff Dashboard';
  if ($('admin-desktop-title')) $('admin-desktop-title').textContent = cleanTitle;
  if ($('admin-current-tab-title')) $('admin-current-tab-title').textContent = cleanTitle;

  // Close mobile sidebar
  const sidebar = $('admin-sidebar');
  const overlay = $('admin-sidebar-overlay');
  if (sidebar && sidebar.classList.contains('active')) {
    sidebar.classList.remove('active');
    overlay.classList.remove('active');
  }
  
  if($('admin-orders-search')) $('admin-orders-search').value = '';
  if($('admin-menu-search')) $('admin-menu-search').value = '';
  if($('admin-addons-search')) $('admin-addons-search').value = '';
  if($('admin-combos-search')) $('admin-combos-search').value = '';
  if($('admin-offers-search')) $('admin-offers-search').value = '';

  // Show PWA install button in admin panel if supported
  const adminInstallBtn = $('admin-sidebar-install');
  if (adminInstallBtn) {
    const isSupported = deferredPrompt || (typeof isIOSDevice === 'function' && isIOSDevice() && !isAppInstalled());
    adminInstallBtn.style.display = isSupported ? 'flex' : 'none';
  }

  if(tabId==='admin-dashboard-tab')loadAdminData();
  if(tabId==='admin-menu-tab')loadAdminMenu();
  if(tabId==='admin-addons-tab')loadAdminAddOns();
  if(tabId==='admin-combos-tab')loadAdminCombos();
  if(tabId==='admin-offers-tab')loadAdminOffers();
  if(tabId==='admin-reports-tab')initReportsTab();
  if(tabId==='admin-qr-tab')initQRTab();
  if(tabId==='admin-settings-tab')loadAdminSettings();
}

function toggleAdminSidebar() {
  const sidebar = $('admin-sidebar');
  const overlay = $('admin-sidebar-overlay');
  if (sidebar && overlay) {
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
  }
}

function animateCounter(el, targetValue) {
  if (!el) return;
  const duration = 600; // ms
  const isCurrency = el.textContent.includes('₹') || (typeof targetValue === 'string' && targetValue.includes('₹')) || el.id.includes('revenue') || el.id.includes('avg');
  const startText = el.textContent || '0';
  const start = parseInt(startText.replace(/[^0-9]/g, ''), 10) || 0;
  const target = typeof targetValue === 'string' ? parseInt(targetValue.replace(/[^0-9]/g, ''), 10) || 0 : targetValue;
  
  if (start === target) {
    el.textContent = isCurrency ? '₹' + target : target;
    return;
  }
  
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = progress * (2 - progress);
    const current = Math.floor(start + (target - start) * ease);
    
    el.textContent = isCurrency ? '₹' + current : current;
    
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = isCurrency ? '₹' + target : target;
    }
  }
  
  requestAnimationFrame(update);
}

function renderDashboardInsights(stats, orders) {
  // Stats update
  animateCounter($('stat-total-new'), stats.totalOrders || 0);
  animateCounter($('stat-revenue-new'), stats.totalRevenue || 0);
  animateCounter($('stat-active-new'), stats.activeOrders || 0);
  animateCounter($('stat-completed-new'), stats.completedOrders || 0);
  animateCounter($('stat-avg-new'), stats.avgOrderValue || 0);
  
  const topItem = stats.popularItems && stats.popularItems.length > 0 ? stats.popularItems[0].name : 'None';
  if ($('stat-popular-new')) {
    $('stat-popular-new').textContent = topItem;
    $('stat-popular-new').title = topItem; // tooltip for long names
  }

  // Chart rendering
  const chartContainer = $('popular-items-chart-container');
  if (chartContainer) {
    if (!stats.popularItems || !stats.popularItems.length) {
      chartContainer.innerHTML = '<div class="empty-state"><div class="empty-icon">🍳</div><p>No orders processed today to display popularity metrics.</p></div>';
    } else {
      const maxCount = Math.max(...stats.popularItems.map(i => i.count));
      chartContainer.innerHTML = '<div class="popular-items-chart">' + 
        stats.popularItems.map(item => {
          const percentage = maxCount > 0 ? Math.round((item.count / maxCount) * 100) : 0;
          return `
            <div class="chart-bar-row">
              <div class="chart-bar-info">
                <span class="chart-bar-name">${item.name}</span>
                <span class="chart-bar-qty">${item.count} sold</span>
              </div>
              <div class="chart-bar-track">
                <div class="chart-bar-fill" style="width: ${percentage}%"></div>
              </div>
            </div>
          `;
        }).join('') +
      '</div>';
    }
  }

  // Operations metrics
  const compRate = stats.totalOrders > 0 ? Math.round((stats.completedOrders / stats.totalOrders) * 100) : 0;
  if ($('metric-completion-rate')) $('metric-completion-rate').textContent = compRate + '%';
  if ($('metric-completion-fill')) $('metric-completion-fill').style.width = compRate + '%';

  // Payment settled rate calculation
  const liveOrders = orders || [];
  const totalVisible = liveOrders.length;
  const paidVisible = liveOrders.filter(o => o.paymentStatus === 'Paid').length;
  const completedPaid = stats.completedOrders || 0;
  const totalAll = totalVisible + completedPaid;
  const paidAll = paidVisible + completedPaid;
  const payRate = totalAll > 0 ? Math.round((paidAll / totalAll) * 100) : 0;

  if ($('metric-payment-rate')) $('metric-payment-rate').textContent = payRate + '%';
  if ($('metric-payment-fill')) $('metric-payment-fill').style.width = payRate + '%';

  // Recent orders preview rendering
  const recentList = $('admin-recent-orders-list');
  if (recentList) {
    const activeOrders = liveOrders.filter(o => o.status !== 'Completed').slice(0, 3);
    if (!activeOrders.length) {
      recentList.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>No active orders in the queue.</p></div>';
    } else {
      recentList.innerHTML = activeOrders.map(o => {
        const itemsStr = (o.items || []).map(i => i.name + ' × ' + i.qty).join(', ');
        const statusBadgeClass = 'status-' + o.status;
        return `
          <div class="recent-order-preview-card">
            <div class="ropc-info">
              <div class="ropc-title">
                <span class="ropc-id">${o.orderId}</span>
                <span class="ropc-table">Table ${o.table || 'Takeaway'}</span>
                <span class="status-badge ${statusBadgeClass.toLowerCase()}" style="font-size:0.65rem;padding:2px 6px">${o.status}</span>
              </div>
              <div class="ropc-details" title="${itemsStr}">${itemsStr}</div>
              <div class="ropc-meta">
                <span>₹${o.total}</span> • <span>${o.elapsed}</span>
              </div>
            </div>
            <div class="ropc-actions">
              <button class="btn btn-secondary btn-sm" style="margin-bottom:0;padding:4px 8px;font-size:0.75rem" onclick="switchAdminTab(document.querySelector('[data-tab=admin-orders-tab]'), 'admin-orders-tab')">Manage</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// ===== ADMIN COMBO MANAGEMENT =====
function resolveComboProperties() {
  const menuItems = [];
  if (S.adminMenu && S.adminMenu.length) {
    menuItems.push(...S.adminMenu);
  }
  if (S.menu) {
    for (const cat in S.menu) {
      if (Array.isArray(S.menu[cat])) {
        menuItems.push(...S.menu[cat]);
      }
    }
  }

  (S.combos || []).forEach(c => {
    c.includedItems = c.items || '';
    const itemIds = (c.items || '').split(',').map(s => s.trim());
    const names = itemIds.map(id => {
      const match = menuItems.find(item => item.id === id);
      return match ? match.name : '';
    }).filter(Boolean);
    c.includedNames = names.join(', ');
  });
}

async function loadAdminCombos() {
  const searchInput = $('admin-combos-search');
  if (searchInput && document.activeElement === searchInput) return;
  
  try {
    if (!S.adminMenu || !S.adminMenu.length) {
      const menuRes = await callServer('getAllMenuItems');
      if (menuRes.success) {
        S.adminMenu = menuRes.data;
      }
    }
    
    const r = await callServer('getAllCombos');
    if (r.success) {
      S.combos = r.data;
      resolveComboProperties();
      renderAdminCombos();
    }
  } catch(e) {
    showToast('Failed to load combos', 'error');
  }
}

function renderAdminCombos() {
  const listEl = $('admin-combos-list');
  if (!listEl) return;
  
  const query = $('admin-combos-search') ? $('admin-combos-search').value.toLowerCase().trim() : '';
  const combos = S.combos || [];
  
  let filtered = combos;
  if (query) {
    filtered = combos.filter(c => 
      c.name.toLowerCase().includes(query) ||
      (c.includedNames || '').toLowerCase().includes(query)
    );
  }
  
  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>No combos found</p></div>';
    return;
  }
  
  listEl.innerHTML = filtered.map(c => {
    const imgHtml = c.image ? `<img src="${c.image}" alt="${c.name}" style="width:40px;height:40px;object-fit:cover;border-radius:6px">` : '<span style="font-size:1.5rem">🍱</span>';
    const statusText = c.available ? 'Active' : 'Disabled';
    const statusClass = c.available ? 'status-ready' : 'status-received';
    
    return `
      <div class="admin-menu-item" style="padding: 12px 16px;">
        <div style="display:flex;align-items:center;gap:12px;flex:1">
          <div class="ami-img" style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:var(--bg2);border-radius:6px">${imgHtml}</div>
          <div class="ami-info">
            <h4 style="font-size:0.95rem;color:var(--text1)">${c.name}</h4>
            <div class="ami-meta" style="font-size:0.75rem;color:var(--text3);margin-top:2px">
              Price: <strong>₹${c.price}</strong> | Items: ${c.includedNames || 'None'}
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="status-badge ${statusClass}" style="font-size:0.65rem">${statusText}</span>
          <label class="toggle-switch">
            <input type="checkbox" ${c.available ? 'checked' : ''} onchange="toggleComboAvail('${c.id}')">
            <span class="slider"></span>
          </label>
          <button class="btn btn-ghost btn-sm" onclick="showEditComboModal('${c.id}', '${encodeURIComponent(JSON.stringify(c))}')">✏️</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--error)" onclick="deleteAdminCombo('${c.id}', '${c.name.replace(/'/g,"\\'")}')">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function filterComboChecklistItems() {
  const query = ($('combo-items-search') ? $('combo-items-search').value : '').toLowerCase().trim();
  const checklist = document.querySelector('.combo-items-checklist');
  if (!checklist) return;
  const labels = checklist.querySelectorAll('label');
  const headers = checklist.querySelectorAll('.checklist-cat-header');
  
  const catVisible = {};
  
  labels.forEach(label => {
    const itemName = (label.getAttribute('data-item-name') || '').toLowerCase();
    const itemCat = label.getAttribute('data-item-category') || '';
    const matches = itemName.includes(query);
    label.style.setProperty('display', matches ? 'flex' : 'none', 'important');
    if (matches) {
      catVisible[itemCat] = true;
    }
  });
  
  headers.forEach(hdr => {
    const cat = hdr.getAttribute('data-category') || '';
    hdr.style.display = catVisible[cat] ? 'block' : 'none';
  });
}

function getMenuListCheckboxes(selectedIds = []) {
  const items = S.adminMenu || [];
  if (!items.length) return '<p style="color:var(--text3);font-size:0.8rem">No menu items found. Please add menu items first.</p>';
  
  const groups = {};
  items.forEach(it => {
    if (!groups[it.category]) groups[it.category] = [];
    groups[it.category].push(it);
  });
  
  let html = `
    <div style="margin-bottom: 8px;">
      <input type="text" id="combo-items-search" placeholder="🔍 Search menu items..." oninput="filterComboChecklistItems()" style="width:100%; padding: 8px 12px; font-size: 0.82rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text); outline: none;">
    </div>
    <div class="combo-items-checklist">
  `;
  for (const cat in groups) {
    const cleanCat = cat.replace(/"/g, '&quot;');
    html += `<div class="checklist-cat-header" data-category="${cleanCat}" style="font-weight:bold;font-size:0.75rem;color:var(--primary);margin:6px 0 4px 0">${cat}</div>`;
    groups[cat].forEach(it => {
      const checked = selectedIds.includes(it.id) ? 'checked' : '';
      const cleanName = it.name.replace(/"/g, '&quot;');
      html += `
        <label data-item-name="${cleanName}" data-item-category="${cleanCat}">
          <input type="checkbox" class="combo-item-chk" value="${it.id}" ${checked}>
          <span>${it.name} (₹${it.price})</span>
        </label>
      `;
    });
  }
  html += '</div>';
  return html;
}

function showAddComboModal() {
  const checklistHtml = getMenuListCheckboxes();
  const html = `
    <div class="modal-header">
      <h3>Add Custom Combo / Bundle</h3>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body-scrollable" style="max-height:60vh; overflow-y:auto; padding-right:6px; margin-bottom:16px;">
      <div class="input-group">
        <label>Combo Name</label>
        <input id="co-name" placeholder="e.g. Burger + Fries + Coke Combo">
      </div>
      <div class="input-group">
        <label>Description (optional)</label>
        <input id="co-desc" placeholder="Short description of the combo">
      </div>
      <div class="input-group">
        <label>Combo Price (₹)</label>
        <input id="co-price" type="number" placeholder="0">
      </div>
      <div class="input-group" style="margin-bottom:16px;">
        <label>Select Included Items</label>
        ${checklistHtml}
      </div>
      <div class="input-group" style="margin-bottom:0;">
        <label>Image URL (optional)</label>
        <input id="co-img" placeholder="https://...">
      </div>
    </div>
    <div class="modal-footer" style="padding-top:12px; border-top:1px solid var(--border)">
      <button class="btn btn-primary btn-block" onclick="saveNewCombo()">Create Combo</button>
    </div>
  `;
  $('modal-content').innerHTML = html;
  $('modal-overlay').classList.add('active');
}

function showEditComboModal(id, encoded) {
  const combo = JSON.parse(decodeURIComponent(encoded));
  const selectedIds = (combo.includedItems || '').split(',').map(s => s.trim());
  const checklistHtml = getMenuListCheckboxes(selectedIds);
  const html = `
    <div class="modal-header">
      <h3>Edit Combo</h3>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body-scrollable" style="max-height:60vh; overflow-y:auto; padding-right:6px; margin-bottom:16px;">
      <div class="input-group">
        <label>Combo Name</label>
        <input id="co-name" value="${combo.name || ''}" placeholder="Combo name">
      </div>
      <div class="input-group">
        <label>Description (optional)</label>
        <input id="co-desc" value="${combo.description || ''}" placeholder="Short description of the combo">
      </div>
      <div class="input-group">
        <label>Combo Price (₹)</label>
        <input id="co-price" type="number" value="${combo.price || ''}" placeholder="0">
      </div>
      <div class="input-group" style="margin-bottom:16px;">
        <label>Select Included Items</label>
        ${checklistHtml}
      </div>
      <div class="input-group" style="margin-bottom:0;">
        <label>Image URL</label>
        <input id="co-img" value="${combo.image || ''}" placeholder="https://...">
      </div>
    </div>
    <div class="modal-footer" style="padding-top:12px; border-top:1px solid var(--border)">
      <button class="btn btn-primary btn-block" onclick="saveEditCombo('${id}')">Save Changes</button>
    </div>
  `;
  $('modal-content').innerHTML = html;
  $('modal-overlay').classList.add('active');
}

async function saveNewCombo() {
  const name = $('co-name').value;
  const description = $('co-desc').value;
  const price = parseFloat($('co-price').value);
  const image = $('co-img').value;
  
  const checkedBoxes = document.querySelectorAll('.combo-item-chk:checked');
  const includedIds = Array.from(checkedBoxes).map(cb => cb.value);
  const includedItemsStr = includedIds.join(',');
  
  if (!name || isNaN(price)) {
    return showToast('Name and price are required', 'error');
  }
  if (includedIds.length === 0) {
    return showToast('Please select at least one included item', 'error');
  }
  
  const data = {
    name,
    description,
    price,
    items: includedItemsStr,
    image,
    available: true
  };
  
  showLoader('Creating combo...');
  try {
    const r = await callServer('addCombo', data);
    hideLoader();
    if (r.success) {
      showToast('Combo created successfully! 🎉', 'success');
      closeModal();
      loadAdminCombos();
    } else {
      showToast(r.message || 'Failed to create combo', 'error');
    }
  } catch(e) {
    hideLoader();
    showToast('Failed to connect to server', 'error');
  }
}

async function saveEditCombo(id) {
  const name = $('co-name').value;
  const description = $('co-desc').value;
  const price = parseFloat($('co-price').value);
  const image = $('co-img').value;
  
  const checkedBoxes = document.querySelectorAll('.combo-item-chk:checked');
  const includedIds = Array.from(checkedBoxes).map(cb => cb.value);
  const includedItemsStr = includedIds.join(',');
  
  if (!name || isNaN(price)) {
    return showToast('Name and price are required', 'error');
  }
  if (includedIds.length === 0) {
    return showToast('Please select at least one included item', 'error');
  }
  
  const data = {
    id,
    name,
    description,
    price,
    items: includedItemsStr,
    image,
    available: true
  };
  
  showLoader('Saving combo...');
  try {
    const r = await callServer('updateCombo', data);
    hideLoader();
    if (r.success) {
      showToast('Combo updated successfully! 🎉', 'success');
      closeModal();
      loadAdminCombos();
    } else {
      showToast(r.message || 'Failed to save combo', 'error');
    }
  } catch(e) {
    hideLoader();
    showToast('Failed to connect to server', 'error');
  }
}

async function toggleComboAvail(id) {
  const combo = (S.combos || []).find(c => c.id === id);
  if (!combo) return;
  
  combo.available = !combo.available;
  renderAdminCombos();
  
  try {
    const r = await callServer('updateCombo', {
      id: combo.id,
      name: combo.name,
      description: combo.description || '',
      price: combo.price,
      items: combo.items || combo.includedItems || '',
      image: combo.image,
      available: combo.available
    });
    if (r.success) {
      showToast('Combo availability updated! 🎉', 'success');
      loadAdminCombos();
    } else {
      showToast(r.message || 'Failed to update availability', 'error');
      combo.available = !combo.available;
      renderAdminCombos();
    }
  } catch(e) {
    showToast('Network error, reverted change', 'error');
    combo.available = !combo.available;
    renderAdminCombos();
  }
}

async function deleteAdminCombo(id, name) {
  if (!confirm(`Are you sure you want to delete combo "${name}"?`)) return;
  
  showLoader('Deleting combo...');
  try {
    const r = await callServer('deleteCombo', id);
    hideLoader();
    if (r.success) {
      showToast('Combo deleted successfully! 🎉', 'success');
      loadAdminCombos();
    } else {
      showToast(r.message || 'Failed to delete combo', 'error');
    }
  } catch(e) {
    hideLoader();
    showToast('Failed to delete combo', 'error');
  }
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
    if(stats.success){
      const d=stats.data;
      $('stat-total').textContent=d.totalOrders;
      $('stat-revenue').textContent='₹'+d.totalRevenue;
      $('stat-active').textContent=d.activeOrders;
      $('stat-avg').textContent='₹'+d.avgOrderValue;
      
      // Trigger animated updates and insights render
      renderDashboardInsights(d, S.adminOrders);

      if(orders.success&&orders.data.length>S.adminOrderCount&&S.adminOrderCount>0)try{new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH+Jj4WBfXx9gYeOkI2Jh4aIjJGUko+Nh4WGiY6UmJaSjomGhYaKkZibmpiTjYeFhYmPl5yenJiSjIiFhYqSmZ6gnpqUjoqHh4uUm6Chn5yXkY2Kio2Wnp+fnZqWkY6MjZGZnp6dnJmVkY+OkZabnZ2cm5mWlJKSlZqdnJycm5qYlpWUl5udnJycm5qZl5aWmZydnJycm5qZmJeYm52cnJybm5qZmJibnZ2dnJybm5qamZqcnZ2cnJybm5ubm5ydnZ2cnJybm5ubm5ydnZ2cnJybm5ubnJ2dnZ2cnJyb').play()}catch(e){}
      S.adminOrderCount=orders.success?orders.data.length:0
    }
  }catch(e){showToast('Failed to load data','error')}
}

function filterAdminOrders() {
  renderAdminOrders(S.adminOrders || []);
}

function setAdminOrderTypeFilter(type) {
  S.adminOrderTypeFilter = type;
  document.querySelectorAll('.order-type-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-type') === type);
  });
  renderAdminOrders(S.adminOrders || []);
}

function renderAdminOrders(orders){
  const el=$('admin-orders-list');
  if(!el) return;
  if(!orders || !orders.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">🎉</div><p>No active orders</p></div>';return}
  
  const query = $('admin-orders-search') ? $('admin-orders-search').value.toLowerCase().trim() : '';
  const typeFilter = S.adminOrderTypeFilter || 'ALL';

  let filtered = orders;

  if (typeFilter !== 'ALL') {
    filtered = filtered.filter(o => {
      const mode = (o.orderType || (o.table ? 'DINE_IN' : 'TAKEAWAY')).toUpperCase();
      return mode === typeFilter;
    });
  }

  if(query){
    filtered = filtered.filter(o => 
      o.orderId.toLowerCase().includes(query) ||
      (o.customerName || '').toLowerCase().includes(query) ||
      (o.customerPhone || '').toLowerCase().includes(query) ||
      (o.status || '').toLowerCase().includes(query) ||
      (o.paymentStatus || '').toLowerCase().includes(query) ||
      (o.deliveryAddress || '').toLowerCase().includes(query) ||
      (o.table || 'takeaway').toString().toLowerCase().includes(query) ||
      (o.items || []).some(i => i.name.toLowerCase().includes(query))
    );
  }

  if(!filtered.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">🔍</div><p>No matching orders</p></div>';return}
  
  el.innerHTML=filtered.map(o=>{
    const items=(o.items||[]).map(i=>i.name+' × '+i.qty).join(', ');
    const orderType = (o.orderType || (o.table ? 'DINE_IN' : 'TAKEAWAY')).toUpperCase();
    
    let typeBadge = '';
    if (orderType === 'DELIVERY') {
      typeBadge = '<span class="status-badge" style="background:rgba(59,130,246,0.15);color:#3b82f6;border:1px solid rgba(59,130,246,0.3);margin-left:6px;font-weight:700">🛵 DELIVERY</span>';
    } else if (orderType === 'TAKEAWAY') {
      typeBadge = '<span class="status-badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);margin-left:6px;font-weight:700">🛍️ TAKEAWAY</span>';
    } else {
      typeBadge = '<span class="status-badge" style="background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);margin-left:6px;font-weight:700">🍽️ DINE-IN</span>';
    }

    let btns='';
    if(o.status==='Received')btns='<button class="btn btn-warning btn-sm" onclick="promptPreparingETA(\''+o.orderId+'\')">👨‍🍳 Start Preparing</button>';
    if(o.status==='Preparing')btns='<button class="btn btn-success btn-sm" onclick="updateStatus(\''+o.orderId+'\',\'Ready\')">✅ Mark Ready</button>';
    if(o.status==='Ready')btns='<button class="btn btn-secondary btn-sm" onclick="updateStatus(\''+o.orderId+'\',\'Completed\')">✔️ Complete</button>';
    
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

    let deliveryInfoHtml = '';
    if (orderType === 'DELIVERY') {
      const delStatus = o.deliveryStatus || 'Pending';
      const mapLink = (o.deliveryLat && o.deliveryLng) ? `<a href="https://maps.google.com/?q=${o.deliveryLat},${o.deliveryLng}" target="_blank" style="color:var(--primary);margin-left:6px;text-decoration:none">📍 View Map</a>` : '';
      deliveryInfoHtml = `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:var(--radius-xs);padding:8px 12px;margin:8px 0;font-size:0.8rem">
          <div style="font-weight:600;color:var(--text1);margin-bottom:4px">🏠 Address: ${o.deliveryAddress || 'Not provided'}${o.deliveryLandmark ? ' (Landmark: ' + o.deliveryLandmark + ')' : ''}${mapLink}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <span style="color:var(--text2);font-weight:500">Delivery Status:</span>
            <select class="delivery-status-select" onchange="updateDeliveryStatus('${o.orderId}', this.value)" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text1);font-size:0.75rem;font-weight:600">
              <option value="Pending" ${delStatus === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
              <option value="Assigned" ${delStatus === 'Assigned' ? 'selected' : ''}>🛵 Assigned Rider</option>
              <option value="Out for Delivery" ${delStatus === 'Out for Delivery' ? 'selected' : ''}>🚚 Out for Delivery</option>
              <option value="Delivered" ${delStatus === 'Delivered' ? 'selected' : ''}>✅ Delivered</option>
            </select>
          </div>
        </div>
      `;
    }

    const locText = orderType === 'DELIVERY' ? '🛵 Delivery' : (orderType === 'TAKEAWAY' ? '🛍️ Takeaway' : '📍 Table ' + (o.table || '1'));

    return '<div class="admin-order '+sc+'"><div class="ao-top"><span class="ao-id">'+o.orderId+'</span><span class="ao-time">'+o.elapsed+'</span></div><div class="ao-meta"><span>'+locText+'</span>'+typeBadge+'<span>👤 '+o.customerName+(o.customerPhone ? ' | 📞 <a href="tel:'+o.customerPhone+'" style="color:inherit;text-decoration:none">'+o.customerPhone+'</a>' : '')+'</span><span class="status-badge '+sc.toLowerCase()+'">'+o.status+'</span>'+payBadge+'</div>'+deliveryInfoHtml+'<div class="ao-items">'+items+'</div>'+(o.specialInstructions?'<div class="ao-instructions">📝 '+o.specialInstructions+'</div>':'')+'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><span style="font-weight:700;color:var(--primary)">₹'+o.total+'</span><div class="ao-actions">'+btns+'</div></div></div>'
  }).join('')
}

async function updateDeliveryStatus(id, deliveryStatus) {
  try {
    const r = await callServer('updateDeliveryStatus', id, deliveryStatus);
    if (r.success) {
      showToast('Delivery status updated to ' + deliveryStatus, 'success');
      try { FirebaseSync.updateDeliveryStatus(id, deliveryStatus); } catch(e) {}
      loadAdminData();
    } else {
      showToast(r.message || 'Failed to update delivery status', 'error');
    }
  } catch(e) {
    showToast('Failed to update delivery status', 'error');
  }
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
      try { FirebaseSync.updateOrderStatus(orderId, 'Preparing', minutes); } catch(e) {}
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
      try { FirebaseSync.updatePaymentStatus(orderId, 'Refunded'); } catch(e) {}
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
  try{
    const r=await callServer('updateOrderStatus',id,status,etaMinutes);
    if(r.success){
      showToast(r.message,'success');
      try { FirebaseSync.updateOrderStatus(id, status, etaMinutes); } catch(e) {}
      loadAdminData();
    }else showToast(r.message,'error')
  }catch(e){showToast('Update failed','error')}
}

async function deleteAdminOrder(id){
  if(!confirm('Are you sure you want to permanently delete order '+id+'? This action cannot be undone.'))return;
  showLoader('Deleting order...');
  try{
    const r=await callServer('deleteOrder',id);
    hideLoader();
    if(r.success){
      showToast(r.message,'success');
      try { FirebaseSync.deleteOrder(id); } catch(e) {}
      loadAdminData();
    }else{
      showToast(r.message,'error');
    }
  }catch(e){
    hideLoader();
    showToast('Failed to delete order','error');
  }
}

function startAdminRefresh() {
  if (S.adminInterval) { clearInterval(S.adminInterval); S.adminInterval = null; }
  try { FirebaseSync.stopListeningToLiveOrders(); } catch(e) {}
  
  // Load initially once
  loadAdminData();
  
  // Subscribe to real-time updates for all live orders
  try {
    FirebaseSync.listenToLiveOrders((allOrders) => {
      if (!allOrders) {
        S.adminOrders = [];
        renderAdminOrders([]);
        return;
      }
      
      // Filter out completed ones, keep sorting
      const liveOrders = Object.values(allOrders)
        .filter(o => o.status && o.status !== 'Completed')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
      // Sound alert for new incoming orders
      if (liveOrders.length > S.adminOrderCount && S.adminOrderCount > 0) {
        showToast('🔔 New order received!', 'success');
        try {
          new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH+Jj4WBfXx9gYeOkI2Jh4aIjJGUko+Nh4WGiY6UmJaSjomGhYaKkZibmpiTjYeFhYmPl5yenJiSjIiFhYqSmZ6gnpqUjoqHh4uUm6Chn5yXkY2Kio2Wnp+fnZqWkY6MjZGZnp6dnJmVkY+OkZabnZ2cm5mWlJKSlZqdnJycm5qYlpWUl5udnJycm5qZl5aWmZydnJycm5qZmJeYm52cnJybm5qZmJibnZ2dnJybm5qamZqcnZ2cnJybm5ubm5ydnZ2cnJybm5ubm5ydnZ2cnJybm5ubnJ2dnZ2cnJyb').play();
        } catch (e) {}
      }
      S.adminOrders = liveOrders;
      S.adminOrderCount = liveOrders.length;
      renderAdminOrders(liveOrders);
    });
  } catch (err) {
    console.error("Firebase admin live orders listener failed:", err);
  }
  
  // Stats and insights update periodically (every 60 seconds)
  S.adminInterval = setInterval(async () => {
    try {
      if (isAdminSearching()) return;
      const stats = await callServer('getOrderStats');
      if (stats.success) {
        const d = stats.data;
        $('stat-total').textContent = d.totalOrders;
        $('stat-revenue').textContent = '₹' + d.totalRevenue;
        $('stat-active').textContent = d.activeOrders;
        $('stat-avg').textContent = '₹' + d.avgOrderValue;
        renderDashboardInsights(d, S.adminOrders);
      }
    } catch(e) {}
  }, 60000);
}

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

function getCategorySelectHTML(selectedValue = '') {
  const categories = S.categories && S.categories.length ? S.categories : ['Starters', 'Main Course', 'Breads', 'Beverages', 'Desserts'];
  
  let options = categories.map(cat => {
    const selected = cat === selectedValue ? ' selected' : '';
    return `<option value="${cat}"${selected}>${cat}</option>`;
  });
  
  if (selectedValue && !categories.includes(selectedValue)) {
    options.unshift(`<option value="${selectedValue}" selected>${selectedValue}</option>`);
  }
  
  options.push('<option value="__new__">+ Add New Category...</option>');
  
  return `
    <div class="input-group">
      <label>Category</label>
      <select id="mi-cat" onchange="handleCategorySelection(this.value)">
        ${options.join('')}
      </select>
      <div id="new-category-group" class="hidden" style="margin-top: 10px;">
        <label style="font-size:0.8rem;color:var(--secondary)">New Category Name</label>
        <input id="mi-new-cat" type="text" placeholder="Enter new category name">
      </div>
    </div>
  `;
}

function handleCategorySelection(val) {
  const newCatGroup = $('new-category-group');
  if (newCatGroup) {
    if (val === '__new__') {
      newCatGroup.classList.remove('hidden');
      $('mi-new-cat').focus();
    } else {
      newCatGroup.classList.add('hidden');
      $('mi-new-cat').value = '';
    }
  }
}

function showAddItemModal(){
  const html = '<div class="modal-header"><h3>Add Menu Item</h3><button class="modal-close" onclick="closeModal()">✕</button></div>' +
    getCategorySelectHTML() +
    '<div class="input-group"><label>Name</label><input id="mi-name" placeholder="Item name"></div><div class="input-group"><label>Description</label><input id="mi-desc" placeholder="Short description"></div><div class="input-group"><label>Price (₹) (Single Portion)</label><input id="mi-price" type="number" placeholder="0"></div><div class="input-group"><label>Portions (comma-separated, optional)</label><input id="mi-portions" placeholder="e.g. Half,Full"></div><div class="input-group"><label>Portion Prices (comma-separated, optional)</label><input id="mi-portion-prices" placeholder="e.g. 149,249"></div><div class="input-group"><label>Image URL</label><input id="mi-img" placeholder="https://..."></div><div class="input-group"><label>Type</label><select id="mi-type"><option>Veg</option><option>Non-Veg</option></select></div><button class="btn btn-primary btn-block" onclick="saveNewItem()">Add Item</button>';
  $('modal-content').innerHTML=html;$('modal-overlay').classList.add('active');
}

function showEditItemModal(id,encoded){
  const it=JSON.parse(decodeURIComponent(encoded));
  const html = '<div class="modal-header"><h3>Edit Item</h3><button class="modal-close" onclick="closeModal()">✕</button></div>' +
    getCategorySelectHTML(it.category) +
    '<div class="input-group"><label>Name</label><input id="mi-name" value="'+it.name+'"></div><div class="input-group"><label>Description</label><input id="mi-desc" value="'+(it.description||'')+'"></div><div class="input-group"><label>Price (Single Portion)</label><input id="mi-price" type="number" value="'+it.price+'"></div><div class="input-group"><label>Portions (comma-separated)</label><input id="mi-portions" value="'+(it.portions||'')+'" placeholder="e.g. Half,Full"></div><div class="input-group"><label>Portion Prices (comma-separated)</label><input id="mi-portion-prices" value="'+(it.portionPrices||'')+'" placeholder="e.g. 149,249"></div><div class="input-group"><label>Image URL</label><input id="mi-img" value="'+(it.image||'')+'"></div><div class="input-group"><label>Type</label><select id="mi-type"><option'+(it.type==='Veg'?' selected':'')+'>Veg</option><option'+(it.type==='Non-Veg'?' selected':'')+'>Non-Veg</option></select></div><button class="btn btn-primary btn-block" onclick="saveEditItem(\''+id+'\')">Save Changes</button>';
  $('modal-content').innerHTML=html;$('modal-overlay').classList.add('active');
  handleCategorySelection(it.category);
}

async function saveNewItem(){
  let category = $('mi-cat').value;
  if (category === '__new__') {
    category = ($('mi-new-cat').value || '').trim();
    if (!category) return showToast('New category name required', 'error');
  }
  const data={category,name:$('mi-name').value,description:$('mi-desc').value,price:$('mi-price').value,image:$('mi-img').value,type:$('mi-type').value,portions:$('mi-portions').value,portionPrices:$('mi-portion-prices').value};
  if(!data.name||!data.price)return showToast('Name and price required','error');
  showLoader('Adding...');try{const r=await callServer('addMenuItem',data);hideLoader();if(r.success){showToast('Added!','success');closeModal();loadAdminMenu()}else showToast(r.message,'error')}catch(e){hideLoader();showToast('Failed','error')}
}

async function saveEditItem(id){
  let category = $('mi-cat').value;
  if (category === '__new__') {
    category = ($('mi-new-cat').value || '').trim();
    if (!category) return showToast('New category name required', 'error');
  }
  const data={id,category,name:$('mi-name').value,description:$('mi-desc').value,price:$('mi-price').value,image:$('mi-img').value,type:$('mi-type').value,available:true,portions:$('mi-portions').value,portionPrices:$('mi-portion-prices').value};
  showLoader('Saving...');try{const r=await callServer('updateMenuItem',data);hideLoader();if(r.success){showToast('Saved!','success');closeModal();loadAdminMenu()}else showToast(r.message,'error')}catch(e){hideLoader();showToast('Failed','error')}
}

function closeModal(){$('modal-overlay').classList.remove('active')}
$('modal-overlay').addEventListener('click',e=>{if(e.target===$('modal-overlay'))closeModal()});

async function loadAdminSettings(){
  try{
    const r=await callServer('getInitData');
    if(r.success){
      const d=r.data;
      if ($('admin-sidebar-restaurant-name')) $('admin-sidebar-restaurant-name').textContent = d.restaurantName || 'MenuSarthi';
      $('cfg-name').value=d.restaurantName||'';
      $('cfg-tagline').value=d.restaurantTagline||'';
      $('cfg-logo').value=d.logoUrl||'';
      $('cfg-tables').value=d.totalTables||20;
      $('cfg-upi-id').value=d.ownerUpiId||'';
      $('cfg-upi-name').value=d.ownerUpiName||'';
      $('cfg-gst-enabled').checked=d.gstEnabled===true;
      $('cfg-gst-rate').value=d.gstRate||5;
      $('cfg-gst-number').value=d.gstNumber||'';

      if ($('cfg-dinein-enabled')) $('cfg-dinein-enabled').checked = d.dineInEnabled !== false;
      if ($('cfg-takeaway-enabled')) $('cfg-takeaway-enabled').checked = d.takeawayEnabled !== false;
      if ($('cfg-delivery-enabled')) $('cfg-delivery-enabled').checked = d.deliveryEnabled === true;
      if ($('cfg-delivery-fee')) $('cfg-delivery-fee').value = d.flatDeliveryFee !== undefined ? d.flatDeliveryFee : 40;
      if ($('cfg-free-delivery-threshold')) $('cfg-free-delivery-threshold').value = d.freeDeliveryThreshold !== undefined ? d.freeDeliveryThreshold : 500;

      const isStarter = S.subscriptionStatus && S.subscriptionStatus.isActive && S.subscriptionStatus.plan && S.subscriptionStatus.plan.toLowerCase().includes('starter');
      
      const rzpCheckbox = $('cfg-razorpay-enabled');
      const rzpKeyId = $('cfg-razorpay-key-id');
      const rzpKeySecret = $('cfg-razorpay-key-secret');
      const toggleRow = rzpCheckbox ? rzpCheckbox.closest('.gst-toggle-row') : null;
      
      if (isStarter) {
        if (rzpCheckbox) {
          rzpCheckbox.checked = false;
          rzpCheckbox.disabled = true;
        }
        if (rzpKeyId) {
          rzpKeyId.value = '';
          rzpKeyId.disabled = true;
        }
        if (rzpKeySecret) {
          rzpKeySecret.value = '';
          rzpKeySecret.disabled = true;
        }
        
        if (toggleRow && !document.getElementById('rzp-locked-badge')) {
          const badge = document.createElement('span');
          badge.id = 'rzp-locked-badge';
          badge.style.color = '#fa5252';
          badge.style.fontSize = '0.75rem';
          badge.style.fontWeight = 'bold';
          badge.style.marginLeft = '8px';
          badge.style.flex = '1';
          badge.style.textAlign = 'right';
          badge.innerHTML = '🔒 Upgrade to Growth/Premium to unlock';
          toggleRow.insertBefore(badge, toggleRow.querySelector('.toggle-switch'));
        }
      } else {
        if (rzpCheckbox) rzpCheckbox.disabled = false;
        if (rzpKeyId) rzpKeyId.disabled = false;
        if (rzpKeySecret) rzpKeySecret.disabled = false;
        
        const badge = document.getElementById('rzp-locked-badge');
        if (badge) badge.remove();
        
        if (rzpCheckbox) rzpCheckbox.checked = d.razorpayEnabled === true;
        if (rzpKeyId) rzpKeyId.value = d.razorpayKeyId || '';
        if (rzpKeySecret) rzpKeySecret.value = '';
      }
      
      // Payment timing
      const timing = d.paymentTiming || 'prepaid';
      selectPaymentTiming(timing);
      
      loadSubscriptionInSettings();
    }
  }catch(e){}
}

function selectPaymentTiming(mode) {
  $('cfg-payment-timing').value = mode;
  const prepaidCard = $('pt-card-prepaid');
  const postpaidCard = $('pt-card-postpaid');
  if (prepaidCard && postpaidCard) {
    prepaidCard.classList.toggle('active', mode === 'prepaid');
    postpaidCard.classList.toggle('active', mode === 'postpaid');
  }
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
    razorpayKeyId:$('cfg-razorpay-key-id').value,
    paymentTiming:$('cfg-payment-timing').value||'prepaid',
    dineInEnabled: $('cfg-dinein-enabled') ? $('cfg-dinein-enabled').checked : true,
    takeawayEnabled: $('cfg-takeaway-enabled') ? $('cfg-takeaway-enabled').checked : true,
    deliveryEnabled: $('cfg-delivery-enabled') ? $('cfg-delivery-enabled').checked : false,
    flatDeliveryFee: parseFloat($('cfg-delivery-fee') ? $('cfg-delivery-fee').value : 40) || 0,
    freeDeliveryThreshold: parseFloat($('cfg-free-delivery-threshold') ? $('cfg-free-delivery-threshold').value : 500) || 0
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
      S.config.paymentTiming=data.paymentTiming;
      S.config.dineInEnabled=data.dineInEnabled;
      S.config.takeawayEnabled=data.takeawayEnabled;
      S.config.deliveryEnabled=data.deliveryEnabled;
      S.config.flatDeliveryFee=data.flatDeliveryFee;
      S.config.freeDeliveryThreshold=data.freeDeliveryThreshold;
      document.title=data.restaurantName+' — Digital Menu';
      $('landing-name').textContent=data.restaurantName;
      if ($('admin-sidebar-restaurant-name')) $('admin-sidebar-restaurant-name').textContent = data.restaurantName;
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
    S.selectedQRDesign = 'modern';
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
  const design = S.selectedQRDesign || 'modern';
  
  let html = '';
  for (let t = from; t <= to; t++) {
    const tableUrl = baseUrl + '?table=' + t;
    const qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(tableUrl) + '&bgcolor=ffffff&color=1a1a2e&margin=10';

    if (design === 'modern') {
      const bannerUrl = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=500&auto=format&fit=crop&q=80';
      const logoHtml = logoUrl 
        ? '<img src="' + logoUrl + '" alt="Logo">'
        : '<span style="font-size:1.8rem">🍽️</span>';

      html += `
        <div class="qr-card qr-design-modern" id="qr-card-${t}">
          <div class="qr-card-banner">
            <img src="${bannerUrl}" alt="Banner" crossorigin="anonymous">
            <div class="qr-card-table-badge">Table ${t}</div>
          </div>
          <div class="qr-card-logo-container">
            ${logoHtml}
          </div>
          <div class="qr-card-restaurant-name">${restaurantName}</div>
          <div class="qr-card-heading">Today's Menu</div>
          <div class="qr-card-qr-wrapper">
            <img src="${qrApiUrl}" alt="QR Code Table ${t}" loading="lazy" crossorigin="anonymous">
          </div>
          <div class="qr-card-badge-line">Fresh • Hygienic • Delicious</div>
          <div class="qr-card-footer">
            Powered by MenuSarthi
          </div>
          <div class="qr-card-actions">
            <button class="btn btn-ghost btn-sm" style="color:inherit;border:1px solid rgba(128,128,128,0.2)" onclick="printSingleQR(${t})">🖨️ Print</button>
            <button class="btn btn-ghost btn-sm" style="color:inherit;border:1px solid rgba(128,128,128,0.2)" onclick="downloadSingleQR(${t})">📥 Save</button>
          </div>
        </div>
      `;
    } else {
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
    
    /* 0. MODERN */
    .print-design-modern {
      background: #ffffff;
      border: 1px solid #dee2e6;
      color: #1a1a2e;
      padding: 0;
      min-height: 440px;
    }
    .print-design-modern .print-card-banner {
      width: 100%;
      height: 110px;
      position: relative;
      overflow: hidden;
      background: #f1f3f5;
    }
    .print-design-modern .print-card-banner img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .print-design-modern .print-card-table-badge {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: #ffffff;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      font-family: 'Outfit', sans-serif;
    }
    .print-design-modern .print-card-logo-container {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #ffffff;
      border: 3px solid #ffffff;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      margin-top: -30px;
      z-index: 2;
    }
    .print-design-modern .print-card-logo-container img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .print-design-modern .print-card-logo-container span {
      font-size: 24px;
    }
    .print-design-modern .print-card-restaurant-name {
      font-family: 'Outfit', sans-serif;
      font-size: 13px;
      font-weight: 700;
      color: #495057;
      margin-top: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: center;
    }
    .print-design-modern .print-card-heading {
      font-family: 'Outfit', sans-serif;
      font-size: 20px;
      font-weight: 900;
      color: #1a1a2e;
      margin-top: 10px;
      margin-bottom: 6px;
    }
    .print-design-modern .print-card-qr {
      background: #ffffff;
      padding: 10px;
      border-radius: 12px;
      border: 1px solid #dee2e6;
      display: inline-block;
      margin: 4px auto 8px;
    }
    .print-design-modern .print-card-qr img {
      width: 130px;
      height: 130px;
      display: block;
    }
    .print-design-modern .print-card-badge-line {
      font-size: 11px;
      font-weight: 700;
      color: #ff5e14;
      margin-bottom: 10px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      font-family: 'Outfit', sans-serif;
    }
    .print-design-modern .print-card-footer {
      font-size: 9px;
      font-weight: 700;
      color: #868e96;
      margin-bottom: 16px;
      width: 100%;
      text-align: center;
      border-top: 1px solid #f1f3f5;
      padding-top: 10px;
      margin-top: auto;
      text-transform: none;
      letter-spacing: 0.3px;
    }
    
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
  const design = S.selectedQRDesign || 'modern';

  let cardsHtml = '';
  tableNumbers.forEach(t => {
    const tableUrl = baseUrl + '?table=' + t;
    const qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(tableUrl) + '&bgcolor=ffffff&color=1a1a2e&margin=8';

    if (design === 'modern') {
      const bannerUrl = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=500&auto=format&fit=crop&q=80';
      const logoHtml = logoUrl 
        ? '<img src="' + logoUrl + '" alt="Logo">'
        : '<span style="font-size:1.5rem">🍽️</span>';

      cardsHtml += `
        <div class="print-card print-design-modern">
          <div class="print-card-banner">
            <img src="${bannerUrl}" alt="Banner" crossorigin="anonymous">
            <div class="print-card-table-badge">Table ${t}</div>
          </div>
          <div class="print-card-logo-container">
            ${logoHtml}
          </div>
          <div class="print-card-restaurant-name">${restaurantName}</div>
          <div class="print-card-heading">Today's Menu</div>
          <div class="print-card-qr">
            <img src="${qrApiUrl}" alt="QR Table ${t}" crossorigin="anonymous">
          </div>
          <div class="print-card-badge-line">Fresh • Hygienic • Delicious</div>
          <div class="print-card-footer">Powered by MenuSarthi</div>
        </div>
      `;
    } else {
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
    }
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
      <div class="subscription-expired" style="display: flex; flex-direction: column; align-items: center;">
        <div class="sub-banner-icon">🚨</div>
        <div class="sub-banner-title">Subscription Expired</div>
        <div class="sub-banner-desc">
          Your MenuSarthi subscription has expired. Select a plan below and renew instantly to restore your digital menu.
        </div>
        
        <!-- Expired plans container -->
        <div id="expired-plans-container" style="width: 100%; max-width: 500px; margin: 15px auto;">
          <div style="text-align:center; padding:15px; color:var(--text3)">Loading subscription plans...</div>
        </div>
        
        <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
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
    
    // Trigger loading of plans directly on the expired screen
    setTimeout(loadExpiredPlans, 100);
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

function formatSavings(savingsVal) {
  if (!savingsVal) return '';
  const str = savingsVal.toString().trim();
  const num = parseFloat(str);
  if (!isNaN(num) && num > 0 && num < 1) {
    return Math.round(num * 100) + '%';
  }
  if (!isNaN(num) && num >= 1 && !str.includes('%')) {
    return str + '%';
  }
  return str;
}

function getPlanFeaturesHTML(planId) {
  const planKey = planId.toLowerCase();
  if (planKey.includes('starter')) {
    return `
      <ul class="plan-features-list">
        <li><span class="feat-icon feat-yes">✅</span> QR Menu</li>
        <li><span class="feat-icon feat-yes">✅</span> Unlimited Menu</li>
        <li><span class="feat-icon feat-yes">✅</span> Unlimited Scan</li>
        <li><span class="feat-icon feat-yes">✅</span> Basic Ordering</li>
        <li><span class="feat-icon feat-yes">✅</span> Live Order Tracking</li>
        <li><span class="feat-icon feat-no">❌</span> No Addons</li>
        <li><span class="feat-icon feat-no">❌</span> No Combo</li>
        <li><span class="feat-icon feat-no">❌</span> No upselling</li>
        <li><span class="feat-icon feat-no">❌</span> No payment gateway</li>
      </ul>
    `;
  } else if (planKey.includes('growth')) {
    return `
      <ul class="plan-features-list">
        <li><span class="feat-icon feat-yes">✅</span> QR Menu</li>
        <li><span class="feat-icon feat-yes">✅</span> Unlimited Menu</li>
        <li><span class="feat-icon feat-yes">✅</span> Unlimited Scan</li>
        <li><span class="feat-icon feat-yes">✅</span> Basic Ordering</li>
        <li><span class="feat-icon feat-yes">✅</span> Live Order Tracking</li>
        <li><span class="feat-icon feat-yes">✅</span> Restaurant Website</li>
        <li><span class="feat-icon feat-yes">✅</span> Analytics Dashboard</li>
        <li><span class="feat-icon feat-yes">✅</span> Customer Database</li>
        <li><span class="feat-icon feat-yes">✅</span> Table Ordering</li>
        <li><span class="feat-icon feat-yes">✅</span> Payment Integration</li>
        <li><span class="feat-icon feat-yes">✅</span> Unlimited Orders</li>
        <li><span class="feat-icon feat-yes">✅</span> Addons</li>
        <li><span class="feat-icon feat-yes">✅</span> Combo</li>
        <li><span class="feat-icon feat-yes">✅</span> Upselling</li>
        <li><span class="feat-icon feat-yes">✅</span> Offers</li>
        <li><span class="feat-icon feat-no">❌</span> No Custom Domain</li>
      </ul>
    `;
  } else if (planKey.includes('premium')) {
    return `
      <ul class="plan-features-list">
        <li><span class="feat-icon feat-yes">✅</span> QR Menu</li>
        <li><span class="feat-icon feat-yes">✅</span> Unlimited Menu</li>
        <li><span class="feat-icon feat-yes">✅</span> Unlimited Scan</li>
        <li><span class="feat-icon feat-yes">✅</span> Basic Ordering</li>
        <li><span class="feat-icon feat-yes">✅</span> Live Order Tracking</li>
        <li><span class="feat-icon feat-yes">✅</span> Restaurant Website</li>
        <li><span class="feat-icon feat-yes">✅</span> Analytics Dashboard</li>
        <li><span class="feat-icon feat-yes">✅</span> Customer Database</li>
        <li><span class="feat-icon feat-yes">✅</span> Table Ordering</li>
        <li><span class="feat-icon feat-yes">✅</span> Payment Integration</li>
        <li><span class="feat-icon feat-yes">✅</span> Unlimited Orders</li>
        <li><span class="feat-icon feat-yes">✅</span> Addons</li>
        <li><span class="feat-icon feat-yes">✅</span> Combo</li>
        <li><span class="feat-icon feat-yes">✅</span> Upselling</li>
        <li><span class="feat-icon feat-yes">✅</span> Offers</li>
        <li><span class="feat-icon feat-yes">✅</span> Custom Domain</li>
      </ul>
    `;
  }
  return '';
}

function renderPlansGrid(container, plans, isExpiredView) {
  if (!container) return;
  const currentPeriod = S.billingPeriod || 'monthly';
  const tiers = [
    { key: 'starter', name: 'Starter' },
    { key: 'growth', name: 'Growth' },
    { key: 'premium', name: 'Premium' }
  ];

  const sub = S.subscriptionStatus || { plan: '', isActive: false };

  let cardsHtml = '';
  tiers.forEach(tier => {
    const planId = tier.key + '_' + (currentPeriod === 'monthly' ? 'monthly' : 'yearly');
    const p = plans.find(x => x.id === planId) || {
      id: planId,
      name: tier.name + ' - ' + (currentPeriod === 'monthly' ? 'Monthly' : 'Annual'),
      price: tier.key === 'starter' ? (currentPeriod === 'monthly' ? 499 : 4999) : 
             tier.key === 'growth' ? (currentPeriod === 'monthly' ? 999 : 9999) :
             (currentPeriod === 'monthly' ? 1999 : 19999),
      description: currentPeriod === 'monthly' ? '1 Month' : '12 Months',
      savings: currentPeriod === 'yearly' ? '16%' : ''
    };

    const isCurrent = sub.plan && (
      sub.plan.toLowerCase() === p.name.toLowerCase() || 
      sub.plan.toLowerCase() === p.id.toLowerCase() ||
      (sub.plan.toLowerCase().includes(tier.key) && sub.plan.toLowerCase().includes(currentPeriod === 'monthly' ? 'monthly' : 'annual'))
    ) && sub.isActive;

    const isSelected = isExpiredView 
      ? selectedExpiredSubPlanId === p.id 
      : selectedSubPlanId === p.id;

    let cardClass = 'plan-card';
    if (isCurrent) cardClass += ' active';
    if (isSelected) cardClass += ' selected';
    if (tier.key === 'growth') cardClass += ' recommended';

    const savingsHtml = p.savings ? `<div class="plan-savings-badge">Save ${formatSavings(p.savings)}</div>` : '';
    const pricePeriodText = currentPeriod === 'monthly' ? '/month' : '/year';

    cardsHtml += `
      <div class="${cardClass}" id="${isExpiredView ? 'plan-expired-' : 'plan-'}${p.id}" onclick="${isExpiredView ? 'selectExpiredSubPlan' : 'selectSubPlan'}('${p.id}')">
        <div class="plan-name">${tier.name}</div>
        <div class="plan-price">₹${p.price}<span class="price-period">${pricePeriodText}</span></div>
        <div class="plan-duration">${p.description}</div>
        ${savingsHtml}
        ${getPlanFeaturesHTML(tier.key)}
      </div>
    `;
  });

  container.innerHTML = `
    <div class="sub-plans-grid">
      ${cardsHtml}
    </div>
  `;
}

function toggleBillingPeriod(isExpiredView) {
  const toggle = $(isExpiredView ? 'billing-period-toggle-expired' : 'billing-period-toggle');
  if (!toggle) return;
  
  S.billingPeriod = toggle.checked ? 'yearly' : 'monthly';
  
  const labelMonthly = $(isExpiredView ? 'toggle-label-monthly-expired' : 'toggle-label-monthly');
  const labelYearly = $(isExpiredView ? 'toggle-label-yearly-expired' : 'toggle-label-yearly');
  
  if (S.billingPeriod === 'yearly') {
    if (labelMonthly) labelMonthly.classList.remove('active');
    if (labelYearly) labelYearly.classList.add('active');
  } else {
    if (labelMonthly) labelMonthly.classList.add('active');
    if (labelYearly) labelYearly.classList.remove('active');
  }
  
  const plans = S.subscriptionPlans || [];
  if (isExpiredView) {
    const plansGrid = $('expired-plans-grid-inner');
    if (plansGrid) {
      renderPlansGrid(plansGrid, plans, true);
      let newPlanId = selectedExpiredSubPlanId || 'growth_monthly';
      newPlanId = newPlanId.replace(/_(monthly|yearly)/, '_' + S.billingPeriod);
      selectExpiredSubPlan(newPlanId);
    }
  } else {
    const plansGrid = $('cfg-sub-plans-grid-inner');
    if (plansGrid) {
      renderPlansGrid(plansGrid, plans, false);
      let newPlanId = selectedSubPlanId || 'growth_monthly';
      newPlanId = newPlanId.replace(/_(monthly|yearly)/, '_' + S.billingPeriod);
      selectSubPlan(newPlanId);
    }
  }
}

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

      S.subscriptionStatus = sub;
      S.subscriptionPlans = plans;
      enforceAdminSidebarRestrictions();

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

      const currentChecked = S.billingPeriod === 'yearly' ? 'checked' : '';
      const activeMonthly = S.billingPeriod === 'monthly' ? 'active' : '';
      const activeYearly = S.billingPeriod === 'yearly' ? 'active' : '';
      
      plansGrid.innerHTML = `
        <div class="billing-toggle-container">
          <span class="toggle-label ${activeMonthly}" id="toggle-label-monthly">Monthly</span>
          <label class="billing-toggle-switch">
            <input type="checkbox" id="billing-period-toggle" onchange="toggleBillingPeriod(false)" ${currentChecked}>
            <span class="billing-slider"></span>
          </label>
          <span class="toggle-label ${activeYearly}" id="toggle-label-yearly">Annual <span class="discount-badge">Save ~16%</span></span>
        </div>
        <div id="cfg-sub-plans-grid-inner"></div>
        <button id="btn-pay-sub" class="btn btn-primary btn-block" style="margin-top:16px;" onclick="paySelectedSubscription()" disabled>
          💳 Select a plan above to Renew
        </button>
      `;

      const plansInner = $('cfg-sub-plans-grid-inner');
      renderPlansGrid(plansInner, plans, false);

      const defaultPlanId = 'growth_' + S.billingPeriod;
      selectSubPlan(defaultPlanId);
    } else {
      statusCard.innerHTML = '<div style="color:var(--error); text-align:center; padding:10px;">Failed to load subscription status</div>';
    }
  } catch (e) {
    statusCard.innerHTML = '<div style="color:var(--error); text-align:center; padding:10px;">Error loading subscription details</div>';
  }
}

function selectSubPlan(planId) {
  selectedSubPlanId = planId;
  document.querySelectorAll('#cfg-sub-plans-grid-inner .plan-card').forEach(el => el.classList.remove('selected'));
  const selectedCard = $('plan-' + planId);
  if (selectedCard) {
    selectedCard.classList.add('selected');
  }

  const payBtn = $('btn-pay-sub');
  if (payBtn) {
    payBtn.disabled = false;
    const plans = S.subscriptionPlans || [
      { id: 'starter_monthly', name: 'Starter - Monthly', price: 499 },
      { id: 'starter_yearly', name: 'Starter - Annual', price: 4999 },
      { id: 'growth_monthly', name: 'Growth - Monthly', price: 999 },
      { id: 'growth_yearly', name: 'Growth - Annual', price: 9999 },
      { id: 'premium_monthly', name: 'Premium - Monthly', price: 1999 },
      { id: 'premium_yearly', name: 'Premium - Annual', price: 19999 }
    ];
    const plan = plans.find(p => p.id === planId) || { name: 'Plan', price: 0 };
    payBtn.innerHTML = `💳 Pay ₹${plan.price} via Razorpay — Renew ${plan.name}`;
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
            enforceAdminSidebarRestrictions();
            renderSubscriptionBanner();
            
            const dashEl = $('admin-dashboard');
            if (dashEl) dashEl.classList.remove('admin-expired-overlay');
            
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

let selectedExpiredSubPlanId = null;

async function loadExpiredPlans() {
  const el = $('expired-plans-container');
  if (!el) return;
  
  try {
    const r = await callServer('getSubscriptionPlans');
    if (r.success && r.data) {
      const plans = r.data;
      S.subscriptionPlans = plans;

      const currentChecked = S.billingPeriod === 'yearly' ? 'checked' : '';
      const activeMonthly = S.billingPeriod === 'monthly' ? 'active' : '';
      const activeYearly = S.billingPeriod === 'yearly' ? 'active' : '';

      el.innerHTML = `
        <div class="billing-toggle-container" style="margin-top:12px; margin-bottom:12px;">
          <span class="toggle-label ${activeMonthly}" id="toggle-label-monthly-expired">Monthly</span>
          <label class="billing-toggle-switch">
            <input type="checkbox" id="billing-period-toggle-expired" onchange="toggleBillingPeriod(true)" ${currentChecked}>
            <span class="billing-slider"></span>
          </label>
          <span class="toggle-label ${activeYearly}" id="toggle-label-yearly-expired">Annual <span class="discount-badge">Save ~16%</span></span>
        </div>
        <div id="expired-plans-grid-inner"></div>
        <button id="btn-pay-expired-sub" class="btn btn-primary btn-block" style="margin-top: 16px; background:linear-gradient(135deg, var(--primary), var(--secondary)); border:none; color:#08090c; font-weight:800;" onclick="payExpiredSubscription()" disabled>
          💳 Select a plan above to Renew
        </button>
      `;

      const plansInner = $('expired-plans-grid-inner');
      renderPlansGrid(plansInner, plans, true);
      
      const defaultPlanId = 'growth_' + S.billingPeriod;
      selectExpiredSubPlan(defaultPlanId);
    } else {
      el.innerHTML = '<div style="color:var(--error); text-align:center; padding:10px;">Failed to load plans</div>';
    }
  } catch (e) {
    el.innerHTML = '<div style="color:var(--error); text-align:center; padding:10px;">Error loading plans</div>';
  }
}

function selectExpiredSubPlan(planId) {
  selectedExpiredSubPlanId = planId;
  document.querySelectorAll('#expired-plans-grid-inner .plan-card').forEach(el => el.classList.remove('selected'));
  const selectedCard = $('plan-expired-' + planId);
  if (selectedCard) {
    selectedCard.classList.add('selected');
  }

  const payBtn = $('btn-pay-expired-sub');
  if (payBtn) {
    payBtn.disabled = false;
    const plans = S.subscriptionPlans || [
      { id: 'starter_monthly', name: 'Starter - Monthly', price: 499 },
      { id: 'starter_yearly', name: 'Starter - Annual', price: 4999 },
      { id: 'growth_monthly', name: 'Growth - Monthly', price: 999 },
      { id: 'growth_yearly', name: 'Growth - Annual', price: 9999 },
      { id: 'premium_monthly', name: 'Premium - Monthly', price: 1999 },
      { id: 'premium_yearly', name: 'Premium - Annual', price: 19999 }
    ];
    const plan = plans.find(p => p.id === planId) || { name: 'Plan', price: 0 };
    payBtn.innerHTML = `💳 Pay ₹${plan.price} via Razorpay — Renew ${plan.name}`;
  }
}

async function payExpiredSubscription() {
  if (!selectedExpiredSubPlanId) return showToast('Please select a plan first', 'error');

  showLoader('Creating payment order...');
  try {
    const r = await callServer('createSubscriptionOrder', selectedExpiredSubPlanId);
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
            enforceAdminSidebarRestrictions();
            renderSubscriptionBanner();
            
            const dashEl = $('admin-dashboard');
            if (dashEl) dashEl.classList.remove('admin-expired-overlay');
            
            if (S.currentView === 'admin') {
              loadSubscriptionInSettings();
            }
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

async function bootstrapApp() {
  try {
    const r = await callServer('getBootstrapData');
    if (r.success && r.data) {
      applyBootstrapData(r.data);
      DataCache.set('getBootstrapData', r);
      return true;
    }
  } catch(e) {
    console.error('Failed to bootstrap app:', e);
  }
  return false;
}

function enforceAdminSidebarRestrictions() {
  const isStarter = S.subscriptionStatus && S.subscriptionStatus.isActive && S.subscriptionStatus.plan && S.subscriptionStatus.plan.toLowerCase().includes('starter');
  
  const addonsTabBtn = document.querySelector('.admin-tab[data-tab="admin-addons-tab"]');
  const combosTabBtn = document.querySelector('.admin-tab[data-tab="admin-combos-tab"]');
  const offersTabBtn = document.querySelector('.admin-tab[data-tab="admin-offers-tab"]');
  
  if (addonsTabBtn) addonsTabBtn.style.display = isStarter ? 'none' : '';
  if (combosTabBtn) combosTabBtn.style.display = isStarter ? 'none' : '';
  if (offersTabBtn) offersTabBtn.style.display = isStarter ? 'none' : '';
}

function applyBootstrapData(d) {
  if (!d) return;
  
  if (d.init) {
    S.config = d.init;
    if (d.init.subscriptionStatus) S.subscriptionStatus = d.init.subscriptionStatus;
  }
  
  enforceAdminSidebarRestrictions();
  
  if (d.combos) S.combos = d.combos;
  if (d.addOns) S.adminAddons = d.addOns;
  if (d.offers) S.offers = d.offers;
  
  if (d.menu) {
    S.menu = d.menu.items || {};
    S.categories = d.menu.categories || [];
  }

  resolveComboProperties();
  
  const config = S.config || {};
  
  // White-label branding
  const rName = config.restaurantName || 'MenuSarthi';
  if ($('admin-sidebar-restaurant-name')) $('admin-sidebar-restaurant-name').textContent = rName;
  const nameEl = $('landing-name');
  if (nameEl) nameEl.textContent = rName;
  const taglineEl = $('landing-tagline');
  if (taglineEl) taglineEl.textContent = config.restaurantTagline || '';
  document.title = rName + ' — Digital Menu';
  
  // Dynamic logo
  const logoEl = $('landing-logo');
  if (logoEl) {
    if (config.logoUrl) {
      logoEl.innerHTML = '<img src="' + config.logoUrl + '" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:28px">';
    } else {
      logoEl.innerHTML = '🍽️';
    }
  }
  
  // Powered by footer
  const pbEl = $('powered-by-landing');
  if (pbEl) pbEl.innerHTML = 'Powered by <a href="#">MenuSarthi</a>';

  // Dynamic SEO & social meta
  const pageUrl = window.location.href;
  const tagline = config.restaurantTagline || 'Scan • Order • Enjoy';
  const seoTitle = rName + ' — Digital Menu';
  const seoDesc = rName + ' — ' + tagline + '. Order delicious food from our digital menu. Browse our full menu, customize your order, and enjoy a seamless dining experience!';
  const seoImage = config.logoUrl || 'https://em-content.zobj.net/source/apple/391/fork-and-knife-with-plate_1f37d-fe0f.png';

  const metaDesc = $('meta-description');
  if (metaDesc) metaDesc.setAttribute('content', seoDesc);

  const ogUrl = $('og-url');
  if (ogUrl) ogUrl.setAttribute('content', pageUrl);
  const ogTitle = $('og-title');
  if (ogTitle) ogTitle.setAttribute('content', seoTitle);
  const ogDesc = $('og-description');
  if (ogDesc) ogDesc.setAttribute('content', seoDesc);
  const ogImage = $('og-image');
  if (ogImage) ogImage.setAttribute('content', seoImage);
  const ogImgAlt = $('og-image-alt');
  if (ogImgAlt) ogImgAlt.setAttribute('content', rName + ' Logo');
  const ogSiteName = $('og-site-name');
  if (ogSiteName) ogSiteName.setAttribute('content', rName);

  const twTitle = $('tw-title');
  if (twTitle) twTitle.setAttribute('content', seoTitle);
  const twDesc = $('tw-description');
  if (twDesc) twDesc.setAttribute('content', seoDesc);
  const twImage = $('tw-image');
  if (twImage) twImage.setAttribute('content', seoImage);

  if (config.logoUrl) {
    const favicon = $('favicon');
    if (favicon) favicon.setAttribute('href', config.logoUrl);
    const appleTouchIcon = $('apple-touch-icon');
    if (appleTouchIcon) appleTouchIcon.setAttribute('href', config.logoUrl);
  }
  
  // Render categories and menu list
  if (S.categories.length) {
    renderCategoryTabs();
    const activeTab = document.querySelector('.cat-tab.active');
    const activeCatName = activeTab ? activeTab.textContent : S.categories[0];
    renderMenuItems(activeCatName);
  }
  
  // Subscription Gate
  const sub = S.subscriptionStatus;
  if (sub && !sub.isActive && sub.found) {
    if (INIT_PAGE === 'admin') {
      navigateTo('admin');
      if (S.isAdmin) {
        renderSubscriptionBanner();
        const dashEl = $('admin-dashboard');
        if (dashEl) dashEl.classList.add('admin-expired-overlay');
      }
    } else {
      navigateTo('maintenance');
    }
  } else {
    // Active subscription
    if (S.isAdmin) {
      loadAdminData();
      startAdminRefresh();
      renderSubscriptionBanner();
    }
  }
}

async function init(){
  try { FirebaseSync.init(); } catch(e) {}
  if(S.table){$('table-badge').style.display='flex';$('table-display').textContent=S.table}
  // Restore session
  if(loadSession()){
    updateUserUI();
    verifyUserSessionFromServer(S.user.phone);
  }
  
  // Restore admin session - await Firebase authentication before loading view
  let adminSessionActive = loadAdminSession();
  if(adminSessionActive){
    S.isAdmin=true;
    try {
      await FirebaseSync.loginAdmin();
    } catch(e) {
      console.error("Firebase admin restore error:", e);
    }
    hide('admin-login-screen');
    show('admin-dashboard');
  }
  
  setInterval(checkAdminSessionExpiry,60000);
  
  // Tab Visibility listener to sync on tab focus
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('Tab focused, syncing in background...');
      bootstrapApp();
      if (S.isAdmin) loadAdminData();
    }
  });
  
  // High performance: Apply cache immediately
  const cached = DataCache.get('getBootstrapData');
  if (cached && cached.success && cached.data) {
    applyBootstrapData(cached.data);
  }
  
  // Fetch fresh data in background (or foreground if no cache exists to prevent blank screens)
  if (!cached) {
    showLoader('Loading digital menu...');
  }
  
  try {
    const success = await bootstrapApp();
    if (!success && !cached) {
      showToast('Could not load menu. Working offline.', 'warning');
    }
  } catch(e) {
    if (!cached) {
      showToast('Error loading menu. Please reload.', 'error');
    }
  } finally {
    if (!cached) hideLoader();
  }
  
  if(INIT_PAGE==='admin'){navigateTo('admin');return}
}
init();

// ===== CUSTOM MODAL SYSTEM =====
function showCustomModal(title, body, actions = []) {
  const overlay = $('modal-overlay');
  const content = $('modal-content');
  if (!overlay || !content) return;

  let actionsHtml = actions.map(act => {
    const cls = act.class || 'btn-secondary';
    return `<button class="btn ${cls} btn-block" id="${act.id || ''}" onclick="${act.onclick}">${act.text}</button>`;
  }).join('');

  content.innerHTML = `
    <div class="modal-title">${title}</div>
    <div class="modal-body">${body}</div>
    <div class="modal-actions">${actionsHtml}</div>
  `;

  overlay.classList.add('active');
}

function closeCustomModal() {
  const overlay = $('modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

if ($('modal-overlay')) {
  $('modal-overlay').addEventListener('click', e => {
    if (e.target === $('modal-overlay')) closeCustomModal();
  });
}

async function handleUpdateExistingOrder(activeOrderId) {
  closeCustomModal();
  const table = $('checkout-table') ? $('checkout-table').value : S.table;
  if (!S.cart.length) return showToast('Cart is empty', 'error');

  showLoader('Updating order...');
  const data = {
    orderId: activeOrderId,
    tableNumber: table,
    customerName: S.user.name,
    customerPhone: S.user.phone,
    items: S.cart.map(c => ({
      id: c.id,
      name: c.name + (c.portion ? ' (' + c.portion + ')' : ''),
      qty: c.qty,
      price: c.price
    })),
    specialInstructions: $('checkout-notes') ? $('checkout-notes').value : ''
  };

  try {
    const r = await callServer('updateExistingOrder', activeOrderId, data);
    hideLoader();
    if (r.success) {
      const diffAmount = r.data.differenceAmount;
      const orderId = r.data.orderId;
      S.cart = [];
      updateCartBadge();
      
      if (diffAmount > 0) {
        showToast('Order updated! Proceeding to payment for difference...', 'success');
        openPaymentPage(orderId, diffAmount);
      } else {
        showToast('Order updated successfully! 🎉', 'success');
        navigateTo('tracking');
        startTracking(orderId);
      }
    } else {
      showToast(r.message, 'error');
    }
  } catch (e) {
    hideLoader();
    showToast('Failed to update order', 'error');
  }
}

/* ==========================================================================
   DISH DETAIL OVERLAY & PREMIUM RATINGS SYSTEM
   ========================================================================== */

function findItemCategory(itemId) {
  for (const cat of S.categories) {
    if ((S.menu[cat] || []).some(item => item.id === itemId)) {
      return cat;
    }
  }
  return '';
}

function openDishDetail(itemId) {
  const item = findMenuItem(itemId);
  if (!item) return;

  const category = findItemCategory(itemId);
  const overlay = $('dish-detail-overlay');
  const sheet = $('dish-detail-sheet');
  if (!overlay || !sheet) return;

  // Initialize sheet dataset states
  sheet.dataset.itemId = itemId;
  sheet.dataset.selectedPortion = item.portions && item.portions.length > 0 ? item.portions[0] : '';
  sheet.dataset.selectedPrice = item.portions && item.portions.length > 0 ? item.portionPrices[0] : item.price;

  // Render static baseline template
  const isVeg = item.type === 'Veg';
  const badgeClass = isVeg ? 'veg-badge' : 'nonveg-badge';
  const badgeLabel = isVeg ? 'Veg' : 'Non-Veg';
  const imageHtml = item.image ? 
    `<img src="${item.image}" alt="${item.name}" class="dish-hero-image" loading="lazy">` : 
    `<div class="dish-hero-fallback">🍛</div>`;

  let portionsHtml = '';
  if (item.portions && item.portions.length > 0) {
    portionsHtml = `
      <div class="dish-detail-portions-section">
        <h4>Select Size</h4>
        <div class="dish-detail-portions-grid">
          ${item.portions.map((port, idx) => `
            <div class="dish-detail-portion-pill ${idx === 0 ? 'active' : ''}" 
                 data-portion="${port}" 
                 data-price="${item.portionPrices[idx]}" 
                 onclick="selectDetailPortion(this)">
              <span class="dd-portion-name">${port}</span>
              <span class="dd-portion-price">₹${item.portionPrices[idx]}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  sheet.innerHTML = `
    <div class="portion-handle"></div>
    <div class="dish-detail-topbar">
      <button class="dish-close-btn" onclick="closeDishDetail()">✕</button>
    </div>
    
    <div class="dish-detail-body" id="dish-detail-body">
      <div class="dish-hero-wrapper">
        ${imageHtml}
        <div class="dish-hero-gradient"></div>
        <div class="dish-hero-badge">
          <span class="${badgeClass}"></span> ${badgeLabel}
        </div>
      </div>

      <div class="dish-detail-content-wrap">
        <span class="dish-detail-category">${category}</span>
        <h2 class="dish-detail-title">${item.name}</h2>
        <div class="dish-detail-price" id="dish-detail-main-price">
          ₹${sheet.dataset.selectedPrice}
        </div>
        
        ${item.description ? `
          <div class="dish-detail-desc-heading">Description</div>
          <p class="dish-detail-description">${item.description}</p>
        ` : ''}

        ${portionsHtml}

        <!-- Ratings & Reviews Section -->
        <div class="dish-reviews-section">
          <h4>⭐ Guest Ratings & Reviews</h4>
          <div id="dish-reviews-container">
            <!-- Render loading state first -->
            <div class="reviews-summary-card skeleton-bar" style="height: 100px; opacity: 0.6; border-radius: var(--radius)"></div>
            <div style="height: 60px; margin-top: 15px; border-radius: var(--radius-sm);" class="skeleton-bar"></div>
          </div>
        </div>

        <!-- Related Items Section -->
        <div class="dish-related-section">
          <h4>🍛 You May Also Like</h4>
          <div class="dish-related-grid" id="dish-related-grid"></div>
        </div>
      </div>
    </div>

    <!-- Sticky Bottom CTA -->
    <div class="dish-detail-action-bar" id="dish-detail-action-bar"></div>
  `;

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden'; // Stop background scroll

  // Load reviews asynchronously
  loadReviewsForDetail(itemId);

  // Render related dishes
  renderRelatedDishes(item, category);

  // Update action bar
  updateDetailActionBar(itemId);

  // Attach swipe-to-dismiss gesture
  initSwipeToDismiss(sheet, () => closeDishDetail());
}

function closeDishDetail() {
  const overlay = $('dish-detail-overlay');
  if (overlay) {
    overlay.classList.remove('active');
    document.body.style.overflow = ''; // Restore background scroll
  }
}

// Close overlay on backdrop click
if ($('dish-detail-overlay')) {
  $('dish-detail-overlay').addEventListener('click', e => {
    if (e.target === $('dish-detail-overlay')) closeDishDetail();
  });
}

function selectDetailPortion(pillEl) {
  const grid = pillEl.closest('.dish-detail-portions-grid');
  if (!grid) return;
  
  grid.querySelectorAll('.dish-detail-portion-pill').forEach(p => p.classList.remove('active'));
  pillEl.classList.add('active');

  const sheet = $('dish-detail-sheet');
  sheet.dataset.selectedPortion = pillEl.dataset.portion;
  sheet.dataset.selectedPrice = pillEl.dataset.price;

  // Update main price display
  const priceDisplay = $('dish-detail-main-price');
  if (priceDisplay) priceDisplay.textContent = '₹' + pillEl.dataset.price;

  // Update Action Bar
  updateDetailActionBar(sheet.dataset.itemId);
}

function updateDetailActionBar(itemId) {
  const sheet = $('dish-detail-sheet');
  const portion = sheet.dataset.selectedPortion || '';
  const price = parseFloat(sheet.dataset.selectedPrice);
  const cartId = portion ? `${itemId}__${portion}` : itemId;

  const cartItem = S.cart.find(c => c.id === cartId);
  const qty = cartItem ? cartItem.qty : 0;
  const bar = $('dish-detail-action-bar');
  if (!bar) return;

  if (qty > 0) {
    bar.innerHTML = `
      <div class="qty-control dish-detail-qty-wrap">
        <button class="qty-btn" onclick="updateDetailQty('${cartId}', -1)">−</button>
        <span class="qty-val">${qty}</span>
        <button class="qty-btn" onclick="updateDetailQty('${cartId}', 1)">+</button>
      </div>
      <button class="btn btn-secondary dish-detail-btn-add" style="flex: 1;" onclick="navigateTo('cart'); closeDishDetail();">
        🛒 Go to Cart
      </button>
    `;
  } else {
    bar.innerHTML = `
      <button class="btn btn-primary btn-block dish-detail-btn-add" onclick="handleDetailAddToCart('${itemId}')">
        🚀 Add to Cart <span>₹${price}</span>
      </button>
    `;
  }
}

function handleDetailAddToCart(itemId) {
  const sheet = $('dish-detail-sheet');
  const portion = sheet.dataset.selectedPortion || '';
  const price = parseFloat(sheet.dataset.selectedPrice);
  const cartId = portion ? `${itemId}__${portion}` : itemId;

  const item = findMenuItem(itemId);
  if (!item) return;

  // Smart Upselling Touchpoint: Check for matching combos or linked add-ons
  const matchingCombos = (S.combos || []).filter(c => c.available && c.includedItems && c.includedItems.split(',').map(s=>s.trim()).includes(itemId));
  const matchingAddons = (S.adminAddons || []).filter(a => a.available && a.linkedItems && a.linkedItems.split(',').map(s=>s.trim()).includes(itemId));

  if ((matchingCombos.length > 0 || matchingAddons.length > 0) && !S.cart.some(c => c.id === cartId)) {
    closeDishDetail();
    // Pass the selected portion & price so the upsell modal adds the correct size at the correct price
    showUpsellModal(item, matchingCombos, matchingAddons, portion, price);
    return;
  }

  const existing = S.cart.find(c => c.id === cartId);
  if (existing) {
    existing.qty++;
  } else {
    S.cart.push({
      id: cartId,
      name: item.name,
      price: price,
      qty: 1,
      type: item.type,
      portion: portion,
      baseId: itemId
    });
  }
  updateCartBadge();
  const active = document.querySelector('.cat-tab.active');
  if (active) renderMenuItems(active.textContent);
  showToast(item.name + (portion ? ' (' + portion + ')' : '') + ' added', 'success');
  updateDetailActionBar(itemId);
}

function updateDetailQty(cartId, delta) {
  changeDetailQty(cartId, delta);
}

function changeDetailQty(cartId, delta) {
  const item = S.cart.find(c => c.id === cartId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) S.cart = S.cart.filter(c => c.id !== cartId);
  updateCartBadge();
  const active = document.querySelector('.cat-tab.active');
  if (active) renderMenuItems(active.textContent);
  if (S.currentView === 'cart') renderCart();
  const sheet = $('dish-detail-sheet');
  if (sheet) updateDetailActionBar(sheet.dataset.itemId);
}

async function loadReviewsForDetail(itemId) {
  const container = $('dish-reviews-container');
  if (!container) return;

  try {
    const r = await callServer('getItemReviews', itemId);
    if (r.success && r.data) {
      renderReviewsData(itemId, r.data);
    } else {
      renderReviewsData(itemId, null, r.message || 'Failed to load reviews');
    }
  } catch (e) {
    renderReviewsData(itemId, null, 'Working Offline — Reviews unavailable');
  }
}

function renderReviewsData(itemId, data, errorMessage) {
  const container = $('dish-reviews-container');
  if (!container) return;

  const reviews = data ? (data.reviews || []) : [];
  const stats = data ? (data.stats || { avgRating: 0, totalCount: 0, starBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } }) : { avgRating: 0, totalCount: 0, starBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } };
  const total = stats.totalCount;

  // Star breakdown rows generator
  let breakdownRowsHtml = '';
  for (let i = 5; i >= 1; i--) {
    const count = stats.starBreakdown[i] || 0;
    const percent = total > 0 ? (count / total) * 100 : 0;
    breakdownRowsHtml += `
      <div class="reviews-breakdown-row">
        <span class="reviews-breakdown-starlabel">${i} ★</span>
        <div class="reviews-breakdown-bar-bg">
          <div class="reviews-breakdown-bar-fill" style="width: ${percent}%"></div>
        </div>
        <span class="reviews-breakdown-count">${count}</span>
      </div>
    `;
  }

  // Reviews List Generator
  let listHtml = '';
  if (errorMessage) {
    const isOfflineErr = errorMessage.includes('Offline');
    listHtml = `
      <div class="reviews-empty-state">
        <div class="reviews-empty-icon">${isOfflineErr ? '📡' : '⚠️'}</div>
        <p>${errorMessage}</p>
      </div>
    `;
  } else if (reviews.length === 0) {
    listHtml = `
      <div class="reviews-empty-state">
        <div class="reviews-empty-icon">✨</div>
        <p>No reviews yet. Be the first to share your thoughts!</p>
      </div>
    `;
  } else {
    listHtml = reviews.map(rev => {
      const avatarLetter = rev.name ? rev.name.charAt(0) : 'A';
      const dateLabel = formatReviewDate(rev.timestamp);
      const starString = '★'.repeat(rev.rating) + '☆'.repeat(5 - rev.rating);
      
      // Highlight own review if phone matches (loosely based on masking)
      const userPhoneStr = S.user && S.user.phone ? String(S.user.phone) : '';
      const revPhoneStr = rev.phone ? String(rev.phone) : '';
      const isOwnReview = userPhoneStr && revPhoneStr && revPhoneStr.substring(0, 4) === userPhoneStr.substring(0, 4);
      const highlightClass = isOwnReview ? 'review-own-highlight' : '';
      const ownTag = isOwnReview ? '<span class="review-own-tag">Your Review</span>' : '';

      return `
        <div class="review-list-card ${highlightClass}">
          <div class="review-list-header">
            <div class="review-list-user-info">
              <div class="review-list-avatar">${avatarLetter}</div>
              <div>
                <div class="review-list-name" style="display:flex;align-items:center;gap:6px">${rev.name} ${ownTag}</div>
                <div class="review-list-stars">${starString}</div>
              </div>
            </div>
            <div class="review-list-date">${dateLabel}</div>
          </div>
          <p class="review-list-text">${rev.text || 'Liked this dish'}</p>
        </div>
      `;
    }).join('');
  }

  // Write Review form generator
  let writeFormHtml = '';
  if (!S.user) {
    writeFormHtml = `
      <div class="write-review-card" style="text-align: center; padding: 20px;">
        <div class="write-review-title" style="justify-content: center;">📝 Rate this dish</div>
        <p style="font-size: 0.8rem; color: var(--text2); margin-bottom: 12px;">You must be logged in to post reviews.</p>
        <button class="btn btn-secondary btn-sm" onclick="closeDishDetail(); showAuth('login');">Login / Sign Up</button>
      </div>
    `;
  } else {
    // If user already reviewed, show thank you note instead of double submissions
    const userPhoneStr = S.user && S.user.phone ? String(S.user.phone) : '';
    const userMaskedPhone = userPhoneStr ? userPhoneStr.substring(0, 6) + 'XXXX' : '';
    const hasReviewed = reviews.some(r => r.phone === userMaskedPhone);
    
    if (hasReviewed) {
      writeFormHtml = `
        <div class="write-review-card" style="text-align: center; border-style: solid; background: rgba(16, 185, 129, 0.03); border-color: rgba(16, 185, 129, 0.2);">
          <div class="write-review-title" style="justify-content: center; color: var(--success);">✅ Review Submitted</div>
          <p style="font-size: 0.82rem; color: var(--text2);">You have already shared your feedback for this item. Thank you!</p>
        </div>
      `;
    } else {
      writeFormHtml = `
        <div class="write-review-card">
          <div class="write-review-title">✍️ Review this Dish</div>
          <div class="write-review-stars-container" id="detail-star-input-container" data-rating="0">
            <span class="write-review-star" data-value="1" onclick="setDetailStarRating(1)">★</span>
            <span class="write-review-star" data-value="2" onclick="setDetailStarRating(2)">★</span>
            <span class="write-review-star" data-value="3" onclick="setDetailStarRating(3)">★</span>
            <span class="write-review-star" data-value="4" onclick="setDetailStarRating(4)">★</span>
            <span class="write-review-star" data-value="5" onclick="setDetailStarRating(5)">★</span>
          </div>
          <textarea class="write-review-textarea" id="detail-review-text" placeholder="Share your experience (taste, quantity, spice level)..."></textarea>
          <button class="btn btn-primary btn-sm btn-block" id="btn-submit-review" onclick="submitDetailReview('${itemId}')">Submit Review</button>
        </div>
      `;
    }
  }

  let summaryHtml = '';
  if (data && stats.totalCount > 0) {
    const avgStarString = '★'.repeat(Math.round(stats.avgRating)) + '☆'.repeat(5 - Math.round(stats.avgRating));
    summaryHtml = `
      <div class="reviews-summary-card">
        <div class="reviews-summary-avg">
          <div class="reviews-summary-avg-num">${stats.avgRating}</div>
          <div class="reviews-summary-avg-stars">${avgStarString}</div>
          <div class="reviews-summary-avg-count">${total} reviews</div>
        </div>
        <div class="reviews-breakdown-list">
          ${breakdownRowsHtml}
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    ${summaryHtml}

    <div class="dish-reviews-list">
      ${listHtml}
    </div>

    ${writeFormHtml}
  `;
}

function setDetailStarRating(rating) {
  const container = $('detail-star-input-container');
  if (!container) return;
  container.dataset.rating = rating;
  const stars = container.querySelectorAll('.write-review-star');
  stars.forEach(star => {
    const val = parseInt(star.dataset.value);
    star.classList.toggle('active', val <= rating);
  });
}

async function submitDetailReview(itemId) {
  if (!S.user) {
    showToast('Please login to submit reviews', 'error');
    return;
  }

  const ratingContainer = $('detail-star-input-container');
  const rating = ratingContainer ? parseInt(ratingContainer.dataset.rating) : 0;
  if (!rating || rating < 1 || rating > 5) {
    showToast('Please select a star rating', 'warning');
    return;
  }

  const textInput = $('detail-review-text');
  const text = textInput ? textInput.value.trim() : '';

  const submitBtn = $('btn-submit-review');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
  }

  try {
    const r = await callServer('addReview', {
      itemId: itemId,
      rating: rating,
      text: text,
      name: S.user.name,
      phone: S.user.phone
    });

    if (r.success) {
      showToast('Thank you for your review!', 'success');
      // Reload reviews dynamically
      loadReviewsForDetail(itemId);
    } else {
      showToast(r.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Review';
      }
    }
  } catch (e) {
    showToast('Failed to submit review', 'error');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Review';
    }
  }
}

function renderRelatedDishes(item, category) {
  const grid = $('dish-related-grid');
  if (!grid) return;

  const allItems = S.menu[category] || [];
  // Exclude current item and pick up to 6 items
  const related = allItems.filter(it => it.id !== item.id).slice(0, 6);

  if (related.length === 0) {
    const sect = grid.closest('.dish-related-section');
    if (sect) sect.style.display = 'none';
    return;
  }

  grid.innerHTML = related.map(it => {
    const imgHtml = it.image ? 
      `<img src="${it.image}" alt="${it.name}" loading="lazy">` : 
      `🍛`;
    
    let priceStr = '₹' + it.price;
    if (it.portions && it.portions.length > 0) {
      priceStr = '₹' + Math.min(...it.portionPrices);
    }

    return `
      <div class="dish-related-card" onclick="openDishDetail('${it.id}')">
        <div class="dish-related-card-img">${imgHtml}</div>
        <div class="dish-related-card-info">
          <div class="dish-related-card-name">${it.name}</div>
          <div class="dish-related-card-price">${priceStr}</div>
        </div>
      </div>
    `;
  }).join('');
}

function formatReviewDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHrs === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return diffMins <= 1 ? 'Just now' : `${diffMins}m ago`;
    }
    return `${diffHrs}h ago`;
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function initSwipeToDismiss(el, callback) {
  let startY = 0;
  let currentY = 0;
  
  el.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
  }, { passive: true });
  
  el.addEventListener('touchmove', e => {
    currentY = e.touches[0].clientY;
    const diff = currentY - startY;
    // Only swipe down when scrolled to top
    if (diff > 0 && el.scrollTop === 0) {
      el.style.transform = `translateY(${diff}px)`;
      el.style.transition = 'none';
    }
  }, { passive: true });
  
  el.addEventListener('touchend', e => {
    const diff = currentY - startY;
    el.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    if (diff > 120 && el.scrollTop === 0) {
      callback();
    } else {
      el.style.transform = 'translateY(0)';
    }
    startY = 0;
    currentY = 0;
  }, { passive: true });
}

// ===== PWA INSTALLATION PROCESS LOGIC =====
let deferredPrompt = null;

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('MenuSarthi Service Worker registered successfully', reg))
      .catch(err => console.log('MenuSarthi Service Worker registration failed', err));
  });
}

// Check if running on iOS device
function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// Check if app is already running in standalone mode (installed)
function isAppInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Initialize PWA Installation Prompts
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  
  // Show install button in admin sidebar if available
  const adminInstallBtn = $('admin-sidebar-install');
  if (adminInstallBtn) {
    adminInstallBtn.style.display = 'flex';
  }
  
  // Show floating banner in customer view
  showPwaInstallBanner();
});

function showPwaInstallBanner() {
  const banner = $('pwa-install-banner');
  if (!banner) return;
  
  // Do not show if dismissed in this session
  if (localStorage.getItem('ms_pwa_dismissed') === 'true') return;
  if (isAppInstalled()) return;

  // Custom styling and text for iOS Safari users
  if (isIOSDevice()) {
    const titleEl = $('pwa-title');
    const descEl = $('pwa-desc');
    const btnEl = $('pwa-btn-install');
    
    if (titleEl) titleEl.textContent = 'Add to Home Screen';
    if (descEl) descEl.textContent = 'Tap Share button (📤) at the bottom and select "Add to Home Screen".';
    if (btnEl) btnEl.style.display = 'none'; // hide trigger button since iOS uses share menu
  }

  banner.classList.remove('hidden');
}

async function triggerPwaInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    deferredPrompt = null;
    
    // Hide buttons after prompt interaction
    const banner = $('pwa-install-banner');
    if (banner) banner.classList.add('hidden');
    
    const adminInstallBtn = $('admin-sidebar-install');
    if (adminInstallBtn) adminInstallBtn.style.display = 'none';
  } else if (isIOSDevice()) {
    showToast('Safari menu check: Tap Share (📤) -> Add to Home Screen', 'info');
  } else {
    showToast('To install: click browser options menu (⋮) -> Install App / Add to Home screen', 'info');
  }
}

function dismissPwaBanner() {
  const banner = $('pwa-install-banner');
  if (banner) banner.classList.add('hidden');
  localStorage.setItem('ms_pwa_dismissed', 'true');
}

// Auto-trigger banner logic for iOS/Safari users shortly after startup
setTimeout(() => {
  if (isIOSDevice() && !isAppInstalled() && localStorage.getItem('ms_pwa_dismissed') !== 'true') {
    showPwaInstallBanner();
  }
}, 5000);

// ===== CLIENT-SIDE OFFERS / COUPON SYSTEM =====

function applyOffer(offerId) {
  const offer = (S.offers || []).find(o => o.id === offerId);
  if (!offer) return;

  // --- Per-account usage limit: client-side pre-check ---
  const maxUsage = parseInt(offer.maxUsagePerAccount) || 0;
  if (maxUsage > 0) {
    const normalizedCode = (offer.code || '').toUpperCase().trim();
    const usedCount = (S.myOrders || []).filter(o =>
      (o.appliedOffer || '').toUpperCase().trim() === normalizedCode
    ).length;
    if (usedCount >= maxUsage) {
      showToast(
        `Offer limit reached! "${offer.code}" can only be used ${maxUsage} time${maxUsage > 1 ? 's' : ''} per account. You have already used it ${usedCount} time${usedCount > 1 ? 's' : ''}.`,
        'error'
      );
      return;
    }
  }

  const subtotal = S.cart.reduce((s,c)=>s+c.price*c.qty,0);
  if (subtotal >= offer.minOrderValue) {
    S.appliedOffer = offer;

    // Auto-add free dish if it is a specific free dish offer and not already in cart
    if (offer.type === 'free_dish' && offer.freeDishId && offer.freeDishId !== 'any') {
      const dishId = offer.freeDishId;
      const isInCart = S.cart.some(c => c.id.split('__')[0] === dishId);
      if (!isInCart) {
        const item = findMenuItem(dishId);
        if (item) {
          let cartId = item.id;
          let portion = '';
          let price = item.price;
          if (item.portions && item.portions.length > 0) {
            portion = item.portions[0];
            price = item.portionPrices[0];
            cartId = item.id + '__' + portion;
          }
          S.cart.push({
            id: cartId,
            name: item.name,
            price: price,
            qty: 1,
            type: item.type || 'Veg',
            portion: portion,
            baseId: portion ? item.id : undefined
          });
          updateCartBadge();
          showToast(`${item.name} added to your cart for free! 🎁`, 'success');
        } else {
          showToast(`Offer applied, but please add the free dish to your cart!`, 'info');
        }
      }
    }

    renderCart();
    showToast(`Offer ${offer.code} applied successfully! 🎉`, 'success');
  } else {
    showToast(`Minimum order value of ₹${offer.minOrderValue} not met.`, 'error');
  }
}

function removeOffer() {
  if (S.appliedOffer) {
    const code = S.appliedOffer.code;
    S.appliedOffer = null;
    S.discountAmount = 0;
    renderCart();
    showToast(`Offer ${code} removed.`, 'info');
  }
}

// ===== ADMINISTRATIVE OFFERS MANAGEMENT =====

async function loadAdminOffers() {
  const searchInput = $('admin-offers-search');
  if (searchInput && document.activeElement === searchInput) return;
  
  try {
    const r = await callServer('getAllOffers');
    if (r.success) {
      S.offers = r.data;
      renderAdminOffers();
    }
  } catch(e) {
    showToast('Failed to load offers', 'error');
  }
}

function renderAdminOffers() {
  const listEl = $('admin-offers-list');
  if (!listEl) return;
  
  const query = $('admin-offers-search') ? $('admin-offers-search').value.toLowerCase().trim() : '';
  const offers = S.offers || [];
  
  let filtered = offers;
  if (query) {
    filtered = offers.filter(o => 
      o.code.toLowerCase().includes(query) ||
      o.description.toLowerCase().includes(query)
    );
  }
  
  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-icon">🔍</div><p>No offers configured</p></div>';
    return;
  }
  
  listEl.innerHTML = filtered.map(o => {
    let typeLabel = '';
    if (o.type === 'discount_percent') typeLabel = '🏷️ % Discount';
    else if (o.type === 'discount_flat') typeLabel = '💵 Flat Discount';
    else if (o.type === 'free_dish') typeLabel = '🎁 Free Dish';
    
    let valLabel = '';
    if (o.type === 'discount_percent') valLabel = `${o.value}%`;
    else if (o.type === 'discount_flat') valLabel = `₹${o.value}`;
    else if (o.type === 'free_dish') {
      if (o.freeDishId && o.freeDishId !== 'any') {
        let allItems = [];
        if (S.adminMenu && S.adminMenu.length) allItems = S.adminMenu;
        else {
          for (const cat in S.menu) allItems = allItems.concat(S.menu[cat] || []);
        }
        const item = allItems.find(m => m.id === o.freeDishId);
        valLabel = item ? `Free ${item.name}` : 'Free Specific Dish';
      } else {
        valLabel = 'Free Any';
      }
    }
    
    const statusText = o.isActive ? 'Active' : 'Inactive';
    const statusClass = o.isActive ? 'status-ready' : 'status-received';
    
    return `
      <div class="admin-offer-card glass">
        <div class="admin-offer-header">
          <div class="admin-offer-title">
            <span class="offer-code-badge">${o.code}</span>
            <span style="font-size:0.75rem; font-weight:700; color:var(--text3); margin-top:2px;">${typeLabel}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px">
            <span class="status-badge ${statusClass}" style="font-size:0.65rem">${statusText}</span>
            <label class="toggle-switch">
              <input type="checkbox" ${o.isActive ? 'checked' : ''} onchange="toggleOfferAvail('${o.id}')">
              <span class="slider"></span>
            </label>
          </div>
        </div>
        
        <div class="offer-desc" style="font-size:0.85rem; color:var(--text1)">
          ${o.description}
        </div>
        
        <div class="admin-offer-meta-row">
          <div>Min Order: <span class="admin-offer-meta-val">₹${o.minOrderValue}</span></div>
          <div>Value: <span class="admin-offer-meta-val">${valLabel}</span></div>
          <div>Per Account: <span class="admin-offer-meta-val" style="${(o.maxUsagePerAccount && o.maxUsagePerAccount > 0) ? 'color:var(--warning)' : 'color:var(--success)'}">${(o.maxUsagePerAccount && o.maxUsagePerAccount > 0) ? o.maxUsagePerAccount + 'x' : '∞ Unlimited'}</span></div>
        </div>
        
        <div class="admin-offer-actions">
          <button class="btn btn-secondary btn-block btn-sm" onclick="showEditOfferModal('${o.id}')" style="margin-bottom:0; padding:6px;">✏️ Edit</button>
          <button class="btn btn-secondary btn-block btn-sm" style="color:var(--error); border-color:rgba(239,68,68,0.2); margin-bottom:0; padding:6px;" onclick="deleteAdminOffer('${o.id}', '${o.code}')">🗑️ Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function showAddOfferModal() {
  const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:12px">
      <h3 style="font-family:var(--font-head);font-weight:800;font-size:1.2rem">🎁 Add New Offer</h3>
      <span style="font-size:1.5rem;cursor:pointer" onclick="closeCustomModal()">✕</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="input-group">
        <label>Offer Code (Alphanumeric, e.g. WELCOME50)</label>
        <input type="text" id="offer-form-code" placeholder="WELCOME50" style="text-transform:uppercase">
      </div>
      
      <div class="form-row-2">
        <div class="input-group">
          <label>Offer Type</label>
          <select id="offer-form-type" onchange="handleOfferTypeChange()">
            <option value="discount_percent">Percentage Discount</option>
            <option value="discount_flat">Flat Amount Discount</option>
            <option value="free_dish">Free Dish Offer</option>
          </select>
        </div>
        <div class="input-group" id="offer-value-group">
          <label id="offer-value-label">Discount Percentage (%)</label>
          <input type="number" id="offer-form-value" placeholder="10" min="0">
        </div>
      </div>

      <!-- Specific Free Dish Container -->
      <div class="input-group" id="offer-free-dish-group" style="display:none">
        <label>Select Free Item</label>
        <input type="text" id="offer-form-dish-search" placeholder="🔍 Search menu items..." oninput="filterFreeDishList()" style="margin-bottom:8px">
        <div id="offer-form-dish-list" style="max-height: 180px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-xs); padding: 8px; display:flex; flex-direction:column; gap:6px; background: rgba(0,0,0,0.15);"></div>
        <input type="hidden" id="offer-form-free-dish" value="any">
      </div>

      <div class="input-group">
        <label>Minimum Order Value (₹)</label>
        <input type="number" id="offer-form-min-order" placeholder="200" min="0">
      </div>

      <div class="input-group">
        <label>Description</label>
        <input type="text" id="offer-form-description" placeholder="Get 10% off on orders above ₹200">
      </div>

      <div class="input-group">
        <label style="display:flex;align-items:center;gap:6px;">🔒 Max Uses Per Account <span style="font-size:0.75rem;color:var(--text3);font-weight:400;">(0 = Unlimited)</span></label>
        <input type="number" id="offer-form-max-usage" placeholder="0" min="0" style="">
        <span style="font-size:0.75rem;color:var(--text3);margin-top:4px;display:block;">Set how many times a single customer account can redeem this offer. Leave 0 for no restriction.</span>
      </div>

      <div style="display:flex;gap:12px;margin-top:12px">
        <button class="btn btn-primary btn-block" onclick="saveOffer()" style="margin-bottom:0">💾 Create Offer</button>
        <button class="btn btn-secondary btn-block" onclick="closeCustomModal()" style="margin-bottom:0">Cancel</button>
      </div>
    </div>
  `;
  
  $('modal-content').innerHTML = html;
  $('modal-overlay').classList.add('active');
  setTimeout(attachAutoSuggestListeners, 50);
}

function showEditOfferModal(offerId) {
  const offer = (S.offers || []).find(o => o.id === offerId);
  if (!offer) return;
  
  const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:12px">
      <h3 style="font-family:var(--font-head);font-weight:800;font-size:1.2rem">🎁 Edit Offer</h3>
      <span style="font-size:1.5rem;cursor:pointer" onclick="closeCustomModal()">✕</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <input type="hidden" id="offer-form-id" value="${offer.id}">
      <div class="input-group">
        <label>Offer Code (Alphanumeric)</label>
        <input type="text" id="offer-form-code" value="${offer.code}" placeholder="WELCOME50" style="text-transform:uppercase">
      </div>
      
      <div class="form-row-2">
        <div class="input-group">
          <label>Offer Type</label>
          <select id="offer-form-type" onchange="handleOfferTypeChange()">
            <option value="discount_percent" ${offer.type === 'discount_percent' ? 'selected' : ''}>Percentage Discount</option>
            <option value="discount_flat" ${offer.type === 'discount_flat' ? 'selected' : ''}>Flat Amount Discount</option>
            <option value="free_dish" ${offer.type === 'free_dish' ? 'selected' : ''}>Free Dish Offer</option>
          </select>
        </div>
        <div class="input-group" id="offer-value-group" style="display: ${offer.type === 'free_dish' ? 'none' : 'block'}">
          <label id="offer-value-label">${offer.type === 'discount_percent' ? 'Discount Percentage (%)' : 'Discount Amount (₹)'}</label>
          <input type="number" id="offer-form-value" value="${offer.value}" placeholder="10" min="0">
        </div>
      </div>

      <!-- Specific Free Dish Container -->
      <div class="input-group" id="offer-free-dish-group" style="display:${offer.type === 'free_dish' ? 'block' : 'none'}">
        <label>Select Free Item</label>
        <input type="text" id="offer-form-dish-search" placeholder="🔍 Search menu items..." oninput="filterFreeDishList()" style="margin-bottom:8px">
        <div id="offer-form-dish-list" style="max-height: 180px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-xs); padding: 8px; display:flex; flex-direction:column; gap:6px; background: rgba(0,0,0,0.15);"></div>
        <input type="hidden" id="offer-form-free-dish" value="${offer.freeDishId || 'any'}">
      </div>

      <div class="input-group">
        <label>Minimum Order Value (₹)</label>
        <input type="number" id="offer-form-min-order" value="${offer.minOrderValue}" placeholder="200" min="0">
      </div>

      <div class="input-group">
        <label>Description</label>
        <input type="text" id="offer-form-description" value="${offer.description}" placeholder="Get 10% off on orders above ₹200">
      </div>

      <div class="input-group">
        <label style="display:flex;align-items:center;gap:6px;">🔒 Max Uses Per Account <span style="font-size:0.75rem;color:var(--text3);font-weight:400;">(0 = Unlimited)</span></label>
        <input type="number" id="offer-form-max-usage" value="${offer.maxUsagePerAccount || 0}" placeholder="0" min="0">
        <span style="font-size:0.75rem;color:var(--text3);margin-top:4px;display:block;">Set how many times a single customer account can redeem this offer. Leave 0 for no restriction.</span>
      </div>

      <div class="gst-toggle-row" style="margin-bottom:0">
        <span>Offer Active</span>
        <label class="toggle-switch">
          <input type="checkbox" id="offer-form-active" ${offer.isActive ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>

      <div style="display:flex;gap:12px;margin-top:12px">
        <button class="btn btn-primary btn-block" onclick="saveOffer()" style="margin-bottom:0">💾 Save Changes</button>
        <button class="btn btn-secondary btn-block" onclick="closeCustomModal()" style="margin-bottom:0">Cancel</button>
      </div>
    </div>
  `;
  
  $('modal-content').innerHTML = html;
  $('modal-overlay').classList.add('active');
  if (offer.type === 'free_dish') {
    populateFreeDishList(offer.freeDishId || 'any');
  }
  setTimeout(attachAutoSuggestListeners, 50);
}

function handleOfferTypeChange() {
  const type = $('offer-form-type').value;
  const valueGroup = $('offer-value-group');
  const valueLabel = $('offer-value-label');
  const valueInput = $('offer-form-value');
  const freeDishGroup = $('offer-free-dish-group');
  
  if (type === 'free_dish') {
    valueGroup.style.display = 'none';
    valueInput.value = '0';
    freeDishGroup.style.display = 'block';
    populateFreeDishList($('offer-form-free-dish').value);
  } else {
    valueGroup.style.display = 'block';
    freeDishGroup.style.display = 'none';
    if (type === 'discount_percent') {
      valueLabel.textContent = 'Discount Percentage (%)';
      valueInput.placeholder = '10';
    } else {
      valueLabel.textContent = 'Discount Amount (₹)';
      valueInput.placeholder = '50';
    }
  }
  autoSuggestDescription();
}

function autoSuggestDescription() {
  const type = $('offer-form-type').value;
  const val = $('offer-form-value').value || '0';
  const minVal = $('offer-form-min-order').value || '0';
  const descInput = $('offer-form-description');
  
  let suggested = '';
  if (type === 'discount_percent') {
    suggested = `Get ${val}% off on orders above ₹${minVal}`;
  } else if (type === 'discount_flat') {
    suggested = `Get flat ₹${val} off on orders above ₹${minVal}`;
  } else if (type === 'free_dish') {
    const dishId = $('offer-form-free-dish').value;
    if (!dishId || dishId === 'any') {
      suggested = `Get any 1 dish free on orders above ₹${minVal}`;
    } else {
      let itemName = 'Item';
      let allItems = [];
      if (S.adminMenu && S.adminMenu.length) allItems = S.adminMenu;
      else {
        for (const cat in S.menu) allItems = allItems.concat(S.menu[cat] || []);
      }
      const item = allItems.find(m => m.id === dishId);
      if (item) itemName = item.name;
      suggested = `Get free ${itemName} on orders above ₹${minVal}`;
    }
  }
  descInput.value = suggested;
}

function attachAutoSuggestListeners() {
  const value = $('offer-form-value');
  const min = $('offer-form-min-order');
  
  if (value) value.addEventListener('input', autoSuggestDescription);
  if (min) min.addEventListener('input', autoSuggestDescription);
}

function populateFreeDishList(selectedId) {
  const container = $('offer-form-dish-list');
  if (!container) return;
  
  let allItems = [];
  if (S.adminMenu && S.adminMenu.length) {
    allItems = S.adminMenu;
  } else {
    for (const cat in S.menu) {
      allItems = allItems.concat(S.menu[cat] || []);
    }
  }
  
  const seen = {};
  allItems = allItems.filter(item => {
    if (seen[item.id]) return false;
    seen[item.id] = true;
    return true;
  });

  const selectedValue = selectedId || 'any';

  // Any Dish Option Row
  const isAnySelected = selectedValue === 'any';
  let html = `
    <div style="display:flex; align-items:center; gap:12px; padding:10px; border-radius:var(--radius-xs); cursor:pointer; border:1px solid ${isAnySelected ? 'var(--primary)' : 'var(--border)'}; background:${isAnySelected ? 'rgba(255,94,20,0.08)' : 'rgba(255,255,255,0.02)'}; transition: all 0.2s;" class="free-dish-option-row" data-id="any" onclick="setFreeDishValue('any')">
      <div class="custom-radio-circle" style="width:18px; height:18px; border-radius:50%; border:2px solid ${isAnySelected ? 'var(--primary)' : 'var(--text3)'}; display:flex; align-items:center; justify-content:center; flex-shrink:0; background:${isAnySelected ? 'var(--primary)' : 'transparent'}; transition:all 0.2s;">
        ${isAnySelected ? '<div style="width:6px; height:6px; border-radius:50%; background:#fff;"></div>' : ''}
      </div>
      <div style="display:flex; flex-direction:column; flex:1;">
        <strong style="font-size:0.85rem; color:var(--text1);">🌟 Any Dish (Cheapest in Cart)</strong>
        <span style="font-size:0.7rem; color:var(--text3); margin-top:2px;">Waive price of cheapest item in cart.</span>
      </div>
    </div>
  `;

  allItems.forEach(item => {
    const isSelected = selectedValue === item.id;
    const categoryName = item.category || 'Menu';
    html += `
      <div style="display:flex; align-items:center; gap:12px; padding:10px; border-radius:var(--radius-xs); cursor:pointer; border:1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}; background:${isSelected ? 'rgba(255,94,20,0.08)' : 'rgba(255,255,255,0.02)'}; transition: all 0.2s; margin-top:4px;" class="free-dish-option-row" data-id="${item.id}" onclick="setFreeDishValue('${item.id}')">
        <div class="custom-radio-circle" style="width:18px; height:18px; border-radius:50%; border:2px solid ${isSelected ? 'var(--primary)' : 'var(--text3)'}; display:flex; align-items:center; justify-content:center; flex-shrink:0; background:${isSelected ? 'var(--primary)' : 'transparent'}; transition:all 0.2s;">
          ${isSelected ? '<div style="width:6px; height:6px; border-radius:50%; background:#fff;"></div>' : ''}
        </div>
        <div style="display:flex; flex-direction:column; flex:1;">
          <strong style="font-size:0.85rem; color:var(--text1);">${item.name}</strong>
          <span style="font-size:0.7rem; color:var(--text3); margin-top:2px;">Price: ₹${item.price} | Category: ${categoryName}</span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  $('offer-form-free-dish').value = selectedValue;
}

function setFreeDishValue(val) {
  $('offer-form-free-dish').value = val;
  document.querySelectorAll('.free-dish-option-row').forEach(row => {
    const id = row.dataset.id;
    const isSelected = id === val;
    row.style.borderColor = isSelected ? 'var(--primary)' : 'var(--border)';
    row.style.background = isSelected ? 'rgba(255,94,20,0.08)' : 'rgba(255,255,255,0.02)';
    
    const circle = row.querySelector('.custom-radio-circle');
    if (circle) {
      circle.style.borderColor = isSelected ? 'var(--primary)' : 'var(--text3)';
      circle.style.background = isSelected ? 'var(--primary)' : 'transparent';
      circle.innerHTML = isSelected ? '<div style="width:6px; height:6px; border-radius:50%; background:#fff;"></div>' : '';
    }
  });
  autoSuggestDescription();
}

function filterFreeDishList() {
  const query = $('offer-form-dish-search').value.toLowerCase().trim();
  const rows = document.querySelectorAll('.free-dish-option-row');
  
  rows.forEach(row => {
    const id = row.dataset.id;
    if (id === 'any') {
      row.style.display = query === '' ? 'flex' : 'none';
      return;
    }
    
    const text = row.textContent.toLowerCase();
    if (text.includes(query)) {
      row.style.display = 'flex';
    } else {
      row.style.display = 'none';
    }
  });
}

async function saveOffer() {
  const idEl = $('offer-form-id');
  const code = $('offer-form-code').value.toUpperCase().trim();
  const type = $('offer-form-type').value;
  const value = parseFloat($('offer-form-value').value) || 0;
  const minVal = parseFloat($('offer-form-min-order').value) || 0;
  const description = $('offer-form-description').value.trim();
  const activeEl = $('offer-form-active');
  const isActive = activeEl ? activeEl.checked : true;
  const freeDishId = type === 'free_dish' ? $('offer-form-free-dish').value : '';
  const maxUsagePerAccount = parseInt($('offer-form-max-usage') ? $('offer-form-max-usage').value : '0') || 0;
  
  if (!code) return showToast('Please enter an offer code', 'error');
  if (!description) return showToast('Please enter a description', 'error');
  
  showLoader('Saving offer...');
  const isEdit = !!idEl;
  const action = isEdit ? 'updateOffer' : 'addOffer';
  const data = {
    code,
    type,
    value,
    freeDishId,
    minOrderValue: minVal,
    description,
    isActive,
    maxUsagePerAccount
  };
  if (isEdit) data.id = idEl.value;
  
  try {
    const r = await callServer(action, data);
    hideLoader();
    if (r.success) {
      showToast(r.message, 'success');
      closeCustomModal();
      loadAdminOffers();
    } else {
      showToast(r.message, 'error');
    }
  } catch(e) {
    hideLoader();
    showToast('Failed to save offer', 'error');
  }
}

async function deleteAdminOffer(offerId, code) {
  if (confirm(`Are you sure you want to delete offer ${code}?`)) {
    showLoader('Deleting offer...');
    try {
      const r = await callServer('deleteOffer', offerId);
      hideLoader();
      if (r.success) {
        showToast(r.message, 'success');
        loadAdminOffers();
      } else {
        showToast(r.message, 'error');
      }
    } catch(e) {
      hideLoader();
      showToast('Failed to delete offer', 'error');
    }
  }
}

async function toggleOfferAvail(offerId) {
  try {
    const r = await callServer('toggleOfferAvailability', offerId);
    if (r.success) {
      showToast(r.message, 'success');
      loadAdminOffers();
    } else {
      showToast(r.message, 'error');
      loadAdminOffers();
    }
  } catch(e) {
    showToast('Failed to toggle offer state', 'error');
    loadAdminOffers();
  }
}