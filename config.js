const CONFIG = {
  // Replace this with your Google Apps Script Web App Deployment URL
  // Example: "https://script.google.com/macros/s/.../exec"
  GAS_API_URL: "https://script.google.com/macros/s/AKfycby7iJfXyvVleL_gp_mgNfetPDs2iyet5EZe4RJYMd_jVxPYtxdzFVy6Hhc_yZ6IoHnTHQ/exec",

  // The Google Spreadsheet ID of this restaurant's database (used as a namespace for Firebase multi-tenant isolation).
  // Note: MenuSarthi automatically syncs & overrides this from the GAS backend at launch if different.
  SPREADSHEET_ID: "1xoIKKpW_QJ__2X30_NXEPqrJxAEqW9gWvSXki2dAnx0",

  REQUEST_TIMEOUT: 30000,

  // Firebase Realtime Database configuration (shared/same for all clients)
  FIREBASE: {
    apiKey: "AIzaSyD-Y7B2KcLHYNaHmmLV7D1oFDkVBaAfhTo",
    authDomain: "menusarthi-e34f6.firebaseapp.com",
    databaseURL: "https://menusarthi-e34f6-default-rtdb.firebaseio.com",
    projectId: "menusarthi-e34f6",
    storageBucket: "menusarthi-e34f6.firebasestorage.app",
    messagingSenderId: "168191981682",
    appId: "1:168191981682:web:c0788ec89920306f4eeaeb",
    measurementId: "G-TL53VM8RKF"
  }
};

