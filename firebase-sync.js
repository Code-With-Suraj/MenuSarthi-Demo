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
    
    const spreadsheetIdLower = (CONFIG.SPREADSHEET_ID || "default").toLowerCase();
    const spreadsheetIdPreserved = CONFIG.SPREADSHEET_ID || "default";
    const email = `admin_${spreadsheetIdLower}@menusarthi.com`;
    
    // We will try multiple password variations in case it was created differently in past sessions
    const passwordsToTry = [
      `auth_${spreadsheetIdLower}`,
      `auth_${spreadsheetIdPreserved}`,
      spreadsheetIdPreserved,
      spreadsheetIdLower,
      "menusarthiadmin"
    ];

    let lastError = null;
    for (const password of passwordsToTry) {
      try {
        await firebase.auth().signInWithEmailAndPassword(email, password);
        const currentUser = firebase.auth().currentUser;
        console.log("Admin authenticated in Firebase. Email in token:", currentUser ? currentUser.email : "none");
        return true;
      } catch (e) {
        lastError = e;
        // If it's a password issue or user not found, we continue to try other passwords
        if (e.code !== 'auth/invalid-credential' && e.code !== 'auth/user-not-found') {
          break; // Stop if it's a network error or other blocking error
        }
      }
    }

    // If all login attempts failed, check if we should try creating the user
    if (lastError && (lastError.code === 'auth/user-not-found' || lastError.code === 'auth/invalid-credential')) {
      const defaultPassword = `auth_${spreadsheetIdLower}`;
      try {
        console.log("Admin user login failed. Attempting to create user programmatically...");
        await firebase.auth().createUserWithEmailAndPassword(email, defaultPassword);
        const currentUser = firebase.auth().currentUser;
        console.log("Admin user created and authenticated in Firebase. Email in token:", currentUser ? currentUser.email : "none");
        return true;
      } catch (createErr) {
        if (createErr.code === 'auth/email-already-in-use') {
          console.warn(`Admin email ${email} is already in use, but passwords did not match. Please verify the password or reset it in the Firebase Console.`);
        } else {
          console.error("Failed to create admin user programmatically:", createErr);
        }
      }
    }

    console.error("Admin Firebase authentication failed:", lastError);
    return false;
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

  // Update order delivery status
  async updateDeliveryStatus(orderId, deliveryStatus) {
    await this.init();
    const ordersRef = this.getOrdersRef();
    if (!ordersRef) return;

    try {
      const updates = {
        deliveryStatus: deliveryStatus,
        lastUpdated: firebase.database.ServerValue.TIMESTAMP
      };
      if (deliveryStatus === 'Delivered') {
        updates.status = 'Completed';
      }
      await ordersRef.child(orderId).update(updates);
      console.log(`Order ${orderId} delivery status updated in Firebase to ${deliveryStatus}.`);
    } catch (e) {
      console.error("Error updating delivery status in Firebase:", e);
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

    const currentUser = firebase.auth().currentUser;
    console.log("FirebaseSync: Subscribing to live orders. Current Auth state:", {
      uid: currentUser ? currentUser.uid : null,
      email: currentUser ? currentUser.email : null,
      isAnonymous: currentUser ? currentUser.isAnonymous : null
    });

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
