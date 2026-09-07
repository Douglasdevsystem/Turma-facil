import { getDatabase, ref } from "firebase/database";
import { initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyA-mEeTeiwjy1NS_gHQxtvnkgE2VcNjh3w",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "turmafacil-811ce.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "turmafacil-811ce",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "turmafacil-811ce.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "741454026958",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:741454026958:web:e15552d46324c49927d89f",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://turmafacil-811ce-default-rtdb.firebaseio.com",
};

const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const dataRef = (path: string) => ref(database, path);
