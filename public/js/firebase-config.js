// Firebase web app config (Firebase console -> Project settings -> Your apps).
// These keys are safe to ship to the browser; data access is protected by firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyACM4prbD2ISubH7oSwO15x42QGhu--M9k",
  authDomain: "familytree-f0410.firebaseapp.com",
  projectId: "familytree-f0410",
  storageBucket: "familytree-f0410.firebasestorage.app",
  messagingSenderId: "721499833554",
  appId: "1:721499833554:web:63da73f5c0cc364904190b",
};

// Social sign-in providers to show. Each one must also be enabled in
// Firebase console -> Authentication -> Sign-in method.
// Supported: "google", "facebook", "twitter", "github", "microsoft"
export const enabledProviders = ["google", "facebook", "twitter", "github"];
