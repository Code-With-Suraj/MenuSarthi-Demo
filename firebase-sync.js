/**
 * MenuSarthi Firebase Real-time Database Sync Module
 * Manages connections, authentication, listeners and updates for orders.
 */
const FirebaseSync = {
  db: null,
  orderListener: null,
  liveOrdersListener: null,
  initialized: false,

  async init() {
    if (this.initialized) return;
    try {
      if (!CONFIG.FIREBASE || !CONFIG.FIREBASE.apiKey) {
        console.warn("Firebase config is missing or incomplete in config.js.");
        return;
      }
      
      // Initialize Firebase App
      firebase.initializeApp(CONFIG.FIREBASE);
      this.db = firebase.database();
      
      // Sign in anonymously for customer read/write permissions
      await firebase.auth().signInAnonymously();
      
      this.initialized = true;
      console.log("Firebase RTDB initialized & authenticated anonymously.");
    } catch (e) {
      console.error("Failed to initialize Firebase:", e);
    }
  },

  // Authenticate admin in Firebase using email/password
  async loginAdmin() {
    await this.init();
    
    const spreadsheetId = (CONFIG.SPREADSHEET_ID || "default").toLowerCase();
    const email = `admin_${spreadsheetId}@menusarthi.com`;
    const password = `auth_${spreadsheetId}`;

    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      console.log("Admin authenticated in Firebase.");
      return true;
    } catch (e) {
      // If user doesn't exist (invalid-credential or user-not-found), try to create it programmatically
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        try {
          console.log("Admin user not found in Firebase. Creating dynamically...");
          await firebase.auth().createUserWithEmailAndPassword(email, password);
          console.log("Admin user created and authenticated in Firebase.");
          return true;
        } catch (createErr) {
          console.error("Failed to create admin user programmatically:", createErr);
        }
      }
      console.error("Admin Firebase authentication failed:", e);
      return false;
    }
  },

  async logoutAdmin() {
    try {
      this.stopListeningToLiveOrders();
      await firebase.auth().signOut();
      // Revert to anonymous session
      await firebase.auth().signInAnonymously();
      console.log("Admin logged out from Firebase, reverted to anonymous.");
    } catch (e) {
      console.error("Error signing out admin from Firebase:", e);
    }
  },

  getOrdersRef() {
    if (!this.db) return null;
    const spreadsheetId = (CONFIG.SPREADSHEET_ID || "default").toLowerCase();
    return this.db.ref(`restaurants/${spreadsheetId}/orders`);
  },

  // Write order data (Customer places order)
  async pushOrder(orderData) {
    await this.init();
    const ordersRef = this.getOrdersRef();
    if (!ordersRef) return;

    try {
      const currentUser = firebase.auth().currentUser;
      const uid = currentUser ? currentUser.uid : null;
      
      // Embed dynamic uid for Firebase security rules matching
      const dataToSave = {
        ...orderData,
        uid: uid,
        lastUpdated: firebase.database.ServerValue.TIMESTAMP
      };

      await ordersRef.child(orderData.orderId).set(dataToSave);
      console.log(`Order ${orderData.orderId} synced to Firebase.`);
    } catch (e) {
      console.error("Error syncing order to Firebase:", e);
    }
  },

  // Update order status (Admin updates order)
  async updateOrderStatus(orderId, newStatus, etaMinutes = null) {
    await this.init();
    const ordersRef = this.getOrdersRef();
    if (!ordersRef) return;

    try {
      const updates = {
        status: newStatus,
        lastUpdated: firebase.database.ServerValue.TIMESTAMP
      };
      
      if (newStatus === 'Preparing' && etaMinutes) {
        const etaMinutesVal = parseInt(etaMinutes);
        if (!isNaN(etaMinutesVal) && etaMinutesVal > 0) {
          const estimatedTime = new Date(Date.now() + etaMinutesVal * 60 * 1000).toISOString();
          updates.estimatedReadyTime = estimatedTime;
        }
      }

      await ordersRef.child(orderId).update(updates);
      console.log(`Order ${orderId} status updated in Firebase to ${newStatus}.`);
    } catch (e) {
      console.error("Error updating order status in Firebase:", e);
    }
  },

  // Update order payment status
  async updatePaymentStatus(orderId, paymentStatus) {
    await this.init();
    const ordersRef = this.getOrdersRef();
    if (!ordersRef) return;

    try {
      await ordersRef.child(orderId).update({
        paymentStatus: paymentStatus,
        lastUpdated: firebase.database.ServerValue.TIMESTAMP
      });
      console.log(`Order ${orderId} payment status updated in Firebase to ${paymentStatus}.`);
    } catch (e) {
      console.error("Error updating payment status in Firebase:", e);
    }
  },

  // Delete order (Admin deletes order)
  async deleteOrder(orderId) {
    await this.init();
    const ordersRef = this.getOrdersRef();
    if (!ordersRef) return;

    try {
      await ordersRef.child(orderId).remove();
      console.log(`Order ${orderId} removed from Firebase.`);
    } catch (e) {
      console.error("Error deleting order from Firebase:", e);
    }
  },

  // Listen to single order status (Customer)
  async listenToOrder(orderId, callback) {
    await this.init();
    const ordersRef = this.getOrdersRef();
    if (!ordersRef) return;

    this.stopListeningToOrder();

    this.orderListener = ordersRef.child(orderId).on('value', (snapshot) => {
      const val = snapshot.val();
      callback(val);
    }, (error) => {
      console.error("Error reading order from Firebase:", error);
    });
  },

  stopListeningToOrder() {
    if (this.orderListener && this.db) {
      const ordersRef = this.getOrdersRef();
      if (ordersRef) {
        ordersRef.off('value', this.orderListener);
      }
      this.orderListener = null;
    }
  },

  // Listen to all live orders (Admin dashboard)
  async listenToLiveOrders(callback) {
    await this.init();
    const ordersRef = this.getOrdersRef();
    if (!ordersRef) return;

    this.stopListeningToLiveOrders();

    this.liveOrdersListener = ordersRef.on('value', (snapshot) => {
      const val = snapshot.val();
      callback(val);
    }, (error) => {
      console.error("Error reading live orders from Firebase:", error);
    });
  },

  stopListeningToLiveOrders() {
    if (this.liveOrdersListener && this.db) {
      const ordersRef = this.getOrdersRef();
      if (ordersRef) {
        ordersRef.off('value', this.liveOrdersListener);
      }
      this.liveOrdersListener = null;
    }
  }
};
